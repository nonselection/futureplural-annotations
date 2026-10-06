/** Portable v0.5 contracts only. Host implementations/qualification and orchestration are later owners. */
import { isPhysicalEffect, type PhysicalEffect } from "./publicationEffects";

export { isSafeRepresentationLocator } from "./representationLocators";

// Historical facade only; remove after S2/S3 retrofit integration. No adapter emulates old promises.
export {
    storageFailure,
    storageSuccess,
    type RepresentationEntryKind,
    type RepresentationEntry,
    type RepresentationStorageFailureCode,
    type RepresentationStorageFailure,
    type RepresentationStorageResult,
    type BoundedRepresentationListing,
    type RepresentationStoragePort,
} from "./legacy/RepresentationStoragePortV042";

import type { PublicationId } from "./identity";

declare const contextBrand: unique symbol;
declare const rootBrand: unique symbol;
declare const directoryBrand: unique symbol;
declare const fileBrand: unique symbol;
declare const collectionBrand: unique symbol;
declare const tokenBrand: unique symbol;
declare const allocationBrand: unique symbol;
declare const invocationBrand: unique symbol;

/** Ephemeral issuer identity, not a path, StoreId, lock or provider transaction. */
export interface RepresentationContextIdentity {
    readonly [contextBrand]: true;
    readonly kind: "representation-context";
}
export interface RepresentationRootHandle {
    readonly [rootBrand]: true;
    readonly kind: "representation-root";
    readonly context: RepresentationContextIdentity;
    /** Diagnostic only. Equal strings do not exchange capabilities. */
    readonly rootIdentity: string;
}
export interface RepresentationDirectoryHandle {
    readonly [directoryBrand]: true;
    readonly kind: "directory";
    readonly context: RepresentationContextIdentity;
    readonly root: RepresentationRootHandle;
    readonly locator: string;
}
export interface RepresentationFileHandle {
    readonly [fileBrand]: true;
    readonly kind: "file";
    readonly context: RepresentationContextIdentity;
    readonly root: RepresentationRootHandle;
    readonly locator: string;
}

export type RepresentationReadFailureCode =
    | "NOT_FOUND"
    | "UNAVAILABLE"
    | "UNSUPPORTED"
    | "INVALID_INPUT"
    | "INVALID_LOCATOR"
    | "INVALID_LIMIT"
    | "CONFINEMENT";
export type RepresentationReadResult<T> =
    | { readonly ok: true; readonly value: T }
    | {
          readonly ok: false;
          readonly failure: { readonly code: RepresentationReadFailureCode; readonly message: string };
      };
export type RepresentationHandleEntry =
    | { readonly name: string; readonly kind: "directory"; readonly handle: RepresentationDirectoryHandle }
    | { readonly name: string; readonly kind: "file"; readonly handle: RepresentationFileHandle };
export interface BoundedRepresentationHandleListing {
    readonly entries: readonly RepresentationHandleEntry[];
    /** Bounds returned immediate children only, not native allocation, traversal, completeness or B0 capacity. */
    readonly truncated: boolean;
}
export interface RepresentationReadPort {
    readonly context: RepresentationContextIdentity;
    readonly rootIdentity: string;
    /** Creation is confined to this view's default root; does not assert existence. */
    directoryHandle(locator: string): RepresentationReadResult<RepresentationDirectoryHandle>;
    fileHandle(locator: string): RepresentationReadResult<RepresentationFileHandle>;
    /** Accepts issued handles across this context's registered read roots, irrespective of selected write root. */
    listChildren(
        handle: RepresentationDirectoryHandle,
        limit: number
    ): Promise<RepresentationReadResult<BoundedRepresentationHandleListing>>;
    /** Complete defensive binary bytes only. Partial/clipped data must be unavailable, not success. */
    readBytes(handle: RepresentationFileHandle): Promise<RepresentationReadResult<Uint8Array>>;
}

export type PublicationArtifactRole =
    | "namespace"
    | "store-declaration"
    | "canonical-revision"
    | "recovery-preparation"
    | "recovery-receipt"
    | "protocol-fence"
    | "representation-state";
export interface PublicationCollectionHandle {
    readonly [collectionBrand]: true;
    readonly context: RepresentationContextIdentity;
    readonly root: RepresentationRootHandle;
    readonly directory: RepresentationDirectoryHandle;
    readonly role: PublicationArtifactRole;
}
export interface PublicationToken {
    readonly [tokenBrand]: true;
    readonly kind: "publication-token";
}
export interface PublicationBinding {
    readonly publicationId: PublicationId;
    readonly context: RepresentationContextIdentity;
    readonly root: RepresentationRootHandle;
    readonly collection: PublicationCollectionHandle;
    readonly role: PublicationArtifactRole;
    readonly locator: string;
}
/** Issued object identity + token are capabilities; persisted/copied fields do not reconstruct them. */
export interface PublicationAllocation extends PublicationBinding {
    readonly [allocationBrand]: true;
    readonly token: PublicationToken;
}
export type PublicationAllocationResult =
    | { readonly status: "ALLOCATED"; readonly allocation: PublicationAllocation }
    | {
          readonly status: "REFUSED";
          readonly reason: "INVALID_COLLECTION" | "SECURE_RANDOM_UNAVAILABLE" | "PUBLICATION_ID_COLLISION";
          readonly message: string;
      };
export type ControlledPublicationRefusalReason =
    | "INVALID_ALLOCATION"
    | "CONFINEMENT"
    | "OBSERVED_OCCUPANCY"
    | "PREFLIGHT_UNAVAILABLE"
    | "RETIRED_ALLOCATION";
export type PublicationEffectResult =
    | {
          readonly physicalEffect: Extract<PhysicalEffect, "NO_MUTATION_DISPATCHED">;
          readonly reason: ControlledPublicationRefusalReason;
          readonly binding?: PublicationBinding;
      }
    | {
          readonly physicalEffect: Extract<PhysicalEffect, "DISPATCH_REPORTED_SUCCESS">;
          readonly binding: PublicationBinding;
      }
    | {
          readonly physicalEffect: Extract<PhysicalEffect, "DISPATCH_OUTCOME_UNKNOWN">;
          readonly binding: PublicationBinding;
          readonly diagnostic?: string;
      };
export interface PublicationInvocation {
    readonly [invocationBrand]: true;
    readonly binding: PublicationBinding;
}
export type PublicationInvocationResult =
    | { readonly status: "CONSUMED"; readonly invocation: PublicationInvocation }
    | {
          readonly status: "REFUSED";
          readonly effect: Extract<PublicationEffectResult, { physicalEffect: "NO_MUTATION_DISPATCHED" }>;
      };
export type PublicationCompletion =
    | {
          readonly physicalEffect: Extract<PhysicalEffect, "NO_MUTATION_DISPATCHED">;
          readonly reason: ControlledPublicationRefusalReason;
      }
    | { readonly physicalEffect: Extract<PhysicalEffect, "DISPATCH_REPORTED_SUCCESS"> }
    | { readonly physicalEffect: Extract<PhysicalEffect, "DISPATCH_OUTCOME_UNKNOWN">; readonly diagnostic?: string };
export type PublicationAllocationState = "ALLOCATED" | "INVOKED" | "RETIRED";

export interface RepresentationPublicationPort {
    readonly context: RepresentationContextIdentity;
    readonly publicationRoot: RepresentationRootHandle;
    /** Binds an externally authorized collection, never store selection/write authorization/existence/lock. */
    bindPublicationCollection(
        directory: RepresentationDirectoryHandle,
        role: PublicationArtifactRole
    ): RepresentationReadResult<PublicationCollectionHandle>;
    /** Fresh secure ID and generated leaf; no caller destination. Allocation is not reservation or exclusive create. */
    allocatePublication(collection: PublicationCollectionHandle): Promise<PublicationAllocationResult>;
    /**
     * Consume synchronously at invocation entry, before any await; always retire after the attempt.
     * Copy caller bytes synchronously before any await; later caller mutation cannot change dispatched content.
     * Check correlation, scope, observed target/ancestor occupancy and preflight availability before dispatch.
     * Preflight is not a lease: an external arrival can be overwritten by a later replacing write.
     * Even exact later readback cannot establish that an unseen arrival was never displaced.
     * Report dispatch effect only, not CanonicalObservation/authority/health/durability or a receipt.
     */
    publishFresh(allocation: PublicationAllocation, bytes: Uint8Array): Promise<PublicationEffectResult>;
    /** Local abandonment only: no unlink, reservation release, host cancellation/quiescence or target retry. */
    retirePublication(allocation: PublicationAllocation): void;
}
export type CanonicalRepresentationStoragePort = RepresentationReadPort & RepresentationPublicationPort;

export function isPositiveRepresentationListLimit(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
export function isPublicationArtifactRole(value: unknown): value is PublicationArtifactRole {
    return (
        value === "namespace" ||
        value === "store-declaration" ||
        value === "canonical-revision" ||
        value === "recovery-preparation" ||
        value === "recovery-receipt" ||
        value === "protocol-fence" ||
        value === "representation-state"
    );
}
export function isControlledPublicationRefusalReason(value: unknown): value is ControlledPublicationRefusalReason {
    return (
        value === "INVALID_ALLOCATION" ||
        value === "CONFINEMENT" ||
        value === "OBSERVED_OCCUPANCY" ||
        value === "PREFLIGHT_UNAVAILABLE" ||
        value === "RETIRED_ALLOCATION"
    );
}
export function representationReadFailure<T>(
    code: RepresentationReadFailureCode,
    message: string
): RepresentationReadResult<T> {
    if (
        ![
            "NOT_FOUND",
            "UNAVAILABLE",
            "UNSUPPORTED",
            "INVALID_INPUT",
            "INVALID_LOCATOR",
            "INVALID_LIMIT",
            "CONFINEMENT",
        ].includes(code)
    )
        throw new Error("Invalid normative read failure code.");
    return { ok: false, failure: { code, message } };
}
export function representationReadSuccess<T>(value: T): RepresentationReadResult<T> {
    return { ok: true, value };
}
/** Pure result construction, trusting the host caller's completeness fact; performs no read. */
export function representationByteReadResult(
    bytes: Uint8Array,
    complete: boolean
): RepresentationReadResult<Uint8Array> {
    if (!(bytes instanceof Uint8Array) || typeof complete !== "boolean")
        return representationReadFailure("INVALID_INPUT", "Expected binary bytes and an explicit completeness fact.");
    if (!complete) return representationReadFailure("UNAVAILABLE", "Partial/clipped bytes are not a complete read.");
    return representationReadSuccess(Uint8Array.from(bytes));
}
/** Strict completion facts only; receipt/observation/health fields are never accepted here. */
export function validatePublicationCompletion(value: unknown): PublicationCompletion {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid publication completion.");
    const row = value as Record<string, unknown>;
    const effect = Object.getOwnPropertyDescriptor(row, "physicalEffect");
    if (!effect || !("value" in effect) || !isPhysicalEffect(effect.value)) throw new Error("Invalid physicalEffect.");
    const physicalEffect: PhysicalEffect = effect.value;
    const allowed =
        physicalEffect === "NO_MUTATION_DISPATCHED"
            ? ["physicalEffect", "reason"]
            : physicalEffect === "DISPATCH_OUTCOME_UNKNOWN"
              ? ["physicalEffect", "diagnostic"]
              : ["physicalEffect"];
    for (const key of Reflect.ownKeys(row)) {
        if (typeof key !== "string" || !allowed.includes(key)) throw new Error("Invalid publication completion field.");
        const property = Object.getOwnPropertyDescriptor(row, key);
        if (!property || !("value" in property) || !property.enumerable)
            throw new Error("Invalid publication completion property.");
    }
    if (physicalEffect === "NO_MUTATION_DISPATCHED") {
        const reason = Object.getOwnPropertyDescriptor(row, "reason");
        if (!reason || !("value" in reason) || !isControlledPublicationRefusalReason(reason.value))
            throw new Error("Nondispatch requires an own controlled reason.");
        return { physicalEffect, reason: reason.value };
    }
    if (physicalEffect === "DISPATCH_OUTCOME_UNKNOWN") {
        const diagnostic = Object.getOwnPropertyDescriptor(row, "diagnostic");
        if (diagnostic && !("value" in diagnostic)) throw new Error("Invalid dispatch diagnostic.");
        const message: unknown = diagnostic?.value;
        if (message !== undefined && typeof message !== "string") throw new Error("Invalid dispatch diagnostic.");
        if (typeof message === "string") return { physicalEffect, diagnostic: message };
        return { physicalEffect };
    }
    return { physicalEffect };
}
