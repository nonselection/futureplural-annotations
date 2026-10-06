/** Opaque identities for the canonical storage protocol. */

declare const storeIdBrand: unique symbol;
declare const revisionIdBrand: unique symbol;
declare const mutationIdBrand: unique symbol;
declare const migrationIdBrand: unique symbol;
declare const representationStateIdBrand: unique symbol;
declare const publicationIdBrand: unique symbol;
declare const bootstrapIdBrand: unique symbol;

export type StoreId = string & { readonly [storeIdBrand]: true };
export type RevisionId = string & { readonly [revisionIdBrand]: true };
export type MutationId = string & { readonly [mutationIdBrand]: true };
export type MigrationId = string & { readonly [migrationIdBrand]: true };
export type RepresentationStateId = string & { readonly [representationStateIdBrand]: true };
export type PublicationId = string & { readonly [publicationIdBrand]: true };
export type BootstrapId = string & { readonly [bootstrapIdBrand]: true };

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const ID_PATTERNS = {
    store: new RegExp(`^fk-store-${UUID_V4}$`, "i"),
    revision: new RegExp(`^fk-revision-${UUID_V4}$`, "i"),
    mutation: new RegExp(`^fk-mutation-${UUID_V4}$`, "i"),
    migration: new RegExp(`^fk-migration-${UUID_V4}$`, "i"),
    representationState: new RegExp(`^fk-representation-state-${UUID_V4}$`, "i"),
    publication: new RegExp(`^fk-publication-${UUID_V4}$`, "i"),
    bootstrap: new RegExp(`^fk-bootstrap-${UUID_V4}$`, "i"),
} as const;

/** Secure-byte injection for synthetic tests only; production allocation uses default Web Crypto. */
export type SecureByteProvider = (length: number) => Uint8Array;

function secureRandomBytes(length: number): Uint8Array {
    const cryptoApi = typeof window === "undefined" ? undefined : window.crypto;
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
        throw new Error("Cryptographically secure random values are unavailable.");
    }

    return cryptoApi.getRandomValues(new Uint8Array(length));
}

function createUuidV4(provider: SecureByteProvider = secureRandomBytes): string {
    const supplied = provider(16);
    if (!(supplied instanceof Uint8Array) || supplied.length !== 16) {
        throw new Error("Secure byte provider must return exactly 16 bytes.");
    }
    const bytes = Uint8Array.from(supplied);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createId<T extends string>(prefix: string, provider?: SecureByteProvider): T {
    return `${prefix}${createUuidV4(provider)}` as T;
}

function isId(value: unknown, pattern: RegExp): boolean {
    return typeof value === "string" && pattern.test(value);
}

export function createStoreId(provider?: SecureByteProvider): StoreId {
    return createId<StoreId>("fk-store-", provider);
}

export function createRevisionId(provider?: SecureByteProvider): RevisionId {
    return createId<RevisionId>("fk-revision-", provider);
}

export function createMutationId(provider?: SecureByteProvider): MutationId {
    return createId<MutationId>("fk-mutation-", provider);
}

export function createMigrationId(provider?: SecureByteProvider): MigrationId {
    return createId<MigrationId>("fk-migration-", provider);
}

export function createRepresentationStateId(provider?: SecureByteProvider): RepresentationStateId {
    return createId<RepresentationStateId>("fk-representation-state-", provider);
}

export function createPublicationId(provider?: SecureByteProvider): PublicationId {
    return createId<PublicationId>("fk-publication-", provider);
}

export function createBootstrapId(provider?: SecureByteProvider): BootstrapId {
    return createId<BootstrapId>("fk-bootstrap-", provider);
}

export function isStoreId(value: unknown): value is StoreId {
    return isId(value, ID_PATTERNS.store);
}

export function isRevisionId(value: unknown): value is RevisionId {
    return isId(value, ID_PATTERNS.revision);
}

export function isMutationId(value: unknown): value is MutationId {
    return isId(value, ID_PATTERNS.mutation);
}

export function isMigrationId(value: unknown): value is MigrationId {
    return isId(value, ID_PATTERNS.migration);
}

export function isRepresentationStateId(value: unknown): value is RepresentationStateId {
    return isId(value, ID_PATTERNS.representationState);
}

export function isPublicationId(value: unknown): value is PublicationId {
    return isId(value, ID_PATTERNS.publication);
}

export function isBootstrapId(value: unknown): value is BootstrapId {
    return isId(value, ID_PATTERNS.bootstrap);
}
