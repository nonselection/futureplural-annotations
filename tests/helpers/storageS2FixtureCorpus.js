import {
    createNamespaceArtifact,
    encodeNamespaceArtifact,
    encodeProtocolFenceArtifact,
    encodeRepresentationStateArtifact,
    encodeStoreArtifact,
} from "../../src/storage/authorityArtifacts";
import { encodeCanonicalRevisionEnvelope } from "../../src/storage/envelopes";

const encoder = new TextEncoder();

export const STORAGE_S2_FIXTURE_CODEC = Object.freeze({
    recordKind: "test.storage-s2-fixture",
    schemaVersion: 1,
    isRecordId: (value) => typeof value === "string" && value.startsWith("s2-fixture-"),
    validatePayload: (value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object payload");
        return value;
    },
});

export const STORAGE_S2_FIXTURE_IDS = Object.freeze({
    storeA: "fk-store-00000000-0000-4000-8000-000000000001",
    storeB: "fk-store-00000000-0000-4000-8000-000000000002",
    revisionRoot: "fk-revision-00000000-0000-4000-8000-000000000001",
    revisionChildA: "fk-revision-00000000-0000-4000-8000-000000000002",
    revisionChildB: "fk-revision-00000000-0000-4000-8000-000000000003",
    migration: "fk-migration-00000000-0000-4000-8000-000000000001",
    stateRoot: "fk-representation-state-00000000-0000-4000-8000-000000000001",
    stateChildA: "fk-representation-state-00000000-0000-4000-8000-000000000002",
    stateChildB: "fk-representation-state-00000000-0000-4000-8000-000000000003",
});

const namespaceBytes = () => encoder.encode(encodeNamespaceArtifact(createNamespaceArtifact()));

function revision(storeId, revisionId, parentRevisionId, value) {
    return {
        storageEnvelopeVersion: 1,
        schemaVersion: 1,
        storeId,
        recordKind: STORAGE_S2_FIXTURE_CODEC.recordKind,
        recordId: "s2-fixture-shared-record",
        revisionId,
        parentRevisionId,
        resolvedRevisionIds: [],
        state: "active",
        payload: { value },
    };
}

function addStore(files, root, storeId, options = {}) {
    const candidate = `${root}/${options.collection ?? "stores"}/${options.subtree ?? "physical-locator"}`;
    files[`${root}/namespace.json`] ??= namespaceBytes();
    if (options.manifest !== false) {
        files[`${candidate}/${options.manifestName ?? "store.json"}`] = encoder.encode(
            encodeStoreArtifact({ schema: "finders-keepers.store", version: 1, storeId })
        );
    }
    for (const [index, item] of (options.revisions ?? []).entries()) {
        files[
            `${candidate}/${item.collection ?? "records"}/${item.kind ?? "sources"}/${item.fileName ?? `revision-${index}.json`}`
        ] = encoder.encode(encodeCanonicalRevisionEnvelope(item.envelope, [STORAGE_S2_FIXTURE_CODEC]));
    }
    for (const [index, item] of (options.fences ?? []).entries()) {
        const authorityCollection = item.collection ?? "protocol";
        files[`${candidate}/meta/${authorityCollection}/${item.fileName ?? `fence-${index}.json`}`] = encoder.encode(
            encodeProtocolFenceArtifact(item.artifact)
        );
    }
    for (const [index, item] of (options.states ?? []).entries()) {
        const authorityCollection = item.collection ?? "representation-states";
        files[`${candidate}/meta/${authorityCollection}/${item.fileName ?? `state-${index}.json`}`] = encoder.encode(
            encodeRepresentationStateArtifact(item.artifact)
        );
    }
    for (const [index, raw] of (options.recovery ?? []).entries()) {
        files[`${candidate}/recovery/${options.recoveryKind ?? "mutations"}/opaque-${index}.json`] =
            encoder.encode(raw);
    }
    for (const [index, raw] of (options.migrations ?? []).entries()) {
        files[`${candidate}/meta/migrations/${options.migrationChild ?? "arbitrary-locator"}/opaque-${index}.json`] =
            encoder.encode(raw);
    }
    return candidate;
}

function state(storeId, representationStateId, parentRepresentationStateId, establishedByMigrationId = null) {
    return {
        schema: "finders-keepers.representation-state",
        version: 1,
        storeId,
        representationStateId,
        parentRepresentationStateId,
        representation: "hidden",
        establishedByMigrationId,
    };
}

/** Deterministic production-format trees for the provider topology suite. */
export function buildStorageS2FixtureCorpus() {
    const ids = STORAGE_S2_FIXTURE_IDS;
    const make = () => ({});
    const corpus = {};

    const nominalClean = make();
    addStore(nominalClean, ".finders-keepers", ids.storeA);
    corpus.nominalClean = nominalClean;

    const siblingOuterRoots = make();
    addStore(siblingOuterRoots, ".finders-keepers", ids.storeA);
    addStore(siblingOuterRoots, "provider-outer-branch-alpha", ids.storeA);
    corpus.siblingOuterRoots = siblingOuterRoots;

    const recursiveUnion = make();
    addStore(recursiveUnion, ".finders-keepers", ids.storeA, {
        revisions: [
            { envelope: revision(ids.storeA, ids.revisionRoot, null, "root") },
            { envelope: revision(ids.storeA, ids.revisionChildA, ids.revisionRoot, "child") },
        ],
    });
    corpus.recursiveUnion = recursiveUnion;

    const alternateIntermediate = make();
    addStore(alternateIntermediate, "Finders Keepers", ids.storeA, {
        collection: "stores branch alpha",
        manifestName: "provider-renamed-store-artifact.json",
        revisions: [
            {
                envelope: revision(ids.storeA, ids.revisionRoot, null, "renamed record"),
                fileName: "provider-copy.json",
            },
        ],
    });
    corpus.alternateIntermediate = alternateIntermediate;

    const providerRenamedFiles = make();
    addStore(providerRenamedFiles, ".finders-keepers", ids.storeA, {
        manifestName: "provider-renamed-manifest.json",
        revisions: [
            {
                envelope: revision(ids.storeA, ids.revisionRoot, null, "same logical record"),
                fileName: "provider-renamed-record.json",
            },
        ],
    });
    // The outer root marker is also recognized by content, independent of filename.
    delete providerRenamedFiles[".finders-keepers/namespace.json"];
    providerRenamedFiles[".finders-keepers/provider-renamed-namespace.json"] = namespaceBytes();
    corpus.providerRenamedFiles = providerRenamedFiles;

    const equivalentDuplicates = make();
    const same = revision(ids.storeA, ids.revisionRoot, null, "same bytes");
    addStore(equivalentDuplicates, ".finders-keepers", ids.storeA, {
        revisions: [{ envelope: same, fileName: "copy-a.json" }],
    });
    addStore(equivalentDuplicates, "Finders Keepers", ids.storeA, {
        revisions: [{ envelope: same, fileName: "copy-b.json" }],
    });
    corpus.equivalentDuplicates = equivalentDuplicates;

    const mixedStoreBranch = make();
    const mixedStorePath = addStore(mixedStoreBranch, ".finders-keepers", ids.storeA);
    mixedStoreBranch[`${mixedStorePath}/records/sources/foreign-record.json`] = encoder.encode(
        encodeCanonicalRevisionEnvelope(revision(ids.storeB, ids.revisionRoot, null, "foreign branch value"), [
            STORAGE_S2_FIXTURE_CODEC,
        ])
    );
    corpus.mixedStoreBranch = mixedStoreBranch;

    const multipleStores = make();
    addStore(multipleStores, ".finders-keepers", ids.storeA, { subtree: "opaque-store-locator-a" });
    addStore(multipleStores, ".finders-keepers", ids.storeB, { subtree: "opaque-store-locator-b" });
    corpus.multipleStores = multipleStores;

    const splitProtocolFence = make();
    const fence = (requiredProtocolVersion) => ({
        schema: "finders-keepers.protocol-fence",
        version: 1,
        storeId: ids.storeA,
        requiredProtocolVersion,
    });
    addStore(splitProtocolFence, ".finders-keepers", ids.storeA, { fences: [{ artifact: fence(1) }] });
    addStore(splitProtocolFence, "provider-outer-branch-beta", ids.storeA, { fences: [{ artifact: fence(2) }] });
    corpus.splitProtocolFence = splitProtocolFence;

    const splitRepresentationStates = make();
    const migration = ids.migration;
    addStore(splitRepresentationStates, ".finders-keepers", ids.storeA, {
        states: [
            { artifact: state(ids.storeA, ids.stateRoot, null) },
            { artifact: state(ids.storeA, ids.stateChildA, ids.stateRoot, migration) },
        ],
    });
    addStore(splitRepresentationStates, "provider-outer-branch-gamma", ids.storeA, {
        states: [
            { artifact: state(ids.storeA, ids.stateRoot, null) },
            { artifact: state(ids.storeA, ids.stateChildB, ids.stateRoot, migration) },
        ],
    });
    corpus.splitRepresentationStates = splitRepresentationStates;

    const opaqueRecoveryMigration = make();
    const opaque =
        '{"storeId":"untrusted","mutationId":"not-validated","migrationId":"not-validated","phase":"committed"}';
    addStore(opaqueRecoveryMigration, ".finders-keepers", ids.storeA, { recovery: [opaque], migrations: [opaque] });
    addStore(opaqueRecoveryMigration, "provider-outer-branch-delta", ids.storeA, {
        recovery: [opaque],
        migrations: [opaque],
    });
    corpus.opaqueRecoveryMigration = opaqueRecoveryMigration;

    return Object.freeze(corpus);
}
