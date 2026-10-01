import { canonicalDigest, canonicalSerialize, type CanonicalDigest } from "./canonicalEncoding";
import {
    isMigrationId,
    isRepresentationStateId,
    isStoreId,
    type MigrationId,
    type RepresentationStateId,
    type StoreId,
} from "./identity";

export const AUTHORITY_ARTIFACT_VERSION = 1 as const;

export interface NamespaceArtifactV1 {
    readonly schema: "finders-keepers.namespace";
    readonly version: typeof AUTHORITY_ARTIFACT_VERSION;
}

export interface StoreArtifactV1 {
    readonly schema: "finders-keepers.store";
    readonly version: typeof AUTHORITY_ARTIFACT_VERSION;
    readonly storeId: StoreId;
}

export interface ProtocolFenceArtifactV1 {
    readonly schema: "finders-keepers.protocol-fence";
    readonly version: typeof AUTHORITY_ARTIFACT_VERSION;
    readonly storeId: StoreId;
    readonly requiredProtocolVersion: number;
}

export interface RepresentationStateArtifactV1 {
    readonly schema: "finders-keepers.representation-state";
    readonly version: typeof AUTHORITY_ARTIFACT_VERSION;
    readonly storeId: StoreId;
    readonly representationStateId: RepresentationStateId;
    readonly parentRepresentationStateId: RepresentationStateId | null;
    readonly representation: "hidden" | "visible";
    readonly establishedByMigrationId: MigrationId | null;
}

export class AuthorityArtifactError extends Error {
    readonly category: "invalid" | "unsupported";

    constructor(category: "invalid" | "unsupported", message: string) {
        super(message);
        this.name = "AuthorityArtifactError";
        this.category = category;
    }
}

const NAMESPACE: NamespaceArtifactV1 = Object.freeze({ schema: "finders-keepers.namespace", version: 1 });

function fail(message: string, category: "invalid" | "unsupported" = "invalid"): never {
    throw new AuthorityArtifactError(category, message);
}

function parseJson(raw: string): unknown {
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return fail("Authority artifact is malformed JSON.");
    }
}

function readObject(raw: string, schema: string, fields: readonly string[]): Record<string, unknown> {
    const value = parseJson(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Authority artifact must be an object.");
    const row = value as Record<string, unknown>;
    const allowed = new Set(fields);
    for (const key of Object.keys(row)) if (!allowed.has(key)) fail(`Unknown authority artifact field ${key}.`);
    for (const field of fields) if (!Object.prototype.hasOwnProperty.call(row, field)) fail(`Missing ${field}.`);
    if (row.schema !== schema) return fail("Unsupported authority artifact schema.", "unsupported");
    if (row.version !== AUTHORITY_ARTIFACT_VERSION) {
        return fail(`Unsupported ${schema} version.`, "unsupported");
    }
    return row;
}

function requireStoreBinding(value: unknown, expectedStoreId?: StoreId): StoreId {
    if (!isStoreId(value)) fail("Invalid storeId binding.");
    if (expectedStoreId !== undefined && value !== expectedStoreId) {
        fail(`Artifact storeId ${value} does not match expected storeId ${expectedStoreId}.`);
    }
    return value;
}

function optionalRepresentationStateId(value: unknown): RepresentationStateId | null {
    if (value === null) return null;
    if (!isRepresentationStateId(value)) fail("Invalid parentRepresentationStateId.");
    return value;
}

function optionalMigrationId(value: unknown): MigrationId | null {
    if (value === null) return null;
    if (!isMigrationId(value)) fail("Invalid establishedByMigrationId.");
    return value;
}

function encodeValidated<T>(artifact: T): string {
    return canonicalSerialize(artifact);
}

export function createNamespaceArtifact(): NamespaceArtifactV1 {
    return { ...NAMESPACE };
}

export function decodeNamespaceArtifact(raw: string): NamespaceArtifactV1 {
    readObject(raw, NAMESPACE.schema, ["schema", "version"]);
    return createNamespaceArtifact();
}

export function encodeNamespaceArtifact(artifact: NamespaceArtifactV1 = NAMESPACE): string {
    return encodeValidated(decodeNamespaceArtifact(encodeValidated(artifact)));
}

export function decodeStoreArtifact(raw: string, expectedStoreId?: StoreId): StoreArtifactV1 {
    const schema = "finders-keepers.store";
    const row = readObject(raw, schema, ["schema", "version", "storeId"]);
    return {
        schema,
        version: AUTHORITY_ARTIFACT_VERSION,
        storeId: requireStoreBinding(row.storeId, expectedStoreId),
    };
}

export function encodeStoreArtifact(artifact: StoreArtifactV1): string {
    return encodeValidated(decodeStoreArtifact(encodeValidated(artifact)));
}

export function decodeProtocolFenceArtifact(raw: string, expectedStoreId?: StoreId): ProtocolFenceArtifactV1 {
    const schema = "finders-keepers.protocol-fence";
    const row = readObject(raw, schema, ["schema", "version", "storeId", "requiredProtocolVersion"]);
    if (!Number.isSafeInteger(row.requiredProtocolVersion) || (row.requiredProtocolVersion as number) < 1) {
        fail("requiredProtocolVersion must be a positive safe integer.");
    }
    return {
        schema,
        version: AUTHORITY_ARTIFACT_VERSION,
        storeId: requireStoreBinding(row.storeId, expectedStoreId),
        requiredProtocolVersion: row.requiredProtocolVersion as number,
    };
}

export function encodeProtocolFenceArtifact(artifact: ProtocolFenceArtifactV1): string {
    return encodeValidated(decodeProtocolFenceArtifact(encodeValidated(artifact)));
}

export function decodeRepresentationStateArtifact(
    raw: string,
    expectedStoreId?: StoreId
): RepresentationStateArtifactV1 {
    const schema = "finders-keepers.representation-state";
    const row = readObject(raw, schema, [
        "schema",
        "version",
        "storeId",
        "representationStateId",
        "parentRepresentationStateId",
        "representation",
        "establishedByMigrationId",
    ]);
    const representationStateId = row.representationStateId;
    if (!isRepresentationStateId(representationStateId)) fail("Invalid representationStateId.");
    const parentRepresentationStateId = optionalRepresentationStateId(row.parentRepresentationStateId);
    if (row.representation !== "hidden" && row.representation !== "visible") {
        fail("representation must be hidden or visible.");
    }
    const establishedByMigrationId = optionalMigrationId(row.establishedByMigrationId);
    return {
        schema,
        version: AUTHORITY_ARTIFACT_VERSION,
        storeId: requireStoreBinding(row.storeId, expectedStoreId),
        representationStateId,
        parentRepresentationStateId,
        representation: row.representation,
        establishedByMigrationId,
    };
}

export function encodeRepresentationStateArtifact(artifact: RepresentationStateArtifactV1): string {
    return encodeValidated(decodeRepresentationStateArtifact(encodeValidated(artifact)));
}

export async function representationStateArtifactDigest(
    artifact: RepresentationStateArtifactV1
): Promise<CanonicalDigest> {
    const validated = decodeRepresentationStateArtifact(encodeRepresentationStateArtifact(artifact));
    return canonicalDigest(validated);
}
