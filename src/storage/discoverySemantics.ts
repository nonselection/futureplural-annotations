import { representationStateArtifactDigest } from "./authorityArtifacts";
import type { CanonicalDigest } from "./canonicalEncoding";
import {
    assessProtocolWriteFence,
    classifyRecordRevisions,
    classifyStoreInventory,
    validateRepresentationStateLineage,
    type ProtocolFenceAssessment,
    type RecordRepositoryClassification,
    type RepresentationLineageClassification,
    type RevisionObservation,
    type StoreInventoryClassification,
} from "./repositorySemantics";
import type {
    PhysicalArtifactObservation,
    PhysicalStoreCandidate,
    StructuralDiscoverySnapshot,
} from "./discoveryTraversal";
import type { CanonicalRevisionEnvelope } from "./envelopes";
import type { ProtocolFenceArtifactV1, RepresentationStateArtifactV1 } from "./authorityArtifacts";
import type { StoreId } from "./identity";

export interface LogicalRevisionCopy {
    readonly revisionId: CanonicalRevisionEnvelope["revisionId"];
    readonly digest: CanonicalDigest;
    readonly locators: readonly string[];
    readonly rawObservations: readonly PhysicalArtifactObservation[];
}

export interface LogicalRecordDiscovery {
    readonly storeId: StoreId;
    readonly recordKind: string;
    readonly recordId: string;
    readonly copies: readonly LogicalRevisionCopy[];
    readonly classification: RecordRepositoryClassification;
}

export interface BoundedRecoveryEvidence<TRecovery> {
    readonly physicalCandidateLocator: string;
    readonly candidateStoreIds: readonly StoreId[];
    readonly observation: PhysicalArtifactObservation;
    readonly recognition: TRecovery;
}

export type BoundedRecoveryRecognizer<TRecovery> = (
    observation: PhysicalArtifactObservation,
    expectedStoreId?: StoreId
) => Promise<TRecovery>;

export interface LogicalStoreDiscovery<TRecovery = never> {
    readonly storeId: StoreId;
    readonly physicalCandidateLocators: readonly string[];
    readonly records: readonly LogicalRecordDiscovery[];
    readonly protocolFence: ProtocolFenceAssessment;
    readonly representationState: RepresentationLineageClassification;
    readonly opaqueObservations: readonly {
        readonly physicalCandidateLocator: string;
        readonly observation: PhysicalArtifactObservation;
    }[];
    /** Optional S3 recognition layered only over raw observations inside the S2 recovery grammar. */
    readonly recoveryEvidence: readonly BoundedRecoveryEvidence<TRecovery>[];
    readonly hasUnavailableEvidence: boolean;
}

export interface StructuralDiscoverySemantics<TRecovery = never> {
    readonly traversal: StructuralDiscoverySnapshot;
    readonly inventory: StoreInventoryClassification;
    readonly logicalStores: readonly LogicalStoreDiscovery<TRecovery>[];
    readonly namespaceCandidates: StructuralDiscoverySnapshot["rootDiscovery"]["candidates"];
    readonly physicalCandidates: readonly PhysicalStoreCandidate[];
    /** Recognized only when a caller injects an S3 codec; raw S2 observations remain authoritative evidence. */
    readonly recoveryEvidence: readonly BoundedRecoveryEvidence<TRecovery>[];
    readonly unavailableLocators: readonly string[];
    readonly unknownEvidenceLocators: readonly string[];
}

interface MutableRecord {
    storeId: StoreId;
    recordKind: string;
    recordId: string;
    revisionObservations: RevisionObservation[];
    copies: Map<
        string,
        {
            revisionId: CanonicalRevisionEnvelope["revisionId"];
            digest: CanonicalDigest;
            locators: Set<string>;
            observations: PhysicalArtifactObservation[];
        }
    >;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function isValidKind<T extends string>(observation: PhysicalArtifactObservation, kind: T): boolean {
    return observation.recognition.status === "VALID" && observation.recognition.kind === kind;
}

function asEnvelope(observation: PhysicalArtifactObservation): CanonicalRevisionEnvelope {
    if (observation.recognition.status !== "VALID" || observation.recognition.kind !== "revision") {
        throw new Error("Expected a validated revision observation.");
    }
    return observation.recognition.value as CanonicalRevisionEnvelope;
}

function asProtocolFence(observation: PhysicalArtifactObservation): ProtocolFenceArtifactV1 {
    if (observation.recognition.status !== "VALID" || observation.recognition.kind !== "protocol-fence") {
        throw new Error("Expected a validated protocol fence.");
    }
    return observation.recognition.value as ProtocolFenceArtifactV1;
}

function asRepresentationState(observation: PhysicalArtifactObservation): RepresentationStateArtifactV1 {
    if (observation.recognition.status !== "VALID" || observation.recognition.kind !== "representation-state") {
        throw new Error("Expected a validated representation state.");
    }
    return observation.recognition.value as RepresentationStateArtifactV1;
}

function artifactStoreId(observation: PhysicalArtifactObservation): StoreId | undefined {
    if (observation.recognition.status !== "VALID") return undefined;
    const value = observation.recognition.value;
    return "storeId" in value ? value.storeId : undefined;
}

function uniquePhysicalObservations(
    observations: readonly PhysicalArtifactObservation[]
): PhysicalArtifactObservation[] {
    const unique = new Map<string, PhysicalArtifactObservation>();
    for (const observation of observations) unique.set(`${observation.context}\0${observation.locator}`, observation);
    return [...unique.values()].sort(
        (left, right) => compareText(left.locator, right.locator) || compareText(left.context, right.context)
    );
}

function recordKey(storeId: StoreId, recordKind: string, recordId: string): string {
    return JSON.stringify([storeId, recordKind, recordId]);
}

function revisionCopyKey(revisionId: string, digest: CanonicalDigest): string {
    return JSON.stringify([revisionId, digest]);
}

function unknownFenceArtifact(observation: PhysicalArtifactObservation): boolean {
    if (observation.context !== "protocol-namespace") return false;
    return !isValidKind(observation, "protocol-fence");
}

function unavailable(observation: PhysicalArtifactObservation): boolean {
    return observation.readStatus !== "READ";
}

function allArtifacts(snapshot: StructuralDiscoverySnapshot): PhysicalArtifactObservation[] {
    const all = [...snapshot.artifacts];
    for (const candidate of snapshot.storeCandidates) all.push(...candidate.artifactObservations);
    return uniquePhysicalObservations(all);
}

/**
 * Aggregate validated physical observations using S1 classifiers. This does not
 * establish cross-scope write-gate precedence or select a physical winner.
 */
export interface StructuralDiscoveryAggregationOptions<TRecovery> {
    readonly recognizeRecovery?: BoundedRecoveryRecognizer<TRecovery>;
}

export async function aggregateStructuralDiscovery<TRecovery = never>(
    snapshot: StructuralDiscoverySnapshot,
    supportedProtocolVersion: number,
    options: StructuralDiscoveryAggregationOptions<TRecovery> = {}
): Promise<StructuralDiscoverySemantics<TRecovery>> {
    if (!Number.isSafeInteger(supportedProtocolVersion) || supportedProtocolVersion < 1) {
        throw new Error("supportedProtocolVersion must be a positive safe integer.");
    }
    const inventory = classifyStoreInventory(
        snapshot.storeCandidates.map((candidate) => ({
            candidateId: candidate.candidateLocator,
            storeIds: candidate.storeIds,
        }))
    );
    const observations = allArtifacts(snapshot);
    const recoveryEvidence: BoundedRecoveryEvidence<TRecovery>[] = [];
    if (options.recognizeRecovery) {
        for (const candidate of snapshot.storeCandidates) {
            for (const observation of uniquePhysicalObservations(candidate.artifactObservations)) {
                if (observation.context !== "opaque-recovery" || observation.recognition.status !== "OPAQUE") continue;
                const expectedStoreId = candidate.storeIds.length === 1 ? candidate.storeIds[0] : undefined;
                recoveryEvidence.push({
                    physicalCandidateLocator: candidate.candidateLocator,
                    candidateStoreIds: candidate.storeIds,
                    observation,
                    recognition: await options.recognizeRecovery(observation, expectedStoreId),
                });
            }
        }
    }
    const logicalStoreIds = new Set<StoreId>(inventory.storeIds);
    for (const observation of observations) {
        const storeId = artifactStoreId(observation);
        if (storeId) logicalStoreIds.add(storeId);
    }

    const recordsByKey = new Map<string, MutableRecord>();
    for (const observation of observations) {
        if (
            !isValidKind(observation, "revision") ||
            observation.recognition.status !== "VALID" ||
            !observation.recognition.digest
        ) {
            continue;
        }
        const envelope = asEnvelope(observation);
        const key = recordKey(envelope.storeId, envelope.recordKind, envelope.recordId);
        let record = recordsByKey.get(key);
        if (!record) {
            record = {
                storeId: envelope.storeId,
                recordKind: envelope.recordKind,
                recordId: envelope.recordId,
                revisionObservations: [],
                copies: new Map(),
            };
            recordsByKey.set(key, record);
        }
        const revisionObservation: RevisionObservation = { envelope, digest: observation.recognition.digest };
        record.revisionObservations.push(revisionObservation);
        const copyKey = revisionCopyKey(envelope.revisionId, observation.recognition.digest);
        const copy = record.copies.get(copyKey) ?? {
            revisionId: envelope.revisionId,
            digest: observation.recognition.digest,
            locators: new Set<string>(),
            observations: [],
        };
        copy.locators.add(observation.locator);
        copy.observations.push(observation);
        record.copies.set(copyKey, copy);
    }

    const physicalCandidateLocatorsByStore = new Map<StoreId, Set<string>>();
    for (const candidate of snapshot.storeCandidates) {
        for (const storeId of candidate.storeIds) {
            const paths = physicalCandidateLocatorsByStore.get(storeId) ?? new Set<string>();
            paths.add(candidate.candidateLocator);
            physicalCandidateLocatorsByStore.set(storeId, paths);
        }
    }

    const logicalStores: LogicalStoreDiscovery<TRecovery>[] = [];
    for (const storeId of [...logicalStoreIds].sort(compareText)) {
        const physicalCandidates = snapshot.storeCandidates.filter((candidate) => candidate.storeIds.includes(storeId));
        const records = [...recordsByKey.values()]
            .filter((record) => record.storeId === storeId)
            .map(
                (record): LogicalRecordDiscovery => ({
                    storeId,
                    recordKind: record.recordKind,
                    recordId: record.recordId,
                    copies: [...record.copies.values()]
                        .map((copy) => ({
                            revisionId: copy.revisionId,
                            digest: copy.digest,
                            locators: [...copy.locators].sort(compareText),
                            rawObservations: uniquePhysicalObservations(copy.observations),
                        }))
                        .sort(
                            (left, right) =>
                                compareText(left.revisionId, right.revisionId) || compareText(left.digest, right.digest)
                        ),
                    classification: classifyRecordRevisions(record.revisionObservations),
                })
            )
            .sort(
                (left, right) =>
                    compareText(left.recordKind, right.recordKind) || compareText(left.recordId, right.recordId)
            );

        const candidateArtifacts = uniquePhysicalObservations(
            physicalCandidates.flatMap((candidate) => candidate.artifactObservations)
        );
        const fences = candidateArtifacts.filter((item) => isValidKind(item, "protocol-fence")).map(asProtocolFence);
        const protocolStructuralUnknownCount = snapshot.unknownNodes.filter(
            (node) =>
                node.parentContext === "protocol-namespace" &&
                physicalCandidates.some(
                    (candidate) =>
                        node.locator === candidate.candidateLocator ||
                        node.locator.startsWith(`${candidate.candidateLocator}/`)
                )
        ).length;
        const unrecognizedFenceCount =
            candidateArtifacts.filter(unknownFenceArtifact).length + protocolStructuralUnknownCount;
        const protocolFence = assessProtocolWriteFence(
            storeId,
            fences,
            supportedProtocolVersion,
            unrecognizedFenceCount
        );
        const stateArtifacts = observations.filter(
            (item) => isValidKind(item, "representation-state") && artifactStoreId(item) === storeId
        );
        const representationStateObservations = await Promise.all(
            uniquePhysicalObservations(stateArtifacts).map(async (item) => ({
                artifact: asRepresentationState(item),
                digest: await representationStateArtifactDigest(asRepresentationState(item)),
            }))
        );
        const opaqueObservations = physicalCandidates.flatMap((candidate) =>
            uniquePhysicalObservations(candidate.artifactObservations)
                .filter((item) => item.recognition.status === "OPAQUE")
                .map((observation) => ({ physicalCandidateLocator: candidate.candidateLocator, observation }))
        );
        const storeRecoveryEvidence = recoveryEvidence.filter((item) => item.candidateStoreIds.includes(storeId));
        const hasUnavailableEvidence =
            snapshot.state === "UNAVAILABLE" ||
            physicalCandidates.some((candidate) => candidate.state === "UNAVAILABLE") ||
            candidateArtifacts.some(unavailable);

        logicalStores.push({
            storeId,
            physicalCandidateLocators: [...(physicalCandidateLocatorsByStore.get(storeId) ?? [])].sort(compareText),
            records,
            protocolFence,
            representationState: validateRepresentationStateLineage(representationStateObservations, storeId),
            opaqueObservations,
            recoveryEvidence: storeRecoveryEvidence,
            hasUnavailableEvidence,
        });
    }

    const unknownEvidenceLocators = observations
        .filter(
            (observation) =>
                observation.recognition.status === "INVALID" ||
                observation.recognition.status === "UNSUPPORTED" ||
                observation.recognition.status === "UNKNOWN" ||
                observation.recognition.status === "UNRECOGNIZED" ||
                observation.recognition.status === "OPAQUE"
        )
        .map((observation) => observation.locator);
    const unavailableLocators = observations.filter(unavailable).map((observation) => observation.locator);
    return {
        traversal: snapshot,
        inventory,
        logicalStores,
        namespaceCandidates: snapshot.rootDiscovery.candidates,
        physicalCandidates: snapshot.storeCandidates,
        recoveryEvidence,
        unavailableLocators: [...new Set(unavailableLocators)].sort(compareText),
        unknownEvidenceLocators: [
            ...new Set([...unknownEvidenceLocators, ...snapshot.unknownNodes.map((node) => node.locator)]),
        ].sort(compareText),
    };
}
