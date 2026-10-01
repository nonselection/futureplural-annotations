import { canonicalDigest, canonicalSerialize, type CanonicalDigest } from "./canonicalEncoding";
import { isRevisionId, isStoreId, type RevisionId, type StoreId } from "./identity";

export const STORAGE_ENVELOPE_VERSION = 1 as const;

export type CanonicalRecordState = "active" | "deleted";

export interface CanonicalRecordCodec<TPayload = unknown, TRecordId extends string = string> {
    readonly recordKind: string;
    readonly schemaVersion: number;
    isRecordId(value: unknown): value is TRecordId;
    validatePayload(value: unknown): TPayload;
}

export interface CanonicalRevisionEnvelope<TPayload = unknown, TRecordId extends string = string> {
    readonly storageEnvelopeVersion: typeof STORAGE_ENVELOPE_VERSION;
    readonly schemaVersion: number;
    readonly storeId: StoreId;
    readonly recordKind: string;
    readonly recordId: TRecordId;
    readonly revisionId: RevisionId;
    readonly parentRevisionId: RevisionId | null;
    readonly resolvedRevisionIds: readonly RevisionId[];
    readonly state: CanonicalRecordState;
    readonly payload: TPayload;
}

export class CanonicalEnvelopeError extends Error {
    readonly category: "invalid" | "unsupported";

    constructor(category: "invalid" | "unsupported", message: string) {
        super(message);
        this.name = "CanonicalEnvelopeError";
        this.category = category;
    }
}

function fail(message: string, category: "invalid" | "unsupported" = "invalid"): never {
    throw new CanonicalEnvelopeError(category, message);
}

function readJson(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return fail("Canonical envelope is malformed JSON.");
    }
}

function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return fail("Canonical envelope must be an object.");
    }
    return value as Record<string, unknown>;
}

function recordCodecFor<TPayload, TRecordId extends string>(
    codecs: readonly CanonicalRecordCodec<TPayload, TRecordId>[],
    kind: string
): CanonicalRecordCodec<TPayload, TRecordId> {
    const matches = codecs.filter((codec) => codec.recordKind === kind);
    if (matches.length !== 1) {
        return fail(
            matches.length ? `Duplicate record codec for ${kind}.` : `Unsupported record kind ${kind}.`,
            matches.length ? "invalid" : "unsupported"
        );
    }
    return matches[0];
}

function optionalRevisionId(value: unknown): RevisionId | null {
    if (value === null) return null;
    if (!isRevisionId(value)) fail("parentRevisionId must be a valid RevisionId or null.");
    return value;
}

function validateCodecRegistry(codecs: readonly CanonicalRecordCodec[]): void {
    const seen = new Set<string>();
    for (const codec of codecs) {
        if (
            !codec ||
            typeof codec.recordKind !== "string" ||
            !codec.recordKind.trim() ||
            codec.recordKind.includes("\0") ||
            codec.recordKind.length > 128
        ) {
            fail("Record codec has an invalid recordKind.");
        }
        if (seen.has(codec.recordKind)) fail(`Duplicate record codec for ${codec.recordKind}.`);
        seen.add(codec.recordKind);
        if (!Number.isSafeInteger(codec.schemaVersion) || codec.schemaVersion < 1) {
            fail(`Record codec ${codec.recordKind} has an invalid schemaVersion.`);
        }
        if (typeof codec.isRecordId !== "function" || typeof codec.validatePayload !== "function") {
            fail(`Record codec ${codec.recordKind} is incomplete.`);
        }
    }
}

function validateEnvelope<TPayload = unknown, TRecordId extends string = string>(
    value: unknown,
    codecs: readonly CanonicalRecordCodec<TPayload, TRecordId>[]
): CanonicalRevisionEnvelope<TPayload, TRecordId> {
    validateCodecRegistry(codecs);
    canonicalSerialize(value);
    const row = object(value);
    const allowed = new Set([
        "storageEnvelopeVersion",
        "schemaVersion",
        "storeId",
        "recordKind",
        "recordId",
        "revisionId",
        "parentRevisionId",
        "resolvedRevisionIds",
        "state",
        "payload",
    ]);
    for (const key of Object.keys(row)) if (!allowed.has(key)) fail(`Unknown canonical envelope field ${key}.`);
    for (const key of [
        "storageEnvelopeVersion",
        "schemaVersion",
        "storeId",
        "recordKind",
        "recordId",
        "revisionId",
        "parentRevisionId",
        "state",
        "payload",
    ]) {
        if (!Object.prototype.hasOwnProperty.call(row, key)) fail(`Missing canonical envelope field ${key}.`);
    }

    if (row.storageEnvelopeVersion !== STORAGE_ENVELOPE_VERSION) {
        return fail("Unsupported storage envelope version.", "unsupported");
    }
    const schemaVersion = row.schemaVersion;
    if (typeof schemaVersion !== "number" || !Number.isSafeInteger(schemaVersion) || schemaVersion < 1) {
        fail("Invalid schemaVersion.");
    }
    if (!isStoreId(row.storeId)) fail("Invalid storeId.");
    if (typeof row.recordKind !== "string" || !row.recordKind.trim() || row.recordKind.length > 128) {
        fail("Invalid recordKind.");
    }

    const codec = recordCodecFor(codecs, row.recordKind);
    if (row.schemaVersion !== codec.schemaVersion) {
        return fail(`Unsupported ${row.recordKind} schema version.`, "unsupported");
    }
    const recordId = row.recordId;
    if (!codec.isRecordId(recordId)) fail(`Invalid recordId for ${row.recordKind}.`);
    const revisionId = row.revisionId;
    if (!isRevisionId(revisionId)) fail("Invalid revisionId.");
    const parentRevisionId = optionalRevisionId(row.parentRevisionId);
    if (parentRevisionId === revisionId) fail("A revision cannot be its own parent.");

    const resolutions = row.resolvedRevisionIds === undefined ? [] : row.resolvedRevisionIds;
    if (!Array.isArray(resolutions)) fail("resolvedRevisionIds must be an array when present.");
    if (resolutions.length === 1) fail("Non-empty resolvedRevisionIds must contain at least two heads.");
    const typedResolutions: RevisionId[] = [];
    for (const resolutionId of resolutions) {
        if (!isRevisionId(resolutionId)) fail("resolvedRevisionIds contains an invalid RevisionId.");
        typedResolutions.push(resolutionId);
    }
    const sorted = [...typedResolutions].sort();
    if (new Set(typedResolutions).size !== typedResolutions.length) {
        fail("resolvedRevisionIds must be unique.");
    }
    if (typedResolutions.some((resolutionId, index) => resolutionId !== sorted[index])) {
        fail("resolvedRevisionIds must be sorted.");
    }

    if (row.state !== "active" && row.state !== "deleted") fail("Unknown canonical record state.");

    let payload: TPayload;
    try {
        payload = codec.validatePayload(row.payload);
    } catch (error) {
        if (error instanceof CanonicalEnvelopeError) throw error;
        fail(`Invalid payload for ${row.recordKind}: ${error instanceof Error ? error.message : "validation failed"}`);
    }

    const envelope: CanonicalRevisionEnvelope<TPayload, TRecordId> = {
        storageEnvelopeVersion: STORAGE_ENVELOPE_VERSION,
        schemaVersion,
        storeId: row.storeId,
        recordKind: row.recordKind,
        recordId,
        revisionId,
        parentRevisionId,
        resolvedRevisionIds: typedResolutions,
        state: row.state,
        payload,
    };

    // The payload validator owns its schema; canonical storage still requires portable JSON bytes.
    canonicalSerialize(envelope);
    return envelope;
}

export function decodeCanonicalRevisionEnvelope<TPayload = unknown, TRecordId extends string = string>(
    raw: string,
    codecs: readonly CanonicalRecordCodec<TPayload, TRecordId>[]
): CanonicalRevisionEnvelope<TPayload, TRecordId> {
    return validateEnvelope(readJson(raw), codecs);
}

export function encodeCanonicalRevisionEnvelope<TPayload = unknown, TRecordId extends string = string>(
    envelope: CanonicalRevisionEnvelope<TPayload, TRecordId>,
    codecs: readonly CanonicalRecordCodec<TPayload, TRecordId>[]
): string {
    return canonicalSerialize(validateEnvelope(envelope, codecs));
}

export function canonicalRevisionDigest(envelope: CanonicalRevisionEnvelope): Promise<CanonicalDigest> {
    return canonicalDigest(envelope);
}
