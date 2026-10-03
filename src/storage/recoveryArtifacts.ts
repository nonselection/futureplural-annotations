import { canonicalDigest, canonicalSerialize, isCanonicalDigest, type CanonicalDigest } from "./canonicalEncoding";
import {
    decodeCanonicalRevisionEnvelope,
    encodeCanonicalRevisionEnvelope,
    canonicalRevisionDigest,
    CanonicalEnvelopeError,
    type CanonicalRecordCodec,
    type CanonicalRevisionEnvelope,
} from "./envelopes";
import { isMutationId, isRevisionId, isStoreId, type MutationId, type RevisionId, type StoreId } from "./identity";

export const RECOVERY_FORMAT_VERSION = 1 as const;

export interface MutationIntentV1 {
    readonly recoveryFormatVersion: typeof RECOVERY_FORMAT_VERSION;
    readonly storeId: StoreId;
    readonly mutationId: MutationId;
    readonly recordKind: string;
    readonly recordId: string;
    readonly baseRevisionId: RevisionId | null;
    readonly baseDigest: CanonicalDigest | null;
    readonly before: CanonicalRevisionEnvelope | null;
    readonly candidateRevisionId: RevisionId;
    readonly candidateDigest: CanonicalDigest;
    readonly after: CanonicalRevisionEnvelope;
}

export type MutationOutcomeStatus = "VERIFIED_APPLIED" | "PRECONDITION_REJECTED" | "IO_FAILED";

export interface MutationOutcomeV1 {
    readonly recoveryFormatVersion: typeof RECOVERY_FORMAT_VERSION;
    readonly storeId: StoreId;
    readonly mutationId: MutationId;
    readonly intentDigest: CanonicalDigest;
    readonly recordKind: string;
    readonly recordId: string;
    readonly candidateRevisionId: RevisionId;
    readonly candidateDigest: CanonicalDigest;
    readonly status: MutationOutcomeStatus;
}

export class RecoveryArtifactError extends Error {
    readonly category: "invalid" | "unsupported";

    constructor(category: "invalid" | "unsupported", message: string) {
        super(message);
        this.name = "RecoveryArtifactError";
        this.category = category;
    }
}

function fail(message: string, category: "invalid" | "unsupported" = "invalid"): never {
    throw new RecoveryArtifactError(category, message);
}

function asObject(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
    return value as Record<string, unknown>;
}

function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return fail("Recovery artifact is malformed JSON.");
    }
}

function validateFields(row: Record<string, unknown>, expected: readonly string[], label: string): void {
    const allowed = new Set(expected);
    for (const key of Object.keys(row)) if (!allowed.has(key)) fail(`${label} has unknown field ${key}.`);
    for (const field of expected)
        if (!Object.prototype.hasOwnProperty.call(row, field)) fail(`${label} is missing ${field}.`);
}

function validateVersion(value: unknown): void {
    if (value === RECOVERY_FORMAT_VERSION) return;
    if (typeof value === "number" && Number.isSafeInteger(value) && value > RECOVERY_FORMAT_VERSION) {
        fail(`Unsupported recovery format version ${value}.`, "unsupported");
    }
    fail("Invalid recoveryFormatVersion.");
}

function validateRecordKind(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > 128) {
        fail("Invalid recordKind.");
    }
    return value;
}

function validateRecordId(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.includes("\0") || value.length > 512) {
        fail("Invalid recordId.");
    }
    return value;
}

function validateRevisionOrNull(value: unknown, label: string): RevisionId | null {
    if (value === null) return null;
    if (!isRevisionId(value)) fail(`${label} must be a valid RevisionId or null.`);
    return value;
}

function validateDigestOrNull(value: unknown, label: string): CanonicalDigest | null {
    if (value === null) return null;
    if (!isCanonicalDigest(value)) fail(`${label} must be a canonical SHA-256 digest or null.`);
    return value;
}

function decodeNestedEnvelope(
    value: unknown,
    codecs: readonly CanonicalRecordCodec[],
    label: string
): CanonicalRevisionEnvelope {
    let encoded: string;
    try {
        encoded = canonicalSerialize(value);
    } catch (error) {
        fail(`${label} is not canonical JSON: ${error instanceof Error ? error.message : "encoding failed"}`);
    }
    try {
        return decodeCanonicalRevisionEnvelope(encoded, codecs);
    } catch (error) {
        if (error instanceof CanonicalEnvelopeError && error.category === "unsupported") {
            fail(`${label} is unsupported: ${error.message}`, "unsupported");
        }
        fail(`${label} is invalid: ${error instanceof Error ? error.message : "validation failed"}`);
    }
}

function validateMutationIntentObject(
    value: unknown,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): MutationIntentV1 {
    canonicalSerialize(value);
    const row = asObject(value, "Mutation intent");
    validateFields(
        row,
        [
            "recoveryFormatVersion",
            "storeId",
            "mutationId",
            "recordKind",
            "recordId",
            "baseRevisionId",
            "baseDigest",
            "before",
            "candidateRevisionId",
            "candidateDigest",
            "after",
        ],
        "Mutation intent"
    );
    validateVersion(row.recoveryFormatVersion);
    if (!isStoreId(row.storeId)) fail("Mutation intent has an invalid storeId.");
    if (expectedStoreId !== undefined && row.storeId !== expectedStoreId) {
        fail("Mutation intent storeId does not match its containing logical store.");
    }
    if (!isMutationId(row.mutationId)) fail("Mutation intent has an invalid mutationId.");
    const recordKind = validateRecordKind(row.recordKind);
    const recordId = validateRecordId(row.recordId);
    const baseRevisionId = validateRevisionOrNull(row.baseRevisionId, "baseRevisionId");
    const baseDigest = validateDigestOrNull(row.baseDigest, "baseDigest");
    const before = row.before === null ? null : decodeNestedEnvelope(row.before, codecs, "before");
    if (!isRevisionId(row.candidateRevisionId)) fail("Mutation intent has an invalid candidateRevisionId.");
    if (!isCanonicalDigest(row.candidateDigest)) fail("Mutation intent has an invalid candidateDigest.");
    const after = decodeNestedEnvelope(row.after, codecs, "after");

    if (after.storeId !== row.storeId || after.recordKind !== recordKind || after.recordId !== recordId) {
        fail("Mutation intent candidate record identity does not match its outer binding.");
    }
    if (after.revisionId !== row.candidateRevisionId) fail("candidateRevisionId does not match the after record.");
    if (before === null) {
        if (baseRevisionId !== null || baseDigest !== null)
            fail("Creation intent requires null base fields and before.");
        if (after.parentRevisionId !== null) fail("Creation candidate must have a null parentRevisionId.");
        if (after.resolvedRevisionIds.length) fail("Creation candidate cannot claim resolution provenance.");
    } else {
        if (before.storeId !== row.storeId || before.recordKind !== recordKind || before.recordId !== recordId) {
            fail("Mutation intent prior record identity does not match its outer binding.");
        }
        if (baseRevisionId !== before.revisionId) fail("baseRevisionId does not match the before record.");
        if (after.parentRevisionId !== before.revisionId) fail("Mutation candidate must directly descend from before.");
    }

    return {
        recoveryFormatVersion: RECOVERY_FORMAT_VERSION,
        storeId: row.storeId,
        mutationId: row.mutationId,
        recordKind,
        recordId,
        baseRevisionId,
        baseDigest,
        before,
        candidateRevisionId: row.candidateRevisionId,
        candidateDigest: row.candidateDigest,
        after,
    };
}

export async function validateMutationIntent(
    value: unknown,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<MutationIntentV1> {
    const intent = validateMutationIntentObject(value, codecs, expectedStoreId);
    const candidateDigest = await canonicalRevisionDigest(intent.after);
    if (candidateDigest !== intent.candidateDigest) fail("candidateDigest does not match the after record.");
    if (intent.before) {
        const baseDigest = await canonicalRevisionDigest(intent.before);
        if (baseDigest !== intent.baseDigest) fail("baseDigest does not match the before record.");
    }
    return intent;
}

export async function encodeMutationIntent(
    value: MutationIntentV1,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<string> {
    const intent = await validateMutationIntent(value, codecs, expectedStoreId);
    return canonicalSerialize({
        ...intent,
        before: intent.before ? (JSON.parse(encodeCanonicalRevisionEnvelope(intent.before, codecs)) as unknown) : null,
        after: JSON.parse(encodeCanonicalRevisionEnvelope(intent.after, codecs)) as unknown,
    });
}

export async function decodeMutationIntent(
    raw: string,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<MutationIntentV1> {
    return validateMutationIntent(parseJson(raw), codecs, expectedStoreId);
}

export async function mutationIntentDigest(intent: MutationIntentV1): Promise<CanonicalDigest> {
    return canonicalDigest(intent);
}

function validateMutationOutcomeObject(value: unknown, expectedStoreId?: StoreId): MutationOutcomeV1 {
    canonicalSerialize(value);
    const row = asObject(value, "Mutation outcome");
    validateFields(
        row,
        [
            "recoveryFormatVersion",
            "storeId",
            "mutationId",
            "intentDigest",
            "recordKind",
            "recordId",
            "candidateRevisionId",
            "candidateDigest",
            "status",
        ],
        "Mutation outcome"
    );
    validateVersion(row.recoveryFormatVersion);
    if (!isStoreId(row.storeId)) fail("Mutation outcome has an invalid storeId.");
    if (expectedStoreId !== undefined && row.storeId !== expectedStoreId) {
        fail("Mutation outcome storeId does not match its containing logical store.");
    }
    if (!isMutationId(row.mutationId)) fail("Mutation outcome has an invalid mutationId.");
    if (!isCanonicalDigest(row.intentDigest)) fail("Mutation outcome has an invalid intentDigest.");
    const recordKind = validateRecordKind(row.recordKind);
    const recordId = validateRecordId(row.recordId);
    if (!isRevisionId(row.candidateRevisionId)) fail("Mutation outcome has an invalid candidateRevisionId.");
    if (!isCanonicalDigest(row.candidateDigest)) fail("Mutation outcome has an invalid candidateDigest.");
    if (row.status !== "VERIFIED_APPLIED" && row.status !== "PRECONDITION_REJECTED" && row.status !== "IO_FAILED") {
        fail("Mutation outcome has an unsupported status.");
    }
    return {
        recoveryFormatVersion: RECOVERY_FORMAT_VERSION,
        storeId: row.storeId,
        mutationId: row.mutationId,
        intentDigest: row.intentDigest,
        recordKind,
        recordId,
        candidateRevisionId: row.candidateRevisionId,
        candidateDigest: row.candidateDigest,
        status: row.status,
    };
}

export function encodeMutationOutcome(value: MutationOutcomeV1, expectedStoreId?: StoreId): string {
    return canonicalSerialize(validateMutationOutcomeObject(value, expectedStoreId));
}

export function decodeMutationOutcome(raw: string, expectedStoreId?: StoreId): MutationOutcomeV1 {
    return validateMutationOutcomeObject(parseJson(raw), expectedStoreId);
}

export async function validateOutcomeAgainstIntent(
    outcome: MutationOutcomeV1,
    intent: MutationIntentV1
): Promise<boolean> {
    return (
        outcome.storeId === intent.storeId &&
        outcome.mutationId === intent.mutationId &&
        outcome.intentDigest === (await mutationIntentDigest(intent)) &&
        outcome.recordKind === intent.recordKind &&
        outcome.recordId === intent.recordId &&
        outcome.candidateRevisionId === intent.candidateRevisionId &&
        outcome.candidateDigest === intent.candidateDigest
    );
}

export type RecoveryArtifactRecognition =
    | {
          readonly status: "VALID";
          readonly kind: "mutation-intent";
          readonly value: MutationIntentV1;
          readonly digest: CanonicalDigest;
      }
    | {
          readonly status: "VALID";
          readonly kind: "mutation-outcome";
          readonly value: MutationOutcomeV1;
          readonly digest: CanonicalDigest;
      }
    | {
          readonly status: "INVALID" | "UNSUPPORTED" | "UNRECOGNIZED";
          readonly reason: string;
          readonly bytes: Uint8Array;
      };

/** Content-only recognizer for bytes already found under S2's bounded recovery grammar. */
export async function recognizeRecoveryArtifactBytes(
    input: Uint8Array,
    codecs: readonly CanonicalRecordCodec[],
    expectedStoreId?: StoreId
): Promise<RecoveryArtifactRecognition> {
    const bytes = Uint8Array.from(input);
    let value: unknown;
    try {
        value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
        return { status: "INVALID", reason: "Recovery bytes are not valid UTF-8 JSON.", bytes };
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { status: "INVALID", reason: "Recovery artifact must be a JSON object.", bytes };
    }
    const row = value as Record<string, unknown>;
    const claimsIntent =
        (Object.prototype.hasOwnProperty.call(row, "before") as boolean) ||
        (Object.prototype.hasOwnProperty.call(row, "after") as boolean);
    const claimsOutcome = Object.prototype.hasOwnProperty.call(row, "status") as boolean;
    if (claimsIntent === claimsOutcome) {
        return {
            status: "UNRECOGNIZED",
            reason: "Recovery content does not uniquely claim an intent or outcome shape.",
            bytes,
        };
    }
    try {
        if (claimsIntent) {
            const intent = await validateMutationIntent(value, codecs, expectedStoreId);
            return {
                status: "VALID",
                kind: "mutation-intent",
                value: intent,
                digest: await mutationIntentDigest(intent),
            };
        }
        const outcome = validateMutationOutcomeObject(value, expectedStoreId);
        return { status: "VALID", kind: "mutation-outcome", value: outcome, digest: await canonicalDigest(outcome) };
    } catch (error) {
        const category = error instanceof RecoveryArtifactError ? error.category.toUpperCase() : "INVALID";
        return {
            status: category === "UNSUPPORTED" ? "UNSUPPORTED" : "INVALID",
            reason: error instanceof Error ? error.message : "Recovery artifact validation failed.",
            bytes,
        };
    }
}
