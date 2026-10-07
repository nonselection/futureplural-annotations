/** Batch-2 namespace/Store2 recognition; terminal family hints confer no semantic admission. */
import {
    AuthorityArtifactError,
    decodeNamespaceArtifact,
    decodeStoreDeclaration,
    assessStoreDeclarationSupport,
    storeDeclarationDigest,
    type NamespaceArtifactV1,
    type StoreDeclarationV2,
} from "./authorityArtifacts";
import type { ArtifactDigest } from "./canonicalEncoding";
import type { RawReadObservationV05 } from "./discoveryTraversalV05";
import type { DiscoveryTraversalWorkAxis } from "./discoveryBudget";

export type TerminalFamilyHintV05 = "canonical" | "recovery" | "fence" | "state" | "none";
export type DiscoveryRecognitionV05 =
    | {
          readonly family: "namespace";
          readonly status: "VALID";
          readonly value: NamespaceArtifactV1;
          readonly hint: "none";
      }
    | {
          readonly family: "store-declaration";
          readonly status: "VALID";
          readonly value: StoreDeclarationV2;
          readonly digest: ArtifactDigest;
          readonly supported: boolean;
          readonly hint: "none";
      }
    | {
          readonly family: "namespace" | "store-declaration" | "unknown";
          readonly status: "INVALID" | "UNSUPPORTED" | "UNRECOGNIZED" | "INCOMPLETE";
          readonly hint: TerminalFamilyHintV05;
      };

/** This finite precharge covers source decode and the fixed S1 validation/canonicalization/hash passes.
 * Units are conservative byte-work/admission, not measured JavaScript heap/native I/O capacity. */
export async function recognizeNamespaceOrStoreV05(
    raw: RawReadObservationV05,
    charge: (axis: DiscoveryTraversalWorkAxis, amount: number) => boolean
): Promise<DiscoveryRecognitionV05> {
    const incomplete = (): DiscoveryRecognitionV05 =>
        Object.freeze({ family: "unknown", status: "INCOMPLETE", hint: "none" });
    if (raw.status === "INCOMPLETE") return incomplete();
    if (!charge("decodedBytes", raw.byteLength * 2) || !charge("decodeHashByteWork", raw.byteLength * 64))
        return incomplete();
    let text: string;
    let row: Record<string, unknown>;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(raw.copyBytes());
        const parsed: unknown = JSON.parse(text);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            return Object.freeze({ family: "unknown", status: "UNRECOGNIZED", hint: "none" });
        row = parsed as Record<string, unknown>;
    } catch {
        return Object.freeze({ family: "unknown", status: "INVALID", hint: "none" });
    }
    const family =
        row.schema === "finders-keepers.namespace"
            ? "namespace"
            : row.schema === "finders-keepers.store"
              ? "store-declaration"
              : "unknown";
    try {
        if (family === "namespace")
            return Object.freeze({
                family,
                status: "VALID",
                value: Object.freeze(decodeNamespaceArtifact(text)),
                hint: "none",
            });
        if (family === "store-declaration") {
            const value = decodeStoreDeclaration(text);
            return Object.freeze({
                family,
                status: "VALID",
                value,
                digest: await storeDeclarationDigest(value),
                supported: assessStoreDeclarationSupport(value).status === "SUPPORTED",
                hint: "none",
            });
        }
    } catch (error) {
        return Object.freeze({
            family,
            status:
                error instanceof AuthorityArtifactError && error.category === "unsupported" ? "UNSUPPORTED" : "INVALID",
            hint: "none",
        });
    }
    // Shape/family hints select only an existing finite lookahead role. No IDs, payload,
    // claims, lineage, recovery binding, fence health or authority are decoded here.
    const hint: TerminalFamilyHintV05 = Object.prototype.hasOwnProperty.call(row, "storageEnvelopeVersion")
        ? "canonical"
        : Object.prototype.hasOwnProperty.call(row, "recoveryFormatVersion")
          ? "recovery"
          : row.schema === "finders-keepers.protocol-fence"
            ? "fence"
            : row.schema === "finders-keepers.representation-state"
              ? "state"
              : "none";
    return Object.freeze({
        family: "unknown",
        status:
            typeof row.schema === "string" && row.schema.startsWith("finders-keepers.") && hint === "none"
                ? "UNSUPPORTED"
                : "UNRECOGNIZED",
        hint,
    });
}

// Batch-3 content recognition is separate from Batch-2 lookahead and physical/store qualification.
import { canonicalSerialize, sha256Bytes, CanonicalEncodingError, type CanonicalDigest } from "./canonicalEncoding";
import {
    decodeCanonicalRevisionEnvelope,
    canonicalRevisionDigest,
    CanonicalEnvelopeError,
    type CanonicalRecordCodec,
    type CanonicalRevisionEnvelope,
} from "./envelopes";
import {
    recognizeRecoveryV2ArtifactBytes,
    type RecoveryPreparationV2,
    type RecoveryReceiptV2,
} from "./recoveryArtifacts";
import {
    decodeProtocolFenceArtifact,
    decodeRepresentationStateArtifact,
    representationStateArtifactDigest,
    type ProtocolFenceArtifactV1,
    type RepresentationStateArtifactV1,
} from "./authorityArtifacts";
import type { DiscoveryBudgetAxis } from "./discoveryBudget";

export type ArtifactContentV05 =
    | {
          readonly family: "canonical";
          readonly status: "VALID";
          readonly envelope: CanonicalRevisionEnvelope;
          readonly digest: CanonicalDigest;
      }
    | {
          readonly family: "recovery";
          readonly status: "VALID";
          readonly artifactKind: "preparation";
          readonly value: RecoveryPreparationV2;
          readonly digest: ArtifactDigest;
      }
    | {
          readonly family: "recovery";
          readonly status: "VALID";
          readonly artifactKind: "receipt";
          readonly value: RecoveryReceiptV2;
          readonly digest: ArtifactDigest;
      }
    | { readonly family: "fence"; readonly status: "VALID"; readonly value: ProtocolFenceArtifactV1 }
    | {
          readonly family: "state";
          readonly status: "VALID";
          readonly value: RepresentationStateArtifactV1;
          readonly digest: CanonicalDigest;
      }
    | { readonly family: "metadata"; readonly status: "METADATA"; readonly recognition: DiscoveryRecognitionV05 }
    | {
          readonly family: "canonical" | "recovery" | "fence" | "state" | "unknown";
          readonly status: "INVALID" | "UNSUPPORTED" | "UNRECOGNIZED" | "INCOMPLETE";
      };
export type EvidenceChargeV05 = (axis: DiscoveryBudgetAxis, amount: number) => boolean;
function freezeArtifactContent<T>(value: T): T {
    if (value && typeof value === "object") {
        for (const child of Object.values(value)) freezeArtifactContent(child);
        Object.freeze(value);
    }
    return value;
}
/** S1 validates domain content; this boundary privately detaches the mutable direct-codec return. */
function ownedCanonicalEnvelope(value: CanonicalRevisionEnvelope): CanonicalRevisionEnvelope {
    return freezeArtifactContent(JSON.parse(canonicalSerialize(value)) as CanonicalRevisionEnvelope);
}
function admittedDecodedContent(value: unknown, charge: EvidenceChargeV05): boolean {
    const size = new TextEncoder().encode(canonicalSerialize(value)).byteLength;
    return charge("decodedBytes", size * 2) && charge("decodeHashByteWork", size * 128);
}
function admittedPayload(value: CanonicalRevisionEnvelope, charge: EvidenceChargeV05): boolean {
    return charge("recordPayloadBytes", new TextEncoder().encode(canonicalSerialize(value.payload)).byteLength);
}
export async function recognizeArtifactContentV05(
    raw: RawReadObservationV05,
    lookahead: DiscoveryRecognitionV05,
    codecs: readonly CanonicalRecordCodec[],
    charge: EvidenceChargeV05
): Promise<ArtifactContentV05> {
    const failed = (
        family: "canonical" | "recovery" | "fence" | "state" | "unknown",
        status: "INVALID" | "UNSUPPORTED" | "UNRECOGNIZED" | "INCOMPLETE"
    ): ArtifactContentV05 => Object.freeze({ family, status });
    if (raw.status === "INCOMPLETE") return failed("unknown", "INCOMPLETE");
    if (lookahead.family !== "unknown")
        return Object.freeze({ family: "metadata", status: "METADATA", recognition: lookahead });
    if (!charge("decodedBytes", raw.byteLength * 2) || !charge("decodeHashByteWork", raw.byteLength * 128))
        return failed("unknown", "INCOMPLETE");
    const bytes = raw.copyBytes();
    let text: string, row: Record<string, unknown>;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const value: unknown = JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value)) return failed("unknown", "UNRECOGNIZED");
        row = value as Record<string, unknown>;
    } catch {
        return failed("unknown", "INVALID");
    }
    const family = Object.prototype.hasOwnProperty.call(row, "storageEnvelopeVersion")
        ? "canonical"
        : Object.prototype.hasOwnProperty.call(row, "recoveryFormatVersion") ||
            Object.prototype.hasOwnProperty.call(row, "artifactKind")
          ? "recovery"
          : row.schema === "finders-keepers.protocol-fence"
            ? "fence"
            : row.schema === "finders-keepers.representation-state"
              ? "state"
              : "unknown";
    try {
        if (family === "canonical") {
            const envelope = ownedCanonicalEnvelope(decodeCanonicalRevisionEnvelope(text, codecs));
            if (!admittedPayload(envelope, charge) || !admittedDecodedContent(envelope, charge))
                return failed(family, "INCOMPLETE");
            return Object.freeze({
                family,
                status: "VALID",
                envelope,
                digest: await canonicalRevisionDigest(envelope),
            });
        }
        if (family === "recovery") {
            const recognized = await recognizeRecoveryV2ArtifactBytes(bytes, codecs);
            if (recognized.status !== "VALID") return failed(family, recognized.status);
            if (
                !admittedDecodedContent(recognized.value, charge) ||
                (recognized.kind === "preparation" && !admittedPayload(recognized.value.after, charge))
            )
                return failed(family, "INCOMPLETE");
            return recognized.kind === "preparation"
                ? Object.freeze({
                      family,
                      status: "VALID",
                      artifactKind: "preparation",
                      value: recognized.value,
                      digest: recognized.digest,
                  })
                : Object.freeze({
                      family,
                      status: "VALID",
                      artifactKind: "receipt",
                      value: recognized.value,
                      digest: recognized.digest,
                  });
        }
        if (family === "fence") {
            const value = Object.freeze(decodeProtocolFenceArtifact(text));
            if (!admittedDecodedContent(value, charge)) return failed(family, "INCOMPLETE");
            return Object.freeze({ family, status: "VALID", value });
        }
        if (family === "state") {
            const value = Object.freeze(decodeRepresentationStateArtifact(text));
            if (!admittedDecodedContent(value, charge)) return failed(family, "INCOMPLETE");
            return Object.freeze({
                family,
                status: "VALID",
                value,
                digest: await representationStateArtifactDigest(value),
            });
        }
        return failed("unknown", "UNRECOGNIZED");
    } catch (error) {
        if (error instanceof CanonicalEnvelopeError || error instanceof AuthorityArtifactError)
            return failed(family, error.category === "unsupported" ? "UNSUPPORTED" : "INVALID");
        if (error instanceof CanonicalEncodingError) return failed(family, "INVALID");
        return failed(family, "INCOMPLETE");
    }
}
export async function fingerprintOpaqueArtifactV05(
    raw: RawReadObservationV05,
    charge: EvidenceChargeV05
): Promise<CanonicalDigest | undefined> {
    if (raw.status === "INCOMPLETE" || !charge("decodeHashByteWork", raw.byteLength * 2)) return undefined;
    return sha256Bytes(raw.copyBytes());
}
