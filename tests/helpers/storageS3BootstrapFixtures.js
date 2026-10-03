import { InMemoryRepresentationStorage } from "../../src/storage/InMemoryRepresentationStorage";
import {
    encodeNamespaceArtifact,
    encodeStoreArtifact,
    encodeProtocolFenceArtifact,
    encodeRepresentationStateArtifact,
} from "../../src/storage/authorityArtifacts";
import { encodeCanonicalRevisionEnvelope } from "../../src/storage/envelopes";
import { discoverPhysicalStorageTree } from "../../src/storage/discoveryTraversal";
import { aggregateStructuralDiscovery } from "../../src/storage/discoverySemantics";
import { storageFailure } from "../../src/storage/RepresentationStoragePort";
import { STORAGE_S2_FIXTURE_CODEC as codec, STORAGE_S2_FIXTURE_IDS as ids } from "./storageS2FixtureCorpus";
export { codec, ids };
const encoder = new TextEncoder();
export function revision(id = ids.revisionRoot, parent = null, value = "record") {
    return {
        storageEnvelopeVersion: 1,
        schemaVersion: 1,
        storeId: ids.storeA,
        recordKind: codec.recordKind,
        recordId: "s2-fixture-shared-record",
        revisionId: id,
        parentRevisionId: parent,
        resolvedRevisionIds: [],
        state: "active",
        payload: { value },
    };
}
export async function fixture(options = {}) {
    const root = options.root ?? ".finders-keepers";
    const branch = options.branch ?? `${root}/stores/${ids.storeA}`;
    const representation = options.representation ?? "hidden";
    const storeId = options.storeId ?? ids.storeA;
    const files = options.empty
        ? {}
        : {
              [`${root}/namespace.json`]: encoder.encode(encodeNamespaceArtifact()),
              [`${branch}/store.json`]: encoder.encode(
                  encodeStoreArtifact({ schema: "finders-keepers.store", version: 1, storeId })
              ),
              [`${branch}/meta/protocol/fence.json`]: encoder.encode(
                  encodeProtocolFenceArtifact({
                      schema: "finders-keepers.protocol-fence",
                      version: 1,
                      storeId,
                      requiredProtocolVersion: options.protocolVersion ?? 1,
                  })
              ),
              [`${branch}/meta/representation-states/genesis.json`]: encoder.encode(
                  encodeRepresentationStateArtifact({
                      schema: "finders-keepers.representation-state",
                      version: 1,
                      storeId,
                      representationStateId: ids.stateRoot,
                      parentRepresentationStateId: null,
                      establishedByMigrationId: null,
                      representation,
                      ...options.stateOverrides,
                  })
              ),
          };
    for (const missing of options.missing ?? []) delete files[`${branch}/${missing}`];
    for (const [index, record] of (options.records ?? []).entries())
        files[`${branch}/records/sources/record-${index}.json`] = encoder.encode(
            encodeCanonicalRevisionEnvelope(record, [codec])
        );
    Object.assign(files, options.extraFiles ?? {});
    const base = new InMemoryRepresentationStorage(options.rootIdentity ?? "s3-batch2-fixture");
    for (const [locator, bytes] of Object.entries(files)) {
        const created = await base.createImmutable(locator, bytes);
        if (!created.ok) throw new Error(`Invalid fixture seed ${locator}`);
    }
    const events = [];
    let failedLocator;
    const port = {
        rootIdentity: base.rootIdentity,
        localGuarantees: base.localGuarantees,
        async listChildren(...args) {
            events.push({ method: "listChildren", locator: args[0] });
            if (options.beforeList) await options.beforeList(args[0], base);
            return options.listUnavailable
                ? storageFailure("UNAVAILABLE", "fixture listing unavailable")
                : base.listChildren(...args);
        },
        async readBytes(locator) {
            events.push({ method: "readBytes", locator });
            if (options.readUnavailableAfterFailure && locator === failedLocator)
                return storageFailure("UNAVAILABLE", "uncertain verification");
            return base.readBytes(locator);
        },
        async createImmutable(locator, bytes) {
            events.push({ method: "createImmutable", locator, bytes });
            if (options.failCreateAt && locator.endsWith(options.failCreateAt) && !failedLocator) {
                failedLocator = locator;
                if (options.applyBeforeError) await base.createImmutable(locator, bytes);
                return storageFailure("IO_ERROR", "injected immutable-create failure");
            }
            const result = await base.createImmutable(locator, bytes);
            if (options.afterCreate) await options.afterCreate(locator, base);
            return result;
        },
        writeSnapshot(...args) {
            events.push({ method: "writeSnapshot" });
            return base.writeSnapshot(...args);
        },
        rename(...args) {
            events.push({ method: "rename" });
            return base.rename(...args);
        },
        delete(...args) {
            events.push({ method: "delete" });
            return base.delete(...args);
        },
    };
    const target = { port, representationRootLocator: root, storeCandidateLocator: branch, representation };
    return {
        port,
        base,
        target,
        files,
        events,
        async discover() {
            return aggregateStructuralDiscovery(await discoverPhysicalStorageTree(port, [codec]), 1);
        },
    };
}
