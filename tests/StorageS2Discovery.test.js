import { describe, expect, it } from "vitest";
import {
    createNamespaceArtifact,
    encodeNamespaceArtifact,
    encodeProtocolFenceArtifact,
    encodeRepresentationStateArtifact,
    encodeStoreArtifact,
} from "../src/storage/authorityArtifacts";
import { encodeCanonicalRevisionEnvelope } from "../src/storage/envelopes";
import {
    createMigrationId,
    createRepresentationStateId,
    createRevisionId,
    createStoreId,
} from "../src/storage/identity";
import {
    discoverRepresentationRoots,
    isWithinDiscoveryDepth,
    listAllDiscoveryChildren,
} from "../src/storage/discovery";
import { recognizeDiscoveryArtifact } from "../src/storage/discoveryArtifacts";
import { discoverPhysicalStorageTree } from "../src/storage/discoveryTraversal";
import { aggregateStructuralDiscovery } from "../src/storage/discoverySemantics";
import { storageFailure, storageSuccess } from "../src/storage/RepresentationStoragePort";
import {
    buildStorageS2FixtureCorpus,
    STORAGE_S2_FIXTURE_CODEC,
    STORAGE_S2_FIXTURE_IDS,
} from "./helpers/storageS2FixtureCorpus";

const textEncoder = new TextEncoder();
const NAMESPACE_BYTES = textEncoder.encode(encodeNamespaceArtifact(createNamespaceArtifact()));
const recordCodec = {
    recordKind: "test.storage-s2-record",
    schemaVersion: 1,
    isRecordId: (value) => typeof value === "string" && value.startsWith("test-record-"),
    validatePayload: (value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object payload");
        return value;
    },
};

function readOnlyFixturePort(rootIdentity, folders = {}, options = {}) {
    const listingCalls = [];
    const mutationCalls = [];
    const port = {
        rootIdentity,
        async listChildren(directory, limit) {
            listingCalls.push({ directory, limit });
            if (options.listFailureAt === directory) return storageFailure("UNAVAILABLE", "fixture list failed");
            const value = folders[directory] ?? [];
            if (typeof value === "function") return value(limit);
            const entries = value.slice(0, limit);
            return storageSuccess({ entries, truncated: value.length > limit });
        },
        async readBytes(locator) {
            if (options.readFailureAt === locator) return storageFailure("UNAVAILABLE", "fixture read failed");
            const value = options.files?.[locator];
            if (value === undefined) return storageFailure("NOT_FOUND", "fixture file absent");
            return storageSuccess(Uint8Array.from(value));
        },
        createImmutable() {
            mutationCalls.push("createImmutable");
        },
        writeSnapshot() {
            mutationCalls.push("writeSnapshot");
        },
        rename() {
            mutationCalls.push("rename");
        },
        delete() {
            mutationCalls.push("delete");
        },
    };
    return { port, listingCalls, mutationCalls };
}

function treeFixturePort(files, listingTransform) {
    const mutationCalls = [];
    const bytesByPath = new Map(Object.entries(files).map(([path, bytes]) => [path, Uint8Array.from(bytes)]));
    return {
        mutationCalls,
        port: {
            rootIdentity: "synthetic-vault-root",
            async listChildren(directory, limit) {
                const prefix = directory ? `${directory}/` : "";
                const children = new Map();
                for (const path of bytesByPath.keys()) {
                    if (!path.startsWith(prefix)) continue;
                    const remainder = path.slice(prefix.length);
                    const separator = remainder.indexOf("/");
                    if (separator === 0) continue;
                    const name = separator < 0 ? remainder : remainder.slice(0, separator);
                    children.set(name, { name, kind: separator < 0 ? "file" : "directory" });
                }
                const sorted = [...children.values()].sort((left, right) => left.name.localeCompare(right.name));
                const entries = listingTransform ? listingTransform(directory, sorted) : sorted;
                return storageSuccess({ entries: entries.slice(0, limit), truncated: entries.length > limit });
            },
            async readBytes(locator) {
                const bytes = bytesByPath.get(locator);
                return bytes ? storageSuccess(Uint8Array.from(bytes)) : storageFailure("NOT_FOUND", "fixture absent");
            },
            createImmutable() {
                mutationCalls.push("createImmutable");
            },
            writeSnapshot() {
                mutationCalls.push("writeSnapshot");
            },
            rename() {
                mutationCalls.push("rename");
            },
            delete() {
                mutationCalls.push("delete");
            },
        },
    };
}

function addStore(files, root, storeId, options = {}) {
    const storePath = `${root}/stores/${options.subtreeName ?? "physical-store"}`;
    files[`${root}/namespace.json`] ??= NAMESPACE_BYTES;
    files[`${storePath}/store.json`] = textEncoder.encode(
        encodeStoreArtifact({ schema: "finders-keepers.store", version: 1, storeId })
    );
    for (const [index, revision] of (options.revisions ?? []).entries()) {
        files[`${storePath}/records/sources/${revision.fileName ?? `revision-${index}.json`}`] = textEncoder.encode(
            encodeCanonicalRevisionEnvelope(revision.envelope, [recordCodec])
        );
    }
    for (const [index, fence] of (options.fences ?? []).entries()) {
        files[`${storePath}/meta/protocol/fence-${index}.json`] = textEncoder.encode(
            encodeProtocolFenceArtifact(fence)
        );
    }
    for (const [index, state] of (options.states ?? []).entries()) {
        files[`${storePath}/meta/representation-states/state-${index}.json`] = textEncoder.encode(
            encodeRepresentationStateArtifact(state)
        );
    }
    for (const [index, raw] of (options.recovery ?? []).entries()) {
        files[`${storePath}/recovery/mutations/opaque-${index}.json`] = textEncoder.encode(raw);
    }
    for (const [index, raw] of (options.migrations ?? []).entries()) {
        files[`${storePath}/meta/migrations/arbitrary-child/opaque-${index}.json`] = textEncoder.encode(raw);
    }
    return storePath;
}

function makeRevision(storeId, revisionId, parentRevisionId, payloadValue) {
    return {
        storageEnvelopeVersion: 1,
        schemaVersion: 1,
        storeId,
        recordKind: recordCodec.recordKind,
        recordId: "test-record-shared",
        revisionId,
        parentRevisionId,
        resolvedRevisionIds: [],
        state: "active",
        payload: { value: payloadValue },
    };
}

describe("Storage S2 bounded discovery primitives", () => {
    it("completes a listing beyond the initial page without a sibling-count cap", async () => {
        const entries = Array.from({ length: 73 }, (_value, index) => ({
            name: `candidate-${String(index).padStart(2, "0")}`,
            kind: "directory",
        }));
        const fixture = readOnlyFixturePort("large-root", { "": entries });

        const result = await listAllDiscoveryChildren(fixture.port, "");

        expect(result.ok).toBe(true);
        expect(result.listing.status).toBe("COMPLETE");
        expect(result.listing.entries).toHaveLength(73);
        expect(fixture.listingCalls.map((call) => call.limit)).toEqual([64, 128]);
    });

    it("detects a listing that changes incompatibly while expanding", async () => {
        const fixture = readOnlyFixturePort("changing-root", {
            "": (limit) =>
                storageSuccess({
                    entries: limit === 64 ? [{ name: "old", kind: "directory" }] : [{ name: "new", kind: "directory" }],
                    truncated: limit === 64,
                }),
        });

        const result = await listAllDiscoveryChildren(fixture.port, "");

        expect(result.ok).toBe(false);
        expect(result.listing.status).toBe("INCONSISTENT");
        expect(result.listing.entries.map(({ name }) => name)).toEqual(["new", "old"]);
    });

    it("stops a truncated listing that exposes no additional children", async () => {
        const fixture = readOnlyFixturePort("stuck-root", {
            "": () => storageSuccess({ entries: [{ name: "first", kind: "directory" }], truncated: true }),
        });

        const result = await listAllDiscoveryChildren(fixture.port, "");

        expect(result.ok).toBe(false);
        expect(result.listing.status).toBe("UNAVAILABLE");
        expect(result.listing.failure?.message).toMatch(/without exposing additional child entries/);
        expect(fixture.listingCalls.map(({ limit }) => limit)).toEqual([64, 128]);
    });

    it("does not call nominal roots absent when the vault-root listing is unavailable", async () => {
        const fixture = readOnlyFixturePort("unavailable-root", {}, { listFailureAt: "" });

        const result = await discoverRepresentationRoots(fixture.port);

        expect(result.state).toBe("UNAVAILABLE");
        expect(result.candidates.filter(({ nominal }) => nominal)).toHaveLength(2);
        expect(result.candidates.filter(({ nominal }) => nominal).map(({ state }) => state)).toEqual([
            "UNAVAILABLE",
            "UNAVAILABLE",
        ]);
        expect(result.candidates.some(({ nominal, state }) => nominal && state === "ABSENT")).toBe(false);
    });

    it("does not call unobserved nominal roots absent when the vault-root listing is inconsistent", async () => {
        const fixture = readOnlyFixturePort("inconsistent-root", {
            "": (limit) =>
                storageSuccess({
                    entries: limit === 64 ? [{ name: "partial-entry", kind: "directory" }] : [],
                    truncated: limit === 64,
                }),
        });

        const result = await discoverRepresentationRoots(fixture.port);

        expect(result.rootListing.status).toBe("INCONSISTENT");
        expect(result.state).toBe("UNAVAILABLE");
        expect(result.candidates.filter(({ nominal }) => nominal).map(({ state }) => state)).toEqual([
            "UNAVAILABLE",
            "UNAVAILABLE",
        ]);
        expect(result.candidates.some(({ nominal, state }) => nominal && state === "ABSENT")).toBe(false);
    });

    it("reports nominal roots absent only after a complete root listing", async () => {
        const fixture = readOnlyFixturePort("complete-empty-root");

        const result = await discoverRepresentationRoots(fixture.port);

        expect(result.rootListing.status).toBe("COMPLETE");
        expect(result.state).toBe("COMPLETE");
        expect(result.candidates.filter(({ nominal }) => nominal).map(({ state }) => state)).toEqual([
            "ABSENT",
            "ABSENT",
        ]);
    });

    it("content-recognizes an arbitrary sibling root and ignores unrelated root folders", async () => {
        const fixture = readOnlyFixturePort(
            "vault-root",
            {
                "": [
                    { name: "ordinary-vault-folder", kind: "directory" },
                    { name: "provider-created-branch-x", kind: "directory" },
                    { name: "FK-Storage-Probe-B0", kind: "directory" },
                ],
                "ordinary-vault-folder": [{ name: "notes.json", kind: "file" }],
                "provider-created-branch-x": [{ name: "renamed-marker-from-provider.json", kind: "file" }],
                "FK-Storage-Probe-B0": [{ name: "report.json", kind: "file" }],
            },
            {
                files: {
                    "ordinary-vault-folder/notes.json": textEncoder.encode('{"note":"not FK"}'),
                    "provider-created-branch-x/renamed-marker-from-provider.json": NAMESPACE_BYTES,
                    "FK-Storage-Probe-B0/report.json": textEncoder.encode(
                        '{"probeKind":"finders-keepers-storage-probe"}'
                    ),
                },
            }
        );

        const result = await discoverRepresentationRoots(fixture.port);
        const candidateByName = new Map(result.candidates.map((candidate) => [candidate.locator, candidate]));

        expect(result.state).toBe("COMPLETE");
        expect(candidateByName.get("provider-created-branch-x").state).toBe("VALID");
        expect(candidateByName.get("ordinary-vault-folder").state).toBe("NON_FK");
        expect(candidateByName.get("FK-Storage-Probe-B0").state).toBe("NON_FK");
        expect(candidateByName.get(".finders-keepers").state).toBe("ABSENT");
        expect(candidateByName.get("Finders Keepers").state).toBe("ABSENT");
        expect(fixture.mutationCalls).toEqual([]);
    });

    it("retains malformed namespace-marker evidence and distinguishes candidate I/O failure", async () => {
        const malformed = readOnlyFixturePort(
            "vault-root",
            {
                "": [
                    { name: ".finders-keepers", kind: "directory" },
                    { name: "other-root", kind: "directory" },
                ],
                ".finders-keepers": [{ name: "namespace.json", kind: "file" }],
                "other-root": [{ name: "namespace.json", kind: "file" }],
            },
            {
                files: {
                    ".finders-keepers/namespace.json": textEncoder.encode("{"),
                    "other-root/namespace.json": NAMESPACE_BYTES,
                },
                readFailureAt: "other-root/namespace.json",
            }
        );

        const result = await discoverRepresentationRoots(malformed.port);

        expect(result.state).toBe("UNAVAILABLE");
        expect(result.candidates.find(({ locator }) => locator === ".finders-keepers").state).toBe("INVALID");
        expect(result.candidates.find(({ locator }) => locator === "other-root").state).toBe("UNAVAILABLE");
        expect(result.candidates.find(({ locator }) => locator === ".finders-keepers").markers[0].bytes).toEqual(
            textEncoder.encode("{")
        );
    });

    it("produces the same ordered roots and fingerprint for duplicate or reordered listings", async () => {
        const rootEntries = [
            { name: "root-z", kind: "directory" },
            { name: "root-a", kind: "directory" },
            { name: "root-a", kind: "directory" },
        ];
        const make = (entries) =>
            readOnlyFixturePort(
                "same-vault",
                {
                    "": entries,
                    "root-a": [{ name: "renamed.json", kind: "file" }],
                    "root-z": [{ name: "namespace.json", kind: "file" }],
                },
                { files: { "root-a/renamed.json": NAMESPACE_BYTES, "root-z/namespace.json": NAMESPACE_BYTES } }
            );
        const forward = make(rootEntries);
        const reversed = make([...rootEntries].reverse());

        const left = await discoverRepresentationRoots(forward.port);
        const right = await discoverRepresentationRoots(reversed.port);

        expect(left.candidates.map(({ locator }) => locator)).toEqual(right.candidates.map(({ locator }) => locator));
        expect(left.fingerprint).toBe(right.fingerprint);
        expect(
            left.candidates.filter(({ locator }) => locator.startsWith("root-")).map(({ locator }) => locator)
        ).toEqual(["root-a", "root-z"]);
    });

    it("stops when vault-root enumeration is unavailable and never calls mutations", async () => {
        const fixture = readOnlyFixturePort("unavailable-root", {}, { listFailureAt: "" });

        const result = await discoverRepresentationRoots(fixture.port);

        expect(result.state).toBe("UNAVAILABLE");
        expect(result.rootListing.status).toBe("UNAVAILABLE");
        expect(fixture.mutationCalls).toEqual([]);
    });

    it("reports an incomplete alternate-store candidate probe as unavailable, not absent", async () => {
        const fixture = readOnlyFixturePort(
            "vault-root",
            {
                "": [{ name: ".finders-keepers", kind: "directory" }],
                ".finders-keepers": [
                    { name: "namespace.json", kind: "file" },
                    { name: "provider-collection-alpha", kind: "directory" },
                ],
                ".finders-keepers/provider-collection-alpha": [{ name: "candidate-child", kind: "directory" }],
            },
            {
                files: { ".finders-keepers/namespace.json": NAMESPACE_BYTES },
                listFailureAt: ".finders-keepers/provider-collection-alpha/candidate-child",
            }
        );

        const result = await discoverPhysicalStorageTree(fixture.port);

        expect(result.state).toBe("UNAVAILABLE");
        expect(result.probes).toContainEqual(
            expect.objectContaining({
                locator: ".finders-keepers/provider-collection-alpha/candidate-child",
                result: "UNAVAILABLE",
            })
        );
        expect(fixture.mutationCalls).toEqual([]);
    });

    it("keeps the structural depth predicate finite", () => {
        expect(isWithinDiscoveryDepth("one/two/three/four/five/six")).toBe(true);
        expect(isWithinDiscoveryDepth("one/two/three/four/five/six/seven")).toBe(false);
    });

    it("recognizes store-bound S1 artifacts and rejects foreign bindings", async () => {
        const storeId = createStoreId();
        const otherStoreId = createStoreId();
        const encoded = encodeStoreArtifact({ schema: "finders-keepers.store", version: 1, storeId });
        const bytes = textEncoder.encode(encoded);

        const valid = await recognizeDiscoveryArtifact({
            locator: "stores/arbitrary/store-copy.json",
            context: "store-subtree",
            readStatus: "READ",
            bytes,
        });
        const foreign = await recognizeDiscoveryArtifact(
            { locator: "stores/arbitrary/store.json", context: "store-subtree", readStatus: "READ", bytes },
            { expectedStoreId: otherStoreId }
        );

        expect(valid).toMatchObject({ status: "VALID", kind: "store", value: { storeId } });
        expect(foreign).toMatchObject({ status: "INVALID", locator: "stores/arbitrary/store.json" });
    });

    it("decodes record identity and computes the S1 canonical digest without path identity", async () => {
        const storeId = createStoreId();
        const envelope = {
            storageEnvelopeVersion: 1,
            schemaVersion: 1,
            storeId,
            recordKind: recordCodec.recordKind,
            recordId: "test-record-one",
            revisionId: createRevisionId(),
            parentRevisionId: null,
            resolvedRevisionIds: [],
            state: "active",
            payload: { text: "same logical record" },
        };
        const bytes = textEncoder.encode(encodeCanonicalRevisionEnvelope(envelope, [recordCodec]));
        const result = await recognizeDiscoveryArtifact(
            {
                locator: "any-provider-name/renamed-record.json",
                context: "record-envelope",
                readStatus: "READ",
                bytes,
            },
            { recordCodecs: [recordCodec] }
        );

        expect(result.status).toBe("VALID");
        expect(result.kind).toBe("revision");
        expect(result.value).toMatchObject({ storeId, recordId: "test-record-one" });
        expect(result.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(result.rawBytes).toEqual(bytes);
    });

    it("keeps unknown protocol-namespace evidence fail-closed and migration bytes opaque", async () => {
        const unknownProtocol = await recognizeDiscoveryArtifact({
            locator: "meta/protocol/new-marker.json",
            context: "protocol-namespace",
            readStatus: "READ",
            bytes: textEncoder.encode('{"schema":"future.protocol.marker","version":9}'),
        });
        const rawMigration = textEncoder.encode(
            JSON.stringify({ migrationId: createMigrationId(), phase: "committed", storeId: "untrusted" })
        );
        const migration = await recognizeDiscoveryArtifact({
            locator: "meta/migrations/opaque-child/anything.json",
            context: "opaque-migration",
            readStatus: "READ",
            bytes: rawMigration,
        });

        expect(unknownProtocol).toMatchObject({ status: "UNKNOWN", context: "protocol-namespace" });
        expect(migration).toMatchObject({ status: "OPAQUE", kind: "opaque-migration", rawBytes: rawMigration });
        expect(migration.exactByteFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(migration).not.toHaveProperty("value");
    });

    it("preserves representation-state identity and protocol-fence store bindings", async () => {
        const storeId = createStoreId();
        const protocol = await recognizeDiscoveryArtifact({
            locator: "meta/protocol/current.json",
            context: "protocol-namespace",
            readStatus: "READ",
            bytes: textEncoder.encode(
                encodeProtocolFenceArtifact({
                    schema: "finders-keepers.protocol-fence",
                    version: 1,
                    storeId,
                    requiredProtocolVersion: 1,
                })
            ),
        });
        const state = await recognizeDiscoveryArtifact({
            locator: "meta/representation-states/state.json",
            context: "representation-state-namespace",
            readStatus: "READ",
            bytes: textEncoder.encode(
                encodeRepresentationStateArtifact({
                    schema: "finders-keepers.representation-state",
                    version: 1,
                    storeId,
                    representationStateId: createRepresentationStateId(),
                    parentRepresentationStateId: null,
                    representation: "hidden",
                    establishedByMigrationId: null,
                })
            ),
        });

        expect(protocol).toMatchObject({ status: "VALID", kind: "protocol-fence", value: { storeId } });
        expect(state).toMatchObject({ status: "VALID", kind: "representation-state", value: { storeId } });
    });

    it("distinguishes unreadable evidence from successfully read invalid JSON", async () => {
        const unavailable = await recognizeDiscoveryArtifact({
            locator: "records/sources/source.json",
            context: "record-envelope",
            readStatus: "UNAVAILABLE",
        });
        const invalid = await recognizeDiscoveryArtifact(
            {
                locator: "records/sources/provider-renamed.json",
                context: "record-envelope",
                readStatus: "READ",
                bytes: textEncoder.encode("null"),
            },
            { recordCodecs: [recordCodec] }
        );

        expect(unavailable.status).toBe("UNAVAILABLE");
        expect(invalid.status).toBe("INVALID");
        expect(invalid.rawBytes).toEqual(textEncoder.encode("null"));
    });

    it("walks only validated production structure and retains opaque recovery/migration bytes", async () => {
        const storeId = createStoreId();
        const revision = {
            storageEnvelopeVersion: 1,
            schemaVersion: 1,
            storeId,
            recordKind: recordCodec.recordKind,
            recordId: "test-record-one",
            revisionId: createRevisionId(),
            parentRevisionId: null,
            resolvedRevisionIds: [],
            state: "active",
            payload: { value: "live" },
        };
        const stateArtifact = {
            schema: "finders-keepers.representation-state",
            version: 1,
            storeId,
            representationStateId: createRepresentationStateId(),
            parentRepresentationStateId: null,
            representation: "hidden",
            establishedByMigrationId: null,
        };
        const opaqueRecovery = textEncoder.encode('{"mutationId":"unvalidated","phase":"done"}');
        const opaqueMigration = textEncoder.encode('{"migrationId":"unvalidated","phase":"committed"}');
        const fixture = treeFixturePort({
            ".finders-keepers/namespace.json": NAMESPACE_BYTES,
            ".finders-keepers/stores/store-physical-name/store.json": textEncoder.encode(
                encodeStoreArtifact({ schema: "finders-keepers.store", version: 1, storeId })
            ),
            ".finders-keepers/stores/store-physical-name/records/sources/renamed-copy.json": textEncoder.encode(
                encodeCanonicalRevisionEnvelope(revision, [recordCodec])
            ),
            ".finders-keepers/stores/store-physical-name/meta/protocol/fence.json": textEncoder.encode(
                encodeProtocolFenceArtifact({
                    schema: "finders-keepers.protocol-fence",
                    version: 1,
                    storeId,
                    requiredProtocolVersion: 1,
                })
            ),
            ".finders-keepers/stores/store-physical-name/meta/representation-states/state.json": textEncoder.encode(
                encodeRepresentationStateArtifact(stateArtifact)
            ),
            ".finders-keepers/stores/store-physical-name/recovery/mutations/opaque.json": opaqueRecovery,
            ".finders-keepers/stores/store-physical-name/meta/migrations/arbitrary-child/opaque-phase.json":
                opaqueMigration,
            ".unrelated-folder/ordinary.json": textEncoder.encode('{"user":"data"}'),
        });

        const result = await discoverPhysicalStorageTree(fixture.port, [recordCodec]);
        const candidate = result.storeCandidates.find(({ candidateLocator }) =>
            candidateLocator.endsWith("store-physical-name")
        );

        expect(result.state).toBe("COMPLETE");
        expect(candidate).toMatchObject({ state: "PARTIAL", storeIds: [storeId], hasStoreManifest: true });
        expect(
            result.artifacts.some(
                (item) => item.locator.includes("renamed-copy.json") && item.recognition.status === "VALID"
            )
        ).toBe(true);
        expect(result.artifacts.find((item) => item.locator.endsWith("recovery/mutations/opaque.json"))).toMatchObject({
            context: "opaque-recovery",
            recognition: { status: "OPAQUE", rawBytes: opaqueRecovery },
        });
        expect(result.artifacts.find((item) => item.locator.endsWith("opaque-phase.json"))).toMatchObject({
            context: "opaque-migration",
            recognition: { status: "OPAQUE", rawBytes: opaqueMigration },
        });
        expect(result.artifacts.some((item) => item.locator.startsWith(".unrelated-folder/"))).toBe(false);
        expect(fixture.mutationCalls).toEqual([]);
    });

    it("discovers alternate store collections from content without parsing provider suffixes", async () => {
        const storeId = createStoreId();
        const fixture = treeFixturePort({
            "Finders Keepers/namespace-copy.json": NAMESPACE_BYTES,
            "Finders Keepers/stores alternate branch/store-A-copy/store-copy.json": textEncoder.encode(
                encodeStoreArtifact({ schema: "finders-keepers.store", version: 1, storeId })
            ),
        });

        const result = await discoverPhysicalStorageTree(fixture.port);

        expect(result.storeCandidates).toHaveLength(1);
        expect(result.storeCandidates[0]).toMatchObject({
            storesCollectionLocator: "Finders Keepers/stores alternate branch",
            candidateLocator: "Finders Keepers/stores alternate branch/store-A-copy",
            storeIds: [storeId],
            state: "VALID",
        });
        expect(result.probes).toContainEqual({
            locator: "Finders Keepers/stores alternate branch",
            grammarPosition: "alternate stores collection",
            result: "VALIDATED_DESCENT",
            evidenceLocators: ["Finders Keepers/stores alternate branch/store-A-copy/store-copy.json"],
        });
        expect(result.unknownNodes.some((node) => node.parentContext === "representation-root")).toBe(false);
    });

    it("groups equivalent physical copies by logical revision and retains every locator", async () => {
        const storeId = createStoreId();
        const revisionId = createRevisionId();
        const envelope = makeRevision(storeId, revisionId, null, "same");
        const files = {};
        addStore(files, ".finders-keepers", storeId, { revisions: [{ envelope, fileName: "record-a.json" }] });
        addStore(files, "Finders Keepers", storeId, {
            revisions: [{ envelope, fileName: "renamed-record-copy.json" }],
        });

        const tree = await discoverPhysicalStorageTree(treeFixturePort(files).port, [recordCodec]);
        const result = await aggregateStructuralDiscovery(tree, 1);
        const record = result.logicalStores[0].records[0];

        expect(result.inventory.state).toBe("ONE_STORE");
        expect(record.classification.state).toBe("EQUIVALENT_DUPLICATE");
        expect(record.copies).toHaveLength(1);
        expect(record.copies[0].locators).toEqual([
            ".finders-keepers/stores/physical-store/records/sources/record-a.json",
            "Finders Keepers/stores/physical-store/records/sources/renamed-record-copy.json",
        ]);
    });

    it("delegates linear and divergent revision lineage to the unchanged S1 classifier", async () => {
        const storeId = createStoreId();
        const rootRevision = createRevisionId();
        const leftRevision = createRevisionId();
        const linearFiles = {};
        addStore(linearFiles, ".finders-keepers", storeId, {
            revisions: [
                { envelope: makeRevision(storeId, rootRevision, null, "root") },
                { envelope: makeRevision(storeId, leftRevision, rootRevision, "child") },
            ],
        });
        const linear = await aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(treeFixturePort(linearFiles).port, [recordCodec]),
            1
        );
        expect(linear.logicalStores[0].records[0].classification.state).toBe("LINEAR_DESCENDANT");

        const rightRevision = createRevisionId();
        const divergentFiles = {};
        addStore(divergentFiles, ".finders-keepers", storeId, {
            revisions: [
                { envelope: makeRevision(storeId, rootRevision, null, "root") },
                { envelope: makeRevision(storeId, leftRevision, rootRevision, "left") },
                { envelope: makeRevision(storeId, rightRevision, rootRevision, "right") },
            ],
        });
        const divergent = await aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(treeFixturePort(divergentFiles).port, [recordCodec]),
            1
        );
        expect(divergent.logicalStores[0].records[0].classification.state).toBe("DIVERGENT_VALID_REVISIONS");
    });

    it("retains same-revision identity conflicts and makes mixed versus multiple stores distinct", async () => {
        const storeId = createStoreId();
        const repeatedRevision = createRevisionId();
        const conflictFiles = {};
        addStore(conflictFiles, ".finders-keepers", storeId, {
            revisions: [{ envelope: makeRevision(storeId, repeatedRevision, null, "version-a") }],
        });
        addStore(conflictFiles, "Finders Keepers", storeId, {
            revisions: [{ envelope: makeRevision(storeId, repeatedRevision, null, "version-b") }],
        });
        const conflict = await aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(treeFixturePort(conflictFiles).port, [recordCodec]),
            1
        );
        expect(conflict.logicalStores[0].records[0].classification.state).toBe("REVISION_IDENTITY_INVALID");

        const multipleFiles = {};
        addStore(multipleFiles, ".finders-keepers", createStoreId(), { subtreeName: "first" });
        addStore(multipleFiles, ".finders-keepers", createStoreId(), { subtreeName: "second" });
        const multiple = await aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(treeFixturePort(multipleFiles).port),
            1
        );
        expect(multiple.inventory.state).toBe("MULTIPLE_STORE_IDS");

        const mixedFiles = {};
        const manifestStore = createStoreId();
        const foreignRecordStore = createStoreId();
        addStore(mixedFiles, ".finders-keepers", manifestStore);
        mixedFiles[".finders-keepers/stores/physical-store/records/sources/foreign.json"] = textEncoder.encode(
            encodeCanonicalRevisionEnvelope(makeRevision(foreignRecordStore, createRevisionId(), null, "foreign"), [
                recordCodec,
            ])
        );
        const mixed = await aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(treeFixturePort(mixedFiles).port, [recordCodec]),
            1
        );
        expect(mixed.inventory.state).toBe("MIXED_STORE_INVALID");
        expect(mixed.physicalCandidates[0].storeIds).toEqual([manifestStore, foreignRecordStore].sort());
    });

    it("aggregates split protocol fences and representation-state children across physical roots", async () => {
        const storeId = createStoreId();
        const fence = (requiredProtocolVersion) => ({
            schema: "finders-keepers.protocol-fence",
            version: 1,
            storeId,
            requiredProtocolVersion,
        });
        const fenceFiles = {};
        addStore(fenceFiles, ".finders-keepers", storeId, { fences: [fence(1)] });
        addStore(fenceFiles, "Finders Keepers", storeId, { fences: [fence(2)] });
        const fenceResult = await aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(treeFixturePort(fenceFiles).port),
            1
        );
        expect(fenceResult.logicalStores[0].protocolFence.state).toBe("READ_ONLY_UNSUPPORTED_NEWER_PROTOCOL");

        const unknownFiles = {};
        addStore(unknownFiles, ".finders-keepers", storeId, { fences: [fence(1)] });
        const unknownStore = ".finders-keepers/stores/physical-store";
        unknownFiles[`${unknownStore}/meta/protocol/future.json`] = textEncoder.encode(
            '{"schema":"future.fence","version":8}'
        );
        const unknownResult = await aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(treeFixturePort(unknownFiles).port),
            1
        );
        expect(unknownResult.logicalStores[0].protocolFence.state).toBe("READ_ONLY_UNRECOGNIZED_FENCE");

        const genesisId = createRepresentationStateId();
        const childA = createRepresentationStateId();
        const childB = createRepresentationStateId();
        const migrationId = createMigrationId();
        const state = (representationStateId, parentRepresentationStateId, establishedByMigrationId = null) => ({
            schema: "finders-keepers.representation-state",
            version: 1,
            storeId,
            representationStateId,
            parentRepresentationStateId,
            representation: "hidden",
            establishedByMigrationId,
        });
        const stateFiles = {};
        addStore(stateFiles, ".finders-keepers", storeId, {
            states: [state(genesisId, null), state(childA, genesisId, migrationId)],
        });
        addStore(stateFiles, "Finders Keepers", storeId, {
            states: [state(genesisId, null), state(childB, genesisId, createMigrationId())],
        });
        const stateResult = await aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(treeFixturePort(stateFiles).port),
            1
        );
        expect(stateResult.logicalStores[0].representationState.state).toBe("REPRESENTATION_STATE_DIVERGENT");
    });

    it("fails closed on an unsupported protocol-fence claim in an alternate metadata branch", async () => {
        const storeId = createStoreId();
        const foreignStoreId = createStoreId();
        const files = {};
        addStore(files, ".finders-keepers", storeId, {
            fences: [
                {
                    schema: "finders-keepers.protocol-fence",
                    version: 1,
                    storeId,
                    requiredProtocolVersion: 1,
                },
            ],
        });
        const unsupportedLocator =
            ".finders-keepers/stores/physical-store/meta/provider-metadata-branch/next-fence.json";
        files[unsupportedLocator] = textEncoder.encode(
            JSON.stringify({
                schema: "finders-keepers.protocol-fence",
                version: 2,
                storeId: foreignStoreId,
                requiredProtocolVersion: 2,
            })
        );

        const discovered = await discoverPhysicalStorageTree(treeFixturePort(files).port);
        const result = await aggregateStructuralDiscovery(discovered, 1);

        expect(discovered.artifacts.find(({ locator }) => locator === unsupportedLocator)).toMatchObject({
            context: "protocol-namespace",
            recognition: { status: "UNSUPPORTED" },
        });
        expect(result.logicalStores.find(({ storeId: id }) => id === storeId).protocolFence.state).toBe(
            "READ_ONLY_UNRECOGNIZED_FENCE"
        );
        expect(result.physicalCandidates[0].storeIds).toEqual([storeId]);
        expect(result.physicalCandidates[0].state).toBe("PARTIAL");
    });

    it("routes a wrong-store protocol fence found by traversal through the S1 store gate", async () => {
        const storeId = createStoreId();
        const foreignStoreId = createStoreId();
        const files = {};
        addStore(files, ".finders-keepers", storeId, {
            fences: [
                {
                    schema: "finders-keepers.protocol-fence",
                    version: 1,
                    storeId,
                    requiredProtocolVersion: 1,
                },
            ],
        });
        const foreignFenceLocator =
            ".finders-keepers/stores/physical-store/meta/arbitrary-authority-branch/wrong-store-fence.json";
        files[foreignFenceLocator] = textEncoder.encode(
            encodeProtocolFenceArtifact({
                schema: "finders-keepers.protocol-fence",
                version: 1,
                storeId: foreignStoreId,
                requiredProtocolVersion: 1,
            })
        );

        const discovered = await discoverPhysicalStorageTree(treeFixturePort(files).port);
        const result = await aggregateStructuralDiscovery(discovered, 1);

        expect(discovered.artifacts.find(({ locator }) => locator === foreignFenceLocator)).toMatchObject({
            context: "protocol-namespace",
            recognition: { status: "VALID", kind: "protocol-fence" },
        });
        expect(result.inventory.state).toBe("MIXED_STORE_INVALID");
        expect(result.physicalCandidates[0].storeIds).toEqual([storeId, foreignStoreId].sort());
        expect(result.logicalStores.find(({ storeId: id }) => id === storeId).protocolFence.state).toBe(
            "READ_ONLY_MIXED_STORE"
        );
    });

    it("retains unexpected leaf directories without descent and fails closed for protocol evidence", async () => {
        const storeId = createStoreId();
        const stateId = createRepresentationStateId();
        const revisionId = createRevisionId();
        const opaque = '{"uninterpreted":"recovery or migration bytes"}';
        const files = {};
        const storePath = addStore(files, ".finders-keepers", storeId, {
            revisions: [{ envelope: makeRevision(storeId, revisionId, null, "known record") }],
            fences: [
                {
                    schema: "finders-keepers.protocol-fence",
                    version: 1,
                    storeId,
                    requiredProtocolVersion: 1,
                },
            ],
            states: [
                {
                    schema: "finders-keepers.representation-state",
                    version: 1,
                    storeId,
                    representationStateId: stateId,
                    parentRepresentationStateId: null,
                    representation: "hidden",
                    establishedByMigrationId: null,
                },
            ],
            recovery: [opaque],
            migrations: [opaque],
        });
        const unexpectedDirectories = [
            {
                locator: `${storePath}/records/sources/unexpected-child`,
                parentContext: "record-envelope",
            },
            {
                locator: `${storePath}/meta/protocol/unexpected-child`,
                parentContext: "protocol-namespace",
            },
            {
                locator: `${storePath}/meta/representation-states/unexpected-child`,
                parentContext: "representation-state-namespace",
            },
            {
                locator: `${storePath}/recovery/mutations/unexpected-child`,
                parentContext: "opaque-recovery",
            },
            {
                locator: `${storePath}/meta/migrations/arbitrary-child/unexpected-child`,
                parentContext: "opaque-migration",
            },
        ];
        for (const { locator } of unexpectedDirectories) {
            files[`${locator}/must-not-be-read.json`] = textEncoder.encode('{"nested":"uninspected"}');
        }

        const fixture = treeFixturePort(files);
        const discovered = await discoverPhysicalStorageTree(fixture.port, [recordCodec]);
        const result = await aggregateStructuralDiscovery(discovered, 1);
        const candidate = result.physicalCandidates[0];

        for (const { locator, parentContext } of unexpectedDirectories) {
            expect(discovered.unknownNodes).toContainEqual(expect.objectContaining({ locator, parentContext }));
            expect(discovered.listings.map(({ locator: listed }) => listed)).not.toContain(locator);
            expect(discovered.artifacts.map(({ locator: observed }) => observed)).not.toContain(
                `${locator}/must-not-be-read.json`
            );
            expect(result.unknownEvidenceLocators).toContain(locator);
        }
        expect(candidate.state).toBe("PARTIAL");
        expect(result.logicalStores[0].protocolFence.state).toBe("READ_ONLY_UNRECOGNIZED_FENCE");
        expect(fixture.mutationCalls).toEqual([]);
    });

    it("keeps migration and recovery evidence opaque and attached only to its physical candidate", async () => {
        const storeId = createStoreId();
        const opaque = '{"storeId":"untrusted","migrationId":"unvalidated","phase":"committed"}';
        const files = {};
        addStore(files, ".finders-keepers", storeId, { recovery: [opaque], migrations: [opaque] });
        const result = await aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(treeFixturePort(files).port),
            1
        );

        expect(result.logicalStores[0].opaqueObservations).toHaveLength(2);
        expect(
            result.logicalStores[0].opaqueObservations.every(
                ({ observation }) => observation.recognition.status === "OPAQUE"
            )
        ).toBe(true);
        expect(
            result.logicalStores[0].opaqueObservations.some(({ observation }) => "value" in observation.recognition)
        ).toBe(false);
        expect(result.physicalCandidates[0].state).toBe("PARTIAL");
    });

    it("returns a stable whole-tree fingerprint across reordered and duplicated provider listings", async () => {
        const files = buildStorageS2FixtureCorpus().siblingOuterRoots;
        const ordered = treeFixturePort(files);
        const noisy = treeFixturePort(files, (_directory, entries) =>
            [...entries].reverse().concat(entries.slice(0, 1))
        );

        const first = await discoverPhysicalStorageTree(ordered.port);
        const second = await discoverPhysicalStorageTree(noisy.port);

        expect(first.storeCandidates.map(({ candidateLocator }) => candidateLocator)).toEqual(
            second.storeCandidates.map(({ candidateLocator }) => candidateLocator)
        );
        expect(first.fingerprint).toBe(second.fingerprint);
        expect(ordered.mutationCalls).toEqual([]);
        expect(noisy.mutationCalls).toEqual([]);
    });

    it("stops after a failed candidate probe instead of recursively crawling arbitrary descendants", async () => {
        const storeId = STORAGE_S2_FIXTURE_IDS.storeA;
        const fixture = treeFixturePort({
            ".finders-keepers/namespace.json": NAMESPACE_BYTES,
            ".finders-keepers/unrecognized-container/deeper-branch/inner/store.json": textEncoder.encode(
                encodeStoreArtifact({ schema: "finders-keepers.store", version: 1, storeId })
            ),
        });

        const result = await discoverPhysicalStorageTree(fixture.port);

        expect(result.storeCandidates).toEqual([]);
        expect(result.listings.map(({ locator }) => locator)).not.toContain(
            ".finders-keepers/unrecognized-container/deeper-branch/inner"
        );
        expect(result.unknownNodes.some(({ locator }) => locator === ".finders-keepers/unrecognized-container")).toBe(
            true
        );
        expect(fixture.mutationCalls).toEqual([]);
    });

    it("content-recognizes a renamed authority collection without making its directory name authoritative", async () => {
        const storeId = createStoreId();
        const files = {};
        addStore(files, ".finders-keepers", storeId);
        files[".finders-keepers/stores/physical-store/meta/authority-branch-alpha/future-name.json"] =
            textEncoder.encode(
                encodeProtocolFenceArtifact({
                    schema: "finders-keepers.protocol-fence",
                    version: 1,
                    storeId,
                    requiredProtocolVersion: 1,
                })
            );

        const result = await discoverPhysicalStorageTree(treeFixturePort(files).port);
        const aggregated = await aggregateStructuralDiscovery(result, 1);

        expect(
            result.artifacts.some(
                (item) =>
                    item.locator.endsWith("authority-branch-alpha/future-name.json") &&
                    item.context === "protocol-namespace" &&
                    item.recognition.status === "VALID"
            )
        ).toBe(true);
        expect(aggregated.logicalStores[0].protocolFence.state).toBe("WRITES_ALLOWED");
    });

    it("keeps failed metadata candidate bytes structural instead of misclassifying them as a protocol fence", async () => {
        const storeId = createStoreId();
        const files = {};
        addStore(files, ".finders-keepers", storeId);
        const unknownLocator = ".finders-keepers/stores/physical-store/meta/unrecognized-branch/note.json";
        files[unknownLocator] = textEncoder.encode('{"ordinary":"json"}');

        const result = await discoverPhysicalStorageTree(treeFixturePort(files).port);
        const aggregated = await aggregateStructuralDiscovery(result, 1);

        expect(result.artifacts.find((item) => item.locator === unknownLocator)).toMatchObject({
            context: "unknown-structural",
            readStatus: "READ",
            recognition: { status: "UNRECOGNIZED" },
        });
        expect(aggregated.logicalStores[0].protocolFence.state).toBe("READ_ONLY_MISSING_FENCE");
        expect(aggregated.unknownEvidenceLocators).toContain(unknownLocator);
        expect(result.storeCandidates[0].state).toBe("PARTIAL");
        expect(result.storeCandidates[0].artifactObservations.some((item) => item.locator === unknownLocator)).toBe(
            true
        );
    });

    it("uses the unchanged S1 classifier for indeterminate ancestry", async () => {
        const storeId = createStoreId();
        const files = {};
        addStore(files, ".finders-keepers", storeId, {
            revisions: [{ envelope: makeRevision(storeId, createRevisionId(), null, "left root") }],
        });
        addStore(files, "provider-outer-root-without-suffix-rule", storeId, {
            revisions: [{ envelope: makeRevision(storeId, createRevisionId(), null, "right root") }],
        });

        const result = await aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(treeFixturePort(files).port, [recordCodec]),
            1
        );

        expect(result.logicalStores[0].records[0].classification.state).toBe("LINEAGE_INDETERMINATE");
        expect(result.logicalStores[0].physicalCandidateLocators).toEqual([
            ".finders-keepers/stores/physical-store",
            "provider-outer-root-without-suffix-rule/stores/physical-store",
        ]);
    });

    it("runs the deterministic production-format topology corpus without mutations", async () => {
        const corpus = buildStorageS2FixtureCorpus();
        expect(Object.keys(corpus)).toEqual([
            "nominalClean",
            "siblingOuterRoots",
            "recursiveUnion",
            "alternateIntermediate",
            "providerRenamedFiles",
            "equivalentDuplicates",
            "mixedStoreBranch",
            "multipleStores",
            "splitProtocolFence",
            "splitRepresentationStates",
            "opaqueRecoveryMigration",
        ]);
        expect(buildStorageS2FixtureCorpus()).toEqual(corpus);

        for (const [topology, files] of Object.entries(corpus)) {
            const fixture = treeFixturePort(files);
            const snapshot = await discoverPhysicalStorageTree(fixture.port, [STORAGE_S2_FIXTURE_CODEC]);
            const semantics = await aggregateStructuralDiscovery(snapshot, 1);

            expect(snapshot.state, topology).toBe("COMPLETE");
            expect(snapshot.storeCandidates.length, topology).toBeGreaterThan(0);
            expect(semantics.physicalCandidates, topology).toHaveLength(snapshot.storeCandidates.length);
            expect(fixture.mutationCalls, topology).toEqual([]);
        }

        const expected = {
            nominalClean: { inventory: "ONE_STORE" },
            siblingOuterRoots: { inventory: "ONE_STORE" },
            recursiveUnion: { record: "LINEAR_DESCENDANT" },
            alternateIntermediate: { record: "RECORD_FOUND" },
            providerRenamedFiles: { record: "RECORD_FOUND" },
            equivalentDuplicates: { record: "EQUIVALENT_DUPLICATE" },
            mixedStoreBranch: { inventory: "MIXED_STORE_INVALID" },
            multipleStores: { inventory: "MULTIPLE_STORE_IDS" },
            splitProtocolFence: { fence: "READ_ONLY_UNSUPPORTED_NEWER_PROTOCOL" },
            splitRepresentationStates: { representation: "REPRESENTATION_STATE_DIVERGENT" },
            opaqueRecoveryMigration: { opaqueCount: 4 },
        };
        for (const [topology, assertion] of Object.entries(expected)) {
            const semantics = await aggregateStructuralDiscovery(
                await discoverPhysicalStorageTree(treeFixturePort(corpus[topology]).port, [STORAGE_S2_FIXTURE_CODEC]),
                1
            );
            const store = semantics.logicalStores[0];
            if (assertion.inventory) expect(semantics.inventory.state, topology).toBe(assertion.inventory);
            if (assertion.record) expect(store.records[0]?.classification.state, topology).toBe(assertion.record);
            if (assertion.fence) expect(store.protocolFence.state, topology).toBe(assertion.fence);
            if (assertion.representation)
                expect(store.representationState.state, topology).toBe(assertion.representation);
            if (assertion.opaqueCount) expect(store.opaqueObservations, topology).toHaveLength(assertion.opaqueCount);
        }
    });
});
