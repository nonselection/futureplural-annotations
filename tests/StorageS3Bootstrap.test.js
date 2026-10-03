import { sha256Bytes } from "../src/storage/canonicalEncoding";
import { bootstrapStore } from "../src/storage/storeBootstrap";
import { authorizeWrite } from "../src/storage/writeAuthorization";
import { fixture, codec, ids } from "./helpers/storageS3BootstrapFixtures";
import { describe, expect, it } from "vitest";
import { encodeRepresentationStateArtifact, encodeProtocolFenceArtifact } from "../src/storage/authorityArtifacts";
import { InMemoryRepresentationStorage } from "../src/storage/InMemoryRepresentationStorage";
import { discoverPhysicalStorageTree } from "../src/storage/discoveryTraversal";
import { aggregateStructuralDiscovery } from "../src/storage/discoverySemantics";
import { buildStorageS2FixtureCorpus, STORAGE_S2_FIXTURE_IDS } from "./helpers/storageS2FixtureCorpus";

describe("Storage S3 bootstrap representation-binding seam", () => {
    it.each([".finders-keepers", "provider-renamed-root"])(
        "identifies the partial store at %s without inventing its missing genesis representation",
        async (root) => {
            const files = buildStorageS2FixtureCorpus().nominalClean;
            files[".finders-keepers/stores/physical-locator/meta/protocol/fence.json"] = new TextEncoder().encode(
                encodeProtocolFenceArtifact({
                    schema: "finders-keepers.protocol-fence",
                    version: 1,
                    storeId: STORAGE_S2_FIXTURE_IDS.storeA,
                    requiredProtocolVersion: 1,
                })
            );
            const port = new InMemoryRepresentationStorage("root-agnostic-bootstrap-fixture");
            for (const [locator, bytes] of Object.entries(files)) {
                expect((await port.createImmutable(locator.replace(".finders-keepers", root), bytes)).ok).toBe(true);
            }

            const snapshot = await discoverPhysicalStorageTree(port);
            const aggregate = await aggregateStructuralDiscovery(snapshot, 1);

            expect(snapshot.state).toBe("COMPLETE");
            expect(aggregate.inventory.state).toBe("ONE_STORE");
            expect(aggregate.physicalCandidates[0]).toMatchObject({
                candidateLocator: `${root}/stores/physical-locator`,
                storeIds: [STORAGE_S2_FIXTURE_IDS.storeA],
                state: "VALID",
            });
            expect(aggregate.logicalStores[0].protocolFence.state).toBe("WRITES_ALLOWED");
            expect(aggregate.logicalStores[0].representationState.state).toBe("REPRESENTATION_STATE_ABSENT");
            expect(snapshot.artifacts.some(({ recognition }) => recognition.kind === "representation-state")).toBe(
                false
            );
            expect(snapshot.unknownNodes).toEqual([]);
            // Store/namespace/fence content establishes identity, not representation.
            // There is no accepted content value against which a resume caller's
            // hidden/visible declaration could be checked in this interrupted state.
            for (const { recognition } of snapshot.artifacts) {
                expect(recognition.status).toBe("VALID");
                expect(recognition.value).not.toHaveProperty("representation");
            }
        }
    );
});

function request(f, mode = "bootstrap-resume", extra = {}) {
    return {
        mode,
        target: mode === "fresh-bootstrap" ? { ...f.target, storeCandidateLocator: undefined } : f.target,
        storeId: mode === "bootstrap-resume" ? ids.storeA : undefined,
        supportedProtocolVersion: 1,
        recordCodecs: [codec],
        ...extra,
    };
}
const missingGenesis = ["meta/representation-states/genesis.json"];
function noWrites(f) {
    expect(
        f.events.some(({ method }) => ["createImmutable", "writeSnapshot", "rename", "delete"].includes(method))
    ).toBe(false);
}

describe("Storage S3 resumable bootstrap", () => {
    it.each(["hidden", "visible"])(
        "fresh aggregate absence establishes caller-declared %s genesis",
        async (representation) => {
            const root = representation === "hidden" ? ".finders-keepers" : "Finders Keepers";
            const f = await fixture({ empty: true, root, representation });
            const result = await bootstrapStore(request(f, "fresh-bootstrap"));
            expect(result.state).toBe("COMPLETE");
            expect(result.branchLocator).toBe(`${root}/stores/${result.storeId}`);
            expect(result.aggregate.traversal.state).toBe("COMPLETE");
            expect(result.aggregate.inventory.state).toBe("ONE_STORE");
            expect(result.aggregate.physicalCandidates[0].state).toBe("VALID");
            expect(result.aggregate.logicalStores[0].protocolFence.state).toBe("WRITES_ALLOWED");
            expect(result.aggregate.logicalStores[0].representationState.state).toBe("REPRESENTATION_STATE_VALID");
            expect(result.aggregate.logicalStores[0].representationState.currentHeads[0].artifact).toMatchObject({
                storeId: result.storeId,
                parentRepresentationStateId: null,
                establishedByMigrationId: null,
                representation,
            });
            const creates = f.events.filter(({ method }) => method === "createImmutable");
            expect(creates.map(({ locator }) => locator)).toEqual([
                `${root}/namespace.json`,
                `${result.branchLocator}/store.json`,
                `${result.branchLocator}/meta/representation-states/genesis.json`,
                `${result.branchLocator}/meta/protocol/fence.json`,
            ]);
            expect(result.immutableAttempts.every(({ verified }) => verified)).toBe(true);
            for (const create of creates) {
                const next = f.events.slice(f.events.indexOf(create) + 1);
                expect(next.find(({ method }) => method === "readBytes").locator).toBe(create.locator);
            }
            expect(f.events.some(({ method }) => ["writeSnapshot", "rename", "delete"].includes(method))).toBe(false);
        }
    );
    it.each(["hidden", "visible"])(
        "missing genesis resumes A using explicit %s operational binding",
        async (representation) => {
            // Identical locator spelling deliberately cannot choose the representation.
            const f = await fixture({ missing: missingGenesis, representation });
            const result = await bootstrapStore(request(f));
            expect(result.state).toBe("COMPLETE");
            expect(result.storeId).toBe(ids.storeA);
            expect(result.aggregate.logicalStores[0].representationState.currentHeads[0].artifact.representation).toBe(
                representation
            );
            expect(f.events.filter(({ method }) => method === "createImmutable")).toHaveLength(1);
        }
    );
    it.each(["store.json", "meta/protocol/fence.json"])(
        "resumes a safely missing %s with the same StoreId",
        async (missing) => {
            const f = await fixture({ missing: [missing] });
            const result = await bootstrapStore(request(f));
            expect(result.state).toBe("COMPLETE");
            expect(result.storeId).toBe(ids.storeA);
            expect(result.immutableAttempts.map(({ locator }) => locator)).toEqual([
                `${f.target.storeCandidateLocator}/${missing}`,
            ]);
        }
    );
    it("existing genesis mismatch refuses without changing source bytes", async () => {
        const f = await fixture({ missing: ["meta/protocol/fence.json"] });
        const result = await bootstrapStore(
            request(f, "bootstrap-resume", { target: { ...f.target, representation: "visible" } })
        );
        expect(result.state).toBe("REFUSED");
        noWrites(f);
        expect(
            (await f.base.readBytes(`${f.target.storeCandidateLocator}/meta/representation-states/genesis.json`)).value
        ).toEqual(f.files[`${f.target.storeCandidateLocator}/meta/representation-states/genesis.json`]);
    });
    it.each(["wrong-branch", "wrong-root", "missing-branch"])(
        "refuses %s correlation without materializing another target",
        async (kind) => {
            const f = await fixture({ missing: missingGenesis });
            const target = {
                ...f.target,
                storeCandidateLocator:
                    kind === "missing-branch"
                        ? undefined
                        : kind === "wrong-branch"
                          ? `${f.target.representationRootLocator}/stores/unrelated`
                          : `Finders Keepers/stores/${ids.storeA}`,
                representationRootLocator:
                    kind === "wrong-root" ? "Finders Keepers" : f.target.representationRootLocator,
            };
            const result = await bootstrapStore(request(f, "bootstrap-resume", { target }));
            expect(result.state).toBe("REFUSED");
            noWrites(f);
        }
    );
    it("refuses a different port even if it declares the same rootIdentity", async () => {
        const f = await fixture({ missing: missingGenesis });
        const other = await fixture({ empty: true });
        const gate = await authorizeWrite(
            await f.discover(),
            { mode: "bootstrap-resume", target: { ...f.target, port: other.port }, storeId: ids.storeA },
            f.port,
            [codec]
        );
        expect(gate.authorized).toBe(false);
        expect(gate.blockers.some(({ reason }) => reason.includes("port"))).toBe(true);
        noWrites(f);
        noWrites(other);
    });
    it("refuses aggregate root identity from another discovery handle", async () => {
        const f = await fixture({ missing: missingGenesis });
        const other = await fixture({ missing: missingGenesis, rootIdentity: "other-root" });
        const gate = await authorizeWrite(
            await other.discover(),
            { mode: "bootstrap-resume", target: f.target, storeId: ids.storeA },
            f.port,
            [codec]
        );
        expect(gate.authorized).toBe(false);
        expect(gate.blockers.some(({ reason }) => reason.includes("Discovery root"))).toBe(true);
        noWrites(f);
    });
    it("fresh caller cannot attach StoreId knowledge or an existing branch to its root binding", async () => {
        const f = await fixture({ empty: true });
        expect((await bootstrapStore(request(f, "fresh-bootstrap", { target: f.target }))).state).toBe("REFUSED");
        noWrites(f);
    });
    it("resumes a provider-renamed root, intermediate collection and store branch by exact correlation", async () => {
        const f = await fixture({
            root: "arbitrary-root",
            branch: "arbitrary-root/arbitrary-collection/arbitrary-store",
            missing: missingGenesis,
            representation: "visible",
        });
        const result = await bootstrapStore(request(f));
        expect(result.state).toBe("COMPLETE");
        expect(result.storeId).toBe(ids.storeA);
        expect(result.aggregate.logicalStores[0].representationState.currentHeads[0].artifact.representation).toBe(
            "visible"
        );
        expect(result.immutableAttempts[0].locator).toBe(
            "arbitrary-root/arbitrary-collection/arbitrary-store/meta/representation-states/genesis.json"
        );
    });
    it.each([".finders-keepers", "Finders Keepers"])(
        "another complete store at %s refuses fresh and resume into the other root",
        async (root) => {
            const f = await fixture({ root });
            const opposite = root === ".finders-keepers" ? "Finders Keepers" : ".finders-keepers";
            const target = {
                ...f.target,
                representationRootLocator: opposite,
                storeCandidateLocator: `${opposite}/stores/${ids.storeA}`,
            };
            const freshTarget = {
                ...target,
                storeCandidateLocator: undefined,
                representation: opposite === ".finders-keepers" ? "hidden" : "visible",
            };
            const fresh = await bootstrapStore(request(f, "fresh-bootstrap", { target: freshTarget }));
            expect(fresh.state).toBe("REFUSED");
            expect(fresh.authorization.blockers).toEqual([
                expect.objectContaining({
                    reason: "Global store absence is not established across all representation candidates.",
                }),
            ]);
            expect((await bootstrapStore(request(f, "bootstrap-resume", { target }))).state).toBe("REFUSED");
            noWrites(f);
        }
    );
    it.each(["genesis", "fence"])(
        "uses concurrently appeared %s authority instead of creating a stale queued artifact",
        async (appeared) => {
            const f = await fixture({
                missing: ["store.json", appeared === "genesis" ? missingGenesis[0] : "meta/protocol/fence.json"],
                afterCreate: async (locator, base) => {
                    if (!locator.endsWith("/store.json")) return;
                    const branch = locator.slice(0, -"/store.json".length);
                    if (appeared !== "fence")
                        await base.createImmutable(
                            `${branch}/meta/representation-states/provider-valid.json`,
                            new TextEncoder().encode(
                                encodeRepresentationStateArtifact({
                                    schema: "finders-keepers.representation-state",
                                    version: 1,
                                    storeId: ids.storeA,
                                    representationStateId: ids.stateRoot,
                                    parentRepresentationStateId: null,
                                    establishedByMigrationId: null,
                                    representation: "hidden",
                                })
                            )
                        );
                    if (appeared !== "genesis")
                        await base.createImmutable(
                            `${branch}/meta/protocol/provider-valid.json`,
                            new TextEncoder().encode(
                                encodeProtocolFenceArtifact({
                                    schema: "finders-keepers.protocol-fence",
                                    version: 1,
                                    storeId: ids.storeA,
                                    requiredProtocolVersion: 1,
                                })
                            )
                        );
                },
            });
            const result = await bootstrapStore(request(f));
            expect(result.state).toBe("COMPLETE");
            expect(result.aggregate.logicalStores[0].representationState.state).toBe("REPRESENTATION_STATE_VALID");
            expect(result.immutableAttempts.map(({ locator }) => locator)).toEqual([
                `${f.target.storeCandidateLocator}/store.json`,
            ]);
            if (appeared === "genesis") {
                expect(result.aggregate.logicalStores[0].representationState.currentHeads).toHaveLength(1);
            }
        }
    );
    it("refuses a conflicting genesis that appears after an earlier create", async () => {
        const f = await fixture({
            missing: ["store.json", ...missingGenesis],
            afterCreate: async (locator, base) => {
                if (locator.endsWith("/store.json"))
                    await base.createImmutable(
                        `${locator.slice(0, -"/store.json".length)}/meta/representation-states/provider-valid.json`,
                        new TextEncoder().encode(
                            encodeRepresentationStateArtifact({
                                schema: "finders-keepers.representation-state",
                                version: 1,
                                storeId: ids.storeA,
                                representationStateId: ids.stateRoot,
                                parentRepresentationStateId: null,
                                establishedByMigrationId: null,
                                representation: "visible",
                            })
                        )
                    );
            },
        });
        const result = await bootstrapStore(request(f));
        expect(result.state).toBe("INCOMPLETE");
        expect(result.authorization.blockers.some(({ reason }) => reason.includes("genesis disagrees"))).toBe(true);
        expect(result.immutableAttempts.map(({ locator }) => locator)).toEqual([
            `${f.target.storeCandidateLocator}/store.json`,
        ]);
    });
    it.each([false, true])("resume attribution after manifest loss (other evidence=%s)", async (survives) => {
        let rootListings = 0;
        const f = await fixture({
            missing: survives ? ["meta/protocol/fence.json"] : [...missingGenesis, "meta/protocol/fence.json"],
            beforeList: async (locator, base) => {
                if (locator !== "" || ++rootListings !== 2) return;
                const manifest = `.finders-keepers/stores/${ids.storeA}/store.json`;
                const bytes = await base.readBytes(manifest);
                expect((await base.delete(manifest, await sha256Bytes(bytes.value))).ok).toBe(true);
            },
        });
        const result = await bootstrapStore(request(f));
        expect(result.storeId).toBe(ids.storeA);
        if (survives) {
            expect(result.state).toBe("COMPLETE");
            expect(result.immutableAttempts.map(({ locator }) => locator)).toEqual([
                `${f.target.storeCandidateLocator}/store.json`,
                `${f.target.storeCandidateLocator}/meta/protocol/fence.json`,
            ]);
        } else {
            expect(result.state).toBe("INCOMPLETE");
            expect(result.authorization.blockers.some(({ reason }) => reason.includes("Resume requires"))).toBe(true);
            noWrites(f);
        }
    });
    it("two partial branches remain ambiguous even when StoreId is identical", async () => {
        const f = await fixture({ missing: missingGenesis });
        const other = await fixture({ root: "Finders Keepers", missing: missingGenesis });
        for (const [path, bytes] of Object.entries(other.files)) await f.base.createImmutable(path, bytes);
        expect((await bootstrapStore(request(f))).state).toBe("REFUSED");
        noWrites(f);
    });
    it("a partial branch plus another complete StoreId cannot resume", async () => {
        const f = await fixture({ missing: missingGenesis });
        const other = await fixture({ root: "Finders Keepers", storeId: ids.storeB });
        for (const [path, bytes] of Object.entries(other.files)) await f.base.createImmutable(path, bytes);
        expect((await bootstrapStore(request(f))).state).toBe("REFUSED");
        noWrites(f);
    });
    it.each(["unavailable", "invalid", "unsupported", "conflicting-state", "mixed", "unknown-sibling"])(
        "%s evidence blocks missing-genesis resume",
        async (kind) => {
            const f = await fixture({ missing: missingGenesis, listUnavailable: kind === "unavailable" });
            const branch = f.target.storeCandidateLocator;
            if (kind === "invalid")
                await f.base.createImmutable(`${branch}/meta/protocol/invalid.json`, new TextEncoder().encode("{bad"));
            if (kind === "unsupported")
                await f.base.createImmutable(
                    `${branch}/meta/arbitrary/newer.json`,
                    new TextEncoder().encode('{"schema":"finders-keepers.protocol-fence","version":99}')
                );
            if (kind === "conflicting-state") {
                const other = await fixture({ stateOverrides: { establishedByMigrationId: ids.migration } });
                await f.base.createImmutable(
                    `${branch}/meta/representation-states/genesis.json`,
                    other.files[`${branch}/meta/representation-states/genesis.json`]
                );
            }
            if (kind === "mixed") {
                const other = await fixture({ storeId: ids.storeB });
                await f.base.createImmutable(`${branch}/foreign.json`, other.files[`${branch}/store.json`]);
            }
            if (kind === "unknown-sibling")
                await f.base.createImmutable(
                    `${branch}/unexpected/child/deep/raw.bin`,
                    new TextEncoder().encode("unknown")
                );
            expect((await bootstrapStore(request(f))).state).toBe("REFUSED");
            noWrites(f);
        }
    );
    it.each(["unavailable", "unsupported-namespace", "unknown-branch"])(
        "fresh absence cannot ignore %s FK evidence",
        async (kind) => {
            const f = await fixture({ empty: true, listUnavailable: kind === "unavailable" });
            if (kind !== "unavailable")
                await f.base.createImmutable(
                    ".finders-keepers/namespace.json",
                    new TextEncoder().encode(
                        kind === "unsupported-namespace"
                            ? '{"schema":"finders-keepers.namespace","version":99}'
                            : '{"schema":"finders-keepers.namespace","version":1}'
                    )
                );
            if (kind === "unknown-branch")
                await f.base.createImmutable(
                    ".finders-keepers/stores/unknown/anything.json",
                    new TextEncoder().encode("unknown")
                );
            expect((await bootstrapStore(request(f, "fresh-bootstrap"))).state).toBe("REFUSED");
            noWrites(f);
        }
    );
    it("valid empty namespace may bootstrap without overwriting its marker", async () => {
        const f = await fixture({ empty: true });
        await f.base.createImmutable(
            ".finders-keepers/namespace.json",
            new TextEncoder().encode('{"schema":"finders-keepers.namespace","version":1}')
        );
        const result = await bootstrapStore(request(f, "fresh-bootstrap"));
        expect(result.state).toBe("COMPLETE");
        expect(result.immutableAttempts).toHaveLength(3);
    });
    it.each(["namespace.json", "store.json", "genesis.json", "fence.json"])(
        "exact %s bytes applied before I/O error permit continuation without replacement identity",
        async (failCreateAt) => {
            const f = await fixture({ empty: true, failCreateAt, applyBeforeError: true });
            const result = await bootstrapStore(request(f, "fresh-bootstrap"));
            expect(result.state).toBe("COMPLETE");
            expect(result.immutableAttempts.find(({ create }) => !create.ok).verified).toBe(true);
            expect(result.aggregate.inventory.storeIds).toEqual([result.storeId]);
            expect(
                f.events.filter(({ method, locator }) => method === "createImmutable" && locator.endsWith(failCreateAt))
            ).toHaveLength(1);
        }
    );
    it.each(["absent", "unavailable"])("uncertain create with %s reread stops without later writes", async (state) => {
        const f = await fixture({
            missing: missingGenesis,
            failCreateAt: "genesis.json",
            readUnavailableAfterFailure: state === "unavailable",
        });
        const result = await bootstrapStore(request(f));
        expect(result.state).toBe("INCOMPLETE");
        expect(result.storeId).toBe(ids.storeA);
        expect(result.immutableAttempts).toHaveLength(1);
        expect(result.immutableAttempts[0].verified).toBe(false);
        expect(result.aggregate.inventory.storeIds).toEqual([ids.storeA]);
        if (state === "absent") {
            const restarted = await bootstrapStore(request(f));
            expect(restarted.state).toBe("COMPLETE");
            expect(restarted.storeId).toBe(ids.storeA);
        }
    });
    it("fresh manifest definitely absent after create failure stops without another identity or later authority", async () => {
        const f = await fixture({ empty: true, failCreateAt: "store.json" });
        const result = await bootstrapStore(request(f, "fresh-bootstrap"));
        expect(result.state).toBe("INCOMPLETE");
        expect(result.aggregate.inventory.state).toBe("NO_STORE");
        expect(result.immutableAttempts).toHaveLength(2);
        expect(
            f.events.filter(({ method, locator }) => method === "createImmutable" && locator.endsWith("store.json"))
        ).toHaveLength(1);
        expect(
            f.events.some(({ method, locator }) => method === "createImmutable" && locator.endsWith("genesis.json"))
        ).toBe(false);
    });
    it("conflicting immutable bytes are never overwritten", async () => {
        const f = await fixture({
            missing: missingGenesis,
            afterCreate: async (path, base) => {
                if (path.endsWith("genesis.json")) {
                    const original = await base.readBytes(path);
                    const { sha256Bytes } = await import("../src/storage/canonicalEncoding");
                    await base.writeSnapshot(
                        path,
                        new TextEncoder().encode("conflict"),
                        await sha256Bytes(original.value)
                    );
                }
            },
        });
        const result = await bootstrapStore(request(f));
        expect(result.state).toBe("INCOMPLETE");
        expect(result.reason).toMatch(/conflicts/);
        expect(new TextDecoder().decode((await f.base.readBytes(result.immutableAttempts[0].locator)).value)).toBe(
            "conflict"
        );
    });
    it("post-create rediscovery prevents claiming complete when a new unknown branch arrives", async () => {
        const f = await fixture({
            empty: true,
            afterCreate: async (path, base) => {
                if (path.endsWith("fence.json"))
                    await base.createImmutable(
                        `${path.split("/meta/")[0]}/unexpected/child/deep/raw.bin`,
                        new TextEncoder().encode("unknown")
                    );
            },
        });
        const result = await bootstrapStore(request(f, "fresh-bootstrap"));
        expect(result.state).toBe("INCOMPLETE");
        expect(result.authorization.authorized).toBe(false);
    });
    it("independent complete bootstraps preserve distinct StoreIds with no automatic winner", async () => {
        const a = await fixture({ empty: true });
        const b = await fixture({ empty: true, root: "Finders Keepers", representation: "visible" });
        const left = await bootstrapStore(request(a, "fresh-bootstrap"));
        const right = await bootstrapStore(request(b, "fresh-bootstrap"));
        expect(left.state).toBe("COMPLETE");
        expect(right.state).toBe("COMPLETE");
        expect(left.storeId).not.toBe(right.storeId);
        for (const attempt of right.immutableAttempts)
            await a.base.createImmutable(attempt.locator, (await b.base.readBytes(attempt.locator)).value);
        expect((await a.discover()).inventory.state).toBe("MULTIPLE_STORE_IDS");
    });
});
