/** Batch-3 individual evidence only. No repository index/heads, aggregate health or permission. */
import { DiscoveryInvocationV05, type DiscoveryTraversalInputV05, type CapturedReadScopeV05 } from "./discoveryV05";
import {
    snapshotTraversalWorkLimits,
    snapshotEvidenceLimits,
    type DiscoveryEvidenceLimitsV05,
    type DiscoveryAggregateLimitsV05,
    type DiscoveryBudgetAxis,
    type DiscoveryBudgetSnapshot,
} from "./discoveryBudget";
import {
    traverseNamespaceStoresV05,
    type PhysicalStorageTraversalV05,
    type TraversalRawFileV05,
} from "./discoveryTraversalV05";
import {
    recognizeArtifactContentV05,
    fingerprintOpaqueArtifactV05,
    type ArtifactContentV05,
} from "./discoveryArtifactsV05";
import { canonicalSerialize, type CanonicalDigest, type ArtifactDigest } from "./canonicalEncoding";
import type { CanonicalRecordCodec, CanonicalRevisionEnvelope } from "./envelopes";
import type { RepresentationFileHandle, RepresentationDirectoryHandle } from "./RepresentationStoragePort";
import type { StoreId, RevisionId, MutationId, PublicationId } from "./identity";
import {
    compareRecoveryExecutionArtifacts,
    compareLogicalMutationBindings,
    projectLogicalMutationBinding,
    validateReceiptAgainstPreparation,
    validatePriorPublicationEvidence,
    type RecoveryPreparationV2,
    type RecoveryReceiptV2,
    type PriorPublicationValidation,
    type QualifiedRevisionEvidence,
    type LogicalMutationBinding,
} from "./recoveryArtifacts";
import type { ProtocolFenceArtifactV1, RepresentationStateArtifactV1 } from "./authorityArtifacts";
import { DISCOVERY_NOMINAL_DIRECTORY_NAMES } from "./discoveryGrammar";

export interface ArtifactEvidenceInputV05 extends DiscoveryTraversalInputV05 {
    readonly limits: DiscoveryTraversalInputV05["limits"] & DiscoveryEvidenceLimitsV05;
    readonly recordCodecs: readonly CanonicalRecordCodec[];
}
export interface ArtifactSourceV05 {
    readonly scope: CapturedReadScopeV05;
    readonly file: RepresentationFileHandle;
    readonly positions: readonly TraversalRawFileV05[];
}
export interface RecognizedPhysicalArtifactV05 {
    readonly source: ArtifactSourceV05;
    readonly content: ArtifactContentV05;
}
export interface CompleteRevisionClaimV05 {
    readonly envelope: CanonicalRevisionEnvelope;
    readonly digest: CanonicalDigest;
    readonly source: ArtifactSourceV05;
    readonly origin: "CANONICAL_CONTENT" | "PREPARATION_AFTER";
    /** Every identity/reference field, including repeats, never payload/path/publication strings. */
    readonly referenceIds: readonly RevisionId[];
}
export interface CanonicalArtifactFactV05 {
    readonly source: ArtifactSourceV05;
    readonly envelope: CanonicalRevisionEnvelope;
    readonly digest: CanonicalDigest;
    readonly physicallyCanonical: boolean;
    readonly declarationContext: "SUPPORTED_COHERENT" | "UNQUALIFIED";
    readonly individualEvidence?: Extract<QualifiedRevisionEvidence, { role: "DIRECT_CANONICAL" }>;
}
type RecoveryValue = RecoveryPreparationV2 | RecoveryReceiptV2;
export interface RecoveryArtifactVariantV05 {
    readonly value: RecoveryValue;
    readonly digest: ArtifactDigest;
    readonly observations: readonly { readonly source: ArtifactSourceV05; readonly recoveryTerminal: boolean }[];
}
export interface RecoveryArtifactGroupV05 {
    readonly artifactKind: "preparation" | "receipt";
    readonly storeId: StoreId;
    readonly mutationId: MutationId;
    readonly canonicalPublicationId: PublicationId;
    readonly state: "EQUIVALENT" | "EXECUTION_ARTIFACT_CONFLICT" | "INCOMPLETE";
    readonly variants: readonly RecoveryArtifactVariantV05[];
}
export interface LogicalMutationGroupV05 {
    readonly mutationId: MutationId;
    readonly state: "EQUIVALENT_LOGICAL_MUTATION" | "MUTATION_IDENTITY_CONFLICT" | "INCOMPLETE";
    readonly preparations: readonly RecoveryPreparationV2[];
    readonly bindings: readonly LogicalMutationBinding[];
}
export interface PriorPublicationFactV05 {
    readonly preparation: RecoveryArtifactVariantV05;
    readonly receipt: RecoveryArtifactVariantV05;
    readonly binding: "EXACT" | "MISBOUND";
    readonly validation: PriorPublicationValidation;
    readonly coherent: boolean;
    readonly declarationContext: "SUPPORTED_COHERENT" | "UNQUALIFIED";
    readonly canonicalCopyCoverage: "PRESENT" | "MISSING_IN_COMPLETE_SCOPED_INVENTORY" | "UNKNOWN";
    readonly individualEvidence?: Extract<QualifiedRevisionEvidence, { role: "QUALIFIED_PRIOR_PUBLICATION" }>;
}
export interface ArtifactFindingV05 {
    readonly code:
        | "CONTENT_INVALID"
        | "CONTENT_UNSUPPORTED"
        | "CONTENT_UNRECOGNIZED"
        | "OBSERVATION_INCOMPLETE"
        | "CANONICAL_ROLE_MISMATCH"
        | "RECOVERY_ROLE_MISMATCH"
        | "DECLARATION_CONTEXT_UNQUALIFIED"
        | "READ_ONLY_MISSING_FENCE"
        | "FENCE_COVERAGE_UNKNOWN"
        | "ORPHAN_RECEIPT"
        | "MISBOUND_RECEIPT"
        | "EXECUTION_ARTIFACT_CONFLICT"
        | "MUTATION_IDENTITY_CONFLICT";
    readonly stage:
        | "RECOGNITION"
        | "CLAIM_RETENTION"
        | "EXECUTION_GROUPING"
        | "MUTATION_GROUPING"
        | "PRIOR_PUBLICATION"
        | "FENCE_FACT";
    readonly source?: ArtifactSourceV05;
    readonly storeId?: StoreId;
}
export interface ArtifactEvidenceResultV05 {
    readonly kind: "S2_V05_INDIVIDUAL_ARTIFACT_EVIDENCE";
    /** Stage completion only; never complete repository admission/health. */
    readonly status: "OBSERVATIONS_FINISHED" | "INCOMPLETE";
    readonly manifest: readonly CapturedReadScopeV05[];
    readonly physicalObservationStatus: PhysicalStorageTraversalV05["status"];
    readonly artifacts: readonly RecognizedPhysicalArtifactV05[];
    readonly canonical: readonly CanonicalArtifactFactV05[];
    readonly identityClaims: readonly CompleteRevisionClaimV05[];
    readonly executionArtifacts: readonly RecoveryArtifactGroupV05[];
    readonly logicalMutations: readonly LogicalMutationGroupV05[];
    readonly priorPublications: readonly PriorPublicationFactV05[];
    readonly fences: readonly {
        readonly source: ArtifactSourceV05;
        readonly value: ProtocolFenceArtifactV1;
        readonly protocolTerminal: boolean;
    }[];
    readonly states: readonly {
        readonly source: ArtifactSourceV05;
        readonly value: RepresentationStateArtifactV1;
        readonly digest: CanonicalDigest;
        readonly stateTerminal: boolean;
    }[];
    readonly migrations: readonly {
        readonly source: ArtifactSourceV05;
        readonly fingerprint?: CanonicalDigest;
        readonly status: "OPAQUE" | "INCOMPLETE";
    }[];
    readonly findings: readonly ArtifactFindingV05[];
    readonly budget: DiscoveryBudgetSnapshot;
}
function leaf(locator: string): string {
    return locator.split("/").pop() ?? "";
}
/** Finite role eligibility over captured existing graph provenance. Hints never select a winner.
 * Incompatible eligible positions stay ambiguous rather than promoting content by itself. */
function positionEligible(
    position: TraversalRawFileV05,
    family: "canonical" | "recovery" | "fence" | "state",
    metaContexts?: ReadonlySet<RepresentationDirectoryHandle>
): boolean {
    const terminal = position.chain[position.chain.length - 1].role;
    const expected =
        family === "canonical"
            ? "record-kind-collection"
            : family === "recovery"
              ? "recovery-kind-collection"
              : family === "fence"
                ? "protocol-collection"
                : "representation-states-collection";
    if (terminal !== expected) return false;
    if (position.roleEvidence !== "UNRESOLVED_PROBE") return true;
    // Prefix facts can establish a content-qualified role without upgrading unrelated negative probes.
    if (position.recognition.hint === family) return true;
    const names = DISCOVERY_NOMINAL_DIRECTORY_NAMES;
    const reachedMeta = position.chain.some(
        (step) =>
            step.role === "meta-collection" &&
            (leaf(step.directory.locator) === names.meta || metaContexts?.has(step.directory))
    );
    return position.chain.some(
        (step) =>
            (family === "canonical" &&
                step.role === "records-collection" &&
                leaf(step.directory.locator) === names.records) ||
            (family === "recovery" &&
                step.role === "recovery-collection" &&
                leaf(step.directory.locator) === names.recovery) ||
            (family === "fence" &&
                reachedMeta &&
                step.role === "protocol-collection" &&
                leaf(step.directory.locator) === names.protocol) ||
            (family === "state" &&
                reachedMeta &&
                step.role === "representation-states-collection" &&
                leaf(step.directory.locator) === names.representationStates)
    );
}
function physicalRole(
    source: ArtifactSourceV05,
    family: "canonical" | "recovery" | "fence" | "state",
    metaContexts?: ReadonlySet<RepresentationDirectoryHandle>
): boolean {
    if (!source.positions.some((p) => positionEligible(p, family, metaContexts))) return false;
    return !(["canonical", "recovery", "fence", "state"] as const).some(
        (other) => other !== family && source.positions.some((p) => positionEligible(p, other, metaContexts))
    );
}
export function supportedDeclarationContexts(snapshot: PhysicalStorageTraversalV05): ReadonlySet<StoreId> {
    const qualified = new Set<StoreId>();
    if (snapshot.budget.refusal) return qualified;
    const outer = new Set(["vault-root", "representation-root", "stores-collection", "store-subtree"]);
    if (snapshot.listings.some((row) => outer.has(row.role) && row.outcome.status !== "COMPLETE")) return qualified;
    for (const raw of snapshot.rawFiles) {
        const role = raw.chain[raw.chain.length - 1].role;
        if (role !== "representation-root" && role !== "store-subtree") continue;
        if (raw.raw.status === "INCOMPLETE") return qualified;
        const r = raw.recognition;
        if (r.family === "store-declaration" && (r.status !== "VALID" || !r.supported || role !== "store-subtree"))
            return qualified;
        if (r.family === "unknown" && r.hint === "none") return qualified;
    }
    for (const group of snapshot.declarationGroups)
        if (group.state === "EQUIVALENT" && group.plans.length === 1 && group.plans[0].supported)
            qualified.add(group.storeId);
    return qualified;
}
function isArrayValue(value: unknown): boolean {
    return Array.isArray(value);
}
function snapshotCodecs(input: readonly CanonicalRecordCodec[]): readonly CanonicalRecordCodec[] {
    if (!isArrayValue(input)) throw new Error("Explicit record codec registry required.");
    return Object.freeze(
        input.map((codec) => {
            if (
                !codec ||
                typeof codec.recordKind !== "string" ||
                !Number.isSafeInteger(codec.schemaVersion) ||
                codec.schemaVersion < 1 ||
                typeof codec.isRecordId !== "function" ||
                typeof codec.validatePayload !== "function"
            )
                throw new Error("Invalid record codec registry.");
            return Object.freeze({
                recordKind: codec.recordKind,
                schemaVersion: codec.schemaVersion,
                isRecordId: codec.isRecordId.bind(codec) as CanonicalRecordCodec["isRecordId"],
                validatePayload: codec.validatePayload.bind(codec) as CanonicalRecordCodec["validatePayload"],
            });
        })
    );
}
interface MutableRecoveryGroup {
    artifactKind: "preparation" | "receipt";
    storeId: StoreId;
    mutationId: MutationId;
    canonicalPublicationId: PublicationId;
    conflict: boolean;
    variants: {
        value: RecoveryValue;
        digest: ArtifactDigest;
        observations: { source: ArtifactSourceV05; recoveryTerminal: boolean }[];
    }[];
}

class ArtifactEvidenceCollector {
    readonly #artifacts: RecognizedPhysicalArtifactV05[] = [];
    readonly #canonical: CanonicalArtifactFactV05[] = [];
    readonly #claims: CompleteRevisionClaimV05[] = [];
    readonly #groups = new Map<string, MutableRecoveryGroup>();
    readonly #executions = new Set<string>();
    readonly #mutations = new Map<
        MutationId,
        { preparations: RecoveryPreparationV2[]; bindings: LogicalMutationBinding[]; conflict: boolean }
    >();
    readonly #prior: PriorPublicationFactV05[] = [];
    readonly #fences: ArtifactEvidenceResultV05["fences"][number][] = [];
    readonly #states: ArtifactEvidenceResultV05["states"][number][] = [];
    readonly #migrations: ArtifactEvidenceResultV05["migrations"][number][] = [];
    readonly #findings: ArtifactFindingV05[] = [];
    #declarationContexts: ReadonlySet<StoreId> = new Set();
    readonly #physicalCopyKeys = new Set<string>();
    readonly #metaContexts = new Map<number, Set<RepresentationDirectoryHandle>>();
    #canonicalUnknown = false;
    #recoveryListsComplete = false;
    #incomplete = false;
    #recoveryIncomplete = false;
    constructor(
        private readonly invocation: DiscoveryInvocationV05,
        private readonly snapshot: PhysicalStorageTraversalV05,
        private readonly codecs: readonly CanonicalRecordCodec[]
    ) {}
    #charge(source: ArtifactSourceV05, axis: DiscoveryBudgetAxis, amount: number): boolean {
        const ok = this.invocation.chargeWork(axis, amount, source.scope.scopeId);
        if (!ok) this.#incomplete = true;
        return ok;
    }
    #finding(
        code: ArtifactFindingV05["code"],
        stage: ArtifactFindingV05["stage"],
        source?: ArtifactSourceV05,
        storeId?: StoreId
    ) {
        this.#findings.push(
            Object.freeze({ code, stage, ...(source ? { source } : {}), ...(storeId ? { storeId } : {}) })
        );
    }
    #claim(
        source: ArtifactSourceV05,
        envelope: CanonicalRevisionEnvelope,
        digest: CanonicalDigest,
        origin: CompleteRevisionClaimV05["origin"]
    ): boolean {
        const references = [
            envelope.revisionId,
            ...(envelope.parentRevisionId ? [envelope.parentRevisionId] : []),
            ...envelope.resolvedRevisionIds,
        ];
        if (
            !this.#charge(source, "completeClaims", 1) ||
            !this.#charge(source, "identityReferences", references.length)
        ) {
            this.#finding("OBSERVATION_INCOMPLETE", "CLAIM_RETENTION", source);
            return false;
        }
        this.#claims.push(Object.freeze({ source, envelope, digest, origin, referenceIds: Object.freeze(references) }));
        return true;
    }
    #pairWork(source: ArtifactSourceV05, left: RecoveryValue, right?: RecoveryValue): boolean {
        const length =
            new TextEncoder().encode(canonicalSerialize(left)).byteLength +
            (right ? new TextEncoder().encode(canonicalSerialize(right)).byteLength : 0);
        return this.#charge(source, "graphWork", 1) && this.#charge(source, "decodeHashByteWork", length * 128);
    }
    async #recovery(
        source: ArtifactSourceV05,
        content: Extract<ArtifactContentV05, { family: "recovery"; status: "VALID" }>
    ) {
        const value = content.value;
        if (
            content.artifactKind === "preparation" &&
            !this.#claim(source, content.value.after, content.value.candidateDigest, "PREPARATION_AFTER")
        )
            return;
        const execution = canonicalSerialize([value.storeId, value.mutationId, value.canonicalPublicationId]);
        if (!this.#executions.has(execution)) {
            if (!this.#charge(source, "recoveryExecutions", 1)) {
                this.#finding("OBSERVATION_INCOMPLETE", "EXECUTION_GROUPING", source);
                return;
            }
            this.#executions.add(execution);
        }
        const key = canonicalSerialize([
            value.artifactKind,
            value.storeId,
            value.mutationId,
            value.canonicalPublicationId,
        ]);
        const group = this.#groups.get(key) ?? {
            artifactKind: value.artifactKind,
            storeId: value.storeId,
            mutationId: value.mutationId,
            canonicalPublicationId: value.canonicalPublicationId,
            conflict: false,
            variants: [],
        };
        let equivalent: MutableRecoveryGroup["variants"][number] | undefined;
        for (const variant of group.variants) {
            if (!this.#pairWork(source, variant.value, value)) {
                this.#finding("OBSERVATION_INCOMPLETE", "EXECUTION_GROUPING", source);
                return;
            }
            const comparison = await compareRecoveryExecutionArtifacts(variant.value, value, this.codecs);
            if (comparison === "EQUIVALENT") {
                equivalent = variant;
                break;
            }
            if (comparison === "EXECUTION_ARTIFACT_CONFLICT") group.conflict = true;
        }
        const recoveryTerminal = physicalRole(source, "recovery", this.#metaContexts.get(source.scope.scopeId));
        if (!recoveryTerminal) this.#finding("RECOVERY_ROLE_MISMATCH", "RECOGNITION", source);
        const observation = Object.freeze({ source, recoveryTerminal });
        if (equivalent) equivalent.observations.push(observation);
        else group.variants.push({ value, digest: content.digest, observations: [observation] });
        this.#groups.set(key, group);
        if (group.conflict) this.#finding("EXECUTION_ARTIFACT_CONFLICT", "EXECUTION_GROUPING", source, value.storeId);
        if (content.artifactKind === "preparation") {
            const preparation = content.value;
            const mutation = this.#mutations.get(preparation.mutationId) ?? {
                preparations: [],
                bindings: [],
                conflict: false,
            };
            for (const existing of mutation.preparations) {
                if (!this.#pairWork(source, existing, preparation)) {
                    this.#finding("OBSERVATION_INCOMPLETE", "MUTATION_GROUPING", source);
                    return;
                }
                if (
                    (await compareLogicalMutationBindings(existing, preparation, this.codecs)) ===
                    "MUTATION_IDENTITY_CONFLICT"
                )
                    mutation.conflict = true;
            }
            if (!this.#pairWork(source, preparation)) {
                this.#finding("OBSERVATION_INCOMPLETE", "MUTATION_GROUPING", source);
                return;
            }
            mutation.preparations.push(preparation);
            mutation.bindings.push(await projectLogicalMutationBinding(preparation, this.codecs));
            this.#mutations.set(preparation.mutationId, mutation);
            if (mutation.conflict)
                this.#finding("MUTATION_IDENTITY_CONFLICT", "MUTATION_GROUPING", source, preparation.storeId);
        }
    }
    async #recognize(source: ArtifactSourceV05) {
        if (!this.#charge(source, "graphWork", 1)) {
            this.#finding("OBSERVATION_INCOMPLETE", "RECOGNITION", source);
            return;
        }
        const representative = source.positions[0];
        const content = await recognizeArtifactContentV05(
            representative.raw,
            representative.recognition,
            this.codecs,
            (axis, amount) => this.#charge(source, axis, amount)
        );
        this.#artifacts.push(Object.freeze({ source, content }));
        if (source.positions.some((p) => p.chain[p.chain.length - 1].role === "migration-subtree")) {
            const fingerprint = await fingerprintOpaqueArtifactV05(representative.raw, (axis, amount) =>
                this.#charge(source, axis, amount)
            );
            this.#migrations.push(
                Object.freeze({ source, fingerprint, status: fingerprint ? "OPAQUE" : "INCOMPLETE" })
            );
        }
        if (content.status === "INCOMPLETE") {
            this.#incomplete = true;
            this.#finding("OBSERVATION_INCOMPLETE", "RECOGNITION", source);
        }
        if (content.status !== "VALID" && content.status !== "METADATA") {
            const recoveryPosition = source.positions.some((p) =>
                positionEligible(p, "recovery", this.#metaContexts.get(source.scope.scopeId))
            );
            if (recoveryPosition || content.family === "recovery") this.#recoveryIncomplete = true;
            if (content.status !== "INCOMPLETE")
                this.#finding(
                    content.status === "INVALID"
                        ? "CONTENT_INVALID"
                        : content.status === "UNSUPPORTED"
                          ? "CONTENT_UNSUPPORTED"
                          : "CONTENT_UNRECOGNIZED",
                    "RECOGNITION",
                    source
                );
            return;
        }
        if (content.family === "canonical") {
            const physicallyCanonical = physicalRole(source, "canonical", this.#metaContexts.get(source.scope.scopeId));
            const context = this.#declarationContexts.has(content.envelope.storeId)
                ? ("SUPPORTED_COHERENT" as const)
                : ("UNQUALIFIED" as const);
            const retained = this.#claim(source, content.envelope, content.digest, "CANONICAL_CONTENT");
            const individualEvidence =
                retained && physicallyCanonical && context === "SUPPORTED_COHERENT"
                    ? Object.freeze({
                          role: "DIRECT_CANONICAL" as const,
                          envelope: content.envelope,
                          digest: content.digest,
                      })
                    : undefined;
            this.#canonical.push(
                Object.freeze({
                    source,
                    envelope: content.envelope,
                    digest: content.digest,
                    physicallyCanonical,
                    declarationContext: context,
                    ...(individualEvidence ? { individualEvidence } : {}),
                })
            );
            if (!physicallyCanonical) this.#finding("CANONICAL_ROLE_MISMATCH", "RECOGNITION", source);
            if (context === "UNQUALIFIED")
                this.#finding("DECLARATION_CONTEXT_UNQUALIFIED", "RECOGNITION", source, content.envelope.storeId);
        } else if (content.family === "recovery") await this.#recovery(source, content);
        else if (content.family === "fence")
            this.#fences.push(
                Object.freeze({
                    source,
                    value: content.value,
                    protocolTerminal: physicalRole(source, "fence", this.#metaContexts.get(source.scope.scopeId)),
                })
            );
        else if (content.family === "state")
            this.#states.push(
                Object.freeze({
                    source,
                    value: content.value,
                    digest: content.digest,
                    stateTerminal: physicalRole(source, "state", this.#metaContexts.get(source.scope.scopeId)),
                })
            );
    }
    async #proofs() {
        for (const receipts of this.#groups.values()) {
            if (receipts.artifactKind !== "receipt") continue;
            const preparationKey = canonicalSerialize([
                "preparation",
                receipts.storeId,
                receipts.mutationId,
                receipts.canonicalPublicationId,
            ]);
            const preparations = this.#groups.get(preparationKey);
            if (!preparations) {
                for (const variant of receipts.variants)
                    this.#finding(
                        "ORPHAN_RECEIPT",
                        "PRIOR_PUBLICATION",
                        variant.observations[0].source,
                        receipts.storeId
                    );
                continue;
            }
            for (const prep of preparations.variants)
                for (const receipt of receipts.variants) {
                    const source = prep.observations[0].source;
                    if (!this.#pairWork(source, prep.value, receipt.value)) {
                        this.#finding("OBSERVATION_INCOMPLETE", "PRIOR_PUBLICATION", source);
                        return;
                    }
                    const exact = await validateReceiptAgainstPreparation(receipt.value, prep.value, this.codecs);
                    if (!this.#pairWork(source, prep.value, receipt.value)) {
                        this.#finding("OBSERVATION_INCOMPLETE", "PRIOR_PUBLICATION", source);
                        return;
                    }
                    const validation = await validatePriorPublicationEvidence(prep.value, receipt.value, this.codecs);
                    const mutation = this.#mutations.get(receipts.mutationId);
                    const coherent =
                        exact &&
                        !preparations.conflict &&
                        !receipts.conflict &&
                        !mutation?.conflict &&
                        !this.#recoveryIncomplete &&
                        this.#recoveryListsComplete;
                    const context = this.#declarationContexts.has(receipts.storeId)
                        ? ("SUPPORTED_COHERENT" as const)
                        : ("UNQUALIFIED" as const);
                    const physical =
                        prep.observations.some((o) => o.recoveryTerminal) &&
                        receipt.observations.some((o) => o.recoveryTerminal);
                    const individualEvidence =
                        coherent &&
                        physical &&
                        context === "SUPPORTED_COHERENT" &&
                        validation.status === "QUALIFIED_PRIOR_PUBLICATION"
                            ? Object.freeze({
                                  role: "QUALIFIED_PRIOR_PUBLICATION" as const,
                                  evidence: validation.evidence,
                              })
                            : undefined;
                    const preparation = prep.value;
                    const present =
                        preparation.artifactKind === "preparation" &&
                        this.#physicalCopyKeys.has(
                            canonicalSerialize([
                                preparation.storeId,
                                preparation.recordKind,
                                preparation.recordId,
                                preparation.candidateRevisionId,
                                preparation.candidateDigest,
                            ])
                        );
                    const coverage: PriorPublicationFactV05["canonicalCopyCoverage"] = present
                        ? "PRESENT"
                        : this.snapshot.status === "COMPLETE" &&
                            this.snapshot.coverage === "CONTAINING_BOUNDARIES" &&
                            !this.#canonicalUnknown
                          ? "MISSING_IN_COMPLETE_SCOPED_INVENTORY"
                          : "UNKNOWN";
                    this.#prior.push(
                        Object.freeze({
                            preparation: Object.freeze({ ...prep, observations: Object.freeze(prep.observations) }),
                            receipt: Object.freeze({ ...receipt, observations: Object.freeze(receipt.observations) }),
                            binding: exact ? "EXACT" : "MISBOUND",
                            validation: Object.freeze(validation),
                            coherent,
                            declarationContext: context,
                            canonicalCopyCoverage: coverage,
                            ...(individualEvidence ? { individualEvidence } : {}),
                        })
                    );
                    if (!exact)
                        this.#finding(
                            "MISBOUND_RECEIPT",
                            "PRIOR_PUBLICATION",
                            receipt.observations[0].source,
                            receipts.storeId
                        );
                    if (context === "UNQUALIFIED")
                        this.#finding("DECLARATION_CONTEXT_UNQUALIFIED", "PRIOR_PUBLICATION", source, receipts.storeId);
                }
        }
    }
    #fenceFacts() {
        if (
            !this.invocation.chargeWork(
                "graphWork",
                this.#canonical.length + this.#fences.length + this.#artifacts.length,
                0
            )
        ) {
            this.#incomplete = true;
            return;
        }
        const present = new Set(this.#fences.filter((f) => f.protocolTerminal).map((f) => f.value.storeId));
        const unknown =
            this.snapshot.status !== "COMPLETE" ||
            this.#artifacts.some(
                (a) =>
                    a.source.positions.some((p) => p.chain[p.chain.length - 1].role === "protocol-collection") &&
                    a.content.status !== "VALID"
            );
        for (const storeId of new Set(
            this.#canonical.filter((c) => c.physicallyCanonical).map((c) => c.envelope.storeId)
        )) {
            if (!present.has(storeId))
                this.#finding(
                    unknown ? "FENCE_COVERAGE_UNKNOWN" : "READ_ONLY_MISSING_FENCE",
                    "FENCE_FACT",
                    undefined,
                    storeId
                );
        }
    }
    async run(): Promise<ArtifactEvidenceResultV05> {
        if (
            this.invocation.chargeWork(
                "graphWork",
                this.snapshot.rawFiles.length * 3 +
                    this.snapshot.listings.length +
                    this.snapshot.declarationGroups.length,
                0
            )
        )
            this.#declarationContexts = supportedDeclarationContexts(this.snapshot);
        else {
            this.#incomplete = true;
            const raw = this.snapshot.rawFiles[0];
            if (raw)
                this.#finding(
                    "OBSERVATION_INCOMPLETE",
                    "RECOGNITION",
                    Object.freeze({ scope: raw.scope, file: raw.file, positions: Object.freeze([raw]) })
                );
            return this.#finish();
        }
        for (const raw of this.snapshot.rawFiles)
            if (raw.recognition.hint === "fence" || raw.recognition.hint === "state") {
                const contexts = this.#metaContexts.get(raw.scope.scopeId) ?? new Set<RepresentationDirectoryHandle>();
                for (const step of raw.chain) if (step.role === "meta-collection") contexts.add(step.directory);
                this.#metaContexts.set(raw.scope.scopeId, contexts);
            }
        const byScope = new Map<number, Map<RepresentationFileHandle, TraversalRawFileV05[]>>();
        for (const position of this.snapshot.rawFiles) {
            const files =
                byScope.get(position.scope.scopeId) ?? new Map<RepresentationFileHandle, TraversalRawFileV05[]>();
            const positions = files.get(position.file) ?? [];
            positions.push(position);
            files.set(position.file, positions);
            byScope.set(position.scope.scopeId, files);
        }
        for (const files of byScope.values())
            for (const positions of files.values()) {
                const source = Object.freeze({
                    scope: positions[0].scope,
                    file: positions[0].file,
                    positions: Object.freeze(positions),
                });
                await this.#recognize(source);
                if (this.invocation.budget().refusal) break;
            }
        if (
            this.invocation.chargeWork(
                "graphWork",
                this.#canonical.length + this.#artifacts.length + this.snapshot.listings.length,
                0
            )
        ) {
            for (const c of this.#canonical)
                if (c.physicallyCanonical)
                    this.#physicalCopyKeys.add(
                        canonicalSerialize([
                            c.envelope.storeId,
                            c.envelope.recordKind,
                            c.envelope.recordId,
                            c.envelope.revisionId,
                            c.digest,
                        ])
                    );
            this.#canonicalUnknown = this.#artifacts.some(
                (a) =>
                    a.source.positions.some((p) => p.chain[p.chain.length - 1].role === "record-kind-collection") &&
                    a.content.status !== "VALID"
            );
            this.#recoveryListsComplete =
                !this.snapshot.budget.refusal &&
                this.snapshot.listings.every(
                    (l) =>
                        !(
                            [
                                "vault-root",
                                "representation-root",
                                "stores-collection",
                                "store-subtree",
                                "recovery-collection",
                                "recovery-kind-collection",
                            ] as readonly string[]
                        ).includes(l.role) || l.outcome.status === "COMPLETE"
                );
        } else this.#incomplete = true;
        await this.#proofs();
        this.#fenceFacts();
        return this.#finish();
    }
    #finish(): ArtifactEvidenceResultV05 {
        const incomplete =
            this.#incomplete || this.snapshot.status === "INCOMPLETE" || Boolean(this.invocation.budget().refusal);
        return Object.freeze({
            kind: "S2_V05_INDIVIDUAL_ARTIFACT_EVIDENCE",
            status: incomplete ? "INCOMPLETE" : "OBSERVATIONS_FINISHED",
            manifest: this.invocation.manifest,
            physicalObservationStatus: this.snapshot.status,
            artifacts: Object.freeze(this.#artifacts),
            canonical: Object.freeze(this.#canonical),
            identityClaims: Object.freeze(this.#claims),
            executionArtifacts: Object.freeze(
                [...this.#groups.values()].map((g) =>
                    Object.freeze({
                        artifactKind: g.artifactKind,
                        storeId: g.storeId,
                        mutationId: g.mutationId,
                        canonicalPublicationId: g.canonicalPublicationId,
                        state: g.conflict
                            ? ("EXECUTION_ARTIFACT_CONFLICT" as const)
                            : incomplete
                              ? ("INCOMPLETE" as const)
                              : ("EQUIVALENT" as const),
                        variants: Object.freeze(
                            g.variants.map((v) => Object.freeze({ ...v, observations: Object.freeze(v.observations) }))
                        ),
                    })
                )
            ),
            logicalMutations: Object.freeze(
                [...this.#mutations].map(([mutationId, m]) =>
                    Object.freeze({
                        mutationId,
                        state: m.conflict
                            ? ("MUTATION_IDENTITY_CONFLICT" as const)
                            : incomplete
                              ? ("INCOMPLETE" as const)
                              : ("EQUIVALENT_LOGICAL_MUTATION" as const),
                        preparations: Object.freeze(m.preparations),
                        bindings: Object.freeze(m.bindings),
                    })
                )
            ),
            priorPublications: Object.freeze(this.#prior),
            fences: Object.freeze(this.#fences),
            states: Object.freeze(this.#states),
            migrations: Object.freeze(this.#migrations),
            findings: Object.freeze(this.#findings),
            budget: this.invocation.budget(),
        });
    }
}
/** Captures registry/scopes/explicit limits before the first await; all stages share one ledger. */
export interface ArtifactEvidenceInvocationV05 {
    readonly invocation: DiscoveryInvocationV05;
    readonly physical: PhysicalStorageTraversalV05;
    readonly evidence: ArtifactEvidenceResultV05;
}
/** Additive same-invocation handoff; no caller supplied evidence or second ledger. */
export function discoverArtifactEvidenceInvocationV05(
    input: ArtifactEvidenceInputV05,
    aggregateLimits?: DiscoveryAggregateLimitsV05
): Promise<ArtifactEvidenceInvocationV05> {
    const evidence = snapshotEvidenceLimits(input?.limits);
    const work = snapshotTraversalWorkLimits(input?.limits);
    const invocation = new DiscoveryInvocationV05(input, work, evidence, aggregateLimits);
    if (!isArrayValue(input.recordCodecs)) throw new Error("Explicit record codec registry required.");
    const admitted = invocation.chargeWork("graphWork", input.recordCodecs.length, 0);
    const codecs = admitted ? snapshotCodecs(input.recordCodecs) : Object.freeze([] as CanonicalRecordCodec[]);
    return (async () => {
        const physical = await traverseNamespaceStoresV05(invocation);
        return Object.freeze({
            invocation,
            physical,
            evidence: await new ArtifactEvidenceCollector(invocation, physical, codecs).run(),
        });
    })();
}
export function discoverArtifactEvidenceV05(input: ArtifactEvidenceInputV05): Promise<ArtifactEvidenceResultV05> {
    return discoverArtifactEvidenceInvocationV05(input).then((observed) => observed.evidence);
}
