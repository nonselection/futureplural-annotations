/** Synthetic portable v0.5 reference; never Obsidian/device/provider qualification. */
export { InMemoryRepresentationStorage } from "./legacy/InMemoryRepresentationStorageV042";
import { RepresentationCapabilityIssuer } from "./RepresentationCapabilities";
import { isSafeRepresentationLocator } from "./representationLocators";
import {
    isPositiveRepresentationListLimit,
    representationByteReadResult,
    representationReadFailure,
    type BoundedRepresentationHandleListing,
    type CanonicalRepresentationStoragePort,
    type ControlledPublicationRefusalReason,
    type PublicationAllocation,
    type PublicationAllocationResult,
    type PublicationArtifactRole,
    type PublicationCollectionHandle,
    type PublicationEffectResult,
    type RepresentationContextIdentity,
    type RepresentationDirectoryHandle,
    type RepresentationFileHandle,
    type RepresentationHandleEntry,
    type RepresentationReadResult,
    type RepresentationRootHandle,
} from "./RepresentationStoragePort";
import type { SecureByteProvider } from "./identity";

export type SyntheticPublicationSchedule =
    | {
          readonly kind:
              | "success"
              | "known-nondispatch"
              | "applied-before-error"
              | "dispatch-error"
              | "unknown-pending"
              | "success-unreadable";
      }
    | { readonly kind: "partial-apply" | "success-mismatch" | "arrival-after-preflight"; readonly bytes: Uint8Array };
export type SyntheticReadCondition = "UNAVAILABLE" | "UNSUPPORTED" | "PARTIAL";
export interface SyntheticPublicationEvent {
    readonly kind:
        | "preflight-absent"
        | "external-write"
        | "dispatch"
        | "apply"
        | "pending"
        | "late-apply"
        | "late-failure";
    readonly rootIdentity: string;
    readonly locator: string;
    readonly bytes?: Uint8Array;
}
export interface SyntheticPause {
    readonly entered: Promise<void>;
    readonly release: () => void;
}
export interface InMemoryPublicationFixtureControls {
    seedFile(root: RepresentationRootHandle, locator: string, bytes: Uint8Array): void;
    seedDirectory(root: RepresentationRootHandle, locator: string): void;
    externalWrite(root: RepresentationRootHandle, locator: string, bytes: Uint8Array): void;
    externalDelete(root: RepresentationRootHandle, locator: string): void;
    setReadCondition(root: RepresentationRootHandle, locator: string, condition?: SyntheticReadCondition): void;
    setListCondition(root: RepresentationRootHandle, locator: string, condition?: "UNAVAILABLE" | "UNSUPPORTED"): void;
    setPreflightUnavailable(root: RepresentationRootHandle, locator: string, unavailable: boolean): void;
    scheduleNext(schedule: SyntheticPublicationSchedule): void;
    pauseNextPreflight(): SyntheticPause;
    pauseNextDispatch(): SyntheticPause;
    pendingIds(): readonly number[];
    completePending(id: number): void;
    invalidateContext(): void;
    stats(): {
        readonly invocations: number;
        readonly dispatches: number;
        readonly lateCompletions: number;
        readonly pending: number;
    };
    events(): readonly SyntheticPublicationEvent[];
    /** Test-only ground truth; defensive bytes, not a port observation. */
    peekBytes(root: RepresentationRootHandle, locator: string): Uint8Array | undefined;
}
export interface InMemoryPublicationFixture {
    readonly port: InMemoryPublicationStorage;
    readonly secondaryPort: InMemoryPublicationStorage;
    readonly controls: InMemoryPublicationFixtureControls;
}
export interface InMemoryPublicationFixtureOptions {
    readonly rootIdentity?: string;
    readonly secondaryRootIdentity?: string;
    /** Deterministic injection solely for tests; production-default reference uses Web Crypto. */
    readonly secureBytes?: SecureByteProvider;
}
interface PhysicalRoot {
    readonly files: Map<string, Uint8Array>;
    readonly directories: Set<string>;
    readonly reads: Map<string, SyntheticReadCondition>;
    readonly listings: Map<string, "UNAVAILABLE" | "UNSUPPORTED">;
    readonly unavailablePreflight: Set<string>;
}
interface PauseRecord extends SyntheticPause {
    readonly wait: Promise<void>;
    signal(): void;
}
interface PendingHostWork {
    readonly root: RepresentationRootHandle;
    readonly locator: string;
    readonly bytes: Uint8Array;
}
interface SyntheticState {
    readonly issuer: RepresentationCapabilityIssuer;
    readonly roots: Map<RepresentationRootHandle, PhysicalRoot>;
    readonly schedules: SyntheticPublicationSchedule[];
    readonly preflightPauses: PauseRecord[];
    readonly dispatchPauses: PauseRecord[];
    readonly pending: Map<number, PendingHostWork>;
    readonly events: SyntheticPublicationEvent[];
    invocations: number;
    dispatches: number;
    lateCompletions: number;
    nextPending: number;
}
function required<T>(value: T | undefined): T {
    if (value === undefined) throw new Error("Unknown synthetic reference root/task.");
    return value;
}
function physical(state: SyntheticState, root: RepresentationRootHandle): PhysicalRoot {
    return required(state.roots.get(root));
}
function safe(locator: string, rootAllowed = false): void {
    if (!isSafeRepresentationLocator(locator, rootAllowed)) throw new Error("Unsafe fixture locator.");
}
function pause(): PauseRecord {
    let signal = () => {};
    let release = () => {};
    const entered = new Promise<void>((resolve) => {
        signal = resolve;
    });
    const wait = new Promise<void>((resolve) => {
        release = resolve;
    });
    return { entered, wait, signal, release };
}
function parents(locator: string): string[] {
    const parts = locator.split("/");
    return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}
function occupied(root: PhysicalRoot, locator: string): boolean {
    return (
        root.files.has(locator) ||
        root.directories.has(locator) ||
        parents(locator).some((path) => root.files.has(path))
    );
}
function apply(
    state: SyntheticState,
    rootHandle: RepresentationRootHandle,
    locator: string,
    bytes: Uint8Array,
    kind: "apply" | "late-apply" | "external-write"
): void {
    const root = physical(state, rootHandle);
    if (root.directories.has(locator) || parents(locator).some((path) => root.files.has(path)))
        throw new Error("Synthetic conflicting physical path shape.");
    // Confined directory housekeeping is not an authority artifact, lock or publication receipt.
    for (const parent of parents(locator)) root.directories.add(parent);
    root.files.set(locator, Uint8Array.from(bytes));
    state.events.push({ kind, rootIdentity: rootHandle.rootIdentity, locator, bytes: Uint8Array.from(bytes) });
}
function makeControls(state: SyntheticState): InMemoryPublicationFixtureControls {
    return Object.freeze({
        seedFile(root: RepresentationRootHandle, locator: string, bytes: Uint8Array) {
            safe(locator);
            apply(state, root, locator, bytes, "external-write");
        },
        seedDirectory(root: RepresentationRootHandle, locator: string) {
            safe(locator, true);
            const data = physical(state, root);
            if (data.files.has(locator) || parents(locator).some((p) => data.files.has(p)))
                throw new Error("Conflicting fixture directory shape.");
            for (const parent of parents(locator)) data.directories.add(parent);
            data.directories.add(locator);
        },
        externalWrite(root: RepresentationRootHandle, locator: string, bytes: Uint8Array) {
            safe(locator);
            apply(state, root, locator, bytes, "external-write");
        },
        externalDelete(root: RepresentationRootHandle, locator: string) {
            safe(locator);
            physical(state, root).files.delete(locator);
        },
        setReadCondition(root: RepresentationRootHandle, locator: string, condition?: SyntheticReadCondition) {
            safe(locator);
            const data = physical(state, root);
            if (condition) data.reads.set(locator, condition);
            else data.reads.delete(locator);
        },
        setListCondition(root: RepresentationRootHandle, locator: string, condition?: "UNAVAILABLE" | "UNSUPPORTED") {
            safe(locator, true);
            const data = physical(state, root);
            if (condition) data.listings.set(locator, condition);
            else data.listings.delete(locator);
        },
        setPreflightUnavailable(root: RepresentationRootHandle, locator: string, unavailable: boolean) {
            safe(locator, true);
            const data = physical(state, root);
            if (unavailable) data.unavailablePreflight.add(locator);
            else data.unavailablePreflight.delete(locator);
        },
        scheduleNext(schedule: SyntheticPublicationSchedule) {
            state.schedules.push(
                "bytes" in schedule ? { kind: schedule.kind, bytes: Uint8Array.from(schedule.bytes) } : { ...schedule }
            );
        },
        pauseNextPreflight() {
            const gate = pause();
            state.preflightPauses.push(gate);
            return { entered: gate.entered, release: gate.release };
        },
        pauseNextDispatch() {
            const gate = pause();
            state.dispatchPauses.push(gate);
            return { entered: gate.entered, release: gate.release };
        },
        pendingIds() {
            return Object.freeze([...state.pending.keys()]);
        },
        completePending(id: number) {
            const work = required(state.pending.get(id));
            state.pending.delete(id);
            state.lateCompletions++;
            try {
                apply(state, work.root, work.locator, work.bytes, "late-apply");
            } catch {
                state.events.push({
                    kind: "late-failure",
                    rootIdentity: work.root.rootIdentity,
                    locator: work.locator,
                });
            }
        },
        invalidateContext() {
            state.issuer.invalidateContext();
        },
        stats() {
            return Object.freeze({
                invocations: state.invocations,
                dispatches: state.dispatches,
                lateCompletions: state.lateCompletions,
                pending: state.pending.size,
            });
        },
        events() {
            return Object.freeze(
                state.events.map((event) =>
                    Object.freeze(event.bytes ? { ...event, bytes: Uint8Array.from(event.bytes) } : { ...event })
                )
            );
        },
        peekBytes(root: RepresentationRootHandle, locator: string) {
            const bytes = physical(state, root).files.get(locator);
            return bytes ? Uint8Array.from(bytes) : undefined;
        },
    });
}

/** Intentionally nonexclusive synthetic reference. Controls/ground truth are separate from the port. */
export class InMemoryPublicationStorage implements CanonicalRepresentationStoragePort {
    readonly context: RepresentationContextIdentity;
    readonly rootIdentity: string;
    readonly publicationRoot: RepresentationRootHandle;
    readonly #state: SyntheticState;
    private constructor(state: SyntheticState, root: RepresentationRootHandle) {
        this.#state = state;
        this.context = state.issuer.context;
        this.rootIdentity = root.rootIdentity;
        this.publicationRoot = root;
        Object.freeze(this);
    }
    static fixture(options: InMemoryPublicationFixtureOptions = {}): InMemoryPublicationFixture {
        const issuer = new RepresentationCapabilityIssuer(options.secureBytes);
        const primary = issuer.createRoot(options.rootIdentity ?? "synthetic-primary");
        const secondary = issuer.createRoot(options.secondaryRootIdentity ?? "synthetic-secondary");
        const makeRoot = (): PhysicalRoot => ({
            files: new Map(),
            directories: new Set([""]),
            reads: new Map(),
            listings: new Map(),
            unavailablePreflight: new Set(),
        });
        const state: SyntheticState = {
            issuer,
            roots: new Map([
                [primary, makeRoot()],
                [secondary, makeRoot()],
            ]),
            schedules: [],
            preflightPauses: [],
            dispatchPauses: [],
            pending: new Map(),
            events: [],
            invocations: 0,
            dispatches: 0,
            lateCompletions: 0,
            nextPending: 1,
        };
        return Object.freeze({
            port: new InMemoryPublicationStorage(state, primary),
            secondaryPort: new InMemoryPublicationStorage(state, secondary),
            controls: makeControls(state),
        });
    }
    directoryHandle(locator: string): RepresentationReadResult<RepresentationDirectoryHandle> {
        return this.#state.issuer.directoryHandle(this.publicationRoot, locator);
    }
    fileHandle(locator: string): RepresentationReadResult<RepresentationFileHandle> {
        return this.#state.issuer.fileHandle(this.publicationRoot, locator);
    }
    bindPublicationCollection(
        directory: RepresentationDirectoryHandle,
        role: PublicationArtifactRole
    ): RepresentationReadResult<PublicationCollectionHandle> {
        if (!this.#state.issuer.acceptsDirectoryHandle(directory) || directory.root !== this.publicationRoot)
            return representationReadFailure(
                "CONFINEMENT",
                "Publication collection must be in this view's issued write root."
            );
        return this.#state.issuer.bindPublicationCollection(directory, role);
    }
    async allocatePublication(collection: PublicationCollectionHandle): Promise<PublicationAllocationResult> {
        if (!this.#state.issuer.acceptsCollection(collection) || collection.root !== this.publicationRoot)
            return {
                status: "REFUSED",
                reason: "INVALID_COLLECTION",
                message: "Allocation collection is outside this publication root/context.",
            };
        return this.#state.issuer.allocatePublication(collection);
    }
    retirePublication(allocation: PublicationAllocation): void {
        this.#state.issuer.retirePublication(allocation);
    }
    async listChildren(
        handle: RepresentationDirectoryHandle,
        limit: number
    ): Promise<RepresentationReadResult<BoundedRepresentationHandleListing>> {
        if (!this.#state.issuer.acceptsDirectoryHandle(handle))
            return representationReadFailure("CONFINEMENT", "Unissued/inactive directory handle.");
        if (!isPositiveRepresentationListLimit(limit))
            return representationReadFailure("INVALID_LIMIT", "Positive returned-result limit required.");
        const root = physical(this.#state, handle.root);
        const blocked = root.listings.get(handle.locator);
        if (blocked)
            return representationReadFailure(blocked, "Synthetic listing observation unavailable/unsupported.");
        if (root.files.has(handle.locator))
            return representationReadFailure("INVALID_INPUT", "Directory handle addresses a file.");
        if (!root.directories.has(handle.locator))
            return representationReadFailure("NOT_FOUND", "Synthetic directory not found.");
        const prefix = handle.locator ? `${handle.locator}/` : "";
        const names = new Map<string, "file" | "directory">();
        for (const locator of [...root.files.keys(), ...root.directories]) {
            if (!locator.startsWith(prefix) || locator === handle.locator) continue;
            const rest = locator.slice(prefix.length);
            if (!rest) continue;
            const split = rest.indexOf("/");
            const name = split < 0 ? rest : rest.slice(0, split);
            const kind = split >= 0 || root.directories.has(locator) ? "directory" : "file";
            if (names.get(name) !== "directory") names.set(name, kind);
        }
        const entries: RepresentationHandleEntry[] = [];
        for (const [name, kind] of [...names].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
            if (entries.length === limit) break;
            const locator = `${prefix}${name}`;
            if (kind === "file") {
                const child = this.#state.issuer.fileHandle(handle.root, locator);
                if (child.ok === false) return child;
                entries.push({ name, kind, handle: child.value });
            } else {
                const child = this.#state.issuer.directoryHandle(handle.root, locator);
                if (child.ok === false) return child;
                entries.push({ name, kind, handle: child.value });
            }
        }
        // Native-model enumeration above is intentionally not bounded by the result limit.
        return this.#state.issuer.boundedListing(handle, entries, limit, names.size > limit);
    }
    async readBytes(handle: RepresentationFileHandle): Promise<RepresentationReadResult<Uint8Array>> {
        if (!this.#state.issuer.acceptsFileHandle(handle))
            return representationReadFailure("CONFINEMENT", "Unissued/inactive file handle.");
        const root = physical(this.#state, handle.root);
        const condition = root.reads.get(handle.locator);
        if (condition)
            return representationReadFailure(
                condition === "PARTIAL" ? "UNAVAILABLE" : condition,
                "Synthetic read did not provide complete bytes."
            );
        const bytes = root.files.get(handle.locator);
        if (!bytes) return representationReadFailure("NOT_FOUND", "Synthetic file not found.");
        return representationByteReadResult(bytes, true);
    }
    async publishFresh(allocation: PublicationAllocation, bytes: Uint8Array): Promise<PublicationEffectResult> {
        const state = this.#state;
        state.invocations++;
        const entry = state.issuer.consumePublication(allocation, this.publicationRoot);
        if (entry.status === "REFUSED") return entry.effect;
        const invocation = entry.invocation;
        const binding = invocation.binding;
        let dispatched = false;
        const no = (reason: ControlledPublicationRefusalReason) =>
            state.issuer.finishPublication(invocation, { physicalEffect: "NO_MUTATION_DISPATCHED", reason });
        const unknown = () =>
            state.issuer.finishPublication(invocation, {
                physicalEffect: "DISPATCH_OUTCOME_UNKNOWN",
                diagnostic: "Synthetic dispatch did not report normal completion.",
            });
        try {
            if (!(bytes instanceof Uint8Array)) return no("INVALID_ALLOCATION");
            const content = Uint8Array.from(bytes); // Synchronous ownership BEFORE first await.
            const schedule = state.schedules.shift() ?? { kind: "success" };
            const preflightGate = state.preflightPauses.shift();
            const dispatchGate = state.dispatchPauses.shift();
            if (preflightGate) {
                preflightGate.signal();
                await preflightGate.wait;
            } else await Promise.resolve();
            if (!state.issuer.acceptsRoot(binding.root)) return no("CONFINEMENT");
            const root = physical(state, binding.root);
            if ([binding.locator, ...parents(binding.locator), ""].some((path) => root.unavailablePreflight.has(path)))
                return no("PREFLIGHT_UNAVAILABLE");
            if (occupied(root, binding.locator)) return no("OBSERVED_OCCUPANCY");
            state.events.push({
                kind: "preflight-absent",
                rootIdentity: binding.root.rootIdentity,
                locator: binding.locator,
            });
            if (schedule.kind === "known-nondispatch") return no("PREFLIGHT_UNAVAILABLE");
            if (schedule.kind === "arrival-after-preflight")
                apply(state, binding.root, binding.locator, schedule.bytes, "external-write");
            if (dispatchGate) {
                dispatchGate.signal();
                await dispatchGate.wait;
            }
            state.issuer.markDispatchStarted(invocation);
            dispatched = true;
            state.dispatches++;
            state.events.push({ kind: "dispatch", rootIdentity: binding.root.rootIdentity, locator: binding.locator });
            if (schedule.kind === "unknown-pending") {
                const id = state.nextPending++;
                state.pending.set(id, { root: binding.root, locator: binding.locator, bytes: content });
                state.events.push({
                    kind: "pending",
                    rootIdentity: binding.root.rootIdentity,
                    locator: binding.locator,
                });
                return unknown();
            }
            if (schedule.kind === "dispatch-error") throw new Error("Synthetic dispatch rejected.");
            apply(
                state,
                binding.root,
                binding.locator,
                schedule.kind === "partial-apply" || schedule.kind === "success-mismatch" ? schedule.bytes : content,
                "apply"
            );
            if (schedule.kind === "applied-before-error" || schedule.kind === "partial-apply")
                throw new Error("Synthetic dispatch rejected.");
            if (schedule.kind === "success-unreadable") root.reads.set(binding.locator, "UNAVAILABLE");
            return state.issuer.finishPublication(invocation, { physicalEffect: "DISPATCH_REPORTED_SUCCESS" });
        } catch {
            return dispatched
                ? unknown()
                : no(state.issuer.acceptsRoot(binding.root) ? "PREFLIGHT_UNAVAILABLE" : "CONFINEMENT");
        }
    }
}
export function createInMemoryPublicationFixture(
    options: InMemoryPublicationFixtureOptions = {}
): InMemoryPublicationFixture {
    return InMemoryPublicationStorage.fixture(options);
}
