/** Batch4 scoped observation/admission/metadata facts; no record repository or permission engine. */
import {
    discoverArtifactEvidenceInvocationV05,
    supportedDeclarationContexts,
    type ArtifactEvidenceInputV05,
    type ArtifactEvidenceInvocationV05,
    type ArtifactEvidenceResultV05,
} from "./discoverySemanticsV05";
import {
    snapshotAggregateLimits,
    type DiscoveryAggregateLimitsV05,
    type DiscoveryBudgetSnapshot,
    type DiscoveryBudgetRefusal,
    type DiscoveryBudgetAxis,
} from "./discoveryBudget";
import {
    assessProtocolWriteFence,
    classifyStoreInventory,
    validateRepresentationStateLineage,
    type ProtocolFenceState,
    type RepresentationLineageState,
} from "./repositorySemantics";
import { canonicalSerialize, type CanonicalDigest } from "./canonicalEncoding";
import { REQUIRED_PROTOCOL_VERSION } from "./protocol";
import type { StoreId, RepresentationStateId, MigrationId } from "./identity";
import type { RepresentationStateArtifactV1 } from "./authorityArtifacts";
import type {
    StoreDeclarationGroupV05,
    RepresentationProbeV05,
    QualifiedStoreBoundAbsenceV05,
} from "./discoveryTraversalV05";

export interface StorageAggregateInputV05 extends ArtifactEvidenceInputV05 {
    readonly limits: ArtifactEvidenceInputV05["limits"] & DiscoveryAggregateLimitsV05;
}
export interface ScopedCompletionV05 {
    readonly scopeId: number;
    readonly physical: "COMPLETE" | "INCOMPLETE";
    readonly work: "FINISHED" | "INCOMPLETE" | "STOPPED_BY_ADMISSION";
}
export interface ProtocolUnionV05 {
    readonly storeId: StoreId;
    readonly fenceAssessment: ProtocolFenceState | "NOT_EVALUATED";
    readonly maximumKnownRequirement?: number;
    readonly declarationRequirements: readonly number[];
    readonly fenceRequirements: readonly number[];
    readonly hasStrongerRequirement: boolean;
    readonly hasUnsupportedDeclaration: boolean;
    readonly unknownFenceEvidence: number;
    readonly fenceEvidenceComplete: boolean;
    readonly missingFence: boolean;
}
export interface StateIdentityV05 {
    readonly representationStateId: RepresentationStateId;
    readonly conflictingContent: boolean;
    readonly variants: readonly {
        readonly value: RepresentationStateArtifactV1;
        readonly digest: CanonicalDigest;
        readonly copies: ArtifactEvidenceResultV05["states"];
    }[];
}
/** A validated child reference needs later establishing-commit qualification; no commit is asserted. */
export interface UnqualifiedMigrationCommitRequirementV05 {
    readonly qualification: "UNQUALIFIED_MIGRATION_COMMIT";
    readonly representationStateId: RepresentationStateId;
    readonly parentRepresentationStateId: RepresentationStateId;
    readonly migrationId: MigrationId;
    readonly stateDigest: CanonicalDigest;
}
export interface RepresentationMetadataV05 {
    readonly storeId: StoreId;
    readonly identities: readonly StateIdentityV05[];
    readonly lineage: RepresentationLineageState | "NOT_EVALUATED";
    readonly evidenceComplete: boolean;
    readonly lineagePrecharge?: number;
    readonly genesis: "PRESENT" | "MISSING" | "CONFLICT" | "UNQUALIFIED_CONTEXT" | "UNKNOWN";
    readonly plannedGenesisId?: RepresentationStateId;
    readonly competingGenesisIds: readonly RepresentationStateId[];
    readonly migrationCommitRequirements: readonly UnqualifiedMigrationCommitRequirementV05[];
}
export interface AggregateAccountingV05 {
    readonly observedPhysicalFiles: number;
    readonly knownPhysicalBytes: number;
    readonly unknownSizedFiles: number;
    readonly byteAccountingComplete: boolean;
    readonly knownRemainingPhysicalBytes?: number;
    readonly logicalCounts: Readonly<{
        stores: number;
        records: number;
        distinctRevisions: number;
        parentEdges: number;
        representationStates: number;
    }>;
    readonly laterStageAxesUnconsumed: readonly ["ordinaryHeads", "resolutionWork"];
}
export interface AggregateObservationV05 {
    readonly status: "COMPLETE" | "INCOMPLETE";
    readonly physical: "COMPLETE" | "INCOMPLETE";
    readonly scopes: readonly ScopedCompletionV05[];
    readonly coverage: "CONTAINING_BOUNDARIES" | "SUPPLIED_ROOTS_ONLY";
}
interface AggregateFactsV05 {
    readonly kind: "S2_V05_METADATA_AGGREGATE";
    readonly manifest: ArtifactEvidenceResultV05["manifest"];
    readonly evidence: ArtifactEvidenceResultV05;
    readonly namespaces: readonly RepresentationProbeV05[];
    readonly declarations: readonly StoreDeclarationGroupV05[];
    readonly storeIds: readonly StoreId[];
    readonly storeInventory: "NO_STORE" | "ONE_STORE" | "MULTIPLE_STORE_IDS" | "MIXED_STORE_INVALID" | "NOT_EVALUATED";
    readonly mixedStoreBranches: readonly {
        readonly scopeId: number;
        readonly candidateId: number;
        readonly storeIds: readonly StoreId[];
    }[];
    readonly coherentSupportedDeclarationIds: readonly StoreId[];
    readonly protocols: readonly ProtocolUnionV05[];
    readonly representations: readonly RepresentationMetadataV05[];
    readonly unqualifiedMigrationEvidence: boolean;
    readonly findings: readonly string[];
    readonly accounting: AggregateAccountingV05;
    readonly budget: DiscoveryBudgetSnapshot;
}
export type StorageAggregateResultV05 = AggregateFactsV05 &
    (
        | {
              readonly outcome: "COMPLETE_ADMITTED";
              readonly observation: AggregateObservationV05 & { readonly status: "COMPLETE" };
              readonly admission: { readonly status: "ADMITTED" };
              readonly storeBoundAbsence?: QualifiedStoreBoundAbsenceV05;
          }
        | {
              readonly outcome: "COMPLETE_REFUSED";
              readonly observation: AggregateObservationV05 & { readonly status: "COMPLETE" };
              readonly admission: { readonly status: "REFUSED"; readonly refusal: DiscoveryBudgetRefusal };
              readonly storeBoundAbsence?: never;
          }
        | {
              readonly outcome: "INCOMPLETE";
              readonly observation: AggregateObservationV05 & { readonly status: "INCOMPLETE" };
              readonly admission: {
                  readonly status: "REFUSED" | "NOT_EVALUATED";
                  readonly refusal?: DiscoveryBudgetRefusal;
              };
              readonly storeBoundAbsence?: never;
          }
    );
const admissionAxes = new Set<DiscoveryBudgetAxis>([
    "physicalFiles",
    "physicalBytes",
    "artifactBytes",
    "decodedBytes",
    "completeClaims",
    "identityReferences",
    "recordPayloadBytes",
    "recoveryExecutions",
    "stores",
    "records",
    "distinctRevisions",
    "parentEdges",
    "representationStates",
]);
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** Finite conservative S1 worst-case traversal bound; overflow is never rounded into admission. */
export function representationLineageChargeV05(nodes: number): number {
    if (!Number.isSafeInteger(nodes) || nodes < 0) return Infinity;
    const cost = 8 * nodes * nodes + 16 * nodes;
    return Number.isSafeInteger(cost) ? cost : Infinity;
}
class MetadataAggregate {
    readonly #findings = new Set<string>();
    readonly #protocols: ProtocolUnionV05[] = [];
    readonly #representations: RepresentationMetadataV05[] = [];
    readonly #stores = new Set<StoreId>();
    readonly #records = new Set<string>();
    readonly #revisions = new Set<string>();
    readonly #edges = new Set<string>();
    readonly #branchIds = new Map<number, Map<object, Set<StoreId>>>();
    constructor(private readonly context: ArtifactEvidenceInvocationV05) {}
    #charge(axis: DiscoveryBudgetAxis, amount: number): boolean {
        return this.context.invocation.chargeWork(axis, amount, 0);
    }
    #indexBound(source: ArtifactEvidenceResultV05["artifacts"][number]["source"], id: StoreId) {
        this.#stores.add(id);
        for (const position of source.positions) {
            const branch = position.chain.find((step) => step.role === "store-subtree");
            if (!branch) continue;
            const scoped = this.#branchIds.get(source.scope.scopeId) ?? new Map<object, Set<StoreId>>();
            const ids = scoped.get(branch.directory) ?? new Set<StoreId>();
            ids.add(id);
            scoped.set(branch.directory, ids);
            this.#branchIds.set(source.scope.scopeId, scoped);
        }
    }
    #facts() {
        const { physical: p, evidence: e } = this.context;
        for (const id of p.storeIds) this.#stores.add(id);
        for (const a of e.artifacts) {
            const c = a.content;
            if (
                c.family === "metadata" &&
                c.recognition.family === "store-declaration" &&
                c.recognition.status === "VALID"
            )
                this.#indexBound(a.source, c.recognition.value.storeId);
            if (c.status !== "VALID") continue;
            const id = c.family === "canonical" ? c.envelope.storeId : c.value.storeId;
            this.#indexBound(a.source, id);
            if (c.family === "recovery")
                this.#records.add(canonicalSerialize([id, c.value.recordKind, c.value.recordId]));
        }
        for (const claim of e.identityClaims) {
            const v = claim.envelope;
            this.#records.add(canonicalSerialize([v.storeId, v.recordKind, v.recordId]));
            this.#revisions.add(v.revisionId);
            if (v.parentRevisionId)
                this.#edges.add(
                    canonicalSerialize([v.storeId, v.recordKind, v.recordId, v.revisionId, v.parentRevisionId])
                );
        }
        for (const r of p.roots) {
            for (const candidate of r.namespaceCandidates) {
                const recognition = candidate.recognition;
                if (candidate.raw.status === "INCOMPLETE") this.#findings.add("NAMESPACE_UNAVAILABLE");
                else if (recognition.status !== "VALID") this.#findings.add("NAMESPACE_INVALID_OR_UNSUPPORTED");
            }
        }
        for (const raw of p.rawFiles)
            if (raw.chain[raw.chain.length - 1].role === "representation-root") {
                if (raw.raw.status === "INCOMPLETE") this.#findings.add("NAMESPACE_UNAVAILABLE");
                else if (raw.recognition.status !== "VALID" && raw.recognition.family !== "store-declaration")
                    this.#findings.add("NAMESPACE_INVALID_OR_UNSUPPORTED");
            }
        for (const f of p.findings) if (f.blocksAbsence) this.#findings.add(f.code);
        for (const a of e.artifacts)
            if (a.content.status !== "VALID" && a.content.status !== "METADATA")
                this.#findings.add(`ARTIFACT_${a.content.status}`);
        for (const group of p.declarationGroups) {
            if (group.state === "CONFLICTING_PLAN") this.#findings.add("CONFLICTING_PLAN");
            if (group.plans.some((plan) => !plan.supported)) this.#findings.add("UNSUPPORTED_DECLARATION");
        }
        if (e.migrations.length) this.#findings.add("UNQUALIFIED_MIGRATION_EVIDENCE");
    }
    #protocol(id: StoreId): ProtocolUnionV05 {
        const { evidence: e, physical: p } = this.context;
        const declarations = p.declarationGroups.filter((g) => g.storeId === id).flatMap((g) => g.plans);
        const applicable = e.fences.filter(
            (f) =>
                f.protocolTerminal &&
                (f.value.storeId === id ||
                    f.source.positions.some((pos) =>
                        pos.chain.some((s) => this.#branchIds.get(f.source.scope.scopeId)?.get(s.directory)?.has(id))
                    ))
        );
        const unknown = e.artifacts.filter(
            (a) =>
                a.source.positions.some((pos) => pos.chain[pos.chain.length - 1].role === "protocol-collection") &&
                !(a.content.family === "fence" && a.content.status === "VALID")
        ).length;
        const requirements = declarations.map((d) => d.declaration.requiredProtocolVersion);
        const fences = applicable.map((f) => f.value.requiredProtocolVersion);
        let maximum: number | undefined;
        for (const value of [...requirements, ...fences])
            maximum = maximum === undefined ? value : Math.max(maximum, value);
        const complete = p.status === "COMPLETE" && e.status === "OBSERVATIONS_FINISHED";
        const state = this.#charge("graphWork", applicable.length + unknown + declarations.length + 1)
            ? assessProtocolWriteFence(
                  id,
                  applicable.map((f) => f.value),
                  REQUIRED_PROTOCOL_VERSION,
                  unknown
              ).state
            : "NOT_EVALUATED";
        const result: ProtocolUnionV05 = Object.freeze({
            storeId: id,
            fenceAssessment: state,
            maximumKnownRequirement: maximum,
            declarationRequirements: Object.freeze(requirements.sort((a, b) => a - b)),
            fenceRequirements: Object.freeze(fences.sort((a, b) => a - b)),
            hasStrongerRequirement: maximum !== undefined && maximum > REQUIRED_PROTOCOL_VERSION,
            hasUnsupportedDeclaration: declarations.some((d) => !d.supported),
            unknownFenceEvidence: unknown,
            fenceEvidenceComplete: complete,
            missingFence: applicable.length === 0,
        });
        if (result.hasStrongerRequirement) this.#findings.add("READ_ONLY_UNSUPPORTED_NEWER_PROTOCOL");
        if (unknown || !complete) this.#findings.add("READ_ONLY_UNRECOGNIZED_FENCE");
        if (result.missingFence) this.#findings.add("READ_ONLY_MISSING_FENCE");
        if (state === "READ_ONLY_MIXED_STORE") this.#findings.add(state);
        return result;
    }
    #representation(id: StoreId): RepresentationMetadataV05 {
        const { evidence: e, physical: p } = this.context;
        const byId = new Map<
            RepresentationStateId,
            Map<
                CanonicalDigest,
                {
                    value: RepresentationStateArtifactV1;
                    digest: CanonicalDigest;
                    copies: ArtifactEvidenceResultV05["states"][number][];
                }
            >
        >();
        for (const copy of e.states) {
            if (copy.value.storeId !== id || !copy.stateTerminal) continue;
            const variants =
                byId.get(copy.value.representationStateId) ??
                new Map<
                    CanonicalDigest,
                    {
                        value: RepresentationStateArtifactV1;
                        digest: CanonicalDigest;
                        copies: ArtifactEvidenceResultV05["states"][number][];
                    }
                >();
            const variant = variants.get(copy.digest) ?? { value: copy.value, digest: copy.digest, copies: [] };
            variant.copies.push(copy);
            variants.set(copy.digest, variant);
            byId.set(copy.value.representationStateId, variants);
        }
        const identities = Object.freeze(
            [...byId]
                .sort(([a], [b]) => compare(a, b))
                .map(([representationStateId, variants]) =>
                    Object.freeze({
                        representationStateId,
                        conflictingContent: variants.size > 1,
                        variants: Object.freeze(
                            [...variants.values()]
                                .sort((a, b) => compare(a.digest, b.digest))
                                .map((v) => Object.freeze({ ...v, copies: Object.freeze(v.copies) }))
                        ),
                    })
                )
        );
        const supported = p.declarationGroups.find(
            (g) =>
                g.storeId === id &&
                supportedDeclarationContexts(p).has(id) &&
                g.state === "EQUIVALENT" &&
                g.plans.length === 1 &&
                g.plans[0].supported
        )?.plans[0];
        const observations = identities.flatMap((g) =>
            g.variants.map((v) => ({ artifact: v.value, digest: v.digest }))
        );
        const complete =
            p.status === "COMPLETE" &&
            e.status === "OBSERVATIONS_FINISHED" &&
            !e.artifacts.some(
                (a) =>
                    a.source.positions.some(
                        (pos) => pos.chain[pos.chain.length - 1].role === "representation-states-collection"
                    ) && !(a.content.family === "state" && a.content.status === "VALID")
            );
        // One requirement per already-admitted complete state variant, not per physical copy.
        // State/physical/decoded admission bounds the retained inputs; graphWork meters this projection.
        const requirements: UnqualifiedMigrationCommitRequirementV05[] = [];
        for (const identity of identities) {
            for (const variant of identity.variants) {
                const state = variant.value;
                if (state.parentRepresentationStateId === null || state.establishedByMigrationId === null) continue;
                if (!this.#charge("graphWork", 1)) break;
                requirements.push(
                    Object.freeze({
                        qualification: "UNQUALIFIED_MIGRATION_COMMIT" as const,
                        representationStateId: state.representationStateId,
                        parentRepresentationStateId: state.parentRepresentationStateId,
                        migrationId: state.establishedByMigrationId,
                        stateDigest: variant.digest,
                    })
                );
            }
        }
        if (requirements.length) this.#findings.add("UNQUALIFIED_MIGRATION_COMMIT");
        let lineage: RepresentationMetadataV05["lineage"] = "NOT_EVALUATED",
            precharge: number | undefined;
        // Declaration qualifies planned genesis only. Nonempty content-bound state sets have pure lineage.
        // Preserve the existing supported-context empty-set diagnosis without inventing a declarationless plan.
        if (complete && (observations.length > 0 || supported) && !this.context.invocation.budget().refusal) {
            precharge = representationLineageChargeV05(observations.length);
            const bytes = observations.reduce(
                (sum, o) => sum + new TextEncoder().encode(canonicalSerialize(o.artifact)).byteLength,
                0
            );
            if (this.#charge("representationLineageWork", precharge) && this.#charge("decodeHashByteWork", bytes * 64))
                lineage = validateRepresentationStateLineage(observations, id).state;
        }
        let genesis: RepresentationMetadataV05["genesis"] = supported
            ? complete
                ? "MISSING"
                : "UNKNOWN"
            : "UNQUALIFIED_CONTEXT";
        const planned = supported?.declaration.genesisRepresentationStateId;
        if (supported && planned) {
            const target = identities.find((s) => s.representationStateId === planned);
            if (target)
                genesis =
                    target.variants.length === 1 &&
                    target.variants[0].value.parentRepresentationStateId === null &&
                    target.variants[0].value.establishedByMigrationId === null &&
                    target.variants[0].value.representation === supported.declaration.initialRepresentation
                        ? "PRESENT"
                        : "CONFLICT";
        }
        const competing = Object.freeze(
            identities
                .filter(
                    (g) =>
                        g.representationStateId !== planned &&
                        g.variants.some((v) => v.value.parentRepresentationStateId === null)
                )
                .map((g) => g.representationStateId)
        );
        if (genesis !== "PRESENT") this.#findings.add(`GENESIS_${genesis}`);
        if (competing.length) this.#findings.add("COMPETING_GENESIS");
        if (identities.some((i) => i.conflictingContent)) this.#findings.add("REPRESENTATION_STATE_IDENTITY_CONFLICT");
        if (lineage !== "REPRESENTATION_STATE_VALID") this.#findings.add(lineage);
        return Object.freeze({
            storeId: id,
            identities,
            lineage,
            evidenceComplete: complete,
            lineagePrecharge: precharge,
            genesis,
            plannedGenesisId: planned,
            competingGenesisIds: competing,
            migrationCommitRequirements: Object.freeze(requirements),
        });
    }
    run(): StorageAggregateResultV05 {
        const { invocation: inv, physical: p, evidence: e } = this.context;
        const rows =
            e.artifacts.length +
            e.identityClaims.length +
            p.rawFiles.length +
            p.listings.length +
            p.declarationGroups.length;
        if (this.#charge("graphWork", rows * 3)) this.#facts();
        const stateCount = new Set(
            e.states.map((s) => canonicalSerialize([s.value.storeId, s.value.representationStateId]))
        ).size;
        const counts = Object.freeze({
            stores: this.#stores.size,
            records: this.#records.size,
            distinctRevisions: this.#revisions.size,
            parentEdges: this.#edges.size,
            representationStates: stateCount,
        });
        // New admission dimensions are charged after the bounded existing observation stages.
        for (const [axis, count] of Object.entries(counts))
            if (!this.#charge(axis as keyof typeof counts, count)) break;
        const ids = Object.freeze([...this.#stores].sort(compare));
        const mixed: { scopeId: number; candidateId: number; storeIds: readonly StoreId[] }[] = [];
        const candidates: { candidateId: string; storeIds: readonly StoreId[] }[] = [];
        let candidateId = 0;
        for (const [scopeId, branches] of this.#branchIds)
            for (const branchIds of branches.values()) {
                const all = Object.freeze([...branchIds].sort(compare));
                candidates.push({ candidateId: String(candidateId), storeIds: all });
                if (all.length > 1) mixed.push(Object.freeze({ scopeId, candidateId, storeIds: all }));
                candidateId++;
            }
        if (mixed.length) this.#findings.add("MIXED_STORE_INVALID");
        if (ids.length > 1) this.#findings.add("MULTIPLE_STORE_IDS");
        let inventory: StorageAggregateResultV05["storeInventory"] = "NOT_EVALUATED";
        if (this.#charge("graphWork", candidates.length + 1)) inventory = classifyStoreInventory(candidates).state;
        for (const id of ids) {
            this.#protocols.push(this.#protocol(id));
            this.#representations.push(this.#representation(id));
        }
        const refusal = inv.budget().refusal;
        const capacityRefused = Boolean(refusal && admissionAxes.has(refusal.axis));
        const physicalComplete = p.status === "COMPLETE";
        const workFinished = e.status === "OBSERVATIONS_FINISHED" && !refusal;
        const scopes = Object.freeze(
            inv.manifest.map((scope) => {
                const listings = p.listings.filter((l) => l.scope.scopeId === scope.scopeId),
                    raw = p.rawFiles.filter((r) => r.scope.scopeId === scope.scopeId);
                const physical =
                    listings.length > 0 &&
                    listings.every((l) => l.outcome.status === "COMPLETE") &&
                    raw.every((r) => r.raw.status === "COMPLETE");
                const incompleteWork =
                    e.artifacts.some(
                        (a) => a.source.scope.scopeId === scope.scopeId && a.content.status === "INCOMPLETE"
                    ) || refusal?.scopeId === scope.scopeId;
                return Object.freeze({
                    scopeId: scope.scopeId,
                    physical: physical ? ("COMPLETE" as const) : ("INCOMPLETE" as const),
                    work: incompleteWork
                        ? capacityRefused
                            ? ("STOPPED_BY_ADMISSION" as const)
                            : ("INCOMPLETE" as const)
                        : ("FINISHED" as const),
                });
            })
        );
        const complete =
            e.status === "OBSERVATIONS_FINISHED" &&
            physicalComplete &&
            scopes.every((s) => s.physical === "COMPLETE") &&
            (workFinished || capacityRefused);
        // Sizes unavailable through the API remain unknown, never zero/free space.
        const known = new Map<number, Map<object, number>>();
        for (const raw of p.rawFiles)
            if (raw.raw.status === "COMPLETE") {
                const files = known.get(raw.scope.scopeId) ?? new Map<object, number>();
                files.set(raw.file, raw.raw.byteLength);
                known.set(raw.scope.scopeId, files);
            }
        let knownCount = 0,
            knownBytes = 0;
        for (const files of known.values())
            for (const size of files.values()) {
                knownCount++;
                knownBytes += size;
            }
        const observed = e.budget.consumed.physicalFiles,
            unknown = Math.max(0, observed - knownCount);
        const accountingComplete = physicalComplete && unknown === 0 && Number.isSafeInteger(knownBytes);
        const accounting = Object.freeze({
            observedPhysicalFiles: observed,
            knownPhysicalBytes: knownBytes,
            unknownSizedFiles: unknown,
            byteAccountingComplete: accountingComplete,
            ...(accountingComplete && !refusal
                ? { knownRemainingPhysicalBytes: Math.max(0, inv.budget().limits.physicalBytes - knownBytes) }
                : {}),
            logicalCounts: counts,
            laterStageAxesUnconsumed: Object.freeze(["ordinaryHeads", "resolutionWork"] as const),
        });
        const observation = Object.freeze({
            status: complete ? ("COMPLETE" as const) : ("INCOMPLETE" as const),
            physical: physicalComplete ? ("COMPLETE" as const) : ("INCOMPLETE" as const),
            scopes,
            coverage: p.coverage,
        });
        const supported = Object.freeze([...supportedDeclarationContexts(p)].sort(compare));
        const facts: AggregateFactsV05 = Object.freeze({
            kind: "S2_V05_METADATA_AGGREGATE",
            manifest: inv.manifest,
            evidence: e,
            namespaces: p.roots,
            declarations: p.declarationGroups,
            storeIds: ids,
            storeInventory: inventory,
            mixedStoreBranches: Object.freeze(mixed),
            coherentSupportedDeclarationIds: supported,
            protocols: Object.freeze(this.#protocols),
            representations: Object.freeze(this.#representations),
            unqualifiedMigrationEvidence: e.migrations.length > 0,
            findings: Object.freeze([...this.#findings].sort(compare)),
            accounting,
            budget: inv.budget(),
        });
        if (!complete)
            return Object.freeze({
                ...facts,
                outcome: "INCOMPLETE",
                observation: Object.freeze({ ...observation, status: "INCOMPLETE" as const }),
                admission: Object.freeze({
                    status: capacityRefused ? ("REFUSED" as const) : ("NOT_EVALUATED" as const),
                    ...(refusal ? { refusal } : {}),
                }),
            });
        if (refusal)
            return Object.freeze({
                ...facts,
                outcome: "COMPLETE_REFUSED",
                observation: Object.freeze({ ...observation, status: "COMPLETE" as const }),
                admission: Object.freeze({ status: "REFUSED" as const, refusal }),
            });
        const negative =
            p.coverage === "CONTAINING_BOUNDARIES" &&
            p.storeBoundAbsence !== undefined &&
            ids.length === 0 &&
            e.identityClaims.length === 0 &&
            e.executionArtifacts.length === 0 &&
            e.fences.length === 0 &&
            e.states.length === 0 &&
            e.migrations.length === 0;
        return Object.freeze({
            ...facts,
            outcome: "COMPLETE_ADMITTED",
            observation: Object.freeze({ ...observation, status: "COMPLETE" as const }),
            admission: Object.freeze({ status: "ADMITTED" as const }),
            ...(negative ? { storeBoundAbsence: p.storeBoundAbsence } : {}),
        });
    }
}
/** Additive Batch5 handoff; preserves the aggregate result and its original invocation ledger. */
export interface StorageAggregateInvocationV05 {
    readonly context: ArtifactEvidenceInvocationV05;
    readonly aggregate: StorageAggregateResultV05;
}
export function discoverStorageAggregateInvocationV05(
    input: StorageAggregateInputV05
): Promise<StorageAggregateInvocationV05> {
    const limits = snapshotAggregateLimits(input?.limits);
    return discoverArtifactEvidenceInvocationV05(input, limits).then((context) =>
        Object.freeze({ context, aggregate: new MetadataAggregate(context).run() })
    );
}
export function discoverStorageAggregateV05(input: StorageAggregateInputV05): Promise<StorageAggregateResultV05> {
    return discoverStorageAggregateInvocationV05(input).then((observed) => observed.aggregate);
}
