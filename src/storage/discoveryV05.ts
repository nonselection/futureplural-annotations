/** Normative S2 v0.5 Batch-1 surface. Completely unwired from runtime and S3. */
import type { RepresentationDirectoryHandle, RepresentationReadPort } from "./RepresentationStoragePort";
import type { DiscoveryStructuralLevel } from "./discoveryGrammar";
import {
    DiscoveryBudgetLedger,
    type DiscoveryBudgetSnapshot,
    type DiscoveryLimitsV05,
    type DiscoveryTraversalWorkLimitsV05,
    type DiscoveryBudgetAxis,
    type DiscoveryEvidenceLimitsV05,
    type DiscoveryAggregateLimitsV05,
    snapshotTraversalWorkLimits,
} from "./discoveryBudget";
import {
    DiscoveryReadFoundation,
    type ImmediateListingV05,
    type RawReadObservationV05,
    traverseNamespaceStoresV05,
    type PhysicalStorageTraversalV05,
} from "./discoveryTraversalV05";

function isArrayValue(value: unknown): boolean {
    return Array.isArray(value);
}

export type DiscoveryEntryRoleV05 = Extract<DiscoveryStructuralLevel, "vault-root" | "representation-root">;
export interface DiscoveryReadScopeV05 {
    readonly port: RepresentationReadPort;
    readonly directory: RepresentationDirectoryHandle;
    readonly entryRole: DiscoveryEntryRoleV05;
}
export interface DiscoveryInputV05 {
    readonly scopes: readonly DiscoveryReadScopeV05[];
    readonly limits: DiscoveryLimitsV05;
}
export interface CapturedReadScopeV05 extends DiscoveryReadScopeV05 {
    /** Invocation-local identity only; never store identity/priority/authority. */
    readonly scopeId: number;
}
export interface FoundationScopeObservationV05 {
    readonly scope: CapturedReadScopeV05;
    readonly listing: ImmediateListingV05;
    readonly rawReads: readonly RawReadObservationV05[];
}
interface FoundationResultFactsV05 {
    readonly kind: "S2_V05_READ_FOUNDATION";
    readonly manifest: readonly CapturedReadScopeV05[];
    readonly budget: DiscoveryBudgetSnapshot;
}
/** COMPLETE covers supplied immediate boundaries and already requested raw observations only.
 * It never means repository completeness/absence or a transactional snapshot. */
export interface CompleteFoundationScopeObservationV05 {
    readonly scope: CapturedReadScopeV05;
    readonly listing: Extract<ImmediateListingV05, { status: "COMPLETE" }>;
    readonly rawReads: readonly Extract<RawReadObservationV05, { status: "COMPLETE" }>[];
}
export type DiscoveryFoundationResultV05 = FoundationResultFactsV05 &
    (
        | { readonly status: "COMPLETE"; readonly observations: readonly CompleteFoundationScopeObservationV05[] }
        | { readonly status: "INCOMPLETE"; readonly observations: readonly FoundationScopeObservationV05[] }
    );
function completeScope(
    observation: FoundationScopeObservationV05
): observation is CompleteFoundationScopeObservationV05 {
    return (
        observation.listing.status === "COMPLETE" && observation.rawReads.every((read) => read.status === "COMPLETE")
    );
}

export class DiscoveryInvocationV05 {
    readonly manifest: readonly CapturedReadScopeV05[];
    readonly #ledger: DiscoveryBudgetLedger;
    readonly #readers: readonly DiscoveryReadFoundation[];
    constructor(
        input: DiscoveryInputV05,
        workLimits?: DiscoveryTraversalWorkLimitsV05,
        evidenceLimits?: DiscoveryEvidenceLimitsV05,
        aggregateLimits?: DiscoveryAggregateLimitsV05
    ) {
        // Snapshot everything before the first await; opaque capabilities remain the original objects.
        this.#ledger = new DiscoveryBudgetLedger(input?.limits, workLimits, evidenceLimits, aggregateLimits);
        if (!isArrayValue(input?.scopes) || input.scopes.length === 0)
            throw new Error("Nonempty read scopes required.");
        const scopes: CapturedReadScopeV05[] = [];
        // Reject oversized supplied manifests before allocating a copy; duplicates do not waive work limits.
        if (!this.#ledger.charge("readScopes", input.scopes.length, 0))
            throw new Error("Read-scope budget refused manifest.");
        for (const supplied of input.scopes) {
            const { port, directory, entryRole } = supplied ?? {};
            if (
                !port ||
                !port.context ||
                typeof port.listChildren !== "function" ||
                typeof port.readBytes !== "function" ||
                !directory ||
                directory.kind !== "directory" ||
                directory.context !== port.context ||
                directory.root?.context !== port.context ||
                (entryRole !== "vault-root" && entryRole !== "representation-root")
            )
                throw new Error("Invalid correlated read-scope manifest.");
            // Reject an exact repeated scope/boundary; never count it as another physical copy.
            if (scopes.some((scope) => scope.port.context === port.context && scope.directory === directory))
                throw new Error("Duplicate read-scope boundary.");
            scopes.push(Object.freeze({ port, directory, entryRole, scopeId: scopes.length }));
        }
        this.manifest = Object.freeze(scopes);
        this.#readers = Object.freeze(
            scopes.map((scope) => new DiscoveryReadFoundation(scope.port, scope.directory, scope.scopeId, this.#ledger))
        );
        Object.freeze(this);
    }
    reader(scopeId: number): DiscoveryReadFoundation {
        if (!Number.isSafeInteger(scopeId) || scopeId < 0 || scopeId >= this.#readers.length)
            throw new Error("Unknown read scope.");
        return this.#readers[scopeId];
    }
    /** Additive traversal work charges use the same accepted invocation ledger. */
    chargeWork(axis: DiscoveryBudgetAxis, amount: number, scopeId: number): boolean {
        this.reader(scopeId);
        return this.#ledger.charge(axis, amount, scopeId);
    }
    budget(): DiscoveryBudgetSnapshot {
        return this.#ledger.snapshot();
    }
    async observeImmediateBoundaries(): Promise<DiscoveryFoundationResultV05> {
        const observations: FoundationScopeObservationV05[] = [];
        for (const scope of this.manifest) {
            observations.push(
                Object.freeze({
                    scope,
                    listing: await this.reader(scope.scopeId).listImmediate(),
                    rawReads: await this.reader(scope.scopeId).rawObservations(),
                })
            );
        }
        const facts = { kind: "S2_V05_READ_FOUNDATION" as const, manifest: this.manifest, budget: this.budget() };
        if (facts.budget.refusal || !observations.every(completeScope))
            return Object.freeze({ ...facts, status: "INCOMPLETE", observations: Object.freeze(observations) });
        return Object.freeze({ ...facts, status: "COMPLETE", observations: Object.freeze(observations) });
    }
}
export function discoverReadFoundationV05(input: DiscoveryInputV05): Promise<DiscoveryFoundationResultV05> {
    return new DiscoveryInvocationV05(input).observeImmediateBoundaries();
}

export interface DiscoveryTraversalInputV05 extends DiscoveryInputV05 {
    readonly limits: DiscoveryLimitsV05 & DiscoveryTraversalWorkLimitsV05;
}
export function discoverPhysicalStorageTreeV05(
    input: DiscoveryTraversalInputV05
): Promise<PhysicalStorageTraversalV05> {
    const work = snapshotTraversalWorkLimits(input?.limits);
    return traverseNamespaceStoresV05(new DiscoveryInvocationV05(input, work));
}
