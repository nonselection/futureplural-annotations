/** One finite, invocation-local S2 work/admission owner. No release defaults. */
export const DISCOVERY_BUDGET_AXES = [
    "readScopes",
    "structuralNodes",
    "listCalls",
    "listedEntryWork",
    "readCalls",
    "physicalFiles",
    "rawBytesRead",
    "physicalBytes",
    "artifactBytes",
] as const;
export type DiscoveryFoundationBudgetAxis = (typeof DISCOVERY_BUDGET_AXES)[number];
/** Additive Batch-2 work axes; the accepted Batch-1 nine-field profile is unchanged. */
export const DISCOVERY_TRAVERSAL_WORK_AXES = ["decodedBytes", "decodeHashByteWork", "graphWork"] as const;
export type DiscoveryTraversalWorkAxis = (typeof DISCOVERY_TRAVERSAL_WORK_AXES)[number];
export type DiscoveryTraversalWorkLimitsV05 = Readonly<Record<DiscoveryTraversalWorkAxis, number>>;
export const DISCOVERY_EVIDENCE_AXES = [
    "recoveryExecutions",
    "completeClaims",
    "identityReferences",
    "recordPayloadBytes",
] as const;
export type DiscoveryEvidenceAxis = (typeof DISCOVERY_EVIDENCE_AXES)[number];
export type DiscoveryEvidenceLimitsV05 = Readonly<Record<DiscoveryEvidenceAxis, number>>;
export const DISCOVERY_AGGREGATE_AXES = [
    "stores",
    "records",
    "distinctRevisions",
    "parentEdges",
    "ordinaryHeads",
    "representationStates",
    "resolutionWork",
    "representationLineageWork",
] as const;
export type DiscoveryAggregateAxis = (typeof DISCOVERY_AGGREGATE_AXES)[number];
export type DiscoveryAggregateLimitsV05 = Readonly<Record<DiscoveryAggregateAxis, number>>;
export type DiscoveryBudgetAxis =
    | DiscoveryFoundationBudgetAxis
    | DiscoveryTraversalWorkAxis
    | DiscoveryEvidenceAxis
    | DiscoveryAggregateAxis;
export type DiscoveryBudgetUsageV05 = DiscoveryLimitsV05 &
    Partial<DiscoveryTraversalWorkLimitsV05 & DiscoveryEvidenceLimitsV05 & DiscoveryAggregateLimitsV05>;
/** artifactBytes is a per-observation maximum; other axes are cumulative. */
export type DiscoveryLimitsV05 = Readonly<Record<DiscoveryFoundationBudgetAxis, number>>;
export interface DiscoveryBudgetRefusal {
    readonly axis: DiscoveryBudgetAxis;
    readonly limit: number;
    readonly current: number;
    readonly attempted: number;
    readonly scopeId: number;
    readonly reason: "LIMIT" | "OVERFLOW" | "INVALID_AMOUNT";
}
export interface DiscoveryBudgetSnapshot {
    readonly limits: DiscoveryBudgetUsageV05;
    readonly consumed: DiscoveryBudgetUsageV05;
    /** At most the first refusing event; never an unbounded diagnostic log. */
    readonly refusal?: DiscoveryBudgetRefusal;
}
export function snapshotDiscoveryLimits(input: DiscoveryLimitsV05): DiscoveryLimitsV05 {
    if (!input || typeof input !== "object") throw new Error("Complete finite discovery limits required.");
    const limits = {} as Record<DiscoveryFoundationBudgetAxis, number>;
    for (const axis of DISCOVERY_BUDGET_AXES) {
        const value = input[axis];
        if (!Object.prototype.hasOwnProperty.call(input, axis) || !Number.isSafeInteger(value) || value < 0)
            throw new Error(`Invalid finite discovery limit: ${axis}.`);
        limits[axis] = value;
    }
    return Object.freeze(limits);
}
export function snapshotTraversalWorkLimits(input: DiscoveryTraversalWorkLimitsV05): DiscoveryTraversalWorkLimitsV05 {
    if (!input || typeof input !== "object") throw new Error("Complete finite traversal work limits required.");
    const limits = {} as Record<DiscoveryTraversalWorkAxis, number>;
    for (const axis of DISCOVERY_TRAVERSAL_WORK_AXES) {
        const value = input[axis];
        if (!Object.prototype.hasOwnProperty.call(input, axis) || !Number.isSafeInteger(value) || value < 0)
            throw new Error(`Invalid finite traversal work limit: ${axis}.`);
        limits[axis] = value;
    }
    return Object.freeze(limits);
}
export function snapshotEvidenceLimits(input: DiscoveryEvidenceLimitsV05): DiscoveryEvidenceLimitsV05 {
    if (!input || typeof input !== "object") throw new Error("Complete finite evidence limits required.");
    const limits = {} as Record<DiscoveryEvidenceAxis, number>;
    for (const axis of DISCOVERY_EVIDENCE_AXES) {
        const value = input[axis];
        if (!Object.prototype.hasOwnProperty.call(input, axis) || !Number.isSafeInteger(value) || value < 0)
            throw new Error(`Invalid finite evidence limit: ${axis}.`);
        limits[axis] = value;
    }
    return Object.freeze(limits);
}
export function snapshotAggregateLimits(input: DiscoveryAggregateLimitsV05): DiscoveryAggregateLimitsV05 {
    if (!input || typeof input !== "object") throw new Error("Complete finite aggregate limits required.");
    const limits = {} as Record<DiscoveryAggregateAxis, number>;
    for (const axis of DISCOVERY_AGGREGATE_AXES) {
        const value = input[axis];
        if (!Object.prototype.hasOwnProperty.call(input, axis) || !Number.isSafeInteger(value) || value < 0)
            throw new Error(`Invalid finite aggregate limit: ${axis}.`);
        limits[axis] = value;
    }
    return Object.freeze(limits);
}
export class DiscoveryBudgetLedger {
    readonly #limits: DiscoveryBudgetUsageV05;
    readonly #consumed = {} as Record<DiscoveryBudgetAxis, number>;
    #refusal?: DiscoveryBudgetRefusal;
    constructor(
        limits: DiscoveryLimitsV05,
        workLimits?: DiscoveryTraversalWorkLimitsV05,
        evidenceLimits?: DiscoveryEvidenceLimitsV05,
        aggregateLimits?: DiscoveryAggregateLimitsV05
    ) {
        const base = snapshotDiscoveryLimits(limits);
        this.#limits =
            workLimits === undefined ? base : Object.freeze({ ...base, ...snapshotTraversalWorkLimits(workLimits) });
        if (evidenceLimits !== undefined)
            this.#limits = Object.freeze({ ...this.#limits, ...snapshotEvidenceLimits(evidenceLimits) });
        if (aggregateLimits !== undefined)
            this.#limits = Object.freeze({ ...this.#limits, ...snapshotAggregateLimits(aggregateLimits) });
        for (const axis of DISCOVERY_BUDGET_AXES) this.#consumed[axis] = 0;
        if (workLimits !== undefined) for (const axis of DISCOVERY_TRAVERSAL_WORK_AXES) this.#consumed[axis] = 0;
        if (evidenceLimits !== undefined) for (const axis of DISCOVERY_EVIDENCE_AXES) this.#consumed[axis] = 0;
        if (aggregateLimits !== undefined) for (const axis of DISCOVERY_AGGREGATE_AXES) this.#consumed[axis] = 0;
    }
    remaining(axis: DiscoveryBudgetAxis): number {
        const limit = this.#limits[axis];
        if (limit === undefined) throw new Error(`Unconfigured discovery budget axis: ${axis}.`);
        return limit - this.#consumed[axis];
    }
    /** Charge before dispatch/processing when cost is knowable. Refusal is sticky. */
    charge(axis: DiscoveryBudgetAxis, amount: number, scopeId: number): boolean {
        if (this.#refusal) return false;
        const limit = this.#limits[axis];
        if (limit === undefined) throw new Error(`Unconfigured discovery budget axis: ${axis}.`);
        const current = this.#consumed[axis];
        const attempted =
            axis === "artifactBytes" || axis === "recordPayloadBytes" ? Math.max(current, amount) : current + amount;
        const reason =
            !Number.isSafeInteger(amount) || amount < 0
                ? "INVALID_AMOUNT"
                : !Number.isSafeInteger(attempted)
                  ? "OVERFLOW"
                  : attempted > limit
                    ? "LIMIT"
                    : undefined;
        if (reason) {
            this.#refusal = Object.freeze({ axis, limit, current, attempted, scopeId, reason });
            return false;
        }
        this.#consumed[axis] = attempted;
        return true;
    }
    snapshot(): DiscoveryBudgetSnapshot {
        return Object.freeze({
            limits: this.#limits,
            consumed: Object.freeze({ ...this.#consumed }),
            ...(this.#refusal ? { refusal: this.#refusal } : {}),
        });
    }
}
