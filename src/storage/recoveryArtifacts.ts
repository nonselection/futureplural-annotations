/** Pure Canonical Storage v0.5 recovery codecs and supplied-evidence validation. */
import {
    artifactDigest,
    canonicalSerialize,
    isArtifactDigest,
    isCanonicalDigest,
    type ArtifactDigest,
    type CanonicalDigest,
} from "./canonicalEncoding";
import {
    canonicalRevisionDigest,
    CanonicalEnvelopeError,
    decodeCanonicalRevisionEnvelope,
    type CanonicalRecordCodec,
    type CanonicalRevisionEnvelope,
} from "./envelopes";
import {
    isMutationId,
    isPublicationId,
    isRevisionId,
    isStoreId,
    type MutationId,
    type PublicationId,
    type RevisionId,
    type StoreId,
} from "./identity";
import {
    isCanonicalObservation,
    isPhysicalEffect,
    type CanonicalObservation,
    type PhysicalEffect,
} from "./publicationEffects";
import { REQUIRED_PROTOCOL_VERSION } from "./protocol";

// Deprecated facade only. Normative APIs below never call or import these implementations.
// Remove historical facade exports after S2/S3 retrofit integration.
export {
    LEGACY_RECOVERY_FORMAT_VERSION,
    RecoveryArtifactError,
    validateMutationIntent,
    encodeMutationIntent,
    decodeMutationIntent,
    mutationIntentDigest,
    encodeMutationOutcome,
    decodeMutationOutcome,
    validateOutcomeAgainstIntent,
    recognizeRecoveryArtifactBytes,
    type MutationIntentV1,
    type MutationOutcomeV1,
    type MutationOutcomeStatus,
    type RecoveryArtifactRecognition,
} from "./legacy/recoveryArtifactsV1";

export const RECOVERY_FORMAT_VERSION = 2 as const;

export interface ResolutionHeadBinding {
    readonly revisionId: RevisionId;
    readonly digest: CanonicalDigest;
}

export interface RecoveryPreparationV2 {
    readonly recoveryFormatVersion: typeof RECOVERY_FORMAT_VERSION;
    readonly artifactKind: "preparation";
    readonly requiredProtocolVersion: typeof REQUIRED_PROTOCOL_VERSION;
    readonly storeId: StoreId;
    readonly recordKind: string;
    readonly recordId: string;
    readonly mutationId: MutationId;
    readonly canonicalPublicationId: PublicationId;
    readonly purpose: "transition" | "exact-materialization";
    readonly candidateRevisionId: RevisionId;
    readonly candidateDigest: CanonicalDigest;
    readonly after: CanonicalRevisionEnvelope;
    readonly baseRevisionId: RevisionId | null;
    readonly baseDigest: CanonicalDigest | null;
    readonly resolutionHeads: readonly ResolutionHeadBinding[];
}

export interface RecoveryReceiptV2 {
    readonly recoveryFormatVersion: typeof RECOVERY_FORMAT_VERSION;
    readonly artifactKind: "receipt";
    readonly requiredProtocolVersion: typeof REQUIRED_PROTOCOL_VERSION;
    readonly storeId: StoreId;
    readonly recordKind: string;
    readonly recordId: string;
    readonly mutationId: MutationId;
    readonly canonicalPublicationId: PublicationId;
    readonly preparationDigest: ArtifactDigest;
    readonly candidateRevisionId: RevisionId;
    readonly candidateDigest: CanonicalDigest;
    readonly physicalEffect: PhysicalEffect;
    readonly canonicalObservation: CanonicalObservation;
}

export interface LogicalMutationBinding {
    readonly storeId: StoreId;
    readonly recordKind: string;
    readonly recordId: string;
    readonly candidateRevisionId: RevisionId;
    readonly candidateDigest: CanonicalDigest;
    readonly after: CanonicalRevisionEnvelope;
    readonly baseRevisionId: RevisionId | null;
    readonly baseDigest: CanonicalDigest | null;
    readonly resolutionHeads: readonly ResolutionHeadBinding[];
}

export type LogicalMutationComparison =
    | "EQUIVALENT_LOGICAL_MUTATION"
    | "DISTINCT_MUTATION"
    | "MUTATION_IDENTITY_CONFLICT";
export type RecoveryExecutionComparison = "EQUIVALENT" | "DISTINCT_EXECUTION_ARTIFACT" | "EXECUTION_ARTIFACT_CONFLICT";

declare const priorPublicationEvidenceBrand: unique symbol;

/** Exact bound per-execution proof; no current-head, physical-presence or write-gate claim. */
export interface ValidatedPriorPublicationEvidence {
    readonly [priorPublicationEvidenceBrand]: true;
    readonly envelope: CanonicalRevisionEnvelope;
    readonly digest: CanonicalDigest;
    readonly logicalBinding: LogicalMutationBinding;
    readonly mutationId: MutationId;
    readonly canonicalPublicationId: PublicationId;
    readonly preparationDigest: ArtifactDigest;
    readonly receiptDigest: ArtifactDigest;
    readonly preparation: RecoveryPreparationV2;
    readonly receipt: RecoveryReceiptV2;
    readonly physicalEffect: Exclude<PhysicalEffect, "NO_MUTATION_DISPATCHED">;
    readonly canonicalObservation: "EXACT_CANDIDATE";
}

export type PriorPublicationValidation =
    | { readonly status: "QUALIFIED_PRIOR_PUBLICATION"; readonly evidence: ValidatedPriorPublicationEvidence }
    | { readonly status: "NOT_QUALIFIED" | "INVALID" | "UNSUPPORTED"; readonly reason: string };

/** S2 supplies direct canonical collection admission; S1 has no direct-admission factory. */
export type QualifiedRevisionEvidence =
    | {
          readonly role: "DIRECT_CANONICAL";
          readonly envelope: CanonicalRevisionEnvelope;
          readonly digest: CanonicalDigest;
      }
    | { readonly role: "QUALIFIED_PRIOR_PUBLICATION"; readonly evidence: ValidatedPriorPublicationEvidence };

export type RecoveryV2ArtifactRecognition =
    | {
          readonly status: "VALID";
          readonly kind: "preparation";
          readonly value: RecoveryPreparationV2;
          readonly digest: ArtifactDigest;
      }
    | {
          readonly status: "VALID";
          readonly kind: "receipt";
          readonly value: RecoveryReceiptV2;
          readonly digest: ArtifactDigest;
      }
    | {
          readonly status: "INVALID" | "UNSUPPORTED" | "UNRECOGNIZED";
          readonly reason: string;
          readonly bytes: Uint8Array;
      };

export class RecoveryV2ArtifactError extends Error {
    constructor(
        readonly category: "invalid" | "unsupported",
        message: string
    ) {
        super(message);
        this.name = "RecoveryV2ArtifactError";
    }
}

function fail(message: string, category: "invalid" | "unsupported" = "invalid"): never {
    throw new RecoveryV2ArtifactError(category, message);
}

function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return fail("Recovery artifact is malformed JSON.");
    }
}

/** Snapshot before any await, also rejecting getters/symbols/nonportable JSON. */
function detached(value: unknown): unknown {
    try {
        return JSON.parse(canonicalSerialize(value)) as unknown;
    } catch (error) {
        return fail(
            `Recovery content is not canonical JSON: ${error instanceof Error ? error.message : "encoding failed"}`
        );
    }
}

function freezeContent<T>(value: T): T {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) freezeContent(child);
        Object.freeze(value);
    }
    return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
    return value as Record<string, unknown>;
}

function fields(row: Record<string, unknown>, expected: readonly string[], label: string): void {
    const allowed = new Set(expected);
    for (const key of Object.keys(row)) if (!allowed.has(key)) fail(`${label} has unknown field ${key}.`);
    for (const field of expected)
        if (!Object.prototype.hasOwnProperty.call(row, field)) fail(`${label} is missing ${field}.`);
}

function version(row: Record<string, unknown>): void {
    if (!Object.prototype.hasOwnProperty.call(row, "recoveryFormatVersion"))
        fail("Recovery artifact is missing recoveryFormatVersion.");
    const value = row.recoveryFormatVersion;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) fail("Invalid recoveryFormatVersion.");
    if (value !== RECOVERY_FORMAT_VERSION) fail(`Unsupported recovery format version ${value}.`, "unsupported");
}

function isArrayValue(value: unknown): boolean {
    return Array.isArray(value);
}

function recordIdentity(
    row: Record<string, unknown>,
    codecs: readonly CanonicalRecordCodec[]
): { recordKind: string; recordId: string } {
    const kind = row.recordKind;
    const id = row.recordId;
    if (typeof kind !== "string" || !kind.trim() || kind.includes("\0") || kind.length > 128)
        fail("Invalid recordKind.");
    if (typeof id !== "string" || !id.trim() || id.includes("\0") || id.length > 512) fail("Invalid recordId.");
    if (!isArrayValue(codecs)) fail("Invalid record codec registry.");
    const seen = new Set<string>();
    for (const codec of codecs) {
        if (
            !codec ||
            typeof codec.recordKind !== "string" ||
            !codec.recordKind.trim() ||
            codec.recordKind.includes("\0") ||
            codec.recordKind.length > 128 ||
            !Number.isSafeInteger(codec.schemaVersion) ||
            codec.schemaVersion < 1 ||
            typeof codec.isRecordId !== "function" ||
            typeof codec.validatePayload !== "function"
        )
            fail("Invalid record codec registry.");
        if (seen.has(codec.recordKind)) fail("Duplicate record codec.");
        seen.add(codec.recordKind);
    }
    const codec = codecs.find((item) => item.recordKind === kind);
    if (!codec) fail(`Unsupported record kind ${kind}.`, "unsupported");
    let valid = false;
    try {
        valid = codec.isRecordId(id);
    } catch {
        fail("RecordId validation failed.");
    }
    if (!valid) fail(`Invalid recordId for ${kind}.`);
    return { recordKind: kind, recordId: id };
}

function common(row: Record<string, unknown>, codecs: readonly CanonicalRecordCodec[], expectedStoreId?: StoreId) {
    if (!Number.isSafeInteger(row.requiredProtocolVersion) || (row.requiredProtocolVersion as number) < 1)
        fail("Invalid requiredProtocolVersion.");
    if (row.requiredProtocolVersion !== REQUIRED_PROTOCOL_VERSION)
        fail("Unsupported requiredProtocolVersion.", "unsupported");
    if (!isStoreId(row.storeId)) fail("Invalid storeId.");
    if (expectedStoreId !== undefined && row.storeId !== expectedStoreId)
        fail("storeId does not match expected logical store.");
    const record = recordIdentity(row, codecs);
    if (!isMutationId(row.mutationId)) fail("Invalid mutationId.");
    if (!isPublicationId(row.canonicalPublicationId)) fail("Invalid canonicalPublicationId.");
    if (!isRevisionId(row.candidateRevisionId)) fail("Invalid candidateRevisionId.");
    if (!isCanonicalDigest(row.candidateDigest)) fail("Invalid candidateDigest.");
    return {
        recoveryFormatVersion: RECOVERY_FORMAT_VERSION,
        requiredProtocolVersion: REQUIRED_PROTOCOL_VERSION,
        storeId: row.storeId,
        ...record,
        mutationId: row.mutationId,
        canonicalPublicationId: row.canonicalPublicationId,
        candidateRevisionId: row.candidateRevisionId,
        candidateDigest: row.candidateDigest,
    };
}

const PREPARATION_FIELDS = [
    "recoveryFormatVersion",
    "artifactKind",
    "requiredProtocolVersion",
    "storeId",
    "recordKind",
    "recordId",
    "mutationId",
    "canonicalPublicationId",
    "purpose",
    "candidateRevisionId",
    "candidateDigest",
    "after",
    "baseRevisionId",
    "baseDigest",
    "resolutionHeads",
] as const;
const RECEIPT_FIELDS = [
    "recoveryFormatVersion",
    "artifactKind",
    "requiredProtocolVersion",
    "storeId",
    "recordKind",
    "recordId",
    "mutationId",
    "canonicalPublicationId",
    "preparationDigest",
    "candidateRevisionId",
    "candidateDigest",
    "physicalEffect",
    "canonicalObservation",
] as const;

function baseRevision(value: unknown): RevisionId | null {
    if (value === null) return null;
    if (!isRevisionId(value)) fail("Invalid baseRevisionId.");
    return value;
}

function baseDigestValue(value: unknown): CanonicalDigest | null {
    if (value === null) return null;
    if (!isCanonicalDigest(value)) fail("Invalid baseDigest.");
    return value;
}

export async function validateRecoveryPreparation(
    value: unknown,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<RecoveryPreparationV2> {
    const row = object(detached(value), "Recovery preparation");
    version(row); // Recognize incompatible formats before asking for v2-only fields.
    fields(row, PREPARATION_FIELDS, "Recovery preparation");
    if (row.artifactKind !== "preparation") fail("Invalid preparation artifactKind.");
    const binding = common(row, codecs, expectedStoreId);
    if (row.purpose !== "transition" && row.purpose !== "exact-materialization") fail("Invalid purpose.");
    const baseRevisionId = baseRevision(row.baseRevisionId);
    const baseDigest = baseDigestValue(row.baseDigest);
    if ((baseRevisionId === null) !== (baseDigest === null)) fail("Base ID/digest must both be null or both valid.");
    if (!Array.isArray(row.resolutionHeads)) fail("resolutionHeads must be an array.");
    const heads: ResolutionHeadBinding[] = row.resolutionHeads.map((value) => {
        const head = object(value, "Resolution head");
        fields(head, ["revisionId", "digest"], "Resolution head");
        if (!isRevisionId(head.revisionId)) fail("Invalid resolution head RevisionId.");
        if (!isCanonicalDigest(head.digest)) fail("Invalid resolution head digest.");
        return { revisionId: head.revisionId, digest: head.digest };
    });
    if (heads.length === 1) fail("Resolution must bind at least two heads.");
    const ids = heads.map((head) => head.revisionId);
    if (new Set(ids).size !== ids.length) fail("Resolution heads must be unique.");
    const sortedIds = [...ids].sort();
    if (ids.some((id, index) => id !== sortedIds[index])) fail("Resolution heads must be sorted.");
    if (ids.includes(binding.candidateRevisionId)) fail("Candidate cannot be its own resolution head.");
    let decoded: CanonicalRevisionEnvelope;
    try {
        decoded = decodeCanonicalRevisionEnvelope(canonicalSerialize(row.after), codecs);
    } catch (error) {
        if (error instanceof CanonicalEnvelopeError && error.category === "unsupported")
            fail(`after is unsupported: ${error.message}`, "unsupported");
        fail(`after is invalid: ${error instanceof Error ? error.message : "validation failed"}`);
    }
    // Detach codec-returned payload too: codecs may return externally owned objects.
    const after = detached(decoded) as CanonicalRevisionEnvelope;
    if (
        after.storeId !== binding.storeId ||
        after.recordKind !== binding.recordKind ||
        after.recordId !== binding.recordId
    )
        fail("after record identity does not match outer binding.");
    if (after.revisionId !== binding.candidateRevisionId) fail("after revisionId does not match candidateRevisionId.");
    if (after.parentRevisionId !== baseRevisionId) fail("after parentRevisionId does not match baseRevisionId.");
    if (baseRevisionId === null && (heads.length || after.resolvedRevisionIds.length))
        fail("Null base requires original creation without resolution.");
    if (heads.length === 0 && after.resolvedRevisionIds.length)
        fail("Ordinary preparation cannot carry resolution provenance.");
    if (heads.length) {
        const selected = heads.find((head) => head.revisionId === baseRevisionId);
        if (!selected) fail("Selected base parent must be included in resolutionHeads.");
        if (selected.digest !== baseDigest) fail("Selected parent digest does not match baseDigest.");
        if (canonicalSerialize(after.resolvedRevisionIds) !== canonicalSerialize(ids))
            fail("Resolution head IDs do not exactly match after provenance.");
    }
    const preparation: RecoveryPreparationV2 = freezeContent({
        ...binding,
        artifactKind: "preparation",
        purpose: row.purpose,
        after,
        baseRevisionId,
        baseDigest,
        resolutionHeads: heads,
    });
    if ((await canonicalRevisionDigest(preparation.after)) !== preparation.candidateDigest)
        fail("candidateDigest does not match complete after content.");
    return preparation;
}

export async function decodeRecoveryPreparation(
    raw: string,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<RecoveryPreparationV2> {
    return validateRecoveryPreparation(parseJson(raw), codecs, expectedStoreId);
}

export async function encodeRecoveryPreparation(
    value: RecoveryPreparationV2,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<string> {
    return canonicalSerialize(await validateRecoveryPreparation(value, codecs, expectedStoreId));
}

export async function recoveryPreparationDigest(
    value: RecoveryPreparationV2,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<ArtifactDigest> {
    return artifactDigest(await validateRecoveryPreparation(value, codecs, expectedStoreId));
}

export function validateRecoveryReceipt(
    value: unknown,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): RecoveryReceiptV2 {
    const row = object(detached(value), "Recovery receipt");
    version(row);
    fields(row, RECEIPT_FIELDS, "Recovery receipt");
    if (row.artifactKind !== "receipt") fail("Invalid receipt artifactKind.");
    const binding = common(row, codecs, expectedStoreId);
    if (!isArtifactDigest(row.preparationDigest)) fail("Invalid preparationDigest.");
    if (!isPhysicalEffect(row.physicalEffect)) fail("Invalid physicalEffect.");
    if (!isCanonicalObservation(row.canonicalObservation)) fail("Invalid canonicalObservation.");
    if (row.physicalEffect === "NO_MUTATION_DISPATCHED" && row.canonicalObservation === "EXACT_CANDIDATE")
        fail("Nondispatch cannot claim EXACT_CANDIDATE.");
    return freezeContent({
        ...binding,
        artifactKind: "receipt",
        preparationDigest: row.preparationDigest,
        physicalEffect: row.physicalEffect,
        canonicalObservation: row.canonicalObservation,
    });
}

export function decodeRecoveryReceipt(
    raw: string,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): RecoveryReceiptV2 {
    return validateRecoveryReceipt(parseJson(raw), codecs, expectedStoreId);
}

export function encodeRecoveryReceipt(
    value: RecoveryReceiptV2,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): string {
    return canonicalSerialize(validateRecoveryReceipt(value, codecs, expectedStoreId));
}

export function recoveryReceiptDigest(
    value: RecoveryReceiptV2,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<ArtifactDigest> {
    return artifactDigest(validateRecoveryReceipt(value, codecs, expectedStoreId));
}

function projectValidated(preparation: RecoveryPreparationV2): LogicalMutationBinding {
    return freezeContent({
        storeId: preparation.storeId,
        recordKind: preparation.recordKind,
        recordId: preparation.recordId,
        candidateRevisionId: preparation.candidateRevisionId,
        candidateDigest: preparation.candidateDigest,
        after: preparation.after,
        baseRevisionId: preparation.baseRevisionId,
        baseDigest: preparation.baseDigest,
        resolutionHeads: preparation.resolutionHeads,
    });
}

export async function projectLogicalMutationBinding(
    value: unknown,
    codecs: readonly CanonicalRecordCodec[]
): Promise<LogicalMutationBinding> {
    return projectValidated(await validateRecoveryPreparation(value, codecs));
}

export async function compareLogicalMutationBindings(
    left: unknown,
    right: unknown,
    codecs: readonly CanonicalRecordCodec[],
    rightCodecs: readonly CanonicalRecordCodec[] = codecs
): Promise<LogicalMutationComparison> {
    // Supplied claims may have distinct domain schema validation contexts.
    // This comparison establishes identity consistency, never schema admission or write permission.
    const [first, second] = await Promise.all([
        validateRecoveryPreparation(left, codecs),
        validateRecoveryPreparation(right, rightCodecs),
    ]);
    if (first.mutationId !== second.mutationId) return "DISTINCT_MUTATION";
    return canonicalSerialize(projectValidated(first)) === canonicalSerialize(projectValidated(second))
        ? "EQUIVALENT_LOGICAL_MUTATION"
        : "MUTATION_IDENTITY_CONFLICT";
}

async function receiptBinding(receipt: RecoveryReceiptV2, preparation: RecoveryPreparationV2): Promise<boolean> {
    return (
        receipt.storeId === preparation.storeId &&
        receipt.recordKind === preparation.recordKind &&
        receipt.recordId === preparation.recordId &&
        receipt.mutationId === preparation.mutationId &&
        receipt.canonicalPublicationId === preparation.canonicalPublicationId &&
        receipt.candidateRevisionId === preparation.candidateRevisionId &&
        receipt.candidateDigest === preparation.candidateDigest &&
        receipt.preparationDigest === (await artifactDigest(preparation))
    );
}

export async function validateReceiptAgainstPreparation(
    receipt: unknown,
    preparation: unknown,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<boolean> {
    const validatedReceipt = validateRecoveryReceipt(receipt, codecs, expectedStoreId);
    const validatedPreparation = await validateRecoveryPreparation(preparation, codecs, expectedStoreId);
    return receiptBinding(validatedReceipt, validatedPreparation);
}

async function executionArtifact(
    value: unknown,
    codecs: readonly CanonicalRecordCodec[]
): Promise<RecoveryPreparationV2 | RecoveryReceiptV2> {
    const row = object(detached(value), "Recovery execution artifact");
    version(row);
    if (row.artifactKind === "preparation") return validateRecoveryPreparation(row, codecs);
    if (row.artifactKind === "receipt") return validateRecoveryReceipt(row, codecs);
    return fail("Invalid recovery artifactKind.");
}

export async function compareRecoveryExecutionArtifacts(
    left: unknown,
    right: unknown,
    codecs: readonly CanonicalRecordCodec[]
): Promise<RecoveryExecutionComparison> {
    const [first, second] = await Promise.all([executionArtifact(left, codecs), executionArtifact(right, codecs)]);
    // Record kind/id are content bindings within this artifact identity, not distinct-artifact keys.
    if (
        first.artifactKind !== second.artifactKind ||
        first.storeId !== second.storeId ||
        first.mutationId !== second.mutationId ||
        first.canonicalPublicationId !== second.canonicalPublicationId
    )
        return "DISTINCT_EXECUTION_ARTIFACT";
    return canonicalSerialize(first) === canonicalSerialize(second) ? "EQUIVALENT" : "EXECUTION_ARTIFACT_CONFLICT";
}

export async function validatePriorPublicationEvidence(
    preparation: unknown,
    receipt: unknown,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<PriorPublicationValidation> {
    try {
        // Validate complete preparation even when the receipt is absent; malformed intent isn't qualified intent.
        // Snapshot receipt before the preparation hash yields.
        const validatedReceipt =
            receipt === null || receipt === undefined
                ? null
                : validateRecoveryReceipt(receipt, codecs, expectedStoreId);
        const validatedPreparation = await validateRecoveryPreparation(preparation, codecs, expectedStoreId);
        if (!validatedReceipt)
            return { status: "NOT_QUALIFIED", reason: "Complete preparation alone is not prior-publication evidence." };
        if (!(await receiptBinding(validatedReceipt, validatedPreparation)))
            return { status: "INVALID", reason: "Receipt does not match complete preparation/execution binding." };
        if (
            validatedReceipt.canonicalObservation !== "EXACT_CANDIDATE" ||
            validatedReceipt.physicalEffect === "NO_MUTATION_DISPATCHED"
        )
            return { status: "NOT_QUALIFIED", reason: "Receipt does not establish this execution's exact candidate." };
        const [preparationDigest, receiptDigest] = await Promise.all([
            artifactDigest(validatedPreparation),
            artifactDigest(validatedReceipt),
        ]);
        const evidence = freezeContent({
            envelope: validatedPreparation.after,
            digest: validatedPreparation.candidateDigest,
            logicalBinding: projectValidated(validatedPreparation),
            mutationId: validatedPreparation.mutationId,
            canonicalPublicationId: validatedPreparation.canonicalPublicationId,
            preparationDigest,
            receiptDigest,
            preparation: validatedPreparation,
            receipt: validatedReceipt,
            physicalEffect: validatedReceipt.physicalEffect,
            canonicalObservation: validatedReceipt.canonicalObservation,
        }) as ValidatedPriorPublicationEvidence;
        return { status: "QUALIFIED_PRIOR_PUBLICATION", evidence };
    } catch (error) {
        return {
            status:
                error instanceof RecoveryV2ArtifactError && error.category === "unsupported"
                    ? "UNSUPPORTED"
                    : "INVALID",
            reason: error instanceof Error ? error.message : "Prior-publication evidence validation failed.",
        };
    }
}

/** Content-only recognition; failed recognition retains an owned raw-byte copy. No path/admission policy. */
export async function recognizeRecoveryV2ArtifactBytes(
    input: Uint8Array,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<RecoveryV2ArtifactRecognition> {
    const bytes = Uint8Array.from(input);
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
        return { status: "INVALID", reason: "Recovery bytes are not valid UTF-8 JSON.", bytes };
    }
    try {
        const row = object(value, "Recovery artifact");
        if (
            !Object.prototype.hasOwnProperty.call(row, "recoveryFormatVersion") &&
            !Object.prototype.hasOwnProperty.call(row, "artifactKind")
        )
            return { status: "UNRECOGNIZED", reason: "Content does not claim a recovery artifact.", bytes };
        version(row);
        if (row.artifactKind === "preparation") {
            const preparation = await validateRecoveryPreparation(row, codecs, expectedStoreId);
            return {
                status: "VALID",
                kind: "preparation",
                value: preparation,
                digest: await artifactDigest(preparation),
            };
        }
        if (row.artifactKind === "receipt") {
            const receipt = validateRecoveryReceipt(row, codecs, expectedStoreId);
            return { status: "VALID", kind: "receipt", value: receipt, digest: await artifactDigest(receipt) };
        }
        return { status: "INVALID", reason: "Invalid recovery artifactKind.", bytes };
    } catch (error) {
        return {
            status:
                error instanceof RecoveryV2ArtifactError && error.category === "unsupported"
                    ? "UNSUPPORTED"
                    : "INVALID",
            reason: error instanceof Error ? error.message : "Recovery artifact validation failed.",
            bytes,
        };
    }
}
