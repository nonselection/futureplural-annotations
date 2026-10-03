import { sha256Bytes, type CanonicalDigest } from "./canonicalEncoding";
import type { CanonicalRecordCodec } from "./envelopes";
import type { StoreId } from "./identity";
import type { RepresentationStoragePort, RepresentationStorageResult } from "./RepresentationStoragePort";
import { aggregateStructuralDiscovery, type StructuralDiscoverySemantics } from "./discoverySemantics";
import { discoverPhysicalStorageTree, type StructuralDiscoverySnapshot } from "./discoveryTraversal";
import { recognizeRecoveryArtifactBytes } from "./recoveryArtifacts";
import { authorizeWrite, type WriteAuthorization } from "./writeAuthorization";
import type { QualifiedRecordLineage } from "./recoverySemantics";

/** Maintenance targets only, not production defaults or authority constraints. */
export interface RecoveryRetentionPolicy {
    readonly maxMutationCount?: number;
    readonly maxBytes?: number;
}
export interface RecoveryRetentionRequest {
    readonly port: RepresentationStoragePort;
    readonly storeId: StoreId;
    readonly codecs: readonly CanonicalRecordCodec[];
    readonly supportedProtocolVersion: number;
    readonly policy?: unknown;
}
export interface RecoveryRetentionResult {
    readonly state:
        | "DISABLED"
        | "INVALID_POLICY"
        | "BLOCKED"
        | "NOTHING_ELIGIBLE"
        | "COMPLETED"
        | "BUDGET_PROTECTED"
        | "GUARD_REJECTED"
        | "IO_UNCERTAIN";
    readonly deletedLocators: readonly string[];
    readonly remainingMutationCount: number;
    readonly remainingBytes: number;
    /** Counts/bytes are observed accounting, not proof of absence when discovery is blocked. */
    readonly accountingComplete: boolean;
    readonly budgetSatisfied: boolean;
    readonly aggregate: StructuralDiscoverySemantics;
    readonly authorization: WriteAuthorization;
    readonly reason?: string;
}
function policyValue(value: unknown): RecoveryRetentionPolicy | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const row = value as Record<string, unknown>;
    const keys = Object.keys(row);
    if (!keys.length || keys.some((key) => key !== "maxMutationCount" && key !== "maxBytes")) return undefined;
    if (keys.some((key) => !Number.isSafeInteger(row[key]) || (row[key] as number) < 0)) return undefined;
    return row;
}
function without(snapshot: StructuralDiscoverySnapshot, removed: ReadonlySet<string>): StructuralDiscoverySnapshot {
    // A read-only hypothetical removal from already bounded observations. No discovery grammar changes.
    return {
        ...snapshot,
        artifacts: snapshot.artifacts.filter((row) => !removed.has(row.locator)),
        storeCandidates: snapshot.storeCandidates.map((candidate) => ({
            ...candidate,
            artifactObservations: candidate.artifactObservations.filter((row) => !removed.has(row.locator)),
        })),
    };
}
function predecessor(record: QualifiedRecordLineage) {
    const current = record.classification.current;
    const parent = current?.envelope.parentRevisionId;
    return parent ? record.observations.find((row) => row.envelope.revisionId === parent) : undefined;
}
function preserves(before: WriteAuthorization, after: WriteAuthorization): boolean {
    if (!before.authorized || !after.authorized || !before.qualifiedLineage || !after.qualifiedLineage) return false;
    return before.qualifiedLineage.records.every((record) => {
        const current = record.classification.current;
        if (!current || record.classification.writeGate) return false;
        const next = after.qualifiedLineage?.records.find(
            (row) => row.recordKind === record.recordKind && row.recordId === record.recordId
        );
        if (
            next?.classification.current?.envelope.revisionId !== current.envelope.revisionId ||
            next.classification.current.digest !== current.digest
        )
            return false;
        if (next.classification.writeGate) return false;
        const parent = predecessor(record);
        if (current.envelope.parentRevisionId && !parent) return false;
        return (
            !parent ||
            next.observations.some(
                (row) => row.envelope.revisionId === parent.envelope.revisionId && row.digest === parent.digest
            )
        );
    });
}

interface RetentionInvocationProgress {
    /** Never cleared until this invocation returns; locator is an operation identity, not canonical authority. */
    readonly removed: Map<string, { readonly rawByteDigest: CanonicalDigest; readonly mutationId?: string }>;
}

/** Invocation-local evidence only: no maintenance journal or global recovery exemption. */
interface RetentionProgress {
    readonly baseline: StructuralDiscoverySemantics;
    readonly authority: WriteAuthorization;
    readonly approved: readonly string[];
    readonly removed: Set<string>;
}
function isExpectedRetentionPartialProgress(
    progress: RetentionProgress,
    current: StructuralDiscoverySemantics
): boolean {
    const before = progress.baseline.traversal;
    const after = current.traversal;
    if (
        after.state !== "COMPLETE" ||
        after.rootDiscovery.state !== "COMPLETE" ||
        after.listings.some((row) => row.status !== "COMPLETE")
    )
        return false;
    const expected = before.artifacts.filter((row) => !progress.removed.has(row.locator));
    if (expected.length !== after.artifacts.length) return false;
    for (const row of expected) {
        const observed = after.artifacts.find((item) => item.locator === row.locator && item.context === row.context);
        if (
            !row.bytes ||
            !observed?.bytes ||
            observed.readStatus !== row.readStatus ||
            row.bytes.length !== observed.bytes.length ||
            !row.bytes.every((byte, index) => byte === observed.bytes?.[index])
        )
            return false;
    }
    if (
        JSON.stringify(before.unknownNodes) !== JSON.stringify(after.unknownNodes) ||
        JSON.stringify(before.rootDiscovery) !== JSON.stringify(after.rootDiscovery)
    )
        return false;
    const branches = (snapshot: StructuralDiscoverySnapshot) =>
        snapshot.storeCandidates.map((row) => [
            row.candidateLocator,
            row.representationRootLocator,
            row.storeIds,
            row.hasStoreManifest,
        ]);
    if (JSON.stringify(branches(before)) !== JSON.stringify(branches(after))) return false;
    // Some ports retain empty directories; others cease listing them. Permit only
    // disappearing ancestors of our exact deletes, never new directory/file edges.
    const removedDirectory = (locator: string) =>
        [...progress.removed].some((path) => path.startsWith(`${locator}/`)) &&
        !expected.some((row) => row.locator.startsWith(`${locator}/`));
    for (const listing of after.listings) {
        const original = before.listings.find((row) => row.locator === listing.locator);
        if (!original) return false;
        for (const entry of listing.entries)
            if (!original.entries.some((row) => row.name === entry.name && row.kind === entry.kind)) return false;
        for (const entry of original.entries) {
            if (listing.entries.some((row) => row.name === entry.name && row.kind === entry.kind)) continue;
            const locator = listing.locator ? `${listing.locator}/${entry.name}` : entry.name;
            if (!(entry.kind === "file" ? progress.removed.has(locator) : removedDirectory(locator))) return false;
        }
    }
    return before.listings.every(
        (row) => after.listings.some((item) => item.locator === row.locator) || removedDirectory(row.locator)
    );
}

/** Fixture/test-port maintenance. Consumes accepted authority, never repairs or replays it. */
export async function pruneRecoveryHistory(request: RecoveryRetentionRequest): Promise<RecoveryRetentionResult> {
    const { port, storeId, codecs, supportedProtocolVersion } = request;
    const policy = policyValue(request.policy);
    const operation = { mode: "ordinary", storeId } as const;
    const discover = async () =>
        aggregateStructuralDiscovery(await discoverPhysicalStorageTree(port, codecs), supportedProtocolVersion);
    const assess = async (aggregate: StructuralDiscoverySemantics) =>
        authorizeWrite(aggregate, operation, port, codecs);
    let aggregate = await discover();
    let authorization = await assess(aggregate);
    const deletedLocators: string[] = [];
    const invocation: RetentionInvocationProgress = { removed: new Map() };
    const hasReappearedRemoval = () => aggregate.traversal.artifacts.some((row) => invocation.removed.has(row.locator));
    const reappearanceReason =
        "Evidence successfully removed earlier in this same invocation reappeared; maintenance stops without another delete.";
    const artifacts = () => [
        ...new Map(
            aggregate.physicalCandidates
                .filter((branch) => branch.storeIds.includes(storeId))
                .flatMap((branch) => branch.artifactObservations.filter((row) => row.context === "opaque-recovery"))
                .map((row) => [row.locator, row])
        ).values(),
    ];
    const accounting = () => ({
        count: authorization.qualifiedLineage?.mutations.length ?? 0,
        bytes: artifacts().reduce((sum, row) => sum + (row.bytes?.byteLength ?? 0), 0),
    });
    const satisfied = () => {
        const size = accounting();
        return (
            Boolean(policy) &&
            authorization.authorized &&
            preserves(authorization, authorization) &&
            (policy?.maxMutationCount === undefined || size.count <= policy.maxMutationCount) &&
            (policy?.maxBytes === undefined || size.bytes <= policy.maxBytes)
        );
    };
    const result = (state: RecoveryRetentionResult["state"], reason?: string): RecoveryRetentionResult => ({
        state,
        deletedLocators,
        remainingMutationCount: accounting().count,
        remainingBytes: accounting().bytes,
        accountingComplete: authorization.authorized && artifacts().every((row) => row.bytes !== undefined),
        budgetSatisfied: satisfied(),
        aggregate,
        authorization,
        reason,
    });
    if (request.policy === undefined) return result("DISABLED");
    if (!policy) return result("INVALID_POLICY");
    const limit = artifacts().length; // Finite pass; concurrently added history waits for a later explicit pass.
    for (let iteration = 0; iteration <= limit; iteration++) {
        if (iteration) {
            aggregate = await discover();
            authorization = await assess(aggregate);
        }
        // Check before budget completion or planning: a new unit cannot forget prior removals.
        if (hasReappearedRemoval()) return result("IO_UNCERTAIN", reappearanceReason);
        if (!authorization.authorized || !preserves(authorization, authorization))
            return result("BLOCKED", "Current store/record authority or immediate predecessor is not proven.");
        if (satisfied()) return result(deletedLocators.length ? "COMPLETED" : "NOTHING_ELIGIBLE");
        if (iteration === limit)
            return result("BUDGET_PROTECTED", "Finite maintenance pass exhausted; safety overrides the budget.");
        let selected: string[] | undefined;
        // MutationId/locator ordering is maintenance ordering among proven-safe units only.
        // It never selects canonical heads, representation authority, or recovery outcomes.
        for (const finding of [...(authorization.qualifiedLineage?.mutations ?? [])].sort((a, b) =>
            a.mutation.intent.mutationId.localeCompare(b.mutation.intent.mutationId)
        )) {
            if (
                finding.writeGate ||
                ![
                    "RESOLVED_HISTORY",
                    "RESOLVED_HISTORICAL_ANCESTRY",
                    "RESOLVED_ADJUDICATED_HISTORY",
                    "REJECTED_HISTORY",
                ].includes(finding.state)
            )
                continue;
            const rows = artifacts().filter((row) => finding.locators.includes(row.locator));
            const copies = new Map<string, string[]>();
            for (const row of rows) {
                if (!row.bytes) continue;
                const recognized = await recognizeRecoveryArtifactBytes(row.bytes, codecs, storeId);
                if (recognized.status !== "VALID") continue;
                const key = `${recognized.kind}:${recognized.digest}`;
                copies.set(key, [...(copies.get(key) ?? []), row.locator]);
            }
            const duplicateUnits = [...copies.values()]
                .filter((locators) => locators.length > 1)
                .map((locators) => [locators.sort()[0]]);
            // Whole-group removal deletes outcomes first. Interruption is exposed as
            // intent-without-outcome, never concealed by transactional assumptions.
            const whole = [...rows].sort((a, b) => (a.context === b.context ? a.locator.localeCompare(b.locator) : 0));
            const outcomes: string[] = [];
            const intents: string[] = [];
            for (const row of whole) {
                if (!row.bytes) continue;
                const recognized = await recognizeRecoveryArtifactBytes(row.bytes, codecs, storeId);
                if (recognized.status === "VALID")
                    (recognized.kind === "mutation-outcome" ? outcomes : intents).push(row.locator);
            }
            for (const unit of [...duplicateUnits, [...outcomes, ...intents]]) {
                if (!unit.length) continue;
                const projected = await aggregateStructuralDiscovery(
                    without(aggregate.traversal, new Set(unit)),
                    supportedProtocolVersion
                );
                if (preserves(authorization, await assess(projected))) {
                    selected = unit;
                    break;
                }
            }
            if (selected) break;
        }
        if (!selected)
            return result(
                "BUDGET_PROTECTED",
                "No further resolved evidence can be removed while preserving current authority and predecessor."
            );
        const progress: RetentionProgress = {
            baseline: aggregate,
            authority: authorization,
            approved: selected,
            removed: new Set(),
        };
        for (const locator of selected) {
            const row = artifacts().find((artifact) => artifact.locator === locator);
            if (!row?.bytes) return result("BLOCKED", "Selected exact bytes unavailable.");
            if (invocation.removed.has(locator)) return result("IO_UNCERTAIN", reappearanceReason);
            const rawByteDigest = await sha256Bytes(row.bytes);
            const identity = await recognizeRecoveryArtifactBytes(row.bytes, codecs, storeId);
            let deletion: RepresentationStorageResult<void>;
            try {
                deletion = await port.delete(locator, rawByteDigest);
            } catch {
                deletion = {
                    ok: false as const,
                    failure: { code: "IO_ERROR", message: "Guarded delete threw; application unknown." },
                };
            }
            if (deletion.ok === false) {
                aggregate = await discover();
                authorization = await assess(aggregate);
                if (hasReappearedRemoval()) return result("IO_UNCERTAIN", reappearanceReason);
                return result(
                    ["DIGEST_MISMATCH", "NOT_FOUND"].includes(deletion.failure.code)
                        ? "GUARD_REJECTED"
                        : "IO_UNCERTAIN",
                    deletion.failure.message
                );
            }
            invocation.removed.set(locator, {
                rawByteDigest,
                mutationId: identity.status === "VALID" ? identity.value.mutationId : undefined,
            });
            deletedLocators.push(locator);
            progress.removed.add(locator);
            // Each successful physical delete ends the authority snapshot. Observe
            // again even inside one group, before any subsequent destructive action.
            aggregate = await discover();
            authorization = await assess(aggregate);
            if (hasReappearedRemoval()) return result("IO_UNCERTAIN", reappearanceReason);
            if (!isExpectedRetentionPartialProgress(progress, aggregate))
                return result(
                    aggregate.traversal.state !== "COMPLETE" ||
                        [...progress.removed].some((path) =>
                            aggregate.traversal.artifacts.some((row) => row.locator === path)
                        )
                        ? "IO_UNCERTAIN"
                        : "BLOCKED",
                    "Fresh evidence differs from the exact cumulative maintenance-created partial state; no continuation."
                );
            const remaining = new Set(progress.approved.filter((path) => !progress.removed.has(path)));
            const completion = await aggregateStructuralDiscovery(
                without(aggregate.traversal, remaining),
                supportedProtocolVersion
            );
            // The ordinary interpreter may block on our expected temporary I/no-O.
            // Only this exact proven-safe group may finish, and only if completing
            // the remaining deletes still preserves current authority/predecessor.
            if (!preserves(progress.authority, await assess(completion)))
                return result(
                    "BLOCKED",
                    "Current qualified lineage/predecessor no longer permits completing this unit."
                );
        }
    }
    return result("BUDGET_PROTECTED");
}
