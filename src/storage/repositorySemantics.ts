import { canonicalSerialize, type CanonicalDigest } from "./canonicalEncoding";
import type { QualifiedRevisionEvidence, ResolutionHeadBinding } from "./recoveryArtifacts";
import type { CanonicalRevisionEnvelope } from "./envelopes";
import type { ProtocolFenceArtifactV1, RepresentationStateArtifactV1 } from "./authorityArtifacts";
import type { RevisionId, StoreId } from "./identity";

export type WriteGateScope = "record" | "store" | "namespace/store-selection";

export interface RepositoryWriteGate {
    readonly scope: WriteGateScope;
    readonly reason: string;
    readonly storeId?: StoreId;
    readonly recordId?: string;
}

export interface RevisionObservation {
    readonly envelope: CanonicalRevisionEnvelope;
    readonly digest: CanonicalDigest;
}

export type RecordRepositoryState =
    | "RECORD_ABSENT"
    | "RECORD_FOUND"
    | "EQUIVALENT_DUPLICATE"
    | "LINEAR_DESCENDANT"
    | "RESOLVED_LINEAGE"
    | "LINEAGE_INDETERMINATE"
    | "DIVERGENT_VALID_REVISIONS"
    | "REVISION_IDENTITY_INVALID"
    | "RECORD_INVALID";

export interface RecordRepositoryClassification {
    readonly state: RecordRepositoryState;
    readonly current?: RevisionObservation;
    readonly currentHeads?: readonly RevisionObservation[];
    readonly historicalResolvedRevisionIds?: readonly RevisionId[];
    readonly writeGate?: RepositoryWriteGate;
    readonly reason?: string;
}

function recordGate(observation: RevisionObservation | undefined, reason: string): RepositoryWriteGate {
    return {
        scope: "record",
        reason,
        storeId: observation?.envelope.storeId,
        recordId: observation?.envelope.recordId,
    };
}

function sameRecord(left: CanonicalRevisionEnvelope, right: CanonicalRevisionEnvelope): boolean {
    return left.storeId === right.storeId && left.recordKind === right.recordKind && left.recordId === right.recordId;
}

export interface RevisionGraphWorkEvent {
    readonly kind:
        | "identity-claim"
        | "node"
        | "parent-edge"
        | "cycle-visit"
        | "interval-visit"
        | "resolution-claim"
        | "candidate-head"
        | "ancestry-relation"
        | "resolution-relation";
    readonly revisionId?: RevisionId;
    readonly otherRevisionId?: RevisionId;
}

/** No numerical budgets here. False or a thrown refusal means no complete result. */
export type RevisionGraphWorkObserver = (event: RevisionGraphWorkEvent) => boolean | void;
export interface IncompleteRevisionGraphWork {
    readonly status: "INCOMPLETE";
    readonly reason: string;
}

export type RevisionIdentityClaimValidation =
    | {
          readonly status: "VALID";
          readonly observations: readonly RevisionObservation[];
          readonly sawEquivalentCopy: boolean;
      }
    | { readonly status: "INVALID"; readonly classification: RecordRepositoryClassification }
    | IncompleteRevisionGraphWork;

export interface IndexedRevisionInfo {
    readonly revisionId: RevisionId;
    readonly parentRevisionId: RevisionId | null | undefined;
    readonly missingBoundary: boolean;
    readonly cycleInvolvement: boolean;
    readonly component: number;
    readonly enter: number;
    readonly exit: number;
}

declare const indexedRevisionGraphBrand: unique symbol;
/** Opaque, complete index of caller-qualified evidence; it does not certify inventory completeness. */
export interface IndexedRevisionGraph {
    readonly [indexedRevisionGraphBrand]: true;
    readonly revisionIds: readonly RevisionId[];
    readonly missingBoundaryIds: readonly RevisionId[];
    readonly hasParentCycle: boolean;
    observation(revisionId: RevisionId): RevisionObservation | undefined;
    parentRevisionId(revisionId: RevisionId): RevisionId | null | undefined;
    children(revisionId: RevisionId): readonly RevisionId[];
    revisionInfo(revisionId: RevisionId): IndexedRevisionInfo | undefined;
}

export type IndexedRevisionGraphResult =
    | { readonly status: "COMPLETE"; readonly index: IndexedRevisionGraph }
    | { readonly status: "INVALID"; readonly classification: RecordRepositoryClassification }
    | IncompleteRevisionGraphWork;

export interface IndexedRevisionRelation {
    readonly relation: "equivalent" | "left-ancestor" | "right-ancestor" | "competing" | "unknown";
    readonly cycleInvolvement: boolean;
}
export type IndexedRevisionRelationResult =
    | ({ readonly status: "COMPLETE" } & IndexedRevisionRelation)
    | IncompleteRevisionGraphWork;
export interface CandidateLineageRelation extends IndexedRevisionRelation {
    readonly left: RevisionId;
    readonly right: RevisionId;
}
export type IndexedHeadEvaluation =
    | {
          readonly status: "COMPLETE";
          readonly classification: RecordRepositoryClassification;
          readonly pairRelations: readonly CandidateLineageRelation[];
      }
    | IncompleteRevisionGraphWork;

interface GraphData {
    readonly byId: Map<RevisionId, RevisionObservation>;
    readonly info: Map<RevisionId, IndexedRevisionInfo>;
    readonly children: Map<RevisionId, readonly RevisionId[]>;
    readonly claimsByTarget: Map<RevisionId, readonly RevisionId[]>;
    readonly knownRevisionIds: Set<RevisionId>;
    readonly sawEquivalentCopy: boolean;
    readonly hasParentCycle: boolean;
}
const issuedGraphs = new WeakMap<IndexedRevisionGraph, GraphData>();

class InterruptedGraphWork extends Error {}
function observeWork(observer: RevisionGraphWorkObserver | undefined, event: RevisionGraphWorkEvent): void {
    try {
        if (observer?.(event) === false) throw new InterruptedGraphWork("Revision graph work was refused.");
    } catch (error) {
        if (error instanceof InterruptedGraphWork) throw error;
        throw new InterruptedGraphWork(
            `Revision graph observer interrupted work: ${error instanceof Error ? error.message : "refusal"}`
        );
    }
}
function incomplete(error: InterruptedGraphWork): IncompleteRevisionGraphWork {
    return { status: "INCOMPLETE", reason: error.message };
}
function graphData(index: IndexedRevisionGraph): GraphData {
    const data = issuedGraphs.get(index);
    if (!data) throw new Error("Expected a complete issued revision graph index.");
    return data;
}
function requiredIndexValue<T>(value: T | undefined): T {
    if (value === undefined) throw new Error("Complete revision index invariant is missing.");
    return value;
}
function freezeJson<T>(value: T): T {
    const pending: object[] = value && typeof value === "object" ? [value] : [];
    while (pending.length) {
        const item = requiredIndexValue(pending.pop());
        const childValues: unknown[] = Object.values(item);
        for (const child of childValues) if (child && typeof child === "object") pending.push(child);
        Object.freeze(item);
    }
    return value;
}
function invalidRecord(observation: RevisionObservation | undefined, reason: string): RecordRepositoryClassification {
    return { state: "RECORD_INVALID", writeGate: recordGate(observation, reason), reason };
}

/** Complete already-validated claims, including non-authoritative preparation candidates. No head admission. */
export function validateRevisionIdentityClaims(
    claims: readonly RevisionObservation[],
    observer?: RevisionGraphWorkObserver
): RevisionIdentityClaimValidation {
    try {
        const byId = new Map<RevisionId, RevisionObservation>();
        const first = claims[0];
        let sawEquivalentCopy = false;
        for (const claim of claims) {
            observeWork(observer, { kind: "identity-claim", revisionId: claim.envelope.revisionId });
            if (first && !sameRecord(first.envelope, claim.envelope)) {
                return {
                    status: "INVALID",
                    classification: invalidRecord(
                        first,
                        "Observations do not belong to one store-bound logical record."
                    ),
                };
            }
            const previous = byId.get(claim.envelope.revisionId);
            if (previous) {
                if (
                    previous.digest !== claim.digest ||
                    canonicalSerialize(previous.envelope) !== canonicalSerialize(claim.envelope)
                ) {
                    const reason = `RevisionId ${claim.envelope.revisionId} has incompatible canonical content/digests.`;
                    return {
                        status: "INVALID",
                        classification: {
                            state: "REVISION_IDENTITY_INVALID",
                            currentHeads: [previous, claim],
                            writeGate: recordGate(first, reason),
                            reason,
                        },
                    };
                }
                sawEquivalentCopy = true;
            } else {
                // Keep later queries independent of mutable caller-owned envelope objects.
                const envelope = JSON.parse(canonicalSerialize(claim.envelope)) as CanonicalRevisionEnvelope;
                byId.set(claim.envelope.revisionId, freezeJson({ envelope, digest: claim.digest }));
            }
        }
        return { status: "VALID", observations: Object.freeze([...byId.values()]), sawEquivalentCopy };
    } catch (error) {
        if (error instanceof InterruptedGraphWork) return incomplete(error);
        throw error;
    }
}

/** Only explicitly caller-qualified roles contribute parent edges. Extra identity claims never do. */
export function indexQualifiedRevisionGraph(
    qualified: readonly QualifiedRevisionEvidence[],
    observer?: RevisionGraphWorkObserver,
    identityClaims: readonly RevisionObservation[] = []
): IndexedRevisionGraphResult {
    try {
        const observations: RevisionObservation[] = [];
        for (const evidence of qualified) {
            if (evidence.role === "DIRECT_CANONICAL") observations.push(evidence);
            else if (evidence.role === "QUALIFIED_PRIOR_PUBLICATION")
                observations.push({ envelope: evidence.evidence.envelope, digest: evidence.evidence.digest });
            else
                return {
                    status: "INVALID",
                    classification: invalidRecord(
                        undefined,
                        "Qualified revision evidence requires an explicit direct or prior-publication role."
                    ),
                };
        }
        const validation = validateRevisionIdentityClaims([...observations, ...identityClaims], observer);
        if (validation.status !== "VALID") return validation;
        const knownRevisionIds = new Set<RevisionId>();
        const validated = new Map(
            validation.observations.map((item) => {
                const envelope = item.envelope;
                // Identity references remain known even when their claim supplies no authority edges.
                knownRevisionIds.add(envelope.revisionId);
                if (envelope.parentRevisionId !== null) knownRevisionIds.add(envelope.parentRevisionId);
                for (const target of envelope.resolvedRevisionIds) knownRevisionIds.add(target);
                return [envelope.revisionId, item] as const;
            })
        );
        const byId = new Map<RevisionId, RevisionObservation>();
        let sawEquivalentCopy = false;
        for (const observation of observations) {
            const id = observation.envelope.revisionId;
            if (byId.has(id)) sawEquivalentCopy = true;
            byId.set(id, requiredIndexValue(validated.get(id)));
        }
        const parent = new Map<RevisionId, RevisionId | null | undefined>();
        const mutableChildren = new Map<RevisionId, RevisionId[]>();
        const claimsByTarget = new Map<RevisionId, RevisionId[]>();
        const ensureNode = (id: RevisionId, parentId: RevisionId | null | undefined) => {
            if (!parent.has(id)) {
                observeWork(observer, { kind: "node", revisionId: id });
                parent.set(id, parentId);
                mutableChildren.set(id, []);
            }
        };
        for (const [id, observation] of byId) ensureNode(id, observation.envelope.parentRevisionId);
        for (const [id, observation] of byId) {
            const parentId = observation.envelope.parentRevisionId;
            if (parentId !== null) {
                observeWork(observer, { kind: "parent-edge", revisionId: id, otherRevisionId: parentId });
                ensureNode(parentId, undefined);
                requiredIndexValue(mutableChildren.get(parentId)).push(id);
            }
            for (const target of observation.envelope.resolvedRevisionIds) {
                observeWork(observer, { kind: "resolution-claim", revisionId: id, otherRevisionId: target });
                const claiming = claimsByTarget.get(target) ?? [];
                claiming.push(id);
                claimsByTarget.set(target, claiming);
            }
        }
        const done = new Set<RevisionId>();
        const info = new Map<RevisionId, IndexedRevisionInfo>();
        let componentCount = 0;
        let hasParentCycle = false;
        // Functional parent graph: each node/edge is traversed once, including terminal placeholders.
        for (const start of parent.keys()) {
            if (done.has(start)) continue;
            const path: RevisionId[] = [];
            const positions = new Map<RevisionId, number>();
            let cursor = start;
            let component: number;
            let cyclic = false;
            while (true) {
                const known = info.get(cursor);
                if (known) {
                    component = known.component;
                    cyclic = known.cycleInvolvement;
                    break;
                }
                if (positions.has(cursor)) {
                    component = componentCount++;
                    cyclic = true;
                    hasParentCycle = true;
                    break;
                }
                observeWork(observer, { kind: "cycle-visit", revisionId: cursor });
                positions.set(cursor, path.length);
                path.push(cursor);
                const parentId = parent.get(cursor);
                if (parentId === null || parentId === undefined) {
                    component = componentCount++;
                    break;
                }
                cursor = parentId;
            }
            for (let i = path.length - 1; i >= 0; i--) {
                const id = path[i];
                info.set(id, {
                    revisionId: id,
                    parentRevisionId: parent.get(id),
                    missingBoundary: !byId.has(id),
                    cycleInvolvement: cyclic,
                    component,
                    enter: -1,
                    exit: -1,
                });
                done.add(id);
            }
        }
        let interval = 0;
        for (const [root, parentId] of parent) {
            if (parentId !== null && parentId !== undefined) continue;
            const pending: { id: RevisionId; exit: boolean }[] = [{ id: root, exit: false }];
            while (pending.length) {
                const frame = requiredIndexValue(pending.pop());
                observeWork(observer, { kind: "interval-visit", revisionId: frame.id });
                const metadata = requiredIndexValue(info.get(frame.id));
                if (frame.exit) {
                    info.set(frame.id, { ...metadata, exit: interval++ });
                    continue;
                }
                info.set(frame.id, { ...metadata, enter: interval++ });
                pending.push({ id: frame.id, exit: true });
                for (const child of requiredIndexValue(mutableChildren.get(frame.id)))
                    pending.push({ id: child, exit: false });
            }
        }
        const children = new Map([...mutableChildren].map(([id, ids]) => [id, Object.freeze(ids)]));
        const frozenClaims = new Map([...claimsByTarget].map(([id, ids]) => [id, Object.freeze(ids)]));
        for (const [id, metadata] of info) info.set(id, Object.freeze(metadata));
        const data: GraphData = {
            byId,
            info,
            children,
            claimsByTarget: frozenClaims,
            knownRevisionIds,
            sawEquivalentCopy,
            hasParentCycle,
        };
        const index = Object.freeze({
            revisionIds: Object.freeze([...byId.keys()]),
            missingBoundaryIds: Object.freeze([...parent.keys()].filter((id) => !byId.has(id))),
            hasParentCycle,
            observation: (id: RevisionId) => byId.get(id),
            parentRevisionId: (id: RevisionId) => parent.get(id),
            children: (id: RevisionId) => children.get(id) ?? Object.freeze([] as RevisionId[]),
            revisionInfo: (id: RevisionId) => info.get(id),
        }) as IndexedRevisionGraph;
        issuedGraphs.set(index, data); // Never issue a partly constructed index.
        return { status: "COMPLETE", index };
    } catch (error) {
        if (error instanceof InterruptedGraphWork) return incomplete(error);
        throw error;
    }
}

function relationKernel(
    data: GraphData,
    left: RevisionId,
    right: RevisionId,
    observer?: RevisionGraphWorkObserver
): IndexedRevisionRelation {
    observeWork(observer, { kind: "ancestry-relation", revisionId: left, otherRevisionId: right });
    const a = data.info.get(left);
    const b = data.info.get(right);
    const cycleInvolvement = Boolean(a?.cycleInvolvement || b?.cycleInvolvement);
    if (!a || !b) return { relation: "unknown", cycleInvolvement };
    if (left === right) return { relation: "equivalent", cycleInvolvement };
    if (cycleInvolvement || a.component !== b.component) return { relation: "unknown", cycleInvolvement };
    if (a.enter <= b.enter && b.exit <= a.exit) return { relation: "left-ancestor", cycleInvolvement };
    if (b.enter <= a.enter && a.exit <= b.exit) return { relation: "right-ancestor", cycleInvolvement };
    return { relation: "competing", cycleInvolvement };
}
export function relateIndexedRevisions(
    index: IndexedRevisionGraph,
    left: RevisionId,
    right: RevisionId,
    observer?: RevisionGraphWorkObserver
): IndexedRevisionRelationResult {
    try {
        return { status: "COMPLETE", ...relationKernel(graphData(index), left, right, observer) };
    } catch (error) {
        if (error instanceof InterruptedGraphWork) return incomplete(error);
        throw error;
    }
}

/** Pure convenience maxima over exactly this supplied set; S2 owns actual admitted inventory/maxima. */
function suppliedOrdinaryCandidates(index: IndexedRevisionGraph, observer?: RevisionGraphWorkObserver): RevisionId[] {
    const data = graphData(index);
    const ids: RevisionId[] = [];
    for (const id of index.revisionIds) {
        observeWork(observer, { kind: "candidate-head", revisionId: id });
        if (data.hasParentCycle || !requiredIndexValue(data.children.get(id)).length) ids.push(id);
    }
    return ids;
}
function orderedObservations(data: GraphData, ids: Iterable<RevisionId>): RevisionObservation[] {
    return [...ids].sort().map((id) => requiredIndexValue(data.byId.get(id)));
}
function blocked(
    data: GraphData,
    ids: readonly RevisionId[],
    state: "LINEAGE_INDETERMINATE" | "DIVERGENT_VALID_REVISIONS",
    reason: string
): RecordRepositoryClassification {
    const heads = orderedObservations(data, ids);
    return { state, currentHeads: heads, writeGate: recordGate(heads[0], reason), reason };
}

/** Evaluates only the caller's declared complete candidate set; never supplies inventory admission. */
export function evaluateIndexedHeadRelations(
    index: IndexedRevisionGraph,
    suppliedCandidateHeadIds: readonly RevisionId[],
    observer?: RevisionGraphWorkObserver
): IndexedHeadEvaluation {
    try {
        const data = graphData(index);
        const ids = [...new Set(suppliedCandidateHeadIds)];
        for (const id of ids) {
            observeWork(observer, { kind: "candidate-head", revisionId: id });
            if (!data.byId.has(id))
                return {
                    status: "COMPLETE",
                    classification: invalidRecord(
                        undefined,
                        "Candidate heads must be qualified nodes in the supplied index."
                    ),
                    pairRelations: [],
                };
        }
        if (data.hasParentCycle)
            return {
                status: "COMPLETE",
                classification: blocked(
                    data,
                    index.revisionIds,
                    "LINEAGE_INDETERMINATE",
                    "Qualified record parent links contain a cycle; resolution cannot cure it."
                ),
                pairRelations: [],
            };
        if (!ids.length)
            return {
                status: "COMPLETE",
                classification: data.byId.size
                    ? invalidRecord(undefined, "No candidate heads supplied for a nonempty qualified graph.")
                    : { state: "RECORD_ABSENT" },
                pairRelations: [],
            };
        const pairs: CandidateLineageRelation[] = [];
        let unknown = false;
        let nonmaximal = false;
        for (let left = 0; left < ids.length; left++) {
            for (let right = left + 1; right < ids.length; right++) {
                const relationship = relationKernel(data, ids[left], ids[right], observer);
                pairs.push({ left: ids[left], right: ids[right], ...relationship });
                unknown ||= relationship.relation === "unknown";
                nonmaximal ||= relationship.relation === "left-ancestor" || relationship.relation === "right-ancestor";
            }
        }
        const pairRelations = Object.freeze(pairs.map((pair) => Object.freeze(pair)));
        // Human C2: inspect all necessary relations before allowing any subset divergence or suppression.
        if (unknown)
            return {
                status: "COMPLETE",
                classification: blocked(
                    data,
                    ids,
                    "LINEAGE_INDETERMINATE",
                    "Required candidate lineage relations cannot be proven."
                ),
                pairRelations,
            };
        if (nonmaximal)
            return {
                status: "COMPLETE",
                classification: invalidRecord(
                    data.byId.get(ids[0]),
                    "Supplied candidate heads are not ordinary maximal lineages."
                ),
                pairRelations,
            };
        const targets = new Map(ids.map((id) => [id, new Set<RevisionId>()]));
        const incoming = new Map(ids.map((id) => [id, 0]));
        for (const target of ids) {
            for (const resolver of data.claimsByTarget.get(target) ?? []) {
                for (const current of ids) {
                    if (current === target) continue;
                    observeWork(observer, {
                        kind: "resolution-relation",
                        revisionId: resolver,
                        otherRevisionId: current,
                    });
                    const relationship = relationKernel(data, resolver, current, observer);
                    if (relationship.relation !== "equivalent" && relationship.relation !== "left-ancestor") continue;
                    const selected = requiredIndexValue(targets.get(current));
                    if (!selected.has(target)) {
                        selected.add(target);
                        incoming.set(target, requiredIndexValue(incoming.get(target)) + 1);
                    }
                }
            }
        }
        // Diagnose cyclic applicability before any head can be hidden by another resolver.
        const topologicalIncoming = new Map(incoming);
        const topologicalQueue = ids.filter((id) => topologicalIncoming.get(id) === 0);
        let visited = 0;
        for (let position = 0; position < topologicalQueue.length; position++) {
            const resolver = topologicalQueue[position];
            visited++;
            observeWork(observer, { kind: "resolution-relation", revisionId: resolver });
            for (const target of requiredIndexValue(targets.get(resolver))) {
                const remaining = requiredIndexValue(topologicalIncoming.get(target)) - 1;
                topologicalIncoming.set(target, remaining);
                if (remaining === 0) topologicalQueue.push(target);
            }
        }
        if (visited !== ids.length)
            return {
                status: "COMPLETE",
                classification: blocked(
                    data,
                    ids,
                    "LINEAGE_INDETERMINATE",
                    "Current resolution claims form a cycle; current authority is indeterminate."
                ),
                pairRelations,
            };
        const alive = new Set(ids);
        const resolvedAway = new Set<RevisionId>();
        let active = ids.filter((id) => incoming.get(id) === 0);
        while (active.length) {
            const removed = new Set<RevisionId>();
            for (const resolver of active) {
                observeWork(observer, { kind: "resolution-relation", revisionId: resolver });
                for (const target of requiredIndexValue(targets.get(resolver)))
                    if (alive.has(target)) removed.add(target);
            }
            for (const target of removed) {
                alive.delete(target);
                resolvedAway.add(target);
            }
            const newlyActive: RevisionId[] = [];
            for (const stale of removed) {
                for (const target of requiredIndexValue(targets.get(stale))) {
                    if (!alive.has(target)) continue;
                    const remaining = requiredIndexValue(incoming.get(target)) - 1;
                    incoming.set(target, remaining);
                    if (remaining === 0) newlyActive.push(target);
                }
            }
            active = newlyActive; // Removed resolvers never exercise their stale claims.
        }
        let classification: RecordRepositoryClassification;
        if (alive.size > 1)
            classification = blocked(
                data,
                [...alive],
                "DIVERGENT_VALID_REVISIONS",
                "Multiple proven competing revision heads remain."
            );
        else if (!alive.size)
            classification = blocked(
                data,
                ids,
                "LINEAGE_INDETERMINATE",
                "Resolution provenance suppresses every observed head."
            );
        else {
            const current = requiredIndexValue(data.byId.get([...alive][0]));
            if (resolvedAway.size)
                classification = {
                    state: "RESOLVED_LINEAGE",
                    current,
                    historicalResolvedRevisionIds: [...resolvedAway].sort(),
                };
            else if (data.byId.size === 1)
                classification = { state: data.sawEquivalentCopy ? "EQUIVALENT_DUPLICATE" : "RECORD_FOUND", current };
            else classification = { state: "LINEAR_DESCENDANT", current };
        }
        return { status: "COMPLETE", classification, pairRelations };
    } catch (error) {
        if (error instanceof InterruptedGraphWork) return incomplete(error);
        throw error;
    }
}

/** Historical API: caller-validated explicit evidence only; all semantics delegate to the one indexed core. */
export function classifyRecordRevisions(observations: readonly RevisionObservation[]): RecordRepositoryClassification {
    const built = indexQualifiedRevisionGraph(observations.map((item) => ({ role: "DIRECT_CANONICAL", ...item })));
    if (built.status === "INVALID") return built.classification;
    if (built.status === "INCOMPLETE") throw new Error(built.reason);
    const evaluated = evaluateIndexedHeadRelations(built.index, suppliedOrdinaryCandidates(built.index));
    if (evaluated.status === "INCOMPLETE") throw new Error(evaluated.reason);
    return evaluated.classification;
}

export type ExplicitResolutionValidation =
    | { readonly valid: true; readonly resolvedRevisionIds: readonly RevisionId[] }
    | { readonly valid: false; readonly reason: string };
export type IndexedExplicitResolutionValidation =
    | { readonly status: "COMPLETE"; readonly validation: ExplicitResolutionValidation }
    | IncompleteRevisionGraphWork;

function explicitCoverageKernel(
    resolution: CanonicalRevisionEnvelope,
    index: IndexedRevisionGraph,
    result: RecordRepositoryClassification,
    headBindings: readonly ResolutionHeadBinding[],
    observer?: RevisionGraphWorkObserver
): IndexedExplicitResolutionValidation {
    try {
        const reject = (reason: string): IndexedExplicitResolutionValidation => ({
            status: "COMPLETE",
            validation: { valid: false, reason },
        });
        if (resolution.resolvedRevisionIds.length < 2)
            return reject("Explicit resolution requires at least two competing heads.");
        if (result.state !== "DIVERGENT_VALID_REVISIONS" || !result.currentHeads)
            return reject("Resolution coverage requires a proven divergent pre-resolution head set.");
        if (result.currentHeads.some((head) => !sameRecord(resolution, head.envelope)))
            return reject("Resolution and competing heads must belong to the same store-bound record.");
        const data = graphData(index);
        const competingHeadIds = result.currentHeads.map((head) => head.envelope.revisionId).sort();
        if (resolution.parentRevisionId === null || !competingHeadIds.includes(resolution.parentRevisionId))
            return reject("Resolution parent must be one of the adjudicated competing heads.");
        // Missing content or stale provenance never frees an already named revision identity.
        if (data.knownRevisionIds.has(resolution.revisionId))
            return reject("Resolution revisionId must be fresh relative to pre-resolution history.");
        const suppliedBindings = new Map<RevisionId, CanonicalDigest>();
        for (const head of headBindings) {
            observeWork(observer, { kind: "candidate-head", revisionId: head.revisionId });
            if (suppliedBindings.has(head.revisionId)) return reject("Head digest bindings must be unique.");
            suppliedBindings.set(head.revisionId, head.digest);
        }
        if (
            headBindings.length !== competingHeadIds.length ||
            result.currentHeads.some((head) => suppliedBindings.get(head.envelope.revisionId) !== head.digest)
        )
            return reject("Head bindings must exactly match the complete qualified head IDs/digests.");
        const listed = resolution.resolvedRevisionIds;
        if (
            listed.length !== competingHeadIds.length ||
            listed.some((id, position) => id !== competingHeadIds[position])
        )
            return reject("resolvedRevisionIds must equal the complete proven competing-head set.");
        return { status: "COMPLETE", validation: { valid: true, resolvedRevisionIds: Object.freeze([...listed]) } };
    } catch (error) {
        if (error instanceof InterruptedGraphWork) return incomplete(error);
        throw error;
    }
}

/** Caller supplies complete candidate IDs and exact head digest bindings; no inventory completeness inference. */
export function validateExplicitResolutionCoverageFromHeads(
    resolution: CanonicalRevisionEnvelope,
    index: IndexedRevisionGraph,
    candidateHeadIds: readonly RevisionId[],
    headBindings: readonly ResolutionHeadBinding[],
    observer?: RevisionGraphWorkObserver
): IndexedExplicitResolutionValidation {
    const evaluated = evaluateIndexedHeadRelations(index, candidateHeadIds, observer);
    if (evaluated.status === "INCOMPLETE") return evaluated;
    return explicitCoverageKernel(resolution, index, evaluated.classification, headBindings, observer);
}

/** Compatibility over caller-declared evidence; coverage and classification use the same indexed kernel. */
export function validateExplicitResolutionCoverage(
    resolution: CanonicalRevisionEnvelope,
    observations: readonly RevisionObservation[]
): ExplicitResolutionValidation {
    const built = indexQualifiedRevisionGraph(observations.map((item) => ({ role: "DIRECT_CANONICAL", ...item })));
    if (built.status !== "COMPLETE")
        return {
            valid: false,
            reason:
                built.status === "INCOMPLETE"
                    ? built.reason
                    : "Resolution coverage requires a proven divergent pre-resolution head set.",
        };
    const candidates = suppliedOrdinaryCandidates(built.index);
    const evaluation = evaluateIndexedHeadRelations(built.index, candidates);
    if (evaluation.status === "INCOMPLETE") return { valid: false, reason: evaluation.reason };
    const bindings = (evaluation.classification.currentHeads ?? []).map((head) => ({
        revisionId: head.envelope.revisionId,
        digest: head.digest,
    }));
    const result = explicitCoverageKernel(resolution, built.index, evaluation.classification, bindings);
    return result.status === "COMPLETE" ? result.validation : { valid: false, reason: result.reason };
}

export interface StoreCandidateObservation {
    readonly candidateId: string;
    /** Store IDs read from store-bound artifacts within this one candidate. */
    readonly storeIds: readonly StoreId[];
}

export type StoreInventoryState = "NO_STORE" | "ONE_STORE" | "MULTIPLE_STORE_IDS" | "MIXED_STORE_INVALID";

export interface StoreInventoryClassification {
    readonly state: StoreInventoryState;
    readonly storeIds: readonly StoreId[];
    readonly writeGate?: RepositoryWriteGate;
    readonly reason?: string;
}

export function classifyStoreInventory(candidates: readonly StoreCandidateObservation[]): StoreInventoryClassification {
    const allStoreIds = new Set<StoreId>();
    for (const candidate of candidates) {
        const candidateStoreIds = new Set(candidate.storeIds);
        for (const storeId of candidateStoreIds) allStoreIds.add(storeId);
        if (candidateStoreIds.size > 1) {
            const reason = `Candidate ${candidate.candidateId} contains more than one storeId.`;
            return {
                state: "MIXED_STORE_INVALID",
                storeIds: [...candidateStoreIds].sort(),
                writeGate: { scope: "store", reason },
                reason,
            };
        }
    }

    const storeIds = [...allStoreIds].sort();
    if (!storeIds.length) return { state: "NO_STORE", storeIds };
    if (storeIds.length === 1) return { state: "ONE_STORE", storeIds };
    const reason = "Multiple coherent logical store IDs are present; selection is ambiguous.";
    return {
        state: "MULTIPLE_STORE_IDS",
        storeIds,
        writeGate: { scope: "namespace/store-selection", reason },
        reason,
    };
}

export type ProtocolFenceState =
    | "WRITES_ALLOWED"
    | "READ_ONLY_MISSING_FENCE"
    | "READ_ONLY_UNRECOGNIZED_FENCE"
    | "READ_ONLY_UNSUPPORTED_NEWER_PROTOCOL"
    | "READ_ONLY_MIXED_STORE";

export interface ProtocolFenceAssessment {
    readonly state: ProtocolFenceState;
    readonly writeGate?: RepositoryWriteGate;
    readonly requiredProtocolVersion?: number;
    readonly reason?: string;
}

export function assessProtocolWriteFence(
    expectedStoreId: StoreId,
    markers: readonly ProtocolFenceArtifactV1[],
    supportedProtocolVersion: number,
    unrecognizedArtifactCount = 0
): ProtocolFenceAssessment {
    if (!Number.isSafeInteger(supportedProtocolVersion) || supportedProtocolVersion < 1) {
        throw new Error("supportedProtocolVersion must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(unrecognizedArtifactCount) || unrecognizedArtifactCount < 0) {
        throw new Error("unrecognizedArtifactCount must be a nonnegative safe integer.");
    }
    if (markers.some((marker) => marker.storeId !== expectedStoreId)) {
        const reason = "Protocol fence evidence contains a different storeId.";
        return { state: "READ_ONLY_MIXED_STORE", writeGate: { scope: "store", reason }, reason };
    }
    if (unrecognizedArtifactCount > 0) {
        const reason = "Unrecognized artifacts in the protocol-fence namespace fail closed for writes.";
        return {
            state: "READ_ONLY_UNRECOGNIZED_FENCE",
            writeGate: { scope: "store", storeId: expectedStoreId, reason },
            reason,
        };
    }
    if (!markers.length) {
        const reason = "No supported protocol fence was observed for this store.";
        return {
            state: "READ_ONLY_MISSING_FENCE",
            writeGate: { scope: "store", storeId: expectedStoreId, reason },
            reason,
        };
    }

    const requiredProtocolVersion = Math.max(...markers.map((marker) => marker.requiredProtocolVersion));
    if (requiredProtocolVersion > supportedProtocolVersion) {
        const reason = `Store requires protocol ${requiredProtocolVersion}, above supported ${supportedProtocolVersion}.`;
        return {
            state: "READ_ONLY_UNSUPPORTED_NEWER_PROTOCOL",
            requiredProtocolVersion,
            writeGate: { scope: "store", storeId: expectedStoreId, reason },
            reason,
        };
    }
    return { state: "WRITES_ALLOWED", requiredProtocolVersion };
}

export interface RepresentationStateObservation {
    readonly artifact: RepresentationStateArtifactV1;
    readonly digest: CanonicalDigest;
}

export type RepresentationLineageState =
    | "REPRESENTATION_STATE_ABSENT"
    | "REPRESENTATION_STATE_VALID"
    | "REPRESENTATION_STATE_DIVERGENT"
    | "LINEAGE_INDETERMINATE"
    | "REPRESENTATION_STATE_INVALID";

export interface RepresentationLineageClassification {
    readonly state: RepresentationLineageState;
    readonly currentHeads?: readonly RepresentationStateObservation[];
    readonly writeGate?: RepositoryWriteGate;
    readonly reason?: string;
}

export function validateRepresentationStateLineage(
    observations: readonly RepresentationStateObservation[],
    expectedStoreId?: StoreId
): RepresentationLineageClassification {
    if (!observations.length) return { state: "REPRESENTATION_STATE_ABSENT" };
    const first = observations[0].artifact;
    const byId = new Map<RepresentationStateArtifactV1["representationStateId"], RepresentationStateObservation>();
    for (const observation of observations) {
        const artifact = observation.artifact;
        if (artifact.storeId !== first.storeId || (expectedStoreId && artifact.storeId !== expectedStoreId)) {
            const reason = "Representation-state artifacts do not share the expected storeId.";
            return { state: "REPRESENTATION_STATE_INVALID", writeGate: { scope: "store", reason }, reason };
        }
        const previous = byId.get(artifact.representationStateId);
        if (previous && previous.digest !== observation.digest) {
            const reason = `RepresentationStateId ${artifact.representationStateId} has different digests.`;
            return {
                state: "REPRESENTATION_STATE_INVALID",
                writeGate: { scope: "store", storeId: first.storeId, reason },
                reason,
            };
        }
        byId.set(artifact.representationStateId, observation);
        if (artifact.parentRepresentationStateId === artifact.representationStateId) {
            const reason = "Representation state cannot be its own parent.";
            return {
                state: "REPRESENTATION_STATE_INVALID",
                writeGate: { scope: "store", storeId: first.storeId, reason },
                reason,
            };
        }
        if (artifact.parentRepresentationStateId === null && artifact.establishedByMigrationId !== null) {
            const reason = "Representation-state genesis must not claim a migration ID.";
            return {
                state: "REPRESENTATION_STATE_INVALID",
                writeGate: { scope: "store", storeId: first.storeId, reason },
                reason,
            };
        }
        if (artifact.parentRepresentationStateId !== null && artifact.establishedByMigrationId === null) {
            const reason = "A representation-state child must identify the establishing migration.";
            return {
                state: "REPRESENTATION_STATE_INVALID",
                writeGate: { scope: "store", storeId: first.storeId, reason },
                reason,
            };
        }
    }

    const unique = [...byId.values()];
    const missingParent = unique.find(
        (item) =>
            item.artifact.parentRepresentationStateId !== null && !byId.has(item.artifact.parentRepresentationStateId)
    );
    if (missingParent) {
        const reason = `Parent representation state ${missingParent.artifact.parentRepresentationStateId} is not observed.`;
        return {
            state: "LINEAGE_INDETERMINATE",
            writeGate: { scope: "store", storeId: first.storeId, reason },
            reason,
        };
    }

    for (const item of unique) {
        const visited = new Set<string>();
        let cursor: RepresentationStateObservation | undefined = item;
        while (cursor?.artifact.parentRepresentationStateId) {
            const currentId = cursor.artifact.representationStateId;
            if (visited.has(currentId)) {
                const reason = "Representation-state parent links contain a cycle.";
                return {
                    state: "REPRESENTATION_STATE_INVALID",
                    writeGate: { scope: "store", storeId: first.storeId, reason },
                    reason,
                };
            }
            visited.add(currentId);
            cursor = byId.get(cursor.artifact.parentRepresentationStateId);
        }
    }

    const parentIds = new Set(
        unique
            .map((item) => item.artifact.parentRepresentationStateId)
            .filter((id): id is NonNullable<typeof id> => id !== null)
    );
    const heads = unique.filter((item) => !parentIds.has(item.artifact.representationStateId));
    if (heads.length > 1) {
        const reason = "Multiple representation-state heads are present.";
        return {
            state: "REPRESENTATION_STATE_DIVERGENT",
            currentHeads: heads,
            writeGate: { scope: "store", storeId: first.storeId, reason },
            reason,
        };
    }
    if (heads.length === 0) {
        const reason = "Representation-state lineage has no root or head.";
        return {
            state: "REPRESENTATION_STATE_INVALID",
            writeGate: { scope: "store", storeId: first.storeId, reason },
            reason,
        };
    }
    return { state: "REPRESENTATION_STATE_VALID", currentHeads: heads };
}
