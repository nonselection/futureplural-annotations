/** Opaque identities for the canonical storage protocol. */

declare const storeIdBrand: unique symbol;
declare const revisionIdBrand: unique symbol;
declare const mutationIdBrand: unique symbol;
declare const migrationIdBrand: unique symbol;
declare const representationStateIdBrand: unique symbol;

export type StoreId = string & { readonly [storeIdBrand]: true };
export type RevisionId = string & { readonly [revisionIdBrand]: true };
export type MutationId = string & { readonly [mutationIdBrand]: true };
export type MigrationId = string & { readonly [migrationIdBrand]: true };
export type RepresentationStateId = string & { readonly [representationStateIdBrand]: true };

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const ID_PATTERNS = {
    store: new RegExp(`^fk-store-${UUID_V4}$`, "i"),
    revision: new RegExp(`^fk-revision-${UUID_V4}$`, "i"),
    mutation: new RegExp(`^fk-mutation-${UUID_V4}$`, "i"),
    migration: new RegExp(`^fk-migration-${UUID_V4}$`, "i"),
    representationState: new RegExp(`^fk-representation-state-${UUID_V4}$`, "i"),
} as const;

function createUuidV4(): string {
    const cryptoApi = window.crypto;
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
        throw new Error("Cryptographically secure random values are unavailable.");
    }

    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createId<T extends string>(prefix: string): T {
    return `${prefix}${createUuidV4()}` as T;
}

function isId(value: unknown, pattern: RegExp): boolean {
    return typeof value === "string" && pattern.test(value);
}

export function createStoreId(): StoreId {
    return createId<StoreId>("fk-store-");
}

export function createRevisionId(): RevisionId {
    return createId<RevisionId>("fk-revision-");
}

export function createMutationId(): MutationId {
    return createId<MutationId>("fk-mutation-");
}

export function createMigrationId(): MigrationId {
    return createId<MigrationId>("fk-migration-");
}

export function createRepresentationStateId(): RepresentationStateId {
    return createId<RepresentationStateId>("fk-representation-state-");
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
