import type { CanonicalRecordCodec, CanonicalRevisionEnvelope } from "./envelopes";
import type { StructuralDiscoverySemantics } from "./discoverySemantics";
import type { StoreId } from "./identity";
import {
    recognizeRecoveryArtifactBytes,
    validateOutcomeAgainstIntent,
    type RecoveryArtifactRecognition,
} from "./recoveryArtifacts";
import {
    classifyRecoveryMutations,
    type MutationRecoveryFinding,
    type ValidatedRecoveryMutation,
} from "./recoveryClassification";
import {
    classifyRecordRevisions,
    type RevisionObservation,
    type RecordRepositoryClassification,
    type RepositoryWriteGate,
} from "./repositorySemantics";

export interface QualifiedRecordLineage {
    readonly recordKind: string;
    readonly recordId: string;
    readonly snapshotObservations: readonly RevisionObservation[];
    readonly observations: readonly RevisionObservation[];
    readonly snapshotClassification: RecordRepositoryClassification;
    readonly classification: RecordRepositoryClassification;
}
export type QualifiedRecoveryFinding = Omit<MutationRecoveryFinding, "state"> & {
    readonly state: MutationRecoveryFinding["state"] | "RESOLVED_ADJUDICATED_HISTORY";
    readonly locators: readonly string[];
};
type ValidRecovery = Extract<RecoveryArtifactRecognition, { status: "VALID" }>;
export interface RecoveryInterpretation {
    readonly mutations: readonly QualifiedRecoveryFinding[];
    /** Recovery and lineage blockers; broader authorization remains with authorizeWrite. */
    readonly blockers: readonly RepositoryWriteGate[];
    readonly records: readonly QualifiedRecordLineage[];
}

/** Interprets one bounded discovery snapshot. No replay, writes, finalization, or pruning. */
export async function interpretRecovery(
    aggregate: StructuralDiscoverySemantics,
    storeId: StoreId,
    codecs: readonly CanonicalRecordCodec[]
): Promise<RecoveryInterpretation> {
    const store = aggregate.logicalStores.find((item) => item.storeId === storeId);
    const blockers: RepositoryWriteGate[] = [];
    const block = (reason: string) => blockers.push({ scope: "store", storeId, reason });
    if (aggregate.traversal.state !== "COMPLETE" || !store || store.hasUnavailableEvidence)
        block("Recovery observation is incomplete or unavailable.");
    const groups = new Map<string, { artifacts: ValidRecovery[]; locators: Set<string> }>();
    for (const branch of aggregate.physicalCandidates.filter((candidate) => candidate.storeIds.includes(storeId))) {
        for (const artifact of branch.artifactObservations.filter((item) => item.context === "opaque-recovery")) {
            if (!artifact.bytes || artifact.readStatus !== "READ") {
                block(`Recovery bytes unavailable: ${artifact.locator}.`);
                continue;
            }
            const recognition = await recognizeRecoveryArtifactBytes(artifact.bytes, codecs, storeId);
            if (recognition.status !== "VALID") {
                block(`Unvalidated recovery evidence: ${artifact.locator}.`);
                continue;
            }
            const group = groups.get(recognition.value.mutationId) ?? { artifacts: [], locators: new Set<string>() };
            group.artifacts.push(recognition);
            group.locators.add(artifact.locator);
            groups.set(recognition.value.mutationId, group);
        }
    }
    const mutations: ValidatedRecoveryMutation[] = [];
    for (const group of groups.values()) {
        const intents = group.artifacts.filter((row) => row.kind === "mutation-intent");
        const outcomes = group.artifacts.filter((row) => row.kind === "mutation-outcome");
        const intent = intents[0]?.value;
        const outcome = outcomes[0]?.value;
        const conflicting =
            new Set(intents.map((row) => row.digest)).size > 1 || new Set(outcomes.map((row) => row.digest)).size > 1;
        const bound = !outcome || (intent !== undefined && (await validateOutcomeAgainstIntent(outcome, intent)));
        const identityValid = Boolean(intent) && !conflicting && bound;
        if (conflicting) block("Conflicting same-mutation recovery evidence.");
        else if (!intent || !bound) block("Orphan or inconsistently bound mutation outcome.");
        if (intent) mutations.push({ intent, outcome, identityValid });
    }
    const snapshots: RevisionObservation[] =
        store?.records.flatMap((record) =>
            record.copies.flatMap((copy) =>
                copy.rawObservations.flatMap((row) =>
                    row.recognition.status === "VALID" && row.recognition.kind === "revision" && row.recognition.digest
                        ? [
                              {
                                  envelope: row.recognition.value as CanonicalRevisionEnvelope,
                                  digest: row.recognition.digest,
                              },
                          ]
                        : []
                )
            )
        ) ?? [];
    const evidence = [...snapshots];
    // Only an exact valid VERIFIED_APPLIED outcome proves the historical candidate
    // reached storage. Rejected, uncertain, or merely intended candidates stay evidence
    // of their attempt and cannot be injected into canonical lineage.
    for (const mutation of mutations) {
        if (!mutation.identityValid || mutation.outcome?.status !== "VERIFIED_APPLIED") continue;
        if (mutation.intent.before && mutation.intent.baseDigest)
            evidence.push({ envelope: mutation.intent.before, digest: mutation.intent.baseDigest });
        evidence.push({ envelope: mutation.intent.after, digest: mutation.intent.candidateDigest });
    }
    const records = new Map<string, RevisionObservation[]>();
    for (const row of evidence) {
        const key = `${row.envelope.recordKind}\0${row.envelope.recordId}`;
        const observations = records.get(key) ?? [];
        observations.push(row);
        records.set(key, observations);
    }
    const interpretedRecords: QualifiedRecordLineage[] = [...records.values()].map((observations) => ({
        recordKind: observations[0].envelope.recordKind,
        recordId: observations[0].envelope.recordId,
        observations,
        snapshotObservations: snapshots.filter(
            (row) =>
                row.envelope.recordKind === observations[0].envelope.recordKind &&
                row.envelope.recordId === observations[0].envelope.recordId
        ),
        snapshotClassification: classifyRecordRevisions(
            snapshots.filter(
                (row) =>
                    row.envelope.recordKind === observations[0].envelope.recordKind &&
                    row.envelope.recordId === observations[0].envelope.recordId
            )
        ),
        classification: classifyRecordRevisions(observations),
    }));
    const complete = aggregate.traversal.state === "COMPLETE" && Boolean(store) && !store?.hasUnavailableEvidence;
    // All consumers share these qualified records. Retained history may prove
    // ancestry of a physically observed current, but cannot replace it with an
    // unobserved recovered-only head (the accepted CANDIDATE_AHEAD distinction).
    // The classifier also receives S1's complete qualified head set when divergent;
    // absence of a singular current does not erase that stronger lineage proof.
    const classificationInputs = interpretedRecords.flatMap((record) => {
        const current = record.classification.current;
        const anchored =
            current &&
            record.snapshotObservations.some(
                (row) => row.envelope.revisionId === current.envelope.revisionId && row.digest === current.digest
            );
        return anchored ? record.observations : record.snapshotObservations;
    });
    const findings: QualifiedRecoveryFinding[] = classifyRecoveryMutations(
        mutations,
        classificationInputs,
        complete,
        interpretedRecords
    ).map((original) => {
        const mutation = original.mutation;
        const { intent, outcome } = mutation;
        const record = interpretedRecords.find(
            (row) => row.recordKind === intent.recordKind && row.recordId === intent.recordId
        );
        const effective = record?.classification;
        const anchored =
            effective?.current &&
            record?.snapshotObservations.some(
                (row) =>
                    row.envelope.revisionId === effective.current?.envelope.revisionId &&
                    row.digest === effective.current.digest
            );
        let finding: Omit<QualifiedRecoveryFinding, "locators"> = original;
        if (complete && mutation.identityValid && outcome?.status === "VERIFIED_APPLIED" && record) {
            if (
                anchored &&
                !effective?.writeGate &&
                effective?.historicalResolvedRevisionIds?.includes(intent.candidateRevisionId)
            ) {
                // S1's current-lineage-scoped resolution provenance adjudicated this
                // exact head; a stale resolver never supplies this proof.
                finding = { ...finding, state: "RESOLVED_ADJUDICATED_HISTORY", writeGate: undefined };
            }
        }
        return { ...finding, locators: [...(groups.get(intent.mutationId)?.locators ?? [])].sort() };
    });
    for (const finding of findings) if (finding.writeGate) blockers.push(finding.writeGate);
    for (const record of interpretedRecords)
        if (record.classification.writeGate) blockers.push(record.classification.writeGate);
    return { mutations: findings, blockers, records: interpretedRecords };
}
