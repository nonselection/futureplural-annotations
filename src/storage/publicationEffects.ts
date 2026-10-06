/** Host-dispatch facts only; no durability, head, health or mutation-authorization claim. */
export type PhysicalEffect = "NO_MUTATION_DISPATCHED" | "DISPATCH_REPORTED_SUCCESS" | "DISPATCH_OUTCOME_UNKNOWN";

/** A per-execution observation assertion; NOT_ESTABLISHED does not mean absence. */
export type CanonicalObservation = "EXACT_CANDIDATE" | "NOT_ESTABLISHED";

export function isPhysicalEffect(value: unknown): value is PhysicalEffect {
    return (
        value === "NO_MUTATION_DISPATCHED" ||
        value === "DISPATCH_REPORTED_SUCCESS" ||
        value === "DISPATCH_OUTCOME_UNKNOWN"
    );
}

export function isCanonicalObservation(value: unknown): value is CanonicalObservation {
    return value === "EXACT_CANDIDATE" || value === "NOT_ESTABLISHED";
}
