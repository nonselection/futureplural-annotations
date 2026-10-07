/** Foundation-only synthetic read fixtures over the accepted S1 reference. */
import { createInMemoryPublicationFixture } from "../../src/storage/InMemoryRepresentationStorage";
import { DiscoveryInvocationV05 } from "../../src/storage/discoveryV05";

/** Small explicit test profile, not a production/B0 default. */
export function limits(overrides = {}) {
    return {
        readScopes: 8,
        structuralNodes: 100,
        listCalls: 20,
        listedEntryWork: 1000,
        readCalls: 100,
        physicalFiles: 1000,
        rawBytesRead: 10000,
        physicalBytes: 10000,
        artifactBytes: 10000,
        ...overrides,
    };
}
export function unwrap(result) {
    if (!result.ok) throw new Error(result.failure.code);
    return result.value;
}
export function fixture(count = 0, rootIdentity = "same diagnostic root") {
    const base = createInMemoryPublicationFixture({ rootIdentity });
    const directory = unwrap(base.port.directoryHandle(""));
    for (let i = 0; i < count; i++)
        base.controls.seedFile(base.port.publicationRoot, `f${String(i).padStart(4, "0")}`, new Uint8Array([i % 256]));
    const requests = [];
    const reads = [];
    const port = {
        context: base.port.context,
        rootIdentity: base.port.rootIdentity,
        directoryHandle: (locator) => base.port.directoryHandle(locator),
        fileHandle: (locator) => base.port.fileHandle(locator),
        listChildren: async (handle, limit) => {
            requests.push({ handle, limit });
            return base.port.listChildren(handle, limit);
        },
        readBytes: async (handle) => {
            reads.push(handle);
            return base.port.readBytes(handle);
        },
    };
    const scope = { port, directory, entryRole: "vault-root" };
    return {
        ...base,
        port,
        scope,
        requests,
        reads,
        invocation: (profile = limits()) => new DiscoveryInvocationV05({ scopes: [scope], limits: profile }),
    };
}

// Batch-2 fixtures extend the accepted foundation with explicit work limits only.
import { discoverPhysicalStorageTreeV05 } from "../../src/storage/discoveryV05";
import {
    encodeNamespaceArtifact,
    encodeStoreDeclaration,
    encodeProtocolFenceArtifact,
    encodeRepresentationStateArtifact,
} from "../../src/storage/authorityArtifacts";
import { encodeCanonicalRevisionEnvelope, canonicalRevisionDigest } from "../../src/storage/envelopes";
import {
    encodeRecoveryPreparation,
    encodeRecoveryReceipt,
    recoveryPreparationDigest,
} from "../../src/storage/recoveryArtifacts";
export const testId = (role, n = 1) => `fk-${role}-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const traversalLimits = (overrides = {}) => ({
    ...limits({
        structuralNodes: 1000,
        listCalls: 1000,
        listedEntryWork: 20000,
        readCalls: 1000,
        physicalFiles: 1000,
        rawBytesRead: 1000000,
        physicalBytes: 1000000,
        artifactBytes: 100000,
    }),
    decodedBytes: 2000000,
    decodeHashByteWork: 64000000,
    graphWork: 20000,
    ...overrides,
});
export const namespaceText = () => encodeNamespaceArtifact();
export const declaration = (overrides = {}) => ({
    schema: "finders-keepers.store",
    version: 2,
    storeId: testId("store"),
    bootstrapId: testId("bootstrap"),
    initialRepresentation: "hidden",
    genesisRepresentationStateId: testId("representation-state"),
    requiredProtocolVersion: 2,
    storageEnvelopeVersion: 1,
    recoveryFormatVersion: 2,
    ...overrides,
});
export const declarationText = (overrides = {}) => encodeStoreDeclaration(declaration(overrides));
export const rawBytes = (value) => (value instanceof Uint8Array ? value : new TextEncoder().encode(value));
export function traversalFixture(files = {}, directories = []) {
    const f = fixture();
    for (const directory of directories) f.controls.seedDirectory(f.scope.directory.root, directory);
    for (const [locator, value] of Object.entries(files))
        f.controls.seedFile(f.scope.directory.root, locator, rawBytes(value));
    f.traverse = (profile = traversalLimits(), scopes = [f.scope]) =>
        discoverPhysicalStorageTreeV05({ scopes, limits: profile });
    return f;
}
export const recordCodec = {
    recordKind: "test.record",
    schemaVersion: 1,
    isRecordId: (value) => value === "record-a",
    validatePayload(value) {
        if (!value || typeof value.text !== "string") throw new Error("invalid test payload");
        return value;
    },
};
export const canonicalEnvelope = () => ({
    storageEnvelopeVersion: 1,
    schemaVersion: 1,
    storeId: testId("store"),
    recordKind: "test.record",
    recordId: "record-a",
    revisionId: testId("revision"),
    parentRevisionId: null,
    resolvedRevisionIds: [],
    state: "active",
    payload: { text: "P1 retained raw" },
});
export const canonicalText = () => encodeCanonicalRevisionEnvelope(canonicalEnvelope(), [recordCodec]);
export async function recoveryTexts() {
    const after = canonicalEnvelope();
    const preparation = {
        recoveryFormatVersion: 2,
        artifactKind: "preparation",
        requiredProtocolVersion: 2,
        storeId: after.storeId,
        recordKind: after.recordKind,
        recordId: after.recordId,
        mutationId: testId("mutation"),
        canonicalPublicationId: testId("publication"),
        purpose: "transition",
        candidateRevisionId: after.revisionId,
        candidateDigest: await canonicalRevisionDigest(after),
        after,
        baseRevisionId: null,
        baseDigest: null,
        resolutionHeads: [],
    };
    const receipt = {
        recoveryFormatVersion: 2,
        artifactKind: "receipt",
        requiredProtocolVersion: 2,
        storeId: after.storeId,
        recordKind: after.recordKind,
        recordId: after.recordId,
        mutationId: preparation.mutationId,
        canonicalPublicationId: preparation.canonicalPublicationId,
        preparationDigest: await recoveryPreparationDigest(preparation, [recordCodec]),
        candidateRevisionId: after.revisionId,
        candidateDigest: preparation.candidateDigest,
        physicalEffect: "DISPATCH_REPORTED_SUCCESS",
        canonicalObservation: "EXACT_CANDIDATE",
    };
    return {
        preparation: await encodeRecoveryPreparation(preparation, [recordCodec]),
        receipt: encodeRecoveryReceipt(receipt, [recordCodec]),
    };
}
export const fenceText = () =>
    encodeProtocolFenceArtifact({
        schema: "finders-keepers.protocol-fence",
        version: 1,
        storeId: testId("store"),
        requiredProtocolVersion: 2,
    });
export const stateText = () =>
    encodeRepresentationStateArtifact({
        schema: "finders-keepers.representation-state",
        version: 1,
        storeId: testId("store"),
        representationStateId: testId("representation-state"),
        parentRepresentationStateId: null,
        representation: "hidden",
        establishedByMigrationId: null,
    });

// Batch-3 fixture functions do not alter the accepted Batch-2 builders/profiles.
import { discoverArtifactEvidenceV05 } from "../../src/storage/discoverySemanticsV05";
export const inventoryCodec = { ...recordCodec, isRecordId: (value) => value === "record-a" || value === "record-b" };
export const inventoryCodecs = [inventoryCodec, { ...inventoryCodec, recordKind: "other.record" }];
export const evidenceLimits = (overrides = {}) => ({
    ...traversalLimits({ decodedBytes: 10000000, decodeHashByteWork: 100000000, graphWork: 100000 }),
    recoveryExecutions: 100,
    completeClaims: 1000,
    identityReferences: 10000,
    recordPayloadBytes: 100000,
    ...overrides,
});
export function inventoryFixture(files = {}, directories = []) {
    const f = traversalFixture(files, directories);
    f.evidence = (profile = evidenceLimits(), codecs = inventoryCodecs, scopes = [f.scope]) =>
        discoverArtifactEvidenceV05({ scopes, limits: profile, recordCodecs: codecs });
    return f;
}
export const envelopeText = (changes = {}) =>
    encodeCanonicalRevisionEnvelope({ ...canonicalEnvelope(), ...changes }, inventoryCodecs);
export async function executionArtifacts(changes = {}, receiptChanges = {}, afterChanges = {}) {
    const after = { ...canonicalEnvelope(), ...afterChanges };
    const prep = {
        recoveryFormatVersion: 2,
        artifactKind: "preparation",
        requiredProtocolVersion: 2,
        storeId: after.storeId,
        recordKind: after.recordKind,
        recordId: after.recordId,
        mutationId: testId("mutation"),
        canonicalPublicationId: testId("publication"),
        purpose: "transition",
        candidateRevisionId: after.revisionId,
        candidateDigest: await canonicalRevisionDigest(after),
        after,
        baseRevisionId: after.parentRevisionId,
        baseDigest: after.parentRevisionId ? `sha256:${"1".repeat(64)}` : null,
        resolutionHeads: [],
        ...changes,
    };
    const receipt = {
        recoveryFormatVersion: 2,
        artifactKind: "receipt",
        requiredProtocolVersion: 2,
        storeId: prep.storeId,
        recordKind: prep.recordKind,
        recordId: prep.recordId,
        mutationId: prep.mutationId,
        canonicalPublicationId: prep.canonicalPublicationId,
        preparationDigest: await recoveryPreparationDigest(prep, inventoryCodecs),
        candidateRevisionId: prep.candidateRevisionId,
        candidateDigest: prep.candidateDigest,
        physicalEffect: "DISPATCH_REPORTED_SUCCESS",
        canonicalObservation: "EXACT_CANDIDATE",
        ...receiptChanges,
    };
    return {
        prep,
        receipt,
        prepText: await encodeRecoveryPreparation(prep, inventoryCodecs),
        receiptText: encodeRecoveryReceipt(receipt, inventoryCodecs),
    };
}

// Batch4 explicit aggregate profile; prior profiles/builders stay unchanged.
import { discoverStorageAggregateV05 } from "../../src/storage/discoveryAggregateV05";
export const aggregateLimits = (overrides = {}) => ({
    ...evidenceLimits(),
    stores: 100,
    records: 1000,
    distinctRevisions: 1000,
    parentEdges: 10000,
    ordinaryHeads: 1000,
    representationStates: 1000,
    resolutionWork: 100000,
    representationLineageWork: 10000000,
    ...overrides,
});
export function aggregateFixture(files = {}, directories = []) {
    const f = inventoryFixture(files, directories);
    f.aggregate = (profile = aggregateLimits(), codecs = inventoryCodecs, scopes = [f.scope]) =>
        discoverStorageAggregateV05({ scopes, limits: profile, recordCodecs: codecs });
    return f;
}
export const representationStateText = (overrides = {}) =>
    encodeRepresentationStateArtifact({
        schema: "finders-keepers.representation-state",
        version: 1,
        storeId: testId("store"),
        representationStateId: testId("representation-state"),
        parentRepresentationStateId: null,
        representation: "hidden",
        establishedByMigrationId: null,
        ...overrides,
    });

// Batch5 reuses the accepted aggregate profile and same physical synthetic fixture.
import { discoverStorageRepositoryV05 } from "../../src/storage/discoveryRepositoryV05";
export function repositoryFixture(files = {}, directories = []) {
    const f = aggregateFixture(files, directories);
    f.repository = (profile = aggregateLimits(), codecs = inventoryCodecs, scopes = [f.scope]) =>
        discoverStorageRepositoryV05({ scopes, limits: profile, recordCodecs: codecs });
    return f;
}
