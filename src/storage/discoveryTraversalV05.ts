/** Batch-1 immediate read foundation only; no namespace/store traversal or recognition. */
import type {
    RepresentationDirectoryHandle,
    RepresentationFileHandle,
    RepresentationHandleEntry,
    RepresentationReadFailureCode,
    RepresentationReadPort,
} from "./RepresentationStoragePort";
import { INITIAL_DISCOVERY_LIST_LIMIT } from "./discoveryGrammar";
import { isSafeRepresentationLocator } from "./representationLocators";
import { DiscoveryBudgetLedger, type DiscoveryBudgetRefusal } from "./discoveryBudget";

function isArrayValue(value: unknown): boolean {
    return Array.isArray(value);
}

export interface DiscoveryReadFindingV05 {
    readonly code: RepresentationReadFailureCode | "INCONSISTENT_LISTING" | "RESOURCE_PRESSURE";
    /** Fixed S2 diagnostic; provider error text is not retained unboundedly. */
    readonly message: string;
    readonly pressure?: DiscoveryBudgetRefusal;
}
export type ImmediateListingV05 =
    | { readonly status: "COMPLETE"; readonly entries: readonly RepresentationHandleEntry[]; readonly calls: number }
    | {
          readonly status: "INCOMPLETE";
          readonly entries: readonly RepresentationHandleEntry[];
          readonly calls: number;
          readonly finding: DiscoveryReadFindingV05;
      };
export type RawReadObservationV05 =
    | { readonly status: "COMPLETE"; readonly byteLength: number; readonly copyBytes: () => Uint8Array }
    | { readonly status: "INCOMPLETE"; readonly finding: DiscoveryReadFindingV05 };

function failure(code: DiscoveryReadFindingV05["code"]): DiscoveryReadFindingV05 {
    return Object.freeze({ code, message: `S2 read foundation: ${code}.` });
}
function portFailure(code: unknown): DiscoveryReadFindingV05 {
    switch (code) {
        case "NOT_FOUND":
        case "UNAVAILABLE":
        case "UNSUPPORTED":
        case "INVALID_INPUT":
        case "INVALID_LOCATOR":
        case "INVALID_LIMIT":
        case "CONFINEMENT":
            return failure(code);
        default:
            return failure("UNAVAILABLE");
    }
}
function correlated(port: RepresentationReadPort, handle: RepresentationDirectoryHandle | RepresentationFileHandle) {
    return handle && handle.context === port.context && handle.root?.context === port.context;
}

/** Private maps retain exact handle provenance, never diagnostic strings as capability keys. */
export class DiscoveryReadFoundation {
    readonly #lists = new Map<RepresentationDirectoryHandle, Promise<ImmediateListingV05>>();
    readonly #reads = new Map<RepresentationFileHandle, Promise<RawReadObservationV05>>();
    readonly #observedFiles = new Set<RepresentationFileHandle>();
    constructor(
        private readonly port: RepresentationReadPort,
        private readonly boundary: RepresentationDirectoryHandle,
        private readonly scopeId: number,
        private readonly ledger: DiscoveryBudgetLedger
    ) {
        Object.freeze(this);
    }
    #pressure(): DiscoveryReadFindingV05 {
        return Object.freeze({
            code: "RESOURCE_PRESSURE",
            message: "Finite S2 budget refused work.",
            pressure: this.ledger.snapshot().refusal,
        });
    }
    #confined(handle: RepresentationDirectoryHandle | RepresentationFileHandle): boolean {
        return (
            correlated(this.port, handle) &&
            handle.root === this.boundary.root &&
            isSafeRepresentationLocator(handle.locator, handle.kind === "directory") &&
            (handle === this.boundary ||
                !this.boundary.locator ||
                handle.locator.startsWith(`${this.boundary.locator}/`))
        );
    }
    listImmediate(directory: RepresentationDirectoryHandle = this.boundary): Promise<ImmediateListingV05> {
        if (!directory || directory.kind !== "directory" || !this.#confined(directory))
            return Promise.resolve(
                Object.freeze({ status: "INCOMPLETE", entries: [], calls: 0, finding: failure("CONFINEMENT") })
            );
        const cached = this.#lists.get(directory);
        if (cached !== undefined) return cached;
        if (!this.ledger.charge("structuralNodes", 1, this.scopeId))
            return Promise.resolve(
                Object.freeze({
                    status: "INCOMPLETE",
                    entries: Object.freeze([] as RepresentationHandleEntry[]),
                    calls: 0,
                    finding: this.#pressure(),
                })
            );
        const work = this.#list(directory);
        this.#lists.set(directory, work);
        return work;
    }
    async #list(directory: RepresentationDirectoryHandle): Promise<ImmediateListingV05> {
        let entries: readonly RepresentationHandleEntry[] = Object.freeze([] as RepresentationHandleEntry[]);
        let calls = 0;
        const partial = (finding: DiscoveryReadFindingV05): ImmediateListingV05 =>
            Object.freeze({ status: "INCOMPLETE", entries, calls, finding });
        let requested = INITIAL_DISCOVERY_LIST_LIMIT;
        let previous = new Map<string, RepresentationHandleEntry>();
        while (true) {
            const allowance = this.ledger.remaining("listedEntryWork");
            // A truncated result needs strictly more returned capacity than the previous request/evidence.
            const limit = Math.min(requested, allowance);
            if (limit <= 0 || (calls > 0 && limit <= previous.size)) {
                this.ledger.charge("listedEntryWork", previous.size + 1, this.scopeId);
                return partial(this.#pressure());
            }
            if (!this.ledger.charge("listCalls", 1, this.scopeId)) return partial(this.#pressure());
            calls++;
            try {
                const result = await this.port.listChildren(directory, limit);
                if (result.ok === false) return partial(portFailure(result.failure.code));
                const listing = result.value;
                if (
                    !isArrayValue(listing.entries) ||
                    typeof listing.truncated !== "boolean" ||
                    listing.entries.length > limit
                )
                    return partial(failure("INCONSISTENT_LISTING"));
                // Repeated entries across growing calls consume work too.
                if (!this.ledger.charge("listedEntryWork", listing.entries.length, this.scopeId))
                    return partial(this.#pressure());
                const current = new Map<string, RepresentationHandleEntry>();
                for (const entry of listing.entries) {
                    const handle = entry?.handle;
                    const expected = directory.locator ? `${directory.locator}/${entry.name}` : entry.name;
                    if (
                        !entry ||
                        !isSafeRepresentationLocator(entry.name) ||
                        entry.name.includes("/") ||
                        current.has(entry.name) ||
                        (entry.kind !== "file" && entry.kind !== "directory") ||
                        !handle ||
                        handle.kind !== entry.kind ||
                        !correlated(this.port, handle) ||
                        handle.root !== directory.root ||
                        handle.locator !== expected
                    )
                        return partial(failure("INCONSISTENT_LISTING"));
                    const before = previous.get(entry.name);
                    if (
                        before &&
                        (before.kind !== entry.kind ||
                            before.handle.context !== handle.context ||
                            before.handle.root !== handle.root ||
                            before.handle.locator !== handle.locator)
                    )
                        return partial(failure("INCONSISTENT_LISTING"));
                    // Handles may be freshly issued on each call. Preserve the first validated listing handle.
                    current.set(entry.name, before ?? Object.freeze({ ...entry }));
                }
                if ([...previous.keys()].some((name) => !current.has(name)))
                    return partial(failure("INCONSISTENT_LISTING"));
                if (listing.truncated && current.size <= previous.size) return partial(failure("INCONSISTENT_LISTING"));
                for (const [name, entry] of current) {
                    if (entry.kind === "file" && !previous.has(name)) {
                        if (!this.ledger.charge("physicalFiles", 1, this.scopeId)) return partial(this.#pressure());
                        this.#observedFiles.add(entry.handle);
                    }
                }
                entries = Object.freeze(
                    [...current.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
                );
                if (!listing.truncated) return Object.freeze({ status: "COMPLETE", entries, calls });
                previous = current;
                // Checked finite growth: never substitute a maximum-integer/unbounded request.
                const remaining = this.ledger.remaining("listedEntryWork");
                requested = limit > Math.floor(remaining / 2) ? remaining : limit * 2;
            } catch {
                return partial(failure("UNAVAILABLE"));
            }
        }
    }
    readRaw(file: RepresentationFileHandle): Promise<RawReadObservationV05> {
        if (!file || file.kind !== "file" || !this.#confined(file))
            return Promise.resolve(Object.freeze({ status: "INCOMPLETE", finding: failure("CONFINEMENT") }));
        const cached = this.#reads.get(file);
        if (cached !== undefined) return cached;
        if (!this.ledger.charge("readCalls", 1, this.scopeId))
            return Promise.resolve(Object.freeze({ status: "INCOMPLETE", finding: this.#pressure() }));
        const work = this.#read(file);
        this.#reads.set(file, work);
        return work;
    }
    async rawObservations(): Promise<readonly RawReadObservationV05[]> {
        return Object.freeze(await Promise.all([...this.#reads.values()]));
    }
    async #read(file: RepresentationFileHandle): Promise<RawReadObservationV05> {
        const partial = (finding: DiscoveryReadFindingV05): RawReadObservationV05 =>
            Object.freeze({ status: "INCOMPLETE", finding });
        try {
            // S1 validates issued object identity. No reconstructed handle is passed to the port.
            const result = await this.port.readBytes(file);
            if (result.ok === false) return partial(portFailure(result.failure.code));
            if (!(result.value instanceof Uint8Array)) return partial(failure("UNAVAILABLE"));
            const size = result.value.byteLength;
            if (
                !this.ledger.charge("rawBytesRead", size, this.scopeId) ||
                !this.ledger.charge("artifactBytes", size, this.scopeId) ||
                !this.ledger.charge("physicalBytes", size, this.scopeId)
            )
                return partial(this.#pressure());
            if (!this.#observedFiles.has(file)) {
                if (!this.ledger.charge("physicalFiles", 1, this.scopeId)) return partial(this.#pressure());
                this.#observedFiles.add(file);
            }
            // S1 owns this defensive result. Retain it privately; expose only defensive access.
            const owned = result.value;
            return Object.freeze({ status: "COMPLETE", byteLength: size, copyBytes: () => Uint8Array.from(owned) });
        } catch {
            return partial(failure("UNAVAILABLE"));
        }
    }
}

// Batch-2 extension: the accepted immediate read helper above is reused unchanged.
import {
    DISCOVERY_GRAMMAR,
    DISCOVERY_NOMINAL_DIRECTORY_NAMES,
    MAX_DISCOVERY_DIRECTORY_DEPTH,
    allowsValidatedChild,
    type DiscoveryStructuralLevel,
} from "./discoveryGrammar";
import { DISPOSABLE_STORAGE_DIAGNOSTIC_ROOTS } from "./namespace";
import { compareStoreDeclarations, type StoreDeclarationV2 } from "./authorityArtifacts";
import type { StoreId } from "./identity";
import type { ArtifactDigest } from "./canonicalEncoding";
import {
    recognizeNamespaceOrStoreV05,
    type DiscoveryRecognitionV05,
    type TerminalFamilyHintV05,
} from "./discoveryArtifactsV05";
import type { CapturedReadScopeV05, DiscoveryInvocationV05 } from "./discoveryV05";
import type { DiscoveryBudgetSnapshot } from "./discoveryBudget";

export interface DiscoveryRoleStepV05 {
    readonly role: DiscoveryStructuralLevel;
    readonly directory: RepresentationDirectoryHandle;
}
export interface TraversalRawFileV05 {
    readonly scope: CapturedReadScopeV05;
    readonly file: RepresentationFileHandle;
    readonly chain: readonly DiscoveryRoleStepV05[];
    readonly roleEvidence: "NOMINAL_HINT" | "CONTENT_LOOKAHEAD" | "UNRESOLVED_PROBE";
    readonly raw: RawReadObservationV05;
    readonly recognition: DiscoveryRecognitionV05;
}
export interface TraversalFindingV05 {
    readonly scopeId: number;
    readonly directory: RepresentationDirectoryHandle;
    readonly role: DiscoveryStructuralLevel;
    readonly code:
        | "MISSING_NAMESPACE"
        | "MISSING_DECLARATION"
        | "MIXED_STORE_INVALID"
        | "UNRESOLVED_FILE"
        | "UNRESOLVED_DIRECTORY"
        | "UNRESOLVED_STORE_SUBTREE"
        | "READ_INCOMPLETE"
        | "MISPLACED_ARTIFACT";
    readonly blocksAbsence: boolean;
}
export interface RepresentationProbeV05 {
    readonly scope: CapturedReadScopeV05;
    readonly directory: RepresentationDirectoryHandle;
    readonly state: "NAMESPACE_PRESENT" | "STORE_EVIDENCE" | "UNRESOLVED" | "EMPTY_PROBED" | "NON_FK" | "INCOMPLETE";
    readonly namespaceCandidates: readonly TraversalRawFileV05[];
}
export interface StoreBranchFactsV05 {
    readonly scope: CapturedReadScopeV05;
    readonly directory: RepresentationDirectoryHandle;
    readonly declarations: readonly TraversalRawFileV05[];
    readonly storeIds: readonly StoreId[];
    readonly mixedStore: boolean;
}
export interface DeclarationPlanCopiesV05 {
    readonly declaration: StoreDeclarationV2;
    readonly digest: ArtifactDigest;
    readonly supported: boolean;
    readonly copies: readonly TraversalRawFileV05[];
}
export interface StoreDeclarationGroupV05 {
    readonly storeId: StoreId;
    readonly state: "EQUIVALENT" | "CONFLICTING_PLAN";
    readonly plans: readonly DeclarationPlanCopiesV05[];
}
declare const absenceWitnessBrand: unique symbol;
export interface QualifiedStoreBoundAbsenceV05 {
    readonly [absenceWitnessBrand]: true;
    readonly kind: "QUALIFIED_STORE_BOUND_ABSENCE";
    readonly manifest: readonly CapturedReadScopeV05[];
}
export interface TraversalListingV05 {
    readonly scope: CapturedReadScopeV05;
    readonly directory: RepresentationDirectoryHandle;
    readonly role: DiscoveryStructuralLevel;
    readonly outcome: ImmediateListingV05;
}
interface TraversalFactsV05 {
    readonly kind: "S2_V05_NAMESPACE_STORE_TRAVERSAL";
    readonly manifest: readonly CapturedReadScopeV05[];
    readonly coverage: "CONTAINING_BOUNDARIES" | "SUPPLIED_ROOTS_ONLY";
    readonly listings: readonly TraversalListingV05[];
    readonly roots: readonly RepresentationProbeV05[];
    readonly branches: readonly StoreBranchFactsV05[];
    readonly rawFiles: readonly TraversalRawFileV05[];
    readonly findings: readonly TraversalFindingV05[];
    readonly declarationGroups: readonly StoreDeclarationGroupV05[];
    readonly storeIds: readonly StoreId[];
    readonly multipleStoreIds: boolean;
    readonly budget: DiscoveryBudgetSnapshot;
}
export type PhysicalStorageTraversalV05 = TraversalFactsV05 &
    (
        | { readonly status: "COMPLETE"; readonly storeBoundAbsence?: QualifiedStoreBoundAbsenceV05 }
        | { readonly status: "INCOMPLETE"; readonly storeBoundAbsence?: never }
    );

interface ProbeFile {
    readonly handle: RepresentationFileHandle;
    readonly raw: RawReadObservationV05;
    readonly recognition: DiscoveryRecognitionV05;
}
interface RoleProbe {
    readonly scope: CapturedReadScopeV05;
    readonly directory: RepresentationDirectoryHandle;
    readonly role: DiscoveryStructuralLevel;
    readonly chain: readonly DiscoveryRoleStepV05[];
    readonly listing: ImmediateListingV05;
    readonly files: readonly ProbeFile[];
    readonly children: readonly { readonly probe: RoleProbe; readonly nominal: boolean }[];
    readonly complete: boolean;
    readonly positive: boolean;
    readonly structuralHint: boolean;
}
function compareDiscoveryText(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}
function hintForRole(role: DiscoveryStructuralLevel): TerminalFamilyHintV05 {
    switch (role) {
        case "record-kind-collection":
            return "canonical";
        case "recovery-kind-collection":
            return "recovery";
        case "protocol-collection":
            return "fence";
        case "representation-states-collection":
            return "state";
        default:
            return "none";
    }
}
/** Hint matching only; every permissible edge still comes solely from DISCOVERY_GRAMMAR. */
function nominalRole(parent: DiscoveryStructuralLevel, child: DiscoveryStructuralLevel, name: string): boolean {
    const names = DISCOVERY_NOMINAL_DIRECTORY_NAMES;
    const roleHint =
        child === "records-collection"
            ? names.records
            : child === "recovery-collection"
              ? names.recovery
              : child === "meta-collection"
                ? names.meta
                : child === "protocol-collection"
                  ? names.protocol
                  : child === "representation-states-collection"
                    ? names.representationStates
                    : child === "migrations-collection"
                      ? names.migrations
                      : undefined;
    return roleHint !== undefined ? name === roleHint : DISCOVERY_GRAMMAR[parent].nominalChildNames.includes(name);
}

class NamespaceStoreTraversal {
    readonly #raw = new Map<number, Map<RepresentationFileHandle, Promise<ProbeFile>>>();
    readonly #roots: RepresentationProbeV05[] = [];
    readonly #listings: TraversalListingV05[] = [];
    readonly #branches: StoreBranchFactsV05[] = [];
    readonly #files: TraversalRawFileV05[] = [];
    readonly #probedFiles: TraversalRawFileV05[] = [];
    readonly #findings: TraversalFindingV05[] = [];
    #incomplete = false;
    constructor(private readonly invocation: DiscoveryInvocationV05) {}
    #work(scope: CapturedReadScopeV05, amount = 1): boolean {
        const accepted = this.invocation.chargeWork("graphWork", amount, scope.scopeId);
        if (!accepted) this.#incomplete = true;
        return accepted;
    }
    async #read(scope: CapturedReadScopeV05, handle: RepresentationFileHandle): Promise<ProbeFile> {
        const scoped = this.#raw.get(scope.scopeId) ?? new Map<RepresentationFileHandle, Promise<ProbeFile>>();
        this.#raw.set(scope.scopeId, scoped);
        const existing = scoped.get(handle);
        if (existing !== undefined) return existing;
        const pending = (async () => {
            const raw = await this.invocation.reader(scope.scopeId).readRaw(handle);
            const recognition = await recognizeNamespaceOrStoreV05(raw, (axis, amount) =>
                this.invocation.chargeWork(axis, amount, scope.scopeId)
            );
            if (raw.status === "INCOMPLETE" || recognition.status === "INCOMPLETE") this.#incomplete = true;
            return Object.freeze({ handle, raw, recognition });
        })();
        scoped.set(handle, pending);
        return pending;
    }
    async #probe(
        scope: CapturedReadScopeV05,
        directory: RepresentationDirectoryHandle,
        role: DiscoveryStructuralLevel,
        ancestors: readonly DiscoveryRoleStepV05[],
        nominalEntry = false
    ): Promise<RoleProbe | undefined> {
        if (!this.#work(scope)) return undefined;
        const chain = Object.freeze([...ancestors, Object.freeze({ role, directory })]);
        // Entry representation-root starts at depth1 even without its containing boundary supplied.
        const depth = chain.length - (scope.entryRole === "vault-root" ? 1 : 0);
        if (depth > MAX_DISCOVERY_DIRECTORY_DEPTH) throw new Error("Existing grammar exceeded directory depth.");
        const listing = await this.invocation.reader(scope.scopeId).listImmediate(directory);
        this.#listings.push(Object.freeze({ scope, directory, role, outcome: listing }));
        if (listing.status === "INCOMPLETE") this.#incomplete = true;
        const files: ProbeFile[] = [];
        const children: { probe: RoleProbe; nominal: boolean }[] = [];
        const deferredMigrations: RepresentationDirectoryHandle[] = [];
        let positive = false,
            structuralHint = false;
        for (const entry of listing.entries) {
            if (!this.#work(scope)) break;
            if (entry.kind === "file") {
                if (role === "vault-root") continue;
                if (
                    (role === "representation-root" || role === "store-subtree") &&
                    !entry.name.toLowerCase().endsWith(".json")
                )
                    continue;
                const file = await this.#read(scope, entry.handle);
                files.push(file);
                // Already metered probe evidence survives later refusal, even before role projection.
                this.#probedFiles.push(
                    Object.freeze({
                        scope,
                        file: file.handle,
                        chain,
                        roleEvidence: "UNRESOLVED_PROBE",
                        raw: file.raw,
                        recognition: file.recognition,
                    })
                );
                const r = file.recognition;
                if (
                    ((role === "representation-root" || role === "store-subtree") &&
                        (r.family !== "unknown" || r.hint !== "none" || r.status === "UNSUPPORTED")) ||
                    (hintForRole(role) !== "none" && r.hint === hintForRole(role))
                )
                    positive = true;
                if (
                    (role === "representation-root" && entry.name === "namespace.json") ||
                    (role === "store-subtree" && entry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.storeManifest)
                )
                    structuralHint = true;
                continue;
            }
            if (
                role === "vault-root" &&
                (DISPOSABLE_STORAGE_DIAGNOSTIC_ROOTS as readonly string[]).includes(entry.name)
            )
                continue;
            for (const childRole of DISCOVERY_GRAMMAR[role].validatedChildren) {
                if (!allowsValidatedChild(role, childRole)) throw new Error("Undeclared discovery edge.");
                if (role === "meta-collection" && childRole === "migrations-collection") {
                    deferredMigrations.push(entry.handle);
                    continue;
                }
                const nominal = nominalRole(role, childRole, entry.name);
                const child = await this.#probe(scope, entry.handle, childRole, chain, nominal);
                if (!child) break;
                children.push({ probe: child, nominal });
                positive ||= child.positive;
                // Structural hints retain unresolved declarationless context, never supply identity.
                if (role === "store-subtree" && nominal) structuralHint = true;
                structuralHint ||= child.structuralHint;
            }
        }
        // Opaque migration descent needs a reached meta context. Negative role probes cannot
        // reinterpret a known record/protocol terminal's unknown child as recursive permission.
        if (role === "meta-collection" && (nominalEntry || positive))
            for (const handle of deferredMigrations) {
                const name = handle.locator.split("/").pop() ?? "";
                const knownOtherTerminal =
                    nominalRole(role, "protocol-collection", name) ||
                    nominalRole(role, "representation-states-collection", name) ||
                    children.some((child) => child.probe.directory === handle && child.probe.positive);
                if (knownOtherTerminal) continue;
                const child = await this.#probe(
                    scope,
                    handle,
                    "migrations-collection",
                    chain,
                    nominalRole(role, "migrations-collection", name)
                );
                if (child) children.push({ probe: child, nominal: nominalRole(role, "migrations-collection", name) });
            }
        return {
            scope,
            directory,
            role,
            chain,
            listing,
            files,
            children,
            complete:
                listing.status === "COMPLETE" &&
                !this.invocation.budget().refusal &&
                files.every((file) => file.raw.status === "COMPLETE" && file.recognition.status !== "INCOMPLETE") &&
                children.every((child) => child.probe.complete),
            positive,
            structuralHint,
        };
    }
    #finding(probe: RoleProbe, code: TraversalFindingV05["code"], blocksAbsence = true) {
        this.#findings.push(
            Object.freeze({
                scopeId: probe.scope.scopeId,
                directory: probe.directory,
                role: probe.role,
                code,
                blocksAbsence,
            })
        );
    }
    #retain(probe: RoleProbe, file: ProbeFile, roleEvidence: TraversalRawFileV05["roleEvidence"]): TraversalRawFileV05 {
        const observation = Object.freeze({
            scope: probe.scope,
            file: file.handle,
            chain: probe.chain,
            roleEvidence,
            raw: file.raw,
            recognition: file.recognition,
        });
        this.#files.push(observation);
        return observation;
    }
    #emit(probe: RoleProbe, evidence: TraversalRawFileV05["roleEvidence"]) {
        if (!this.#work(probe.scope)) return;
        if (!probe.complete) this.#finding(probe, "READ_INCOMPLETE");
        const declarations: TraversalRawFileV05[] = [];
        for (const file of probe.files) {
            if (!this.#work(probe.scope)) break;
            const observation = this.#retain(probe, file, evidence);
            const r = file.recognition;
            if (probe.role === "store-subtree" && r.family === "store-declaration") declarations.push(observation);
            if (file.raw.status === "INCOMPLETE" || r.status === "INCOMPLETE") this.#finding(probe, "READ_INCOMPLETE");
            else if (
                !(
                    (probe.role === "representation-root" && r.family === "namespace" && r.status === "VALID") ||
                    (probe.role === "store-subtree" && r.family === "store-declaration" && r.status === "VALID")
                )
            )
                this.#finding(
                    probe,
                    r.family !== "unknown" &&
                        !(
                            (probe.role === "representation-root" && r.family === "namespace") ||
                            (probe.role === "store-subtree" && r.family === "store-declaration")
                        )
                        ? "MISPLACED_ARTIFACT"
                        : "UNRESOLVED_FILE"
                );
        }
        const readHandles = new Set(probe.files.map((file) => file.handle));
        for (const entry of probe.listing.entries) {
            if (entry.kind === "file" && !readHandles.has(entry.handle)) this.#finding(probe, "UNRESOLVED_FILE");
        }
        if (probe.role === "store-subtree") {
            const storeIds = [
                ...new Set(
                    declarations.flatMap((d) =>
                        d.recognition.family === "store-declaration" && d.recognition.status === "VALID"
                            ? [d.recognition.value.storeId]
                            : []
                    )
                ),
            ].sort(compareDiscoveryText);
            this.#branches.push(
                Object.freeze({
                    scope: probe.scope,
                    directory: probe.directory,
                    declarations: Object.freeze(declarations),
                    storeIds: Object.freeze(storeIds),
                    mixedStore: storeIds.length > 1,
                })
            );
            if (storeIds.length > 1) this.#finding(probe, "MIXED_STORE_INVALID");
            if (!storeIds.length) this.#finding(probe, "MISSING_DECLARATION");
            if (!probe.files.length && !probe.children.length) this.#finding(probe, "UNRESOLVED_STORE_SUBTREE");
        }
        const selected = new Set<RepresentationDirectoryHandle>();
        for (const child of probe.children) {
            if (!this.#work(probe.scope)) break;
            const unconditionalCandidate =
                probe.role === "stores-collection" ||
                probe.role === "records-collection" ||
                probe.role === "recovery-collection" ||
                probe.role === "migrations-collection";
            if (child.nominal || child.probe.positive || child.probe.structuralHint || unconditionalCandidate) {
                selected.add(child.probe.directory);
                this.#emit(
                    child.probe,
                    child.nominal ? "NOMINAL_HINT" : child.probe.positive ? "CONTENT_LOOKAHEAD" : "UNRESOLVED_PROBE"
                );
            }
        }
        for (const entry of probe.listing.entries) {
            if (entry.kind === "directory" && !selected.has(entry.handle)) {
                this.#finding(probe, "UNRESOLVED_DIRECTORY");
                // Preserve failed/unknown lookahead bytes with explicitly provisional role provenance.
                for (const child of probe.children.filter((child) => child.probe.directory === entry.handle))
                    this.#retainUnresolved(child.probe);
            }
        }
    }
    #retainUnresolved(probe: RoleProbe) {
        if (!this.#work(probe.scope)) return;
        for (const file of probe.files) {
            if (!this.#work(probe.scope)) break;
            this.#retain(probe, file, "UNRESOLVED_PROBE");
        }
        for (const child of probe.children) this.#retainUnresolved(child.probe);
    }
    #root(probe: RoleProbe, nominal: boolean) {
        const namespaceFiles = probe.files.filter(
            (file) =>
                file.recognition.family === "namespace" ||
                file.handle.locator.endsWith("/namespace.json") ||
                file.handle.locator === "namespace.json"
        );
        const hasMarker = namespaceFiles.some(
            (file) => file.recognition.family === "namespace" && file.recognition.status === "VALID"
        );
        const relevant = nominal || probe.positive || probe.structuralHint;
        const initialFindingCount = this.#findings.length;
        const initialFileCount = this.#files.length;
        if (relevant || !probe.complete) {
            this.#emit(probe, nominal ? "NOMINAL_HINT" : "CONTENT_LOOKAHEAD");
            if (!hasMarker) this.#finding(probe, "MISSING_NAMESPACE", probe.positive || probe.structuralHint);
        }
        const blocking = this.#findings.slice(initialFindingCount).some((f) => f.blocksAbsence);
        const state: RepresentationProbeV05["state"] =
            !probe.complete || this.invocation.budget().refusal
                ? "INCOMPLETE"
                : blocking
                  ? "UNRESOLVED"
                  : hasMarker
                    ? "NAMESPACE_PRESENT"
                    : probe.positive
                      ? "STORE_EVIDENCE"
                      : relevant
                        ? "EMPTY_PROBED"
                        : "NON_FK";
        const candidates = this.#files
            .slice(initialFileCount)
            .filter(
                (file) =>
                    file.chain[file.chain.length - 1].role === "representation-root" &&
                    namespaceFiles.some((candidate) => candidate.handle === file.file)
            );
        this.#roots.push(
            Object.freeze({
                scope: probe.scope,
                directory: probe.directory,
                state,
                namespaceCandidates: Object.freeze(candidates),
            })
        );
    }
    #groupDeclarations(): readonly StoreDeclarationGroupV05[] {
        const byStore = new Map<
            StoreId,
            {
                declaration: StoreDeclarationV2;
                digest: ArtifactDigest;
                supported: boolean;
                copies: TraversalRawFileV05[];
            }[]
        >();
        for (const branch of this.#branches)
            for (const copy of branch.declarations) {
                const r = copy.recognition;
                if (r.family !== "store-declaration" || r.status !== "VALID") continue;
                if (!this.#work(copy.scope)) break;
                const plans = byStore.get(r.value.storeId) ?? [];
                let equivalent: (typeof plans)[number] | undefined;
                for (const plan of plans) {
                    if (!this.#work(copy.scope)) break;
                    if (compareStoreDeclarations(plan.declaration, r.value) === "EQUIVALENT") {
                        equivalent = plan;
                        break;
                    }
                }
                if (this.invocation.budget().refusal) break;
                if (equivalent) equivalent.copies.push(copy);
                else plans.push({ declaration: r.value, digest: r.digest, supported: r.supported, copies: [copy] });
                byStore.set(r.value.storeId, plans);
            }
        return Object.freeze(
            [...byStore]
                .sort(([a], [b]) => compareDiscoveryText(a, b))
                .map(([storeId, plans]) =>
                    Object.freeze({
                        storeId,
                        state: plans.length > 1 ? ("CONFLICTING_PLAN" as const) : ("EQUIVALENT" as const),
                        plans: Object.freeze(
                            plans
                                .sort((a, b) => compareDiscoveryText(a.digest, b.digest))
                                .map((plan) => Object.freeze({ ...plan, copies: Object.freeze(plan.copies) }))
                        ),
                    })
                )
        );
    }
    async run(): Promise<PhysicalStorageTraversalV05> {
        for (const scope of this.invocation.manifest) {
            if (scope.entryRole === "representation-root") {
                const probe = await this.#probe(scope, scope.directory, "representation-root", []);
                if (probe) this.#root(probe, false);
                continue;
            }
            const listing = await this.invocation.reader(scope.scopeId).listImmediate();
            this.#listings.push(
                Object.freeze({ scope, directory: scope.directory, role: "vault-root", outcome: listing })
            );
            if (listing.status === "INCOMPLETE") this.#incomplete = true;
            for (const entry of listing.entries) {
                if (
                    entry.kind !== "directory" ||
                    (DISPOSABLE_STORAGE_DIAGNOSTIC_ROOTS as readonly string[]).includes(entry.name)
                )
                    continue;
                const probe = await this.#probe(scope, entry.handle, "representation-root", [
                    Object.freeze({ role: "vault-root", directory: scope.directory }),
                ]);
                if (probe) this.#root(probe, DISCOVERY_GRAMMAR["vault-root"].nominalChildNames.includes(entry.name));
                if (this.invocation.budget().refusal) break;
            }
        }
        const declarationGroups = this.#groupDeclarations();
        // The exhaustive observed union comes from every valid branch declaration, not a classifier's first result.
        const storeIds = Object.freeze(
            [
                ...new Set(
                    this.#probedFiles.flatMap((file) =>
                        file.chain[file.chain.length - 1].role === "store-subtree" &&
                        file.recognition.family === "store-declaration" &&
                        file.recognition.status === "VALID"
                            ? [file.recognition.value.storeId]
                            : []
                    )
                ),
            ].sort(compareDiscoveryText)
        );
        const coverage = this.invocation.manifest.every((scope) => scope.entryRole === "vault-root")
            ? ("CONTAINING_BOUNDARIES" as const)
            : ("SUPPLIED_ROOTS_ONLY" as const);
        const facts: TraversalFactsV05 = Object.freeze({
            kind: "S2_V05_NAMESPACE_STORE_TRAVERSAL",
            manifest: this.invocation.manifest,
            coverage,
            roots: Object.freeze(this.#roots),
            listings: Object.freeze(this.#listings),
            branches: Object.freeze(this.#branches),
            rawFiles: Object.freeze(
                this.#incomplete || this.invocation.budget().refusal ? this.#probedFiles : this.#files
            ),
            findings: Object.freeze(this.#findings),
            declarationGroups,
            storeIds,
            multipleStoreIds: storeIds.length > 1,
            budget: this.invocation.budget(),
        });
        if (this.#incomplete || facts.budget.refusal) return Object.freeze({ ...facts, status: "INCOMPLETE" });
        const negative =
            coverage === "CONTAINING_BOUNDARIES" &&
            storeIds.length === 0 &&
            !facts.findings.some((finding) => finding.blocksAbsence);
        const witness = negative
            ? (Object.freeze({
                  kind: "QUALIFIED_STORE_BOUND_ABSENCE",
                  manifest: facts.manifest,
              }) as QualifiedStoreBoundAbsenceV05)
            : undefined;
        return Object.freeze({ ...facts, status: "COMPLETE", ...(witness ? { storeBoundAbsence: witness } : {}) });
    }
}
/** Finite grammar lookahead only; host-independent, no canonical/recovery semantic admission. */
export function traverseNamespaceStoresV05(invocation: DiscoveryInvocationV05): Promise<PhysicalStorageTraversalV05> {
    return new NamespaceStoreTraversal(invocation).run();
}
