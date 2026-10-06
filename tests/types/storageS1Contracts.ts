/** Compile explicitly; no runtime execution or tsconfig changes. */
import type {
    StoreId,
    RevisionId,
    MutationId,
    MigrationId,
    RepresentationStateId,
    PublicationId,
    BootstrapId,
} from "../../src/storage/identity";
import type { SourceRecordId, AnnotationId } from "../../src/models/annotation";
import type { ArtifactDigest, CanonicalDigest } from "../../src/storage/canonicalEncoding";
import {
    assessStoreDeclarationSupport,
    type StoreDeclarationV2,
    type SupportedStoreDeclarationV2,
    type StoreArtifactV1,
} from "../../src/storage/authorityArtifacts";

export function identityRoleContracts(
    store: StoreId,
    revision: RevisionId,
    mutation: MutationId,
    migration: MigrationId,
    representationState: RepresentationStateId,
    publication: PublicationId,
    bootstrap: BootstrapId,
    sourceRecord: SourceRecordId,
    annotation: AnnotationId
) {
    const positiveAssignments: [
        StoreId,
        RevisionId,
        MutationId,
        MigrationId,
        RepresentationStateId,
        PublicationId,
        BootstrapId,
        SourceRecordId,
        AnnotationId,
    ] = [store, revision, mutation, migration, representationState, publication, bootstrap, sourceRecord, annotation];
    const accepts = {
        store: (id: StoreId) => id,
        revision: (id: RevisionId) => id,
        mutation: (id: MutationId) => id,
        migration: (id: MigrationId) => id,
        representationState: (id: RepresentationStateId) => id,
        publication: (id: PublicationId) => id,
        bootstrap: (id: BootstrapId) => id,
        sourceRecord: (id: SourceRecordId) => id,
        annotation: (id: AnnotationId) => id,
    };
    accepts.store(store);
    // @ts-expect-error RevisionId cannot serve as StoreId.
    accepts.store(revision);
    // @ts-expect-error MutationId cannot serve as StoreId.
    accepts.store(mutation);
    // @ts-expect-error MigrationId cannot serve as StoreId.
    accepts.store(migration);
    // @ts-expect-error RepresentationStateId cannot serve as StoreId.
    accepts.store(representationState);
    // @ts-expect-error PublicationId cannot serve as StoreId.
    accepts.store(publication);
    // @ts-expect-error BootstrapId cannot serve as StoreId.
    accepts.store(bootstrap);
    // @ts-expect-error SourceRecordId cannot serve as StoreId.
    accepts.store(sourceRecord);
    // @ts-expect-error AnnotationId cannot serve as StoreId.
    accepts.store(annotation);
    accepts.revision(revision);
    // @ts-expect-error StoreId cannot serve as RevisionId.
    accepts.revision(store);
    // @ts-expect-error MutationId cannot serve as RevisionId.
    accepts.revision(mutation);
    // @ts-expect-error MigrationId cannot serve as RevisionId.
    accepts.revision(migration);
    // @ts-expect-error RepresentationStateId cannot serve as RevisionId.
    accepts.revision(representationState);
    // @ts-expect-error PublicationId cannot serve as RevisionId.
    accepts.revision(publication);
    // @ts-expect-error BootstrapId cannot serve as RevisionId.
    accepts.revision(bootstrap);
    // @ts-expect-error SourceRecordId cannot serve as RevisionId.
    accepts.revision(sourceRecord);
    // @ts-expect-error AnnotationId cannot serve as RevisionId.
    accepts.revision(annotation);
    accepts.mutation(mutation);
    // @ts-expect-error StoreId cannot serve as MutationId.
    accepts.mutation(store);
    // @ts-expect-error RevisionId cannot serve as MutationId.
    accepts.mutation(revision);
    // @ts-expect-error MigrationId cannot serve as MutationId.
    accepts.mutation(migration);
    // @ts-expect-error RepresentationStateId cannot serve as MutationId.
    accepts.mutation(representationState);
    // @ts-expect-error PublicationId cannot serve as MutationId.
    accepts.mutation(publication);
    // @ts-expect-error BootstrapId cannot serve as MutationId.
    accepts.mutation(bootstrap);
    // @ts-expect-error SourceRecordId cannot serve as MutationId.
    accepts.mutation(sourceRecord);
    // @ts-expect-error AnnotationId cannot serve as MutationId.
    accepts.mutation(annotation);
    accepts.migration(migration);
    // @ts-expect-error StoreId cannot serve as MigrationId.
    accepts.migration(store);
    // @ts-expect-error RevisionId cannot serve as MigrationId.
    accepts.migration(revision);
    // @ts-expect-error MutationId cannot serve as MigrationId.
    accepts.migration(mutation);
    // @ts-expect-error RepresentationStateId cannot serve as MigrationId.
    accepts.migration(representationState);
    // @ts-expect-error PublicationId cannot serve as MigrationId.
    accepts.migration(publication);
    // @ts-expect-error BootstrapId cannot serve as MigrationId.
    accepts.migration(bootstrap);
    // @ts-expect-error SourceRecordId cannot serve as MigrationId.
    accepts.migration(sourceRecord);
    // @ts-expect-error AnnotationId cannot serve as MigrationId.
    accepts.migration(annotation);
    accepts.representationState(representationState);
    // @ts-expect-error StoreId cannot serve as RepresentationStateId.
    accepts.representationState(store);
    // @ts-expect-error RevisionId cannot serve as RepresentationStateId.
    accepts.representationState(revision);
    // @ts-expect-error MutationId cannot serve as RepresentationStateId.
    accepts.representationState(mutation);
    // @ts-expect-error MigrationId cannot serve as RepresentationStateId.
    accepts.representationState(migration);
    // @ts-expect-error PublicationId cannot serve as RepresentationStateId.
    accepts.representationState(publication);
    // @ts-expect-error BootstrapId cannot serve as RepresentationStateId.
    accepts.representationState(bootstrap);
    // @ts-expect-error SourceRecordId cannot serve as RepresentationStateId.
    accepts.representationState(sourceRecord);
    // @ts-expect-error AnnotationId cannot serve as RepresentationStateId.
    accepts.representationState(annotation);
    accepts.publication(publication);
    // @ts-expect-error StoreId cannot serve as PublicationId.
    accepts.publication(store);
    // @ts-expect-error RevisionId cannot serve as PublicationId.
    accepts.publication(revision);
    // @ts-expect-error MutationId cannot serve as PublicationId.
    accepts.publication(mutation);
    // @ts-expect-error MigrationId cannot serve as PublicationId.
    accepts.publication(migration);
    // @ts-expect-error RepresentationStateId cannot serve as PublicationId.
    accepts.publication(representationState);
    // @ts-expect-error BootstrapId cannot serve as PublicationId.
    accepts.publication(bootstrap);
    // @ts-expect-error SourceRecordId cannot serve as PublicationId.
    accepts.publication(sourceRecord);
    // @ts-expect-error AnnotationId cannot serve as PublicationId.
    accepts.publication(annotation);
    accepts.bootstrap(bootstrap);
    // @ts-expect-error StoreId cannot serve as BootstrapId.
    accepts.bootstrap(store);
    // @ts-expect-error RevisionId cannot serve as BootstrapId.
    accepts.bootstrap(revision);
    // @ts-expect-error MutationId cannot serve as BootstrapId.
    accepts.bootstrap(mutation);
    // @ts-expect-error MigrationId cannot serve as BootstrapId.
    accepts.bootstrap(migration);
    // @ts-expect-error RepresentationStateId cannot serve as BootstrapId.
    accepts.bootstrap(representationState);
    // @ts-expect-error PublicationId cannot serve as BootstrapId.
    accepts.bootstrap(publication);
    // @ts-expect-error SourceRecordId cannot serve as BootstrapId.
    accepts.bootstrap(sourceRecord);
    // @ts-expect-error AnnotationId cannot serve as BootstrapId.
    accepts.bootstrap(annotation);
    accepts.sourceRecord(sourceRecord);
    // @ts-expect-error StoreId cannot serve as SourceRecordId.
    accepts.sourceRecord(store);
    // @ts-expect-error RevisionId cannot serve as SourceRecordId.
    accepts.sourceRecord(revision);
    // @ts-expect-error MutationId cannot serve as SourceRecordId.
    accepts.sourceRecord(mutation);
    // @ts-expect-error MigrationId cannot serve as SourceRecordId.
    accepts.sourceRecord(migration);
    // @ts-expect-error RepresentationStateId cannot serve as SourceRecordId.
    accepts.sourceRecord(representationState);
    // @ts-expect-error PublicationId cannot serve as SourceRecordId.
    accepts.sourceRecord(publication);
    // @ts-expect-error BootstrapId cannot serve as SourceRecordId.
    accepts.sourceRecord(bootstrap);
    // @ts-expect-error AnnotationId cannot serve as SourceRecordId.
    accepts.sourceRecord(annotation);
    accepts.annotation(annotation);
    // @ts-expect-error StoreId cannot serve as AnnotationId.
    accepts.annotation(store);
    // @ts-expect-error RevisionId cannot serve as AnnotationId.
    accepts.annotation(revision);
    // @ts-expect-error MutationId cannot serve as AnnotationId.
    accepts.annotation(mutation);
    // @ts-expect-error MigrationId cannot serve as AnnotationId.
    accepts.annotation(migration);
    // @ts-expect-error RepresentationStateId cannot serve as AnnotationId.
    accepts.annotation(representationState);
    // @ts-expect-error PublicationId cannot serve as AnnotationId.
    accepts.annotation(publication);
    // @ts-expect-error BootstrapId cannot serve as AnnotationId.
    accepts.annotation(bootstrap);
    // @ts-expect-error SourceRecordId cannot serve as AnnotationId.
    accepts.annotation(sourceRecord);
    return positiveAssignments;
}

export function digestRoleContracts(canonical: CanonicalDigest, artifact: ArtifactDigest) {
    const canonicalCopy: CanonicalDigest = canonical;
    const artifactCopy: ArtifactDigest = artifact;
    // @ts-expect-error ArtifactDigest is not CanonicalDigest.
    const wrongCanonical: CanonicalDigest = artifact;
    // @ts-expect-error CanonicalDigest is not ArtifactDigest.
    const wrongArtifact: ArtifactDigest = canonical;
    return { canonicalCopy, artifactCopy, wrongCanonical, wrongArtifact };
}

export function declarationSupportContracts(decoded: StoreDeclarationV2, legacy: StoreArtifactV1) {
    const structuralCopy: StoreDeclarationV2 = decoded;
    // @ts-expect-error Decoding alone cannot produce capability-2 support proof.
    const unassessed: SupportedStoreDeclarationV2 = decoded;
    // @ts-expect-error Legacy Store1 cannot supply the declaration plan.
    const legacyPlan: StoreDeclarationV2 = legacy;
    // @ts-expect-error Legacy Store1 cannot qualify supported protocol2 authority.
    const legacySupport: SupportedStoreDeclarationV2 = legacy;
    const result = assessStoreDeclarationSupport(decoded);
    if (result.status === "SUPPORTED") {
        const supported: SupportedStoreDeclarationV2 = result.declaration;
        const protocol2: 2 = supported.requiredProtocolVersion;
        return { supported, protocol2 };
    }
    // @ts-expect-error Unsupported evidence cannot supply supported declaration proof.
    const unsupported: SupportedStoreDeclarationV2 = result.declaration;
    return { structuralCopy, unassessed, legacyPlan, legacySupport, unsupported };
}

export function recoveryRoleContracts(
    preparation: import("../../src/storage/recoveryArtifacts").RecoveryPreparationV2,
    receipt: import("../../src/storage/recoveryArtifacts").RecoveryReceiptV2,
    legacyIntent: import("../../src/storage/recoveryArtifacts").MutationIntentV1,
    legacyOutcome: import("../../src/storage/recoveryArtifacts").MutationOutcomeV1,
    result: import("../../src/storage/recoveryArtifacts").PriorPublicationValidation
) {
    const prepCopy: import("../../src/storage/recoveryArtifacts").RecoveryPreparationV2 = preparation;
    const receiptCopy: import("../../src/storage/recoveryArtifacts").RecoveryReceiptV2 = receipt;
    const effect: import("../../src/storage/publicationEffects").PhysicalEffect = receipt.physicalEffect;
    const observation: import("../../src/storage/publicationEffects").CanonicalObservation =
        receipt.canonicalObservation;
    // @ts-expect-error Recovery1 intent is not preparation2.
    const oldPreparation: import("../../src/storage/recoveryArtifacts").RecoveryPreparationV2 = legacyIntent;
    // @ts-expect-error Recovery1 outcome is not receipt2.
    const oldReceipt: import("../../src/storage/recoveryArtifacts").RecoveryReceiptV2 = legacyOutcome;
    // @ts-expect-error Preparation is not a receipt or a physical outcome.
    const preparationReceipt: import("../../src/storage/recoveryArtifacts").RecoveryReceiptV2 = preparation;
    // @ts-expect-error ArtifactDigest cannot bind candidate canonical content.
    const candidateDigest: CanonicalDigest = receipt.preparationDigest;
    // @ts-expect-error CanonicalDigest cannot bind preparation artifact content.
    const preparationDigest: ArtifactDigest = preparation.candidateDigest;
    // @ts-expect-error Legacy outcome status is not a PhysicalEffect.
    const oldEffect: import("../../src/storage/publicationEffects").PhysicalEffect = "VERIFIED_APPLIED";
    // @ts-expect-error PhysicalEffect is not a CanonicalObservation.
    const wrongObservation: import("../../src/storage/publicationEffects").CanonicalObservation = effect;
    // @ts-expect-error A complete preparation alone is not qualified evidence.
    const preparedEvidence: import("../../src/storage/recoveryArtifacts").ValidatedPriorPublicationEvidence =
        preparation;
    // @ts-expect-error A receipt alone is not qualified evidence.
    const receiptEvidence: import("../../src/storage/recoveryArtifacts").ValidatedPriorPublicationEvidence = receipt;
    // @ts-expect-error Preparation validation cannot admit direct canonical evidence.
    const preparedRole: import("../../src/storage/recoveryArtifacts").QualifiedRevisionEvidence = preparation;
    if (result.status === "QUALIFIED_PRIOR_PUBLICATION") {
        const proof: import("../../src/storage/recoveryArtifacts").ValidatedPriorPublicationEvidence = result.evidence;
        const priorRole: import("../../src/storage/recoveryArtifacts").QualifiedRevisionEvidence = {
            role: "QUALIFIED_PRIOR_PUBLICATION",
            evidence: proof,
        };
        const exact: "EXACT_CANDIDATE" = proof.canonicalObservation;
        // @ts-expect-error Qualified prior-publication evidence excludes nondispatch.
        const nondispatched: "NO_MUTATION_DISPATCHED" = proof.physicalEffect;
        // @ts-expect-error Prior-publication qualification carries no write permission.
        const writable = proof.mayMutate;
        // @ts-expect-error Prior-publication qualification carries no current-head claim.
        const current = proof.current;
        // @ts-expect-error Prior-publication qualification carries no canonical-locator presence claim.
        const present = proof.canonicalLocatorPresent;
        return { proof, priorRole, exact, nondispatched, writable, current, present };
    }
    // @ts-expect-error Failed/not-qualified evidence result exposes no qualification proof.
    const notQualified = result.evidence;
    return {
        prepCopy,
        receiptCopy,
        effect,
        observation,
        oldPreparation,
        oldReceipt,
        preparationReceipt,
        candidateDigest,
        preparationDigest,
        oldEffect,
        wrongObservation,
        preparedEvidence,
        receiptEvidence,
        preparedRole,
        notQualified,
    };
}

export function indexedGraphContracts(
    graph: import("../../src/storage/repositorySemantics").IndexedRevisionGraph,
    built: import("../../src/storage/repositorySemantics").IndexedRevisionGraphResult,
    evaluated: import("../../src/storage/repositorySemantics").IndexedHeadEvaluation,
    relation: import("../../src/storage/repositorySemantics").IndexedRevisionRelationResult,
    coverage: import("../../src/storage/repositorySemantics").IndexedExplicitResolutionValidation,
    preparation: import("../../src/storage/recoveryArtifacts").RecoveryPreparationV2
) {
    const identityClaim: import("../../src/storage/repositorySemantics").RevisionObservation = {
        envelope: preparation.after,
        digest: preparation.candidateDigest,
    };
    // @ts-expect-error Preparation content has no caller-qualified evidence role.
    const unqualified: import("../../src/storage/recoveryArtifacts").QualifiedRevisionEvidence = preparation;
    // @ts-expect-error Incomplete construction cannot be used as a complete issued graph.
    const partial: import("../../src/storage/repositorySemantics").IndexedRevisionGraph = built;
    // @ts-expect-error The graph's qualified revision inventory is immutable.
    graph.revisionIds.push(preparation.candidateRevisionId);
    if (built.status === "COMPLETE") {
        const complete: import("../../src/storage/repositorySemantics").IndexedRevisionGraph = built.index;
        const same = complete.observation(preparation.candidateRevisionId);
        void same;
    } else {
        // @ts-expect-error Neither invalid nor incomplete construction exposes a usable index.
        const missingIndex = built.index;
        void missingIndex;
    }
    if (evaluated.status === "COMPLETE") {
        const classification: import("../../src/storage/repositorySemantics").RecordRepositoryClassification =
            evaluated.classification;
        void classification;
    } else {
        // @ts-expect-error Interrupted evaluation cannot expose partially authoritative classification.
        const partialAuthority = evaluated.classification;
        void partialAuthority;
    }
    if (relation.status === "INCOMPLETE") {
        // @ts-expect-error Interrupted relation is not an unknown/known completed pair proof.
        const partialRelation = relation.relation;
        void partialRelation;
    }
    if (coverage.status === "INCOMPLETE") {
        // @ts-expect-error Interrupted coverage carries no valid/invalid completed validation result.
        const partialCoverage = coverage.validation;
        void partialCoverage;
    }
    return { identityClaim, unqualified, partial };
}

export function portablePhysicalContracts(
    read: import("../../src/storage/RepresentationStoragePort").RepresentationReadPort,
    publication: import("../../src/storage/RepresentationStoragePort").RepresentationPublicationPort,
    canonical: import("../../src/storage/RepresentationStoragePort").CanonicalRepresentationStoragePort,
    legacy: import("../../src/storage/legacy/RepresentationStoragePortV042").RepresentationStoragePort,
    oldReference: import("../../src/storage/InMemoryRepresentationStorage").InMemoryRepresentationStorage,
    context: import("../../src/storage/RepresentationStoragePort").RepresentationContextIdentity,
    root: import("../../src/storage/RepresentationStoragePort").RepresentationRootHandle,
    directory: import("../../src/storage/RepresentationStoragePort").RepresentationDirectoryHandle,
    file: import("../../src/storage/RepresentationStoragePort").RepresentationFileHandle,
    collection: import("../../src/storage/RepresentationStoragePort").PublicationCollectionHandle,
    allocation: import("../../src/storage/RepresentationStoragePort").PublicationAllocation,
    token: import("../../src/storage/RepresentationStoragePort").PublicationToken,
    effect: import("../../src/storage/RepresentationStoragePort").PublicationEffectResult,
    readResult: import("../../src/storage/RepresentationStoragePort").RepresentationReadResult<Uint8Array>,
    legacyResult: import("../../src/storage/legacy/RepresentationStoragePortV042").RepresentationStorageResult<Uint8Array>
) {
    const readOnly: import("../../src/storage/RepresentationStoragePort").RepresentationReadPort = canonical;
    const publishOnly: import("../../src/storage/RepresentationStoragePort").RepresentationPublicationPort = canonical;
    const physicalEffect: import("../../src/storage/publicationEffects").PhysicalEffect = effect.physicalEffect;
    const publicationId: PublicationId = allocation.publicationId;
    const keys: Record<
        keyof import("../../src/storage/RepresentationStoragePort").CanonicalRepresentationStoragePort,
        true
    > = {
        context: true,
        rootIdentity: true,
        publicationRoot: true,
        directoryHandle: true,
        fileHandle: true,
        listChildren: true,
        readBytes: true,
        bindPublicationCollection: true,
        allocatePublication: true,
        publishFresh: true,
        retirePublication: true,
    };
    read.directoryHandle("");
    read.fileHandle("record.json");
    const listing: Promise<
        import("../../src/storage/RepresentationStoragePort").RepresentationReadResult<
            import("../../src/storage/RepresentationStoragePort").BoundedRepresentationHandleListing
        >
    > = read.listChildren(directory, 1);
    const bytes: Promise<import("../../src/storage/RepresentationStoragePort").RepresentationReadResult<Uint8Array>> =
        read.readBytes(file);
    publication.bindPublicationCollection(directory, "canonical-revision");
    const allocated: Promise<import("../../src/storage/RepresentationStoragePort").PublicationAllocationResult> =
        publication.allocatePublication(collection);
    const published: Promise<import("../../src/storage/RepresentationStoragePort").PublicationEffectResult> =
        publication.publishFresh(allocation, new Uint8Array());
    publication.retirePublication(allocation);
    const unrecognizedRefusal: import("../../src/storage/RepresentationStoragePort").PublicationEffectResult = {
        physicalEffect: "NO_MUTATION_DISPATCHED",
        reason: "INVALID_ALLOCATION",
    };
    const binding: import("../../src/storage/RepresentationStoragePort").PublicationBinding = allocation;
    // @ts-expect-error Plain binding plus token cannot construct the allocation's issued role.
    const reassembled: import("../../src/storage/RepresentationStoragePort").PublicationAllocation = {
        ...binding,
        token,
    };
    void reassembled;
    // @ts-expect-error Legacy stronger fixture is not the v0.5 port.
    const legacyPort: import("../../src/storage/RepresentationStoragePort").CanonicalRepresentationStoragePort = legacy;
    // @ts-expect-error Old in-memory reference cannot certify portable v0.5 semantics.
    const oldPort: import("../../src/storage/RepresentationStoragePort").CanonicalRepresentationStoragePort =
        oldReference;
    // @ts-expect-error A read-only consumer need not have any publication API.
    read.publishFresh(allocation, new Uint8Array());
    // @ts-expect-error A publication-only view does not implement reads.
    publication.readBytes(file);
    // @ts-expect-error Distinct directory/file brands cannot interchange read roles.
    read.readBytes(directory);
    // @ts-expect-error Distinct file/directory brands cannot interchange listing roles.
    read.listChildren(file, 1);
    // @ts-expect-error Listing never accepts an uncorrelated locator string.
    read.listChildren("records", 1);
    // @ts-expect-error Reads never accept an uncorrelated locator string.
    read.readBytes("record.json");
    // @ts-expect-error Diagnostic root string is not a context capability.
    const stringContext: import("../../src/storage/RepresentationStoragePort").RepresentationContextIdentity =
        root.rootIdentity;
    // @ts-expect-error Root and context are distinct roles.
    const rootContext: import("../../src/storage/RepresentationStoragePort").RepresentationContextIdentity = root;
    // @ts-expect-error Context and root are distinct roles.
    const contextRoot: import("../../src/storage/RepresentationStoragePort").RepresentationRootHandle = context;
    // @ts-expect-error A file cannot bind a publication collection.
    publication.bindPublicationCollection(file, "namespace");
    // @ts-expect-error No speculative migration role in initial v0.5 contract.
    publication.bindPublicationCollection(directory, "migration");
    // @ts-expect-error Token alone is not an allocation with issued destination binding.
    publication.publishFresh(token, new Uint8Array());
    // @ts-expect-error Caller cannot select a destination leaf during allocation.
    publication.allocatePublication(collection, "override.json");
    // @ts-expect-error Caller cannot retarget publication by an extra destination argument.
    publication.publishFresh(allocation, new Uint8Array(), "override.json");
    // @ts-expect-error Allocation metadata is immutable.
    allocation.locator = "override.json";
    // @ts-expect-error Allocation artifact role cannot change.
    allocation.role = "namespace";
    // @ts-expect-error Allocation token cannot be replaced/reconstructed.
    allocation.token = token;
    // @ts-expect-error New port contains no universal exclusive create.
    canonical.createImmutable("record.json", new Uint8Array());
    // @ts-expect-error New port contains no canonical snapshot CAS.
    canonical.writeSnapshot("record.json", new Uint8Array(), null);
    // @ts-expect-error New port contains no guarded rename.
    canonical.rename("a", "b", "digest");
    // @ts-expect-error New port contains no guarded delete.
    canonical.delete("a", "digest");
    // @ts-expect-error New port claims no local exclusion guarantees.
    const guarantees = canonical.localGuarantees;
    // @ts-expect-error Publication results have no generic ok implying canonical application.
    const applied = effect.ok;
    // @ts-expect-error PhysicalEffect never includes CanonicalObservation.
    const observation = effect.canonicalObservation;
    // @ts-expect-error PhysicalEffect does not establish repository health.
    const health = effect.healthy;
    // @ts-expect-error Reported host success cannot omit validated binding.
    const unboundDispatch: import("../../src/storage/RepresentationStoragePort").PublicationEffectResult = {
        physicalEffect: "DISPATCH_REPORTED_SUCCESS",
    };
    // @ts-expect-error Strong application status is not a physical dispatch fact.
    const verifiedEffect: import("../../src/storage/publicationEffects").PhysicalEffect = "VERIFIED_APPLIED";
    // @ts-expect-error Read results contain no dispatch effect.
    const readEffect = readResult.physicalEffect;
    const mutationRead: import("../../src/storage/RepresentationStoragePort").RepresentationReadResult<Uint8Array> = {
        ok: false,
        failure: {
            // @ts-expect-error Read errors cannot contain mutation-precondition result codes.
            code: "DIGEST_MISMATCH",
            message: "bad",
        },
    };
    // @ts-expect-error Historical result failure union is not the normative read result union.
    const legacyRead: import("../../src/storage/RepresentationStoragePort").RepresentationReadResult<Uint8Array> =
        legacyResult;
    return {
        readOnly,
        publishOnly,
        physicalEffect,
        publicationId,
        keys,
        listing,
        bytes,
        allocated,
        published,
        unrecognizedRefusal,
        legacyPort,
        oldPort,
        stringContext,
        rootContext,
        contextRoot,
        guarantees,
        applied,
        observation,
        health,
        unboundDispatch,
        verifiedEffect,
        readEffect,
        mutationRead,
        legacyRead,
    };
}

export function referenceConformanceContracts(
    fixture: import("../../src/storage/InMemoryRepresentationStorage").InMemoryPublicationFixture
) {
    const port: import("../../src/storage/RepresentationStoragePort").CanonicalRepresentationStoragePort = fixture.port;
    const second: import("../../src/storage/RepresentationStoragePort").RepresentationReadPort = fixture.secondaryPort;
    const controls: import("../../src/storage/InMemoryRepresentationStorage").InMemoryPublicationFixtureControls =
        fixture.controls;
    // @ts-expect-error Fixture scheduling is not part of the normative port.
    port.scheduleNext({ kind: "unknown-pending" });
    // @ts-expect-error Internal physical files are not exposed by the port.
    const files = fixture.port.files;
    // @ts-expect-error Pending synthetic host work is not exposed by the port.
    const pending = fixture.port.pending;
    // @ts-expect-error Ground truth lives only in the separate fixture control surface.
    const truth = fixture.port.controls;
    // @ts-expect-error Portable reference has no canonical mutable snapshot operation.
    fixture.port.writeSnapshot("a", new Uint8Array(), null);
    // @ts-expect-error Optional exclusive capability is not required or advertised.
    fixture.port.createImmutable("a", new Uint8Array());
    return { port, second, controls, files, pending, truth };
}
