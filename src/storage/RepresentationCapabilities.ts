/** Pure ephemeral capability correlation/lifecycle support. No storage map, host I/O, preflight or dispatch. */
import { createPublicationId, type PublicationId, type SecureByteProvider } from "./identity";
import { isSafeRepresentationLocator } from "./representationLocators";
import {
    isPositiveRepresentationListLimit,
    isPublicationArtifactRole,
    representationReadFailure,
    representationReadSuccess,
    validatePublicationCompletion,
    type BoundedRepresentationHandleListing,
    type ControlledPublicationRefusalReason,
    type PublicationAllocation,
    type PublicationAllocationResult,
    type PublicationAllocationState,
    type PublicationArtifactRole,
    type PublicationBinding,
    type PublicationCollectionHandle,
    type PublicationCompletion,
    type PublicationEffectResult,
    type PublicationInvocation,
    type PublicationInvocationResult,
    type PublicationToken,
    type RepresentationContextIdentity,
    type RepresentationDirectoryHandle,
    type RepresentationFileHandle,
    type RepresentationHandleEntry,
    type RepresentationReadResult,
    type RepresentationRootHandle,
} from "./RepresentationStoragePort";

interface AllocationRecord {
    readonly issuer: RepresentationCapabilityIssuer;
    readonly allocation: PublicationAllocation;
    readonly binding: PublicationBinding;
    state: PublicationAllocationState;
}
interface InvocationRecord {
    readonly allocation: AllocationRecord;
    dispatched: boolean;
    completed: boolean;
}
// Shared correlation permits burning a known foreign token on misuse, never acceptance by equal fields.
const tokenRecords = new WeakMap<object, AllocationRecord>();
const allocationRecords = new WeakMap<object, AllocationRecord>();
const invocationRecords = new WeakMap<object, InvocationRecord>();
function isArrayValue(value: unknown): boolean {
    return Array.isArray(value);
}
function object(value: unknown): value is object {
    return value !== null && typeof value === "object";
}
function knownAllocation(input: unknown): AllocationRecord | undefined {
    if (!object(input)) return undefined;
    const exact = allocationRecords.get(input) ?? tokenRecords.get(input);
    if (exact) return exact;
    try {
        const token = Object.getOwnPropertyDescriptor(input, "token");
        return token && "value" in token && object(token.value) ? tokenRecords.get(token.value) : undefined;
    } catch {
        return undefined;
    }
}
function refused(
    reason: ControlledPublicationRefusalReason,
    binding?: PublicationBinding
): PublicationInvocationResult {
    return {
        status: "REFUSED",
        effect: binding
            ? { physicalEffect: "NO_MUTATION_DISPATCHED", reason, binding }
            : { physicalEffect: "NO_MUTATION_DISPATCHED", reason },
    };
}

/** Does not implement either physical port. Production randomness defaults to Web Crypto; injection is test-only. */
export class RepresentationCapabilityIssuer {
    readonly context = Object.freeze({ kind: "representation-context" }) as RepresentationContextIdentity;
    readonly #roots = new WeakSet<object>();
    readonly #directories = new WeakSet<object>();
    readonly #files = new WeakSet<object>();
    readonly #collections = new WeakSet<object>();
    readonly #allocations = new Set<AllocationRecord>();
    readonly #publicationIds = new Set<PublicationId>();
    #closed = false;

    constructor(private readonly secureBytes?: SecureByteProvider) {
        // Runtime privacy/correlation must not depend on TypeScript readonly/private assertions.
        Object.freeze(this);
    }

    createRoot(rootIdentity: string): RepresentationRootHandle {
        if (this.#closed) throw new Error("Capability context is invalidated.");
        if (typeof rootIdentity !== "string" || !rootIdentity.trim())
            throw new Error("Diagnostic root identity is required.");
        const root = Object.freeze({
            kind: "representation-root",
            context: this.context,
            rootIdentity,
        }) as RepresentationRootHandle;
        this.#roots.add(root);
        return root;
    }
    acceptsRoot(input: unknown): input is RepresentationRootHandle {
        return !this.#closed && object(input) && this.#roots.has(input);
    }
    acceptsDirectoryHandle(input: unknown): input is RepresentationDirectoryHandle {
        return !this.#closed && object(input) && this.#directories.has(input);
    }
    acceptsFileHandle(input: unknown): input is RepresentationFileHandle {
        return !this.#closed && object(input) && this.#files.has(input);
    }
    acceptsCollection(input: unknown): input is PublicationCollectionHandle {
        return !this.#closed && object(input) && this.#collections.has(input);
    }
    directoryHandle(
        root: RepresentationRootHandle,
        locator: string
    ): RepresentationReadResult<RepresentationDirectoryHandle> {
        if (!this.acceptsRoot(root))
            return representationReadFailure("CONFINEMENT", "Root is not issued by this active context.");
        if (!isSafeRepresentationLocator(locator, true))
            return representationReadFailure("INVALID_LOCATOR", "Unsafe root-relative directory locator.");
        const handle = Object.freeze({
            kind: "directory",
            context: this.context,
            root,
            locator,
        }) as RepresentationDirectoryHandle;
        this.#directories.add(handle);
        return representationReadSuccess(handle);
    }
    fileHandle(root: RepresentationRootHandle, locator: string): RepresentationReadResult<RepresentationFileHandle> {
        if (!this.acceptsRoot(root))
            return representationReadFailure("CONFINEMENT", "Root is not issued by this active context.");
        if (!isSafeRepresentationLocator(locator))
            return representationReadFailure("INVALID_LOCATOR", "Unsafe root-relative file locator.");
        const handle = Object.freeze({
            kind: "file",
            context: this.context,
            root,
            locator,
        }) as RepresentationFileHandle;
        this.#files.add(handle);
        return representationReadSuccess(handle);
    }
    bindPublicationCollection(
        directory: RepresentationDirectoryHandle,
        role: PublicationArtifactRole
    ): RepresentationReadResult<PublicationCollectionHandle> {
        if (!this.acceptsDirectoryHandle(directory))
            return representationReadFailure("CONFINEMENT", "Directory is not issued by this active context.");
        if (!isPublicationArtifactRole(role))
            return representationReadFailure("INVALID_INPUT", "Unsupported publication artifact role.");
        const collection = Object.freeze({
            context: this.context,
            root: directory.root,
            directory,
            role,
        }) as PublicationCollectionHandle;
        this.#collections.add(collection);
        return representationReadSuccess(collection);
    }
    /** Pure output validation only, no enumeration/native allocation/cursor/traversal. */
    boundedListing(
        directory: RepresentationDirectoryHandle,
        entries: readonly RepresentationHandleEntry[],
        limit: number,
        truncated: boolean
    ): RepresentationReadResult<BoundedRepresentationHandleListing> {
        if (!this.acceptsDirectoryHandle(directory))
            return representationReadFailure("CONFINEMENT", "Unknown directory handle.");
        if (!isPositiveRepresentationListLimit(limit))
            return representationReadFailure("INVALID_LIMIT", "Positive safe-integer listing limit required.");
        if (!isArrayValue(entries) || typeof truncated !== "boolean")
            return representationReadFailure("INVALID_INPUT", "Expected child entries and explicit truncation fact.");
        const copies: RepresentationHandleEntry[] = [];
        const names = new Set<string>();
        for (const entry of entries) {
            if (!entry || !isSafeRepresentationLocator(entry.name) || entry.name.includes("/") || names.has(entry.name))
                return representationReadFailure("INVALID_INPUT", "Entries must name distinct immediate children.");
            names.add(entry.name);
            const accepted =
                entry.kind === "file"
                    ? this.acceptsFileHandle(entry.handle)
                    : entry.kind === "directory" && this.acceptsDirectoryHandle(entry.handle);
            if (
                !accepted ||
                entry.handle.root !== directory.root ||
                entry.handle.locator !== (directory.locator ? `${directory.locator}/${entry.name}` : entry.name)
            )
                return representationReadFailure(
                    "CONFINEMENT",
                    "Child handle does not match its issued root/directory/name/kind."
                );
            if (copies.length < limit)
                copies.push(
                    entry.kind === "file"
                        ? Object.freeze({ name: entry.name, kind: "file", handle: entry.handle })
                        : Object.freeze({ name: entry.name, kind: "directory", handle: entry.handle })
                );
        }
        return representationReadSuccess(
            Object.freeze({ entries: Object.freeze(copies), truncated: truncated || entries.length > limit })
        );
    }
    /** Local ID issuance only. No directory check, reservation, external exclusion or host effect. */
    allocatePublication(collection: PublicationCollectionHandle): PublicationAllocationResult {
        if (!this.acceptsCollection(collection))
            return {
                status: "REFUSED",
                reason: "INVALID_COLLECTION",
                message: "Collection is not issued by this active context.",
            };
        let publicationId: PublicationId;
        try {
            publicationId = createPublicationId(this.secureBytes);
        } catch {
            return {
                status: "REFUSED",
                reason: "SECURE_RANDOM_UNAVAILABLE",
                message: "Secure publication allocation failed.",
            };
        }
        if (this.#publicationIds.has(publicationId))
            return {
                status: "REFUSED",
                reason: "PUBLICATION_ID_COLLISION",
                message: "This context already issued that PublicationId; no target reuse.",
            };
        this.#publicationIds.add(publicationId);
        const locator = `${collection.directory.locator ? `${collection.directory.locator}/` : ""}${publicationId}.json`;
        const binding: PublicationBinding = Object.freeze({
            publicationId,
            context: this.context,
            root: collection.root,
            collection,
            role: collection.role,
            locator,
        });
        const token = Object.freeze({ kind: "publication-token" }) as PublicationToken;
        const allocation = Object.freeze({ ...binding, token }) as PublicationAllocation;
        const record: AllocationRecord = { issuer: this, allocation, binding, state: "ALLOCATED" };
        this.#allocations.add(record);
        tokenRecords.set(token, record);
        allocationRecords.set(allocation, record);
        return { status: "ALLOCATED", allocation };
    }
    /** Synchronous invocation entry. Known tokens burn even on wrong issuer/scope/copied-wrapper refusal. */
    consumePublication(
        input: unknown,
        publicationRoot: RepresentationRootHandle,
        expectedCollection?: PublicationCollectionHandle,
        expectedRole?: PublicationArtifactRole
    ): PublicationInvocationResult {
        const record = knownAllocation(input);
        if (!record) return refused("INVALID_ALLOCATION");
        if (record.state !== "ALLOCATED") {
            record.state = "RETIRED";
            return refused("RETIRED_ALLOCATION", record.binding);
        }
        record.state = "INVOKED"; // Consume BEFORE any possible await in the future host caller.
        if (input !== record.allocation) {
            record.state = "RETIRED";
            return refused("INVALID_ALLOCATION", record.binding);
        }
        if (
            record.issuer !== this ||
            !this.acceptsRoot(publicationRoot) ||
            record.binding.root !== publicationRoot ||
            (expectedCollection !== undefined && record.binding.collection !== expectedCollection) ||
            (expectedRole !== undefined && record.binding.role !== expectedRole)
        ) {
            record.state = "RETIRED";
            return refused("CONFINEMENT", record.binding);
        }
        const invocation = Object.freeze({ binding: record.binding }) as PublicationInvocation;
        invocationRecords.set(invocation, { allocation: record, dispatched: false, completed: false });
        return { status: "CONSUMED", invocation };
    }
    /** External host caller must mark immediately before irreversible dispatch; this method performs no I/O. */
    markDispatchStarted(invocation: PublicationInvocation): void {
        const record = this.#invocation(invocation);
        if (record.dispatched) throw new Error("Dispatch boundary may be entered only once.");
        record.dispatched = true;
    }
    /** Constructs this invocation's fact only; caller supplies truthful host return/uncertainty. No readback. */
    finishPublication(invocation: PublicationInvocation, completion: PublicationCompletion): PublicationEffectResult {
        const record = this.#invocation(invocation, true);
        try {
            const fact = validatePublicationCompletion(completion);
            if (fact.physicalEffect === "NO_MUTATION_DISPATCHED" && record.dispatched)
                throw new Error("Cannot claim nondispatch after entering the dispatch boundary.");
            if (fact.physicalEffect !== "NO_MUTATION_DISPATCHED" && !record.dispatched)
                throw new Error("Dispatch effect requires an entered dispatch boundary.");
            return Object.freeze({ ...fact, binding: record.allocation.binding });
        } finally {
            record.completed = true;
            record.allocation.state = "RETIRED";
        }
    }
    /** Burns local capability only. An existing invocation/provider operation is not cancelled. */
    retirePublication(input: unknown): void {
        const record = knownAllocation(input);
        if (record) record.state = "RETIRED";
    }
    allocationState(input: unknown): PublicationAllocationState | undefined {
        return knownAllocation(input)?.state;
    }
    /** Restart/unload boundary, not physical cleanup/quiescence. Persisted metadata cannot revive this issuer. */
    invalidateContext(): void {
        this.#closed = true;
        for (const record of this.#allocations) record.state = "RETIRED";
    }
    #invocation(input: unknown, completionOnly = false): InvocationRecord {
        const record = object(input) ? invocationRecords.get(input) : undefined;
        if (!record || record.allocation.issuer !== this || record.completed || (this.#closed && !completionOnly))
            throw new Error("Unknown, completed or inactive publication invocation.");
        return record;
    }
}
