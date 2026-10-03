import { interpretRecovery, type RecoveryInterpretation } from "./recoverySemantics";
import type { CanonicalRecordCodec, CanonicalRevisionEnvelope } from "./envelopes";
import type { DiscoveryReadPort } from "./discovery";
import type { StructuralDiscoverySemantics } from "./discoverySemantics";
import type { PhysicalArtifactObservation } from "./discoveryTraversal";
import type { StoreId } from "./identity";
import { isSafeRepresentationLocator, type RepresentationStoragePort } from "./RepresentationStoragePort";
import { validateExplicitResolutionCoverage, type RepositoryWriteGate } from "./repositorySemantics";
import type { RepresentationStateArtifactV1 } from "./authorityArtifacts";

/** Operational context only. The caller classifies the target; S4 qualifies real backends. */
export interface BootstrapRepresentationTarget {
    readonly port: RepresentationStoragePort;
    readonly representationRootLocator: string;
    /** Required for resume. Fresh bootstrap allocates a StoreId-namespaced branch after authorization. */
    readonly storeCandidateLocator?: string;
    readonly representation: "hidden" | "visible";
}

export type WriteAuthorizationOperation =
    | { readonly mode: "fresh-bootstrap"; readonly target: BootstrapRepresentationTarget }
    | { readonly mode: "bootstrap-resume"; readonly target: BootstrapRepresentationTarget; readonly storeId: StoreId }
    | {
          readonly mode: "ordinary";
          readonly storeId: StoreId;
          /** Omit only for store-authority verification; this does not authorize a record transition. */
          readonly record?: {
              readonly recordKind: string;
              readonly recordId: string;
              readonly action: "create" | "update" | "tombstone" | "reactivate" | "resolve";
              readonly resolutionCandidate?: CanonicalRevisionEnvelope;
          };
      };

export type WriteAuthorization =
    | { readonly authorized: true; readonly blockers: readonly []; readonly qualifiedLineage?: RecoveryInterpretation }
    | {
          readonly authorized: false;
          readonly blockers: readonly RepositoryWriteGate[];
          readonly qualifiedLineage?: RecoveryInterpretation;
      };

function within(locator: string, parent: string): boolean {
    return locator === parent || locator.startsWith(`${parent}/`);
}

function validKind(observation: PhysicalArtifactObservation, kind: string): boolean {
    return observation.recognition.status === "VALID" && observation.recognition.kind === kind;
}

/** One fail-closed boundary; scopes remain explicit rather than ranked or scored. */
export async function authorizeWrite(
    aggregate: StructuralDiscoverySemantics,
    operation: WriteAuthorizationOperation,
    discoveryPort: DiscoveryReadPort,
    recordCodecs: readonly CanonicalRecordCodec[] = []
): Promise<WriteAuthorization> {
    const blockers: RepositoryWriteGate[] = [];
    let qualifiedLineage: RecoveryInterpretation | undefined;
    const add = (scope: RepositoryWriteGate["scope"], reason: string, storeId?: StoreId, recordId?: string) => {
        blockers.push({ scope, reason, storeId, recordId });
    };
    const snapshot = aggregate.traversal;
    if (snapshot.rootDiscovery.rootIdentity !== discoveryPort.rootIdentity)
        add("namespace/store-selection", "Discovery root does not correlate to the supplied port.");
    if (
        snapshot.state !== "COMPLETE" ||
        snapshot.rootDiscovery.state !== "COMPLETE" ||
        snapshot.rootDiscovery.rootListing.status !== "COMPLETE" ||
        snapshot.listings.some((listing) => listing.status !== "COMPLETE")
    )
        add("namespace/store-selection", "Bounded discovery is incomplete or unavailable.");
    for (const root of aggregate.namespaceCandidates) {
        if (root.state === "INVALID" || root.state === "UNAVAILABLE")
            add("namespace/store-selection", `Unresolved namespace authority at ${root.locator}.`);
        if (
            root.state !== "NON_FK" &&
            root.markers.some(
                (marker) =>
                    marker.readStatus === "UNAVAILABLE" ||
                    marker.namespaceValidation === "INVALID" ||
                    marker.namespaceValidation === "UNSUPPORTED"
            )
        )
            add(
                "namespace/store-selection",
                `Invalid, unsupported, or unavailable namespace evidence at ${root.locator}.`
            );
    }
    if (aggregate.inventory.writeGate) blockers.push(aggregate.inventory.writeGate);
    for (const locator of aggregate.unknownEvidenceLocators) {
        if (!aggregate.physicalCandidates.some((candidate) => within(locator, candidate.candidateLocator)))
            add("namespace/store-selection", `Unknown evidence cannot be safely attributed: ${locator}.`);
    }
    for (const candidate of aggregate.physicalCandidates) {
        if (candidate.storeIds.length !== 1)
            add(
                "namespace/store-selection",
                `Store branch is not uniquely attributable: ${candidate.candidateLocator}.`
            );
        if (candidate.state === "UNAVAILABLE" || candidate.state === "MIXED_STORE_INVALID")
            add("namespace/store-selection", `Unavailable or mixed branch: ${candidate.candidateLocator}.`);
    }

    if (operation.mode !== "ordinary") {
        const target = operation.target;
        const branchLocator = target.storeCandidateLocator;
        if (target.port !== discoveryPort || target.port.rootIdentity !== snapshot.rootDiscovery.rootIdentity)
            add("namespace/store-selection", "Operational target port does not match the discovery handle.");
        if (
            (target.representation !== "hidden" && target.representation !== "visible") ||
            !isSafeRepresentationLocator(target.representationRootLocator) ||
            target.representationRootLocator.includes("/") ||
            (operation.mode === "bootstrap-resume" && !branchLocator) ||
            (branchLocator !== undefined &&
                (!isSafeRepresentationLocator(branchLocator) ||
                    branchLocator.split("/").length !== 3 ||
                    !within(branchLocator, target.representationRootLocator)))
        )
            add("namespace/store-selection", "Invalid operational representation target or structural location.");
        const root = aggregate.namespaceCandidates.find((item) => item.locator === target.representationRootLocator);
        if (!root || (root.state !== "VALID" && root.state !== "ABSENT"))
            add("namespace/store-selection", "Target root is not positively absent or validated FK structure.");

        if (operation.mode === "fresh-bootstrap") {
            if (branchLocator !== undefined)
                add(
                    "namespace/store-selection",
                    "Fresh target supplies a root binding; its StoreId-namespaced branch is allocated after authorization."
                );
            if (
                aggregate.inventory.state !== "NO_STORE" ||
                aggregate.physicalCandidates.length ||
                aggregate.logicalStores.length
            )
                add(
                    "namespace/store-selection",
                    "Global store absence is not established across all representation candidates."
                );
            if (aggregate.unknownEvidenceLocators.length || aggregate.unavailableLocators.length)
                add("namespace/store-selection", "Uncertain FK evidence prevents fresh bootstrap absence.");
            const occupied =
                branchLocator !== undefined &&
                (snapshot.listings.find((item) => item.locator === branchLocator) ||
                    snapshot.artifacts.some((item) => within(item.locator, branchLocator)));
            if (occupied) add("namespace/store-selection", "Fresh target already has observed branch evidence.");
        } else {
            const candidate = aggregate.physicalCandidates.find(
                (item) => item.candidateLocator === target.storeCandidateLocator
            );
            const store = aggregate.logicalStores.find((item) => item.storeId === operation.storeId);
            if (
                aggregate.physicalCandidates.length !== 1 ||
                aggregate.inventory.state !== "ONE_STORE" ||
                !candidate ||
                candidate.representationRootLocator !== target.representationRootLocator ||
                candidate.storeIds.length !== 1 ||
                candidate.storeIds[0] !== operation.storeId ||
                !store
            )
                add(
                    "namespace/store-selection",
                    "Resume requires exactly one attributable partial branch matching the target."
                );
            if (candidate && store) {
                for (const artifact of candidate.artifactObservations) {
                    if (
                        artifact.recognition.status !== "VALID" ||
                        !["store", "protocol-fence", "representation-state"].includes(artifact.recognition.kind)
                    )
                        add("store", `Non-bootstrap or invalid authority at ${artifact.locator}.`, operation.storeId);
                }
                for (const node of snapshot.unknownNodes)
                    if (within(node.locator, candidate.candidateLocator))
                        add("store", `Unknown structure: ${node.locator}.`, operation.storeId);
                if (
                    store.protocolFence.state !== "WRITES_ALLOWED" &&
                    store.protocolFence.state !== "READ_ONLY_MISSING_FENCE"
                )
                    add("store", store.protocolFence.reason ?? store.protocolFence.state, operation.storeId);
                if (
                    store.representationState.state !== "REPRESENTATION_STATE_VALID" &&
                    store.representationState.state !== "REPRESENTATION_STATE_ABSENT"
                )
                    add(
                        "store",
                        store.representationState.reason ?? store.representationState.state,
                        operation.storeId
                    );
                const states = candidate.artifactObservations
                    .filter((item) => validKind(item, "representation-state"))
                    .map((item) =>
                        item.recognition.status === "VALID"
                            ? (item.recognition.value as RepresentationStateArtifactV1)
                            : undefined
                    )
                    .filter((item): item is RepresentationStateArtifactV1 => Boolean(item));
                if (
                    states.some(
                        (state) =>
                            state.parentRepresentationStateId !== null ||
                            state.establishedByMigrationId !== null ||
                            state.representation !== target.representation
                    )
                )
                    add(
                        "store",
                        "Existing genesis disagrees with the target or is not bootstrap genesis.",
                        operation.storeId
                    );
                if (
                    candidate.hasStoreManifest &&
                    store.protocolFence.state === "WRITES_ALLOWED" &&
                    store.representationState.state === "REPRESENTATION_STATE_VALID"
                )
                    add("store", "This branch is already established, not a partial bootstrap.", operation.storeId);
            }
        }
    } else {
        const store = aggregate.logicalStores.find((item) => item.storeId === operation.storeId);
        if (aggregate.inventory.state !== "ONE_STORE" || !store)
            add(
                "namespace/store-selection",
                "Ordinary writes require one established selected store.",
                operation.storeId
            );
        if (store) {
            if (store.protocolFence.state !== "WRITES_ALLOWED")
                add("store", store.protocolFence.reason ?? store.protocolFence.state, operation.storeId);
            if (store.representationState.state !== "REPRESENTATION_STATE_VALID")
                add("store", store.representationState.reason ?? store.representationState.state, operation.storeId);
            if (store.hasUnavailableEvidence) add("store", "Store evidence is unavailable.", operation.storeId);
            for (const candidate of aggregate.physicalCandidates.filter((item) =>
                item.storeIds.includes(operation.storeId)
            )) {
                if (!candidate.hasStoreManifest) add("store", "Store manifest is missing.", operation.storeId);
                for (const node of snapshot.unknownNodes)
                    if (within(node.locator, candidate.candidateLocator))
                        add("store", `Unknown structure: ${node.locator}.`, operation.storeId);
                for (const artifact of candidate.artifactObservations) {
                    if (artifact.recognition.status === "VALID") continue;
                    if (artifact.context === "record-envelope" && operation.record)
                        add(
                            "record",
                            "Unvalidated record evidence prevents confirmed target state or absence.",
                            operation.storeId,
                            operation.record.recordId
                        );
                    if (artifact.context !== "opaque-recovery")
                        add(
                            "store",
                            `Invalid, opaque, or unavailable evidence: ${artifact.locator}.`,
                            operation.storeId
                        );
                }
            }
            qualifiedLineage = await interpretRecovery(aggregate, operation.storeId, recordCodecs);
            for (const blocker of qualifiedLineage.blockers.filter((item) => item.scope === "store"))
                blockers.push(blocker);
            const targetLineage = qualifiedLineage.records.find(
                (item) =>
                    item.recordKind === operation.record?.recordKind && item.recordId === operation.record.recordId
            );
            const covered =
                operation.record?.action === "resolve" &&
                operation.record.resolutionCandidate &&
                targetLineage?.classification.state === "DIVERGENT_VALID_REVISIONS" &&
                validateExplicitResolutionCoverage(operation.record.resolutionCandidate, targetLineage.observations)
                    .valid;
            for (const finding of qualifiedLineage.mutations) {
                const intent = finding.mutation.intent;
                const applicable =
                    !operation.record ||
                    (operation.record.recordKind === intent.recordKind &&
                        operation.record.recordId === intent.recordId);
                const adjudicated =
                    covered &&
                    finding.state === "COMPETING_BRANCH" &&
                    finding.mutation.identityValid &&
                    finding.mutation.outcome?.status === "VERIFIED_APPLIED" &&
                    targetLineage?.classification.currentHeads?.some(
                        (head) =>
                            head.envelope.revisionId === intent.candidateRevisionId &&
                            head.digest === intent.candidateDigest
                    );
                if (finding.writeGate && applicable && !adjudicated) blockers.push(finding.writeGate);
            }
            const request = operation.record;
            if (request) {
                const record = targetLineage;
                if (request.action === "create") {
                    if (record)
                        add(
                            "record",
                            "Aggregate-confirmed record absence is not established.",
                            operation.storeId,
                            request.recordId
                        );
                } else if (!record)
                    add("record", "No validated current record observation.", operation.storeId, request.recordId);
                else if (record.classification.writeGate) {
                    if (!covered) blockers.push(record.classification.writeGate);
                } else if (request.action === "resolve")
                    add(
                        "record",
                        "Resolution requires a proven divergent head set.",
                        operation.storeId,
                        request.recordId
                    );
            }
        }
    }
    const unique = [...new Map(blockers.map((blocker) => [JSON.stringify(blocker), blocker])).values()];
    const evidence = qualifiedLineage ? { qualifiedLineage } : {};
    return unique.length
        ? { authorized: false, blockers: unique, ...evidence }
        : { authorized: true, blockers: [], ...evidence };
}
