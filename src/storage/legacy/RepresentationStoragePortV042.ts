/** Historical v0.4.2 compatibility only; not the Canonical Storage v0.5 port. */
import type { CanonicalDigest } from "../canonicalEncoding";

/** @deprecated Historical v0.4.2 caller/fixture compatibility; remove facade export after S3 retrofit. */
export type RepresentationEntryKind = "file" | "directory";

/** @deprecated Historical v0.4.2 caller/fixture compatibility; remove facade export after S3 retrofit. */
export interface RepresentationEntry {
    /** One immediate child name, not an absolute or root-relative path. */
    readonly name: string;
    readonly kind: RepresentationEntryKind;
}

/** @deprecated Historical v0.4.2 caller/fixture compatibility; remove facade export after S3 retrofit. */
export type RepresentationStorageFailureCode =
    | "ALREADY_EXISTS"
    | "NOT_FOUND"
    | "DIGEST_MISMATCH"
    | "INVALID_LOCATOR"
    | "INVALID_LIMIT"
    | "UNSUPPORTED"
    | "UNAVAILABLE"
    | "IO_ERROR";

/** @deprecated Historical v0.4.2 caller/fixture compatibility; remove facade export after S3 retrofit. */
export interface RepresentationStorageFailure {
    readonly code: RepresentationStorageFailureCode;
    readonly message: string;
}

/** @deprecated Historical v0.4.2 caller/fixture compatibility; remove facade export after S3 retrofit. */
export type RepresentationStorageResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly failure: RepresentationStorageFailure };

/** @deprecated Historical v0.4.2 caller/fixture compatibility; remove facade export after S3 retrofit. */
export interface BoundedRepresentationListing {
    readonly entries: readonly RepresentationEntry[];
    /** True means additional children exist and the caller must not treat this listing as complete. */
    readonly truncated: boolean;
}

/** @deprecated Historical v0.4.2 caller/fixture compatibility; remove facade export after S3 retrofit. */
export interface RepresentationStoragePort {
    /** Identity of the port's root handle; it is not a storeId or a path-derived authority. */
    readonly rootIdentity: string;
    /** These are operation semantics, not observations of the host or transport. */
    readonly localGuarantees: {
        readonly immutableCreate: "refuses-existing";
        readonly guardedSnapshotWrite: "checks-current-content-digest";
        readonly guaranteeScope: "one-local-operation";
    };

    listChildren(directory: string, limit: number): Promise<RepresentationStorageResult<BoundedRepresentationListing>>;
    readBytes(locator: string): Promise<RepresentationStorageResult<Uint8Array>>;
    createImmutable(locator: string, bytes: Uint8Array): Promise<RepresentationStorageResult<void>>;
    writeSnapshot(
        locator: string,
        bytes: Uint8Array,
        expectedCurrentDigest: CanonicalDigest | null
    ): Promise<RepresentationStorageResult<void>>;
    rename(
        locator: string,
        newLocator: string,
        expectedCurrentDigest: CanonicalDigest
    ): Promise<RepresentationStorageResult<void>>;
    delete(locator: string, expectedCurrentDigest: CanonicalDigest): Promise<RepresentationStorageResult<void>>;
}

/** @deprecated Historical v0.4.2 caller/fixture compatibility; remove facade export after S3 retrofit. */
export function storageFailure<T>(
    code: RepresentationStorageFailureCode,
    message: string
): RepresentationStorageResult<T> {
    return { ok: false, failure: { code, message } };
}

/** @deprecated Historical v0.4.2 caller/fixture compatibility; remove facade export after S3 retrofit. */
export function storageSuccess<T>(value: T): RepresentationStorageResult<T> {
    return { ok: true, value };
}
