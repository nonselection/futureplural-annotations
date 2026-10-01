import { sha256Bytes, type CanonicalDigest } from "./canonicalEncoding";
import {
    AuthorityArtifactError,
    decodeNamespaceArtifact,
    decodeProtocolFenceArtifact,
    decodeRepresentationStateArtifact,
    decodeStoreArtifact,
    type NamespaceArtifactV1,
    type ProtocolFenceArtifactV1,
    type RepresentationStateArtifactV1,
    type StoreArtifactV1,
} from "./authorityArtifacts";
import {
    canonicalRevisionDigest,
    decodeCanonicalRevisionEnvelope,
    CanonicalEnvelopeError,
    type CanonicalRecordCodec,
    type CanonicalRevisionEnvelope,
} from "./envelopes";
import type { RepresentationStorageFailure } from "./RepresentationStoragePort";
import type { DiscoveryReadStatus } from "./discovery";
import type { StoreId } from "./identity";

export type DiscoveryArtifactContext =
    | "namespace-probe"
    | "store-subtree"
    | "record-envelope"
    | "protocol-namespace"
    | "representation-state-namespace"
    | "opaque-recovery"
    | "opaque-migration"
    | "unknown-structural";

export interface DiscoveryRawFile {
    readonly locator: string;
    readonly context: DiscoveryArtifactContext;
    readonly readStatus: DiscoveryReadStatus;
    readonly bytes?: Uint8Array;
    readonly failure?: RepresentationStorageFailure;
}

export type RecognizedArtifactKind =
    | "namespace"
    | "store"
    | "revision"
    | "protocol-fence"
    | "representation-state"
    | "opaque-recovery"
    | "opaque-migration";

export type DiscoveryArtifactRecognition =
    | {
          readonly status: "VALID";
          readonly kind: RecognizedArtifactKind;
          readonly value:
              | NamespaceArtifactV1
              | StoreArtifactV1
              | CanonicalRevisionEnvelope
              | ProtocolFenceArtifactV1
              | RepresentationStateArtifactV1;
          readonly digest?: CanonicalDigest;
          readonly rawBytes: Uint8Array;
      }
    | {
          readonly status: "OPAQUE";
          readonly kind: "opaque-recovery" | "opaque-migration";
          readonly rawBytes: Uint8Array;
          readonly exactByteFingerprint: string;
      }
    | {
          readonly status: "INVALID" | "UNSUPPORTED" | "UNKNOWN" | "UNRECOGNIZED" | "MISSING" | "UNAVAILABLE";
          readonly context: DiscoveryArtifactContext;
          readonly locator: string;
          readonly reason?: string;
          readonly failure?: RepresentationStorageFailure;
          readonly rawBytes?: Uint8Array;
      };

export interface DiscoveryArtifactOptions {
    readonly recordCodecs?: readonly CanonicalRecordCodec[];
    readonly expectedStoreId?: StoreId;
}

function decodeUtf8(bytes: Uint8Array): string {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function objectClaim(raw: string): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(raw);
        if (!value || typeof value !== "object" || Array.isArray(value)) return null;
        return value as Record<string, unknown>;
    } catch {
        return null;
    }
}

function claimsSchema(raw: string, schema: string): boolean {
    return objectClaim(raw)?.schema === schema;
}

function claimedInvalid(
    file: DiscoveryRawFile,
    bytes: Uint8Array,
    raw: string,
    error: unknown,
    expectedSchema?: string
): DiscoveryArtifactRecognition {
    const claimed = expectedSchema !== undefined && claimsSchema(raw, expectedSchema);
    const basename = file.locator.split("/").at(-1);
    const ratifiedLocator =
        (file.context === "namespace-probe" && basename === "namespace.json") ||
        (file.context === "store-subtree" && basename === "store.json");
    if (file.context === "representation-state-namespace") {
        return {
            status: "UNKNOWN",
            context: file.context,
            locator: file.locator,
            rawBytes: bytes,
            reason: error instanceof Error ? error.message : "Unknown representation-state evidence.",
        };
    }
    if (file.context !== "record-envelope" && !claimed && !ratifiedLocator) {
        return {
            status: "UNRECOGNIZED",
            context: file.context,
            locator: file.locator,
            rawBytes: bytes,
            reason: error instanceof Error ? error.message : "Content did not validate as an FK artifact.",
        };
    }
    const category =
        error instanceof AuthorityArtifactError || error instanceof CanonicalEnvelopeError
            ? error.category.toUpperCase()
            : "INVALID";
    return {
        status: category === "UNSUPPORTED" ? "UNSUPPORTED" : "INVALID",
        context: file.context,
        locator: file.locator,
        rawBytes: bytes,
        reason: error instanceof Error ? error.message : "Artifact validation failed.",
    };
}

function unavailable(file: DiscoveryRawFile): DiscoveryArtifactRecognition {
    if (file.readStatus === "NOT_FOUND") {
        return { status: "MISSING", context: file.context, locator: file.locator, failure: file.failure };
    }
    return { status: "UNAVAILABLE", context: file.context, locator: file.locator, failure: file.failure };
}

/** Decode known S1 artifacts only in their bounded structural context. */
export async function recognizeDiscoveryArtifact(
    file: DiscoveryRawFile,
    options: DiscoveryArtifactOptions = {}
): Promise<DiscoveryArtifactRecognition> {
    if (file.readStatus !== "READ" || !file.bytes) return unavailable(file);
    const rawBytes = Uint8Array.from(file.bytes);
    if (file.context === "unknown-structural") {
        return {
            status: "UNRECOGNIZED",
            context: file.context,
            locator: file.locator,
            rawBytes,
            reason: "Raw bytes were observed during a bounded structural candidate probe; no codec validated their role.",
        };
    }
    if (file.context === "opaque-recovery" || file.context === "opaque-migration") {
        // Deliberately do not parse self-declared identity, phase, or lifecycle fields.
        const fingerprint = await sha256Bytes(rawBytes);
        return { status: "OPAQUE", kind: file.context, rawBytes, exactByteFingerprint: fingerprint };
    }

    let raw: string;
    try {
        raw = decodeUtf8(rawBytes);
    } catch (error) {
        return {
            status: file.context === "protocol-namespace" ? "UNKNOWN" : "INVALID",
            context: file.context,
            locator: file.locator,
            rawBytes,
            reason: error instanceof Error ? error.message : "File is not valid UTF-8.",
        };
    }

    try {
        switch (file.context) {
            case "namespace-probe": {
                const value = decodeNamespaceArtifact(raw);
                return { status: "VALID", kind: "namespace", value, rawBytes };
            }
            case "store-subtree": {
                const value = decodeStoreArtifact(raw, options.expectedStoreId);
                return { status: "VALID", kind: "store", value, rawBytes };
            }
            case "record-envelope": {
                const codecs = options.recordCodecs ?? [];
                const value = decodeCanonicalRevisionEnvelope(raw, codecs);
                const digest = await canonicalRevisionDigest(value);
                return { status: "VALID", kind: "revision", value, digest, rawBytes };
            }
            case "protocol-namespace": {
                const value = decodeProtocolFenceArtifact(raw, options.expectedStoreId);
                return { status: "VALID", kind: "protocol-fence", value, rawBytes };
            }
            case "representation-state-namespace": {
                const value = decodeRepresentationStateArtifact(raw, options.expectedStoreId);
                return { status: "VALID", kind: "representation-state", value, rawBytes };
            }
        }
    } catch (error) {
        const schemaByContext: Partial<Record<DiscoveryArtifactContext, string>> = {
            "namespace-probe": "finders-keepers.namespace",
            "store-subtree": "finders-keepers.store",
            "protocol-namespace": "finders-keepers.protocol-fence",
            "representation-state-namespace": "finders-keepers.representation-state",
        };
        if (file.context === "protocol-namespace" && !claimsSchema(raw, "finders-keepers.protocol-fence")) {
            return {
                status: "UNKNOWN",
                context: file.context,
                locator: file.locator,
                rawBytes,
                reason: error instanceof Error ? error.message : "Unknown protocol-namespace evidence.",
            };
        }
        return claimedInvalid(file, rawBytes, raw, error, schemaByContext[file.context]);
    }
}
