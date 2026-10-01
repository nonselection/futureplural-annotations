import type { CanonicalDigest } from "./canonicalEncoding";

export type RepresentationEntryKind = "file" | "directory";

export interface RepresentationEntry {
    /** One immediate child name, not an absolute or root-relative path. */
    readonly name: string;
    readonly kind: RepresentationEntryKind;
}

export type RepresentationStorageFailureCode =
    | "ALREADY_EXISTS"
    | "NOT_FOUND"
    | "DIGEST_MISMATCH"
    | "INVALID_LOCATOR"
    | "INVALID_LIMIT"
    | "UNSUPPORTED"
    | "UNAVAILABLE"
    | "IO_ERROR";

export interface RepresentationStorageFailure {
    readonly code: RepresentationStorageFailureCode;
    readonly message: string;
}

export type RepresentationStorageResult<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly failure: RepresentationStorageFailure };

export interface BoundedRepresentationListing {
    readonly entries: readonly RepresentationEntry[];
    /** True means additional children exist and the caller must not treat this listing as complete. */
    readonly truncated: boolean;
}

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

export function isSafeRepresentationLocator(locator: string, allowRoot = false): boolean {
    if (typeof locator !== "string" || locator.includes("\0") || locator.includes("\\")) return false;
    if (allowRoot && locator === "") return true;
    if (!locator || locator.startsWith("/") || locator.endsWith("/")) return false;
    return locator.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export function storageFailure<T>(
    code: RepresentationStorageFailureCode,
    message: string
): RepresentationStorageResult<T> {
    return { ok: false, failure: { code, message } };
}

export function storageSuccess<T>(value: T): RepresentationStorageResult<T> {
    return { ok: true, value };
}
