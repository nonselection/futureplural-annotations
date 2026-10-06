import {
    artifactDigest,
    canonicalDigest,
    CanonicalEncodingError,
    canonicalSerialize,
    type ArtifactDigest,
    type CanonicalDigest,
} from "./canonicalEncoding";
import {
    isBootstrapId,
    type BootstrapId,
    isMigrationId,
    isRepresentationStateId,
    isStoreId,
    type MigrationId,
    type RepresentationStateId,
    type StoreId,
} from "./identity";

import { STORAGE_ENVELOPE_VERSION } from "./envelopes";
import { REQUIRED_PROTOCOL_VERSION } from "./protocol";

export const NAMESPACE_MARKER_VERSION = 1 as const;
export const STORE_DECLARATION_VERSION = 2 as const;
export const PROTOCOL_FENCE_ARTIFACT_VERSION = 1 as const;
export const REPRESENTATION_STATE_ARTIFACT_VERSION = 1 as const;
const LEGACY_STORE_ARTIFACT_VERSION = 1 as const;

export interface NamespaceArtifactV1 {
    readonly schema: "finders-keepers.namespace";
    readonly version: typeof NAMESPACE_MARKER_VERSION;
}

/** @deprecated Historical protocol-1 codec shape; never v0.5 writable authority. Remove after S3 retrofit. */
export interface StoreArtifactV1 {
    readonly schema: "finders-keepers.store";
    readonly version: typeof LEGACY_STORE_ARTIFACT_VERSION;
    readonly storeId: StoreId;
}

/** Structurally validated plan; protocol support must be assessed separately. */
export interface StoreDeclarationV2 {
    readonly schema: "finders-keepers.store";
    readonly version: typeof STORE_DECLARATION_VERSION;
    readonly storeId: StoreId;
    readonly bootstrapId: BootstrapId;
    readonly initialRepresentation: "hidden" | "visible";
    readonly genesisRepresentationStateId: RepresentationStateId;
    readonly requiredProtocolVersion: number;
    readonly storageEnvelopeVersion: typeof STORAGE_ENVELOPE_VERSION;
    // Declared binding only. Recovery codec/version ownership belongs to Batch B.
    readonly recoveryFormatVersion: 2;
}

declare const supportedStoreDeclarationBrand: unique symbol;

/** Capability-2 support proof, produced only by explicit support assessment. Not a write gate. */
export type SupportedStoreDeclarationV2 = StoreDeclarationV2 & {
    readonly requiredProtocolVersion: typeof REQUIRED_PROTOCOL_VERSION;
    readonly [supportedStoreDeclarationBrand]: true;
};

export type StoreDeclarationSupportAssessment =
    | { readonly status: "SUPPORTED"; readonly declaration: SupportedStoreDeclarationV2 }
    | { readonly status: "UNSUPPORTED_REQUIRED_PROTOCOL"; readonly declaration: StoreDeclarationV2 };

export type StoreDeclarationComparison = "EQUIVALENT" | "DISTINCT_STORE" | "CONFLICTING_PLAN";

export interface ProtocolFenceArtifactV1 {
    readonly schema: "finders-keepers.protocol-fence";
    readonly version: typeof PROTOCOL_FENCE_ARTIFACT_VERSION;
    readonly storeId: StoreId;
    readonly requiredProtocolVersion: number;
}

export interface RepresentationStateArtifactV1 {
    readonly schema: "finders-keepers.representation-state";
    readonly version: typeof REPRESENTATION_STATE_ARTIFACT_VERSION;
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

const NAMESPACE: NamespaceArtifactV1 = Object.freeze({
    schema: "finders-keepers.namespace",
    version: NAMESPACE_MARKER_VERSION,
});

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

function readObject(raw: string, schema: string, version: number, fields: readonly string[]): Record<string, unknown> {
    const value = parseJson(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) fail("Authority artifact must be an object.");
    const row = value as Record<string, unknown>;
    const allowed = new Set(fields);
    for (const key of Object.keys(row)) if (!allowed.has(key)) fail(`Unknown authority artifact field ${key}.`);
    for (const field of fields) if (!Object.prototype.hasOwnProperty.call(row, field)) fail(`Missing ${field}.`);
    if (row.schema !== schema) return fail("Unsupported authority artifact schema.", "unsupported");
    if (row.version !== version) {
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
    readObject(raw, NAMESPACE.schema, NAMESPACE_MARKER_VERSION, ["schema", "version"]);
    return createNamespaceArtifact();
}

export function encodeNamespaceArtifact(artifact: NamespaceArtifactV1 = NAMESPACE): string {
    return encodeValidated(decodeNamespaceArtifact(encodeValidated(artifact)));
}

/** @deprecated Historical diagnostic compatibility only; not StoreDeclarationV2 support. */
export function decodeStoreArtifact(raw: string, expectedStoreId?: StoreId): StoreArtifactV1 {
    const schema = "finders-keepers.store";
    const row = readObject(raw, schema, LEGACY_STORE_ARTIFACT_VERSION, ["schema", "version", "storeId"]);
    return {
        schema,
        version: LEGACY_STORE_ARTIFACT_VERSION,
        storeId: requireStoreBinding(row.storeId, expectedStoreId),
    };
}

/** @deprecated Historical codec retained for unchanged S2/S3 callers; remove after their retrofit. */
export function encodeStoreArtifact(artifact: StoreArtifactV1): string {
    return encodeValidated(decodeStoreArtifact(encodeValidated(artifact)));
}

/** Validates and detaches content without granting protocol support or write authorization. */
export function validateStoreDeclaration(value: unknown, expectedStoreId?: StoreId): StoreDeclarationV2 {
    // Serialize before inspection: reject accessors, symbols and noncanonical values too.
    let raw: string;
    try {
        raw = canonicalSerialize(value);
    } catch (error) {
        if (error instanceof CanonicalEncodingError) fail(error.message);
        throw error;
    }
    const claimed = parseJson(raw);
    if (!claimed || typeof claimed !== "object" || Array.isArray(claimed)) {
        fail("Store declaration must be an object.");
    }
    const claim = claimed as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(claim, "schema")) fail("Missing schema.");
    if (claim.schema !== "finders-keepers.store") fail("Unsupported store declaration schema.", "unsupported");
    if (!Object.prototype.hasOwnProperty.call(claim, "version")) fail("Missing version.");
    if (!Number.isSafeInteger(claim.version) || (claim.version as number) < 1) {
        fail("Store declaration version must be a positive safe integer.");
    }
    // Recognize legacy/future formats before requiring this format's plan fields.
    if (claim.version !== STORE_DECLARATION_VERSION) fail("Unsupported store declaration version.", "unsupported");
    const row = readObject(raw, "finders-keepers.store", STORE_DECLARATION_VERSION, [
        "schema",
        "version",
        "storeId",
        "bootstrapId",
        "initialRepresentation",
        "genesisRepresentationStateId",
        "requiredProtocolVersion",
        "storageEnvelopeVersion",
        "recoveryFormatVersion",
    ]);
    const storeId = requireStoreBinding(row.storeId, expectedStoreId);
    if (!isBootstrapId(row.bootstrapId)) fail("Invalid bootstrapId.");
    if (row.initialRepresentation !== "hidden" && row.initialRepresentation !== "visible") {
        fail("initialRepresentation must be hidden or visible.");
    }
    if (!isRepresentationStateId(row.genesisRepresentationStateId)) fail("Invalid genesisRepresentationStateId.");
    if (!Number.isSafeInteger(row.requiredProtocolVersion) || (row.requiredProtocolVersion as number) < 1) {
        fail("requiredProtocolVersion must be a positive safe integer.");
    }
    if ((row.requiredProtocolVersion as number) < REQUIRED_PROTOCOL_VERSION) {
        fail("Legacy required protocol is incompatible with StoreDeclarationV2.", "unsupported");
    }
    for (const [field, expected] of [
        ["storageEnvelopeVersion", STORAGE_ENVELOPE_VERSION],
        ["recoveryFormatVersion", 2],
    ] as const) {
        if (!Number.isSafeInteger(row[field]) || (row[field] as number) < 1) fail(`Invalid ${field}.`);
        if (row[field] !== expected) fail(`Unsupported ${field}.`, "unsupported");
    }
    return Object.freeze({
        schema: "finders-keepers.store",
        version: STORE_DECLARATION_VERSION,
        storeId,
        bootstrapId: row.bootstrapId,
        initialRepresentation: row.initialRepresentation,
        genesisRepresentationStateId: row.genesisRepresentationStateId,
        requiredProtocolVersion: row.requiredProtocolVersion as number,
        storageEnvelopeVersion: STORAGE_ENVELOPE_VERSION,
        recoveryFormatVersion: 2,
    });
}

export function decodeStoreDeclaration(raw: string, expectedStoreId?: StoreId): StoreDeclarationV2 {
    return validateStoreDeclaration(parseJson(raw), expectedStoreId);
}

/** Copies exact valid content, including higher requirements; never downgrades it. */
export function encodeStoreDeclaration(declaration: StoreDeclarationV2): string {
    return canonicalSerialize(validateStoreDeclaration(declaration));
}

export function assessStoreDeclarationSupport(declaration: StoreDeclarationV2): StoreDeclarationSupportAssessment {
    const validated = validateStoreDeclaration(declaration);
    if (validated.requiredProtocolVersion !== REQUIRED_PROTOCOL_VERSION) {
        return { status: "UNSUPPORTED_REQUIRED_PROTOCOL", declaration: validated };
    }
    return { status: "SUPPORTED", declaration: validated as SupportedStoreDeclarationV2 };
}

export function storeDeclarationDigest(declaration: StoreDeclarationV2): Promise<ArtifactDigest> {
    return artifactDigest(validateStoreDeclaration(declaration));
}

export function compareStoreDeclarations(
    left: StoreDeclarationV2,
    right: StoreDeclarationV2
): StoreDeclarationComparison {
    const first = validateStoreDeclaration(left);
    const second = validateStoreDeclaration(right);
    if (first.storeId !== second.storeId) return "DISTINCT_STORE";
    return canonicalSerialize(first) === canonicalSerialize(second) ? "EQUIVALENT" : "CONFLICTING_PLAN";
}

export function storeDeclarationsEquivalent(left: StoreDeclarationV2, right: StoreDeclarationV2): boolean {
    return compareStoreDeclarations(left, right) === "EQUIVALENT";
}

export function decodeProtocolFenceArtifact(raw: string, expectedStoreId?: StoreId): ProtocolFenceArtifactV1 {
    const schema = "finders-keepers.protocol-fence";
    const row = readObject(raw, schema, PROTOCOL_FENCE_ARTIFACT_VERSION, [
        "schema",
        "version",
        "storeId",
        "requiredProtocolVersion",
    ]);
    if (!Number.isSafeInteger(row.requiredProtocolVersion) || (row.requiredProtocolVersion as number) < 1) {
        fail("requiredProtocolVersion must be a positive safe integer.");
    }
    return {
        schema,
        version: PROTOCOL_FENCE_ARTIFACT_VERSION,
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
    const row = readObject(raw, schema, REPRESENTATION_STATE_ARTIFACT_VERSION, [
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
        version: REPRESENTATION_STATE_ARTIFACT_VERSION,
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
