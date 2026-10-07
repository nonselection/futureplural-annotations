/** Strict standalone successor/legacy isolation fixture; no runtime execution. */
import type {
    RepresentationReadPort,
    RepresentationReadResult,
    RepresentationDirectoryHandle,
} from "../../src/storage/RepresentationStoragePort";
import type {
    RepresentationStoragePort,
    RepresentationStorageResult,
    BoundedRepresentationListing,
} from "../../src/storage/legacy/RepresentationStoragePortV042";
import type { DiscoveryReadPort, RepresentationRootDiscovery } from "../../src/storage/discovery";
import type { StructuralDiscoverySnapshot } from "../../src/storage/discoveryTraversal";
import type { StructuralDiscoverySemantics } from "../../src/storage/discoverySemantics";
import type {
    DiscoveryInputV05,
    DiscoveryReadScopeV05,
    DiscoveryFoundationResultV05,
    FoundationScopeObservationV05,
} from "../../src/storage/discoveryV05";
import type { ImmediateListingV05, RawReadObservationV05 } from "../../src/storage/discoveryTraversalV05";
import type { DiscoveryLimitsV05 } from "../../src/storage/discoveryBudget";

declare const oldPort: RepresentationStoragePort;
declare const oldRead: DiscoveryReadPort;
declare const oldSnapshot: StructuralDiscoverySnapshot;
declare const oldRoots: RepresentationRootDiscovery;
declare const oldAggregate: StructuralDiscoverySemantics;
declare const oldListing: RepresentationStorageResult<BoundedRepresentationListing>;
declare const oldBytes: RepresentationStorageResult<Uint8Array>;
declare const readPort: RepresentationReadPort;
declare const directory: RepresentationDirectoryHandle;
declare const limits: DiscoveryLimitsV05;
declare const scope: DiscoveryReadScopeV05;
declare const input: DiscoveryInputV05;
declare const result: DiscoveryFoundationResultV05;
declare const possiblyIncompleteScope: FoundationScopeObservationV05;
const wrongCompleteScopes: Extract<DiscoveryFoundationResultV05, { status: "COMPLETE" }>["observations"] = [
    // @ts-expect-error A possibly incomplete scope cannot inhabit a complete invocation result.
    possiblyIncompleteScope,
];

const accepted: DiscoveryInputV05 = { scopes: [{ port: readPort, directory, entryRole: "vault-root" }], limits };
// @ts-expect-error Old locator/mutation port cannot satisfy the normative read contract.
const wrongPort: RepresentationReadPort = oldPort;
// @ts-expect-error Historical read-only Pick still uses locators, not correlated handles/context.
const wrongRead: RepresentationReadPort = oldRead;
// @ts-expect-error Old port cannot enter the scope even with a legitimate handle and complete limits.
const wrongScope: DiscoveryReadScopeV05 = { port: oldPort, directory, entryRole: "vault-root" };
// @ts-expect-error Paths/root labels cannot substitute for issued handles.
const wrongHandle: DiscoveryReadScopeV05 = { port: readPort, directory: "", entryRole: "vault-root" };
// @ts-expect-error Foundation supports only the two accepted grammar entry roles.
const wrongRole: DiscoveryReadScopeV05 = { ...scope, entryRole: "store-subtree" };
// @ts-expect-error Explicit complete limits are mandatory.
const absentLimits: DiscoveryInputV05 = { scopes: [scope] };
// @ts-expect-error Historical snapshots have no successor foundation kind/manifest/budget.
const wrongSnapshot: DiscoveryFoundationResultV05 = oldSnapshot;
// @ts-expect-error Old root output is not a successor result.
const wrongRoots: DiscoveryFoundationResultV05 = oldRoots;
// @ts-expect-error Old aggregate classification is not a successor result.
const wrongAggregate: DiscoveryFoundationResultV05 = oldAggregate;
// @ts-expect-error Old result envelopes/failures cannot satisfy successor list results.
const wrongListing: ImmediateListingV05 = oldListing;
// @ts-expect-error Old raw result envelope/failure cannot satisfy successor raw observations.
const wrongBytes: RawReadObservationV05 = oldBytes;
// @ts-expect-error Normative read envelopes are not complete foundation observations either.
const wrongNormativeEnvelope: RawReadObservationV05 = {} as RepresentationReadResult<Uint8Array>;
// @ts-expect-error A partial listing cannot satisfy the complete listing variant.
const wrongComplete: Extract<ImmediateListingV05, { status: "COMPLETE" }> = {} as Extract<
    ImmediateListingV05,
    { status: "INCOMPLETE" }
>;
// @ts-expect-error No old permission fields are exposed by Batch 1.
void result.mayMutate;
// @ts-expect-error No actual repository heads exist in the foundation.
void result.heads;
// @ts-expect-error No store-qualified absence is present.
void result.storeBoundAbsence;
// @ts-expect-error Read-only successor port cannot reach old mutation methods.
void input.scopes[0].port.createImmutable;
// @ts-expect-error No mutable snapshot/CAS surface.
void input.scopes[0].port.writeSnapshot;
// @ts-expect-error No publication methods on the declared successor read surface.
void input.scopes[0].port.publishFresh;

// Root facades retain exactly the legacy call signatures without migrating callers.
import { discoverPhysicalStorageTree } from "../../src/storage/discoveryTraversal";
import { discoverPhysicalStorageTree as legacyTree } from "../../src/storage/legacy/discoveryTraversalV042";
import { aggregateStructuralDiscovery } from "../../src/storage/discoverySemantics";
import { aggregateStructuralDiscovery as legacyAggregate } from "../../src/storage/legacy/discoverySemanticsV042";
const facadeTree: typeof legacyTree = discoverPhysicalStorageTree;
const facadeAggregate: typeof legacyAggregate = aggregateStructuralDiscovery;
void [
    wrongCompleteScopes,
    accepted,
    wrongPort,
    wrongRead,
    wrongScope,
    wrongHandle,
    wrongRole,
    absentLimits,
    wrongSnapshot,
    wrongRoots,
    wrongAggregate,
    wrongListing,
    wrongBytes,
    wrongNormativeEnvelope,
    wrongComplete,
    facadeTree,
    facadeAggregate,
];

// Additive Batch-2 input/result limits preserve the closed Batch-1 surface.
import type { DiscoveryTraversalInputV05 } from "../../src/storage/discoveryV05";
import type {
    PhysicalStorageTraversalV05,
    QualifiedStoreBoundAbsenceV05,
} from "../../src/storage/discoveryTraversalV05";
declare const traversal: PhysicalStorageTraversalV05;
declare const partialTraversal: Extract<PhysicalStorageTraversalV05, { status: "INCOMPLETE" }>;
// @ts-expect-error Batch2 requires its explicit decode/hash/graph work limits.
const missingTraversalWork: DiscoveryTraversalInputV05 = input;
// @ts-expect-error An incomplete traversal has no issued absence witness.
const wrongPartialWitness: QualifiedStoreBoundAbsenceV05 = partialTraversal.storeBoundAbsence;
// @ts-expect-error Witness cannot be manufactured from strings or manifest shape.
const fabricatedWitness: QualifiedStoreBoundAbsenceV05 = {
    kind: "QUALIFIED_STORE_BOUND_ABSENCE",
    manifest: result.manifest,
};
// @ts-expect-error Historical result is not successor structural traversal.
const oldTraversal: PhysicalStorageTraversalV05 = oldSnapshot;
// @ts-expect-error No canonical admission is exposed by Batch2.
void traversal.qualifiedRevisionEvidence;
// @ts-expect-error No recovery qualification is exposed by Batch2.
void traversal.priorPublicationEvidence;
// @ts-expect-error No aggregate health/permission fields.
void traversal.mayBootstrap;
// @ts-expect-error No actual head inventory.
void traversal.heads;
void [missingTraversalWork, wrongPartialWitness, fabricatedWitness, oldTraversal];

// Batch3 supplies individual evidence and complete claims, never a complete repository/index.
import type { ArtifactEvidenceInputV05, ArtifactEvidenceResultV05 } from "../../src/storage/discoverySemanticsV05";
import type { QualifiedRevisionEvidence } from "../../src/storage/recoveryArtifacts";
import type { RevisionObservation } from "../../src/storage/repositorySemantics";
declare const artifacts: ArtifactEvidenceResultV05;
declare const evidenceInput: ArtifactEvidenceInputV05;
const completeClaimsForS1: readonly RevisionObservation[] = artifacts.identityClaims;
const directForS1: QualifiedRevisionEvidence | undefined = artifacts.canonical[0].individualEvidence;
const priorForS1: QualifiedRevisionEvidence | undefined = artifacts.priorPublications[0].individualEvidence;
// @ts-expect-error Batch3 requires explicit evidence limits and codecs.
const missingEvidenceConfig: ArtifactEvidenceInputV05 = input;
// @ts-expect-error Old snapshots cannot masquerade as successor evidence.
const legacyEvidence: ArtifactEvidenceResultV05 = oldSnapshot;
// @ts-expect-error No actual repository heads.
void artifacts.heads;
// @ts-expect-error No final record classification including empty-admitted-set absence.
void artifacts.recordClassification;
// @ts-expect-error No composed permission.
void artifacts.mayMutate;
// @ts-expect-error State content is not active representation selection.
void artifacts.activeRepresentation;
// @ts-expect-error No migration commit qualification.
void artifacts.migrationCommit;
// @ts-expect-error No complete repository authority set.
void artifacts.qualifiedRepository;
// @ts-expect-error No full fence union health.
void artifacts.fenceHealth;
// @ts-expect-error Read-only input cannot publish.
void evidenceInput.scopes[0].port.publishFresh;
void [completeClaimsForS1, directForS1, priorForS1, missingEvidenceConfig, legacyEvidence];

import type { StorageAggregateInputV05, StorageAggregateResultV05 } from "../../src/storage/discoveryAggregateV05";
declare const aggregate: StorageAggregateResultV05;
declare const incompleteAggregate: Extract<StorageAggregateResultV05, { outcome: "INCOMPLETE" }>;
declare const refusedAggregate: Extract<StorageAggregateResultV05, { outcome: "COMPLETE_REFUSED" }>;
// @ts-expect-error Full aggregate requires all 24 explicit dimensions.
const incompleteProfile: StorageAggregateInputV05 = evidenceInput;
// @ts-expect-error Incomplete variants cannot carry absence.
const partialAbsence: QualifiedStoreBoundAbsenceV05 = incompleteAggregate.storeBoundAbsence;
// @ts-expect-error Complete observation with admission refusal cannot carry absence either.
const refusedAbsence: QualifiedStoreBoundAbsenceV05 = refusedAggregate.storeBoundAbsence;
// @ts-expect-error No final record head engine.
void aggregate.currentHeads;
// @ts-expect-error No actual record classification.
void aggregate.recordClassification;
// @ts-expect-error No active representation selected by valid lineage.
void aggregate.activeRepresentation;
// @ts-expect-error No migration commit codec.
void aggregate.migrationCommit;
// @ts-expect-error No mutation permission.
void aggregate.mayMutate;
// @ts-expect-error Old snapshot cannot structurally satisfy aggregate.
const oldMetadataAggregate: StorageAggregateResultV05 = oldSnapshot;
void [incompleteProfile, partialAbsence, refusedAbsence, oldMetadataAggregate];

// Batch5 complete records are gated; diagnostic prefixes have no usable index or heads.
import type { StorageRepositoryResultV05, RecordInterpretationV05 } from "../../src/storage/discoveryRepositoryV05";
import type { IndexedRevisionGraph } from "../../src/storage/repositorySemantics";
declare const repository: StorageRepositoryResultV05;
declare const partialRepository: Extract<StorageRepositoryResultV05, { outcome: "NOT_INTERPRETED" }>;
declare const completeRepository: Extract<StorageRepositoryResultV05, { outcome: "COMPLETE" }>;
declare const interpretedRecord: Extract<RecordInterpretationV05, { interpretation: "INTERPRETED" }>;
declare const unqualifiedRecord: Extract<RecordInterpretationV05, { interpretation: "UNQUALIFIED_EVIDENCE" }>;
const sameIssuedIndex: IndexedRevisionGraph = interpretedRecord.index;
// @ts-expect-error Diagnostic prefix cannot be read as complete records.
const partialRecords: readonly RecordInterpretationV05[] = partialRepository.records;
// @ts-expect-error Diagnostics cannot expose a complete graph.
void partialRepository.diagnostics[0].index;
// @ts-expect-error Unqualified claims cannot expose ordinary heads.
void unqualifiedRecord.ordinaryMaximalHeads;
// @ts-expect-error Metadata aggregate alone is not a complete record repository.
const metadataRepository: StorageRepositoryResultV05 = aggregate;
// @ts-expect-error No resolution/mutation permission.
void repository.mayResolve;
// @ts-expect-error No bootstrap permission.
void completeRepository.mayBootstrap;
// @ts-expect-error Prior proof cannot gain materialization permission.
void interpretedRecord.mayMaterialize;
// @ts-expect-error No selected write target.
void interpretedRecord.publicationTarget;
void [sameIssuedIndex, partialRecords, metadataRepository];

// D1/D2 adds child-reference facts only; no S5 commit or representation permission.
import type { UnqualifiedMigrationCommitRequirementV05 } from "../../src/storage/discoveryAggregateV05";
import type { MigrationId, RepresentationStateId } from "../../src/storage/identity";
const commitRequirement: UnqualifiedMigrationCommitRequirementV05 =
    aggregate.representations[0].migrationCommitRequirements[0];
const childMigration: MigrationId = commitRequirement.migrationId;
const childStateIdentity: RepresentationStateId = commitRequirement.representationStateId;
// @ts-expect-error Outstanding qualification is not a valid/existing commit.
void commitRequirement.migrationCommitValid;
// @ts-expect-error Pure lineage does not select active representation.
void aggregate.representations[0].activeRepresentation;
// @ts-expect-error No migration/commit permission.
void aggregate.representations[0].mayCommit;
// @ts-expect-error Requirements are detached immutable facts.
aggregate.representations[0].migrationCommitRequirements.push(commitRequirement);
void [childMigration, childStateIdentity];
