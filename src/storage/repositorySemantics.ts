import type { CanonicalDigest } from "./canonicalEncoding";
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

type Proof = true | false | "unknown";

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

interface AncestryTrace {
    readonly revisionIds: readonly RevisionId[];
    readonly valid: boolean;
}

function traceAncestry(start: RevisionId, byId: Map<RevisionId, RevisionObservation>): AncestryTrace {
    const revisionIds: RevisionId[] = [];
    const visited = new Set<RevisionId>();
    let cursorId: RevisionId | undefined = start;
    while (cursorId) {
        if (visited.has(cursorId)) return { revisionIds, valid: false };
        visited.add(cursorId);
        revisionIds.push(cursorId);
        const current = byId.get(cursorId);
        if (!current) return { revisionIds, valid: true };
        const parentId = current.envelope.parentRevisionId;
        if (parentId === null) return { revisionIds, valid: true };
        cursorId = parentId;
    }
    return { revisionIds, valid: false };
}

function relation(
    left: RevisionObservation,
    right: RevisionObservation,
    byId: Map<RevisionId, RevisionObservation>
): "left-ancestor" | "right-ancestor" | "unrelated" | "unknown" {
    const leftPath = traceAncestry(left.envelope.revisionId, byId);
    const rightPath = traceAncestry(right.envelope.revisionId, byId);
    if (!leftPath.valid || !rightPath.valid) return "unknown";

    if (rightPath.revisionIds.includes(left.envelope.revisionId)) return "left-ancestor";
    if (leftPath.revisionIds.includes(right.envelope.revisionId)) return "right-ancestor";
    if (leftPath.revisionIds.some((revisionId) => rightPath.revisionIds.includes(revisionId))) return "unrelated";

    // Separate roots or missing chains do not establish a competing branch unless
    // retained parent IDs prove that both revisions share a common base.
    return "unknown";
}

function isResolvedHistoricalHead(
    historicalId: RevisionId,
    current: RevisionObservation,
    byId: Map<RevisionId, RevisionObservation>
): Proof {
    let cursor: RevisionObservation | undefined = current;
    const visited = new Set<RevisionId>();
    while (cursor) {
        const cursorId = cursor.envelope.revisionId;
        if (visited.has(cursorId)) return "unknown";
        visited.add(cursorId);
        if (cursor.envelope.resolvedRevisionIds.includes(historicalId)) return true;
        const parentId = cursor.envelope.parentRevisionId;
        if (parentId === null) return false;
        cursor = byId.get(parentId);
        if (!cursor) return "unknown";
    }
    return "unknown";
}

function invalidRecord(observation: RevisionObservation | undefined, reason: string): RecordRepositoryClassification {
    return {
        state: "RECORD_INVALID",
        writeGate: recordGate(observation, reason),
        reason,
    };
}

/** Classifies only the supplied, already-validated observations; it never discovers files or selects by path. */
export function classifyRecordRevisions(observations: readonly RevisionObservation[]): RecordRepositoryClassification {
    if (!observations.length) return { state: "RECORD_ABSENT" };
    const first = observations[0];
    if (observations.some((item) => !sameRecord(first.envelope, item.envelope))) {
        return invalidRecord(first, "Observations do not belong to one store-bound logical record.");
    }

    const byId = new Map<RevisionId, RevisionObservation>();
    let sawEquivalentCopy = false;
    for (const observation of observations) {
        const revisionId = observation.envelope.revisionId;
        const previous = byId.get(revisionId);
        if (!previous) {
            byId.set(revisionId, observation);
            continue;
        }
        if (previous.digest !== observation.digest) {
            const reason = `RevisionId ${revisionId} has more than one canonical digest.`;
            return {
                state: "REVISION_IDENTITY_INVALID",
                currentHeads: [previous, observation],
                writeGate: recordGate(first, reason),
                reason,
            };
        }
        sawEquivalentCopy = true;
    }

    const revisions = [...byId.values()];
    if (revisions.length === 1) {
        return sawEquivalentCopy
            ? { state: "EQUIVALENT_DUPLICATE", current: revisions[0] }
            : { state: "RECORD_FOUND", current: revisions[0] };
    }

    const superseded = new Set<RevisionId>();
    for (let leftIndex = 0; leftIndex < revisions.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < revisions.length; rightIndex += 1) {
            const left = revisions[leftIndex];
            const right = revisions[rightIndex];
            const relationship = relation(left, right, byId);
            if (relationship === "left-ancestor") superseded.add(left.envelope.revisionId);
            if (relationship === "right-ancestor") superseded.add(right.envelope.revisionId);
        }
    }

    const heads = revisions.filter((item) => !superseded.has(item.envelope.revisionId));
    let currentHeads = [...heads];
    const resolvedAway = new Set<RevisionId>();
    while (currentHeads.length) {
        const targetsByResolver = new Map<RevisionId, Set<RevisionId>>();
        const resolvedByAnotherHead = new Set<RevisionId>();
        for (const historical of currentHeads) {
            for (const resolver of currentHeads) {
                if (historical.envelope.revisionId === resolver.envelope.revisionId) continue;
                if (isResolvedHistoricalHead(historical.envelope.revisionId, resolver, byId) !== true) continue;
                const resolverId = resolver.envelope.revisionId;
                const targets = targetsByResolver.get(resolverId) ?? new Set<RevisionId>();
                targets.add(historical.envelope.revisionId);
                targetsByResolver.set(resolverId, targets);
                resolvedByAnotherHead.add(historical.envelope.revisionId);
            }
        }

        // Only undominated current lineages may exercise resolution provenance.
        // A resolver that is itself resolved by a newer current lineage is stale;
        // its old claims must not suppress additional heads.
        const activeResolvers = currentHeads.filter((head) => !resolvedByAnotherHead.has(head.envelope.revisionId));
        if (!activeResolvers.length && targetsByResolver.size) {
            const reason = "Current resolution claims form a cycle; current authority is indeterminate.";
            return {
                state: "LINEAGE_INDETERMINATE",
                currentHeads: heads,
                writeGate: recordGate(first, reason),
                reason,
            };
        }

        const selectedTargets = new Set<RevisionId>();
        for (const resolver of activeResolvers) {
            for (const target of targetsByResolver.get(resolver.envelope.revisionId) ?? []) {
                selectedTargets.add(target);
            }
        }
        if (!selectedTargets.size) break;
        for (const target of selectedTargets) resolvedAway.add(target);
        currentHeads = currentHeads.filter((head) => !selectedTargets.has(head.envelope.revisionId));
    }
    if (!currentHeads.length) {
        const reason = "Resolution provenance suppresses every observed head; current authority is indeterminate.";
        return {
            state: "LINEAGE_INDETERMINATE",
            currentHeads: heads,
            writeGate: recordGate(first, reason),
            reason,
        };
    }

    for (let leftIndex = 0; leftIndex < currentHeads.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < currentHeads.length; rightIndex += 1) {
            const relationship = relation(currentHeads[leftIndex], currentHeads[rightIndex], byId);
            if (relationship === "unrelated") {
                const reason = "Multiple proven competing revision heads remain.";
                return {
                    state: "DIVERGENT_VALID_REVISIONS",
                    currentHeads,
                    writeGate: recordGate(first, reason),
                    reason,
                };
            }
            if (relationship === "unknown") {
                const reason = "Revision ancestry cannot be proven from retained parent links.";
                return {
                    state: "LINEAGE_INDETERMINATE",
                    currentHeads,
                    writeGate: recordGate(first, reason),
                    reason,
                };
            }
        }
    }

    if (currentHeads.length > 1) {
        const reason = "More than one current head remains without a proven ordering.";
        return {
            state: "LINEAGE_INDETERMINATE",
            currentHeads,
            writeGate: recordGate(first, reason),
            reason,
        };
    }

    if (resolvedAway.size) {
        return {
            state: "RESOLVED_LINEAGE",
            current: currentHeads[0],
            historicalResolvedRevisionIds: [...resolvedAway].sort(),
        };
    }

    return { state: "LINEAR_DESCENDANT", current: currentHeads[0] };
}

export type ExplicitResolutionValidation =
    | { readonly valid: true; readonly resolvedRevisionIds: readonly RevisionId[] }
    | { readonly valid: false; readonly reason: string };

/** Requires the explicit operation to adjudicate exactly the repository's proven competing-head set. */
export function validateExplicitResolutionCoverage(
    resolution: CanonicalRevisionEnvelope,
    preResolutionObservations: readonly RevisionObservation[]
): ExplicitResolutionValidation {
    const listed = resolution.resolvedRevisionIds;
    if (listed.length < 2) {
        return { valid: false, reason: "Explicit resolution requires at least two competing heads." };
    }

    const preResolution = classifyRecordRevisions(preResolutionObservations);
    if (preResolution.state !== "DIVERGENT_VALID_REVISIONS" || !preResolution.currentHeads) {
        return { valid: false, reason: "Resolution coverage requires a proven divergent pre-resolution head set." };
    }
    const heads = preResolution.currentHeads;
    if (heads.some((head) => !sameRecord(resolution, head.envelope))) {
        return { valid: false, reason: "Resolution and competing heads must belong to the same store-bound record." };
    }
    const competingHeadIds = heads.map((head) => head.envelope.revisionId).sort();
    if (resolution.parentRevisionId === null || !competingHeadIds.includes(resolution.parentRevisionId)) {
        return { valid: false, reason: "Resolution parent must be one of the adjudicated competing heads." };
    }
    if (preResolutionObservations.some((observation) => observation.envelope.revisionId === resolution.revisionId)) {
        return { valid: false, reason: "Resolution revisionId must be fresh relative to pre-resolution history." };
    }

    if (listed.length !== competingHeadIds.length || listed.some((id, index) => id !== competingHeadIds[index])) {
        return { valid: false, reason: "resolvedRevisionIds must equal the complete proven competing-head set." };
    }
    return { valid: true, resolvedRevisionIds: listed };
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
