import type { MutationIntentV1, MutationOutcomeV1 } from "./recoveryArtifacts";
import {
    classifyRecordRevisions,
    type RevisionObservation,
    type RepositoryWriteGate,
    type RecordRepositoryClassification,
} from "./repositorySemantics";

/** Inputs have already passed codec, identity-copy and intent/outcome binding validation. */
export interface ValidatedRecoveryMutation {
    readonly intent: MutationIntentV1;
    readonly outcome?: MutationOutcomeV1;
    readonly identityValid: boolean;
}

export type RecoveryFindingState =
    | "RESOLVED_HISTORY"
    | "RESOLVED_HISTORICAL_ANCESTRY"
    | "RESOLVED_QUALIFIED_HISTORY"
    | "REJECTED_HISTORY"
    | "CANDIDATE_AHEAD"
    | "COMPETING_BRANCH"
    | "INDETERMINATE"
    | "IDENTITY_INVALID"
    | "CANDIDATE_PRESENT"
    | "INTERRUPTED"
    | "AMBIGUOUS_CURRENT";

export interface MutationRecoveryFinding {
    readonly mutation: ValidatedRecoveryMutation;
    readonly state: RecoveryFindingState;
    readonly writeGate?: RepositoryWriteGate;
}

/** The complete qualified evidence and its unchanged S1 maximal-head result. */
export interface QualifiedRecoveryLineage {
    readonly observations: readonly RevisionObservation[];
    readonly classification: RecordRepositoryClassification;
}

function sameRecord(observation: RevisionObservation, intent: MutationIntentV1): boolean {
    const row = observation.envelope;
    return row.storeId === intent.storeId && row.recordKind === intent.recordKind && row.recordId === intent.recordId;
}

// Select bounded retained parent-link support for two endpoints, then delegate
// every ancestry/identity/resolution decision to the frozen S1 classifier.
function supportedRelationship(
    evidence: readonly RevisionObservation[],
    left: RevisionObservation,
    right: RevisionObservation
): RecordRepositoryClassification {
    const ids = new Set([left.envelope.revisionId, right.envelope.revisionId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const row of evidence) {
            const parent = row.envelope.parentRevisionId;
            if (ids.has(row.envelope.revisionId) && parent && !ids.has(parent)) {
                ids.add(parent);
                changed = true;
            }
        }
    }
    return classifyRecordRevisions(evidence.filter((row) => ids.has(row.envelope.revisionId)));
}

/** Pure evidence interpretation. No I/O, authorization, repair, or retention. */
export function classifyRecoveryMutations(
    mutations: readonly ValidatedRecoveryMutation[],
    currentObservations: readonly RevisionObservation[],
    currentEvidenceComplete: boolean,
    qualifiedLineages: readonly QualifiedRecoveryLineage[] = []
): readonly MutationRecoveryFinding[] {
    return mutations.map((mutation) => {
        const { intent, outcome } = mutation;
        let state: RecoveryFindingState = "INDETERMINATE";
        const snapshots = currentObservations.filter((row) => sameRecord(row, intent));
        const current = classifyRecordRevisions(snapshots);
        const candidate = { envelope: intent.after, digest: intent.candidateDigest };
        const exact = (row: RevisionObservation | undefined, expected: RevisionObservation) =>
            row?.envelope.revisionId === expected.envelope.revisionId && row.digest === expected.digest;
        if (!mutation.identityValid) state = "IDENTITY_INVALID";
        else if (outcome?.status === "PRECONDITION_REJECTED") state = "REJECTED_HISTORY";
        else if (currentEvidenceComplete && current.current && !current.writeGate) {
            if (outcome?.status === "VERIFIED_APPLIED") {
                // Validated prior snapshots and verified candidates supply retained parent-link
                // evidence. Rejected/uncertain candidates cannot become branch evidence.
                const evidence = [
                    ...snapshots,
                    candidate,
                    ...mutations.flatMap((item) => {
                        if (
                            !item.identityValid ||
                            item.outcome?.status !== "VERIFIED_APPLIED" ||
                            !sameRecord({ envelope: item.intent.after, digest: item.intent.candidateDigest }, intent)
                        )
                            return [];
                        return [
                            ...(item.intent.before && item.intent.baseDigest
                                ? [{ envelope: item.intent.before, digest: item.intent.baseDigest }]
                                : []),
                            { envelope: item.intent.after, digest: item.intent.candidateDigest },
                        ];
                    }),
                ];
                // Select bounded supporting evidence for these two endpoints. Other mutations
                // are classified independently; a competing head is never globally exempted.
                const relation = supportedRelationship(evidence, candidate, current.current);
                if (relation.state === "REVISION_IDENTITY_INVALID") state = "IDENTITY_INVALID";
                else if (!relation.writeGate && exact(current.current, candidate)) state = "RESOLVED_HISTORY";
                else if (relation.state === "LINEAR_DESCENDANT" && exact(relation.current, current.current))
                    state = "RESOLVED_HISTORICAL_ANCESTRY";
                else if (relation.state === "LINEAR_DESCENDANT" && exact(relation.current, candidate))
                    state = "CANDIDATE_AHEAD";
                else if (relation.state === "DIVERGENT_VALID_REVISIONS") state = "COMPETING_BRANCH";
            } else if (exact(current.current, candidate)) state = "CANDIDATE_PRESENT";
            else if (
                intent.before &&
                intent.baseDigest &&
                exact(current.current, { envelope: intent.before, digest: intent.baseDigest })
            )
                state = "INTERRUPTED";
            else state = "AMBIGUOUS_CURRENT";
        } else if (current.state === "REVISION_IDENTITY_INVALID") state = "IDENTITY_INVALID";
        const qualified = qualifiedLineages.find((record) =>
            record.observations.some((row) => sameRecord(row, intent))
        );
        if (currentEvidenceComplete && mutation.identityValid && outcome?.status === "VERIFIED_APPLIED") {
            const effective = qualified?.classification;
            if (effective?.state === "REVISION_IDENTITY_INVALID") state = "IDENTITY_INVALID";
            else if (
                effective?.state === "DIVERGENT_VALID_REVISIONS" &&
                effective.currentHeads?.length &&
                qualified?.observations.some((row) => exact(row, candidate))
            ) {
                // S1 has already proved the complete maximal head set from these exact
                // qualified observations. A non-head is positively superseded by ancestry
                // or effective resolution provenance; it need not precede every head.
                // A recovered head ahead of the physical current remains blocking.
                if (effective.currentHeads.some((head) => exact(head, candidate))) {
                    const physicalHeads = current.current
                        ? [current.current]
                        : current.state === "DIVERGENT_VALID_REVISIONS"
                          ? (current.currentHeads ?? [])
                          : [];
                    const ahead = physicalHeads.some((head) => {
                        const relationship = supportedRelationship(qualified.observations, candidate, head);
                        return (
                            relationship.state === "LINEAR_DESCENDANT" &&
                            exact(relationship.current, candidate) &&
                            !exact(head, candidate)
                        );
                    });
                    state = state === "CANDIDATE_AHEAD" || ahead ? "CANDIDATE_AHEAD" : "COMPETING_BRANCH";
                } else state = "RESOLVED_QUALIFIED_HISTORY";
            }
        }
        const resolved = [
            "RESOLVED_HISTORY",
            "RESOLVED_HISTORICAL_ANCESTRY",
            "RESOLVED_QUALIFIED_HISTORY",
            "REJECTED_HISTORY",
        ].includes(state);
        return {
            mutation,
            state,
            writeGate: resolved
                ? undefined
                : {
                      scope: "record",
                      storeId: intent.storeId,
                      recordId: intent.recordId,
                      reason: "Unresolved mutation evidence requires recovery before another transition.",
                  },
        };
    });
}
