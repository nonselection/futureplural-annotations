/** Complete scoped record evidence interpretation. No permission, publication or persistent index. */
import {
    discoverStorageAggregateInvocationV05,
    type StorageAggregateInputV05,
    type StorageAggregateResultV05,
    type StorageAggregateInvocationV05,
} from "./discoveryAggregateV05";
import {
    indexQualifiedRevisionGraph,
    evaluateIndexedHeadRelations,
    type IndexedRevisionGraph,
    type RecordRepositoryState,
    type RevisionObservation,
    type CandidateLineageRelation,
    type RevisionGraphWorkEvent,
} from "./repositorySemantics";
import type { QualifiedRevisionEvidence } from "./recoveryArtifacts";
import type { StoreId, RevisionId } from "./identity";
import type {
    CompleteRevisionClaimV05,
    CanonicalArtifactFactV05,
    PriorPublicationFactV05,
} from "./discoverySemanticsV05";
import type { DiscoveryBudgetSnapshot } from "./discoveryBudget";
import { canonicalSerialize } from "./canonicalEncoding";

export interface RecordEvidenceV05 {
    readonly storeId: StoreId;
    readonly recordKind: string;
    readonly recordId: string;
    readonly qualifiedEvidence: readonly QualifiedRevisionEvidence[];
    readonly direct: readonly CanonicalArtifactFactV05[];
    readonly prior: readonly PriorPublicationFactV05[];
    readonly identityClaims: readonly CompleteRevisionClaimV05[];
}
export type RecordInterpretationV05 = RecordEvidenceV05 &
    (
        | {
              readonly interpretation: "IDENTITY_INVALID";
              readonly state: RecordRepositoryState;
              readonly reason?: string;
          }
        | { readonly interpretation: "UNQUALIFIED_EVIDENCE"; readonly state?: never }
        | {
              readonly interpretation: "INTERPRETED";
              readonly index: IndexedRevisionGraph;
              readonly qualifiedRevisionIds: readonly RevisionId[];
              readonly ordinaryMaximalHeads: readonly RevisionId[] | undefined;
              readonly hasParentCycle: boolean;
              readonly missingBoundaryIds: readonly RevisionId[];
              readonly state: RecordRepositoryState;
              readonly current?: RevisionObservation;
              readonly currentHeads: readonly RevisionObservation[];
              readonly historicalResolvedRevisionIds: readonly RevisionId[];
              readonly pairRelations: readonly CandidateLineageRelation[];
              readonly reason?: string;
          }
    );
export interface RepositoryWorkV05 {
    readonly indexBuilds: number;
    readonly graphEvents: Readonly<Partial<Record<RevisionGraphWorkEvent["kind"], number>>>;
    readonly maximaScanUnits: number;
    readonly resolutionEvents: Readonly<Partial<Record<RevisionGraphWorkEvent["kind"], number>>>;
}
interface RepositoryFactsV05 {
    readonly kind: "S2_V05_SCOPED_RECORD_REPOSITORY";
    readonly aggregate: StorageAggregateResultV05;
    readonly diagnostics: readonly RecordEvidenceV05[];
    readonly work: RepositoryWorkV05;
    readonly budget: DiscoveryBudgetSnapshot;
}
export type StorageRepositoryResultV05 = RepositoryFactsV05 &
    (
        | { readonly outcome: "COMPLETE"; readonly records: readonly RecordInterpretationV05[] }
        | {
              readonly outcome: "NOT_INTERPRETED";
              readonly reason: "UPSTREAM_INCOMPLETE" | "UPSTREAM_REFUSED" | "NARROW_COVERAGE" | "WORK_REFUSED";
              readonly records?: never;
          }
    );
interface RecordGroup {
    storeId: StoreId;
    recordKind: string;
    recordId: string;
    qualifiedEvidence: QualifiedRevisionEvidence[];
    direct: CanonicalArtifactFactV05[];
    prior: PriorPublicationFactV05[];
    identityClaims: CompleteRevisionClaimV05[];
}
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
class RecordRepository {
    #builds = 0;
    #scan = 0;
    #events: Partial<Record<RevisionGraphWorkEvent["kind"], number>> = {};
    #resolution: Partial<Record<RevisionGraphWorkEvent["kind"], number>> = {};
    #diagnostics: RecordEvidenceV05[] = [];
    constructor(private readonly observed: StorageAggregateInvocationV05) {}
    #charge(axis: "graphWork" | "resolutionWork" | "ordinaryHeads", units = 1): boolean {
        return this.observed.context.invocation.chargeWork(axis, units, 0);
    }
    #observer = (event: RevisionGraphWorkEvent): boolean => {
        if (!this.#charge("graphWork")) return false;
        this.#events[event.kind] = (this.#events[event.kind] ?? 0) + 1;
        return true;
    };
    #headObserver = (event: RevisionGraphWorkEvent): boolean => {
        if (!this.#charge("resolutionWork")) return false;
        this.#resolution[event.kind] = (this.#resolution[event.kind] ?? 0) + 1;
        return true;
    };
    #facts(): RepositoryFactsV05 {
        return Object.freeze({
            kind: "S2_V05_SCOPED_RECORD_REPOSITORY",
            aggregate: this.observed.aggregate,
            diagnostics: Object.freeze(this.#diagnostics),
            work: Object.freeze({
                indexBuilds: this.#builds,
                graphEvents: Object.freeze({ ...this.#events }),
                maximaScanUnits: this.#scan,
                resolutionEvents: Object.freeze({ ...this.#resolution }),
            }),
            budget: this.observed.context.invocation.budget(),
        });
    }
    #refuse(
        reason: Extract<StorageRepositoryResultV05, { outcome: "NOT_INTERPRETED" }>["reason"]
    ): StorageRepositoryResultV05 {
        return Object.freeze({ ...this.#facts(), outcome: "NOT_INTERPRETED", reason });
    }
    #groups(): RecordGroup[] | undefined {
        const groups = new Map<string, RecordGroup>();
        const get = (v: { storeId: StoreId; recordKind: string; recordId: string }) => {
            const key = canonicalSerialize([v.storeId, v.recordKind, v.recordId]);
            let g = groups.get(key);
            if (!g) {
                g = {
                    storeId: v.storeId,
                    recordKind: v.recordKind,
                    recordId: v.recordId,
                    qualifiedEvidence: [],
                    direct: [],
                    prior: [],
                    identityClaims: [],
                };
                groups.set(key, g);
            }
            return g;
        };
        const evidence = this.observed.aggregate.evidence;
        for (const claim of evidence.identityClaims) {
            if (!this.#charge("graphWork")) return undefined;
            get(claim.envelope).identityClaims.push(claim);
        }
        for (const fact of evidence.canonical) {
            if (!this.#charge("graphWork")) return undefined;
            const group = get(fact.envelope);
            group.direct.push(fact);
            if (fact.individualEvidence) group.qualifiedEvidence.push(fact.individualEvidence);
        }
        for (const fact of evidence.priorPublications) {
            if (!this.#charge("graphWork")) return undefined;
            const group = get(fact.preparation.value);
            group.prior.push(fact);
            if (fact.individualEvidence) group.qualifiedEvidence.push(fact.individualEvidence);
        }
        // Orphan/nonqualifying recovery content remains a record finding, never clean absence.
        for (const group of evidence.executionArtifacts) {
            for (const variant of group.variants) {
                if (!this.#charge("graphWork")) return undefined;
                get(variant.value);
            }
        }
        return [...groups].sort(([a], [b]) => compare(a, b)).map(([, g]) => g);
    }
    #record(g: RecordEvidenceV05): RecordInterpretationV05 | undefined {
        this.#builds++;
        // S1 performs identity validation before adding authority edges; all claims are supplied intact.
        const built = indexQualifiedRevisionGraph(g.qualifiedEvidence, this.#observer, g.identityClaims);
        if (built.status === "INCOMPLETE") return undefined;
        if (built.status === "INVALID")
            return Object.freeze({
                ...g,
                interpretation: "IDENTITY_INVALID",
                state: built.classification.state,
                reason: built.classification.reason,
            });
        const index = built.index;
        if (!index.revisionIds.length) return Object.freeze({ ...g, interpretation: "UNQUALIFIED_EVIDENCE" });
        const maxima: RevisionId[] = [];
        for (const id of index.revisionIds) {
            if (!this.#charge("graphWork")) return undefined;
            this.#scan++;
            if (!index.hasParentCycle && index.children(id).length === 0) {
                if (!this.#charge("ordinaryHeads")) return undefined;
                maxima.push(id);
            }
        }
        maxima.sort(compare);
        const evaluated = evaluateIndexedHeadRelations(
            index,
            index.hasParentCycle ? index.revisionIds : maxima,
            this.#headObserver
        );
        if (evaluated.status !== "COMPLETE") return undefined;
        const c = evaluated.classification;
        return Object.freeze({
            ...g,
            interpretation: "INTERPRETED",
            index,
            qualifiedRevisionIds: Object.freeze([...index.revisionIds].sort(compare)),
            ordinaryMaximalHeads: index.hasParentCycle ? undefined : Object.freeze(maxima),
            hasParentCycle: index.hasParentCycle,
            missingBoundaryIds: index.missingBoundaryIds,
            state: c.state,
            ...(c.current ? { current: c.current } : {}),
            currentHeads: Object.freeze([...(c.currentHeads ?? (c.current ? [c.current] : []))]),
            historicalResolvedRevisionIds: Object.freeze([...(c.historicalResolvedRevisionIds ?? [])]),
            pairRelations: evaluated.pairRelations,
            reason: c.reason,
        });
    }
    run(): StorageRepositoryResultV05 {
        const aggregate = this.observed.aggregate;
        if (aggregate.outcome === "INCOMPLETE") return this.#refuse("UPSTREAM_INCOMPLETE");
        if (aggregate.outcome === "COMPLETE_REFUSED") return this.#refuse("UPSTREAM_REFUSED");
        if (
            aggregate.observation.coverage !== "CONTAINING_BOUNDARIES" ||
            aggregate.manifest.some((s) => s.entryRole !== "vault-root")
        )
            return this.#refuse("NARROW_COVERAGE");
        const groups = this.#groups();
        if (!groups) return this.#refuse("WORK_REFUSED");
        this.#diagnostics = groups.map((g) =>
            Object.freeze({
                ...g,
                qualifiedEvidence: Object.freeze(g.qualifiedEvidence),
                direct: Object.freeze(g.direct),
                prior: Object.freeze(g.prior),
                identityClaims: Object.freeze(g.identityClaims),
            })
        );
        const records: RecordInterpretationV05[] = [];
        for (const group of this.#diagnostics) {
            const record = this.#record(group);
            if (!record) return this.#refuse("WORK_REFUSED");
            records.push(record);
        }
        return Object.freeze({ ...this.#facts(), outcome: "COMPLETE", records: Object.freeze(records) });
    }
}
/** Only issued observations from this discovery invocation are consumed; no public fabricated-result input. */
export function discoverStorageRepositoryV05(input: StorageAggregateInputV05): Promise<StorageRepositoryResultV05> {
    return discoverStorageAggregateInvocationV05(input).then((observed) => new RecordRepository(observed).run());
}
