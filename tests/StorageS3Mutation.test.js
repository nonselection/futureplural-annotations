import { describe, it, expect } from "vitest";
import { mutateCanonicalRecord } from "../src/storage/canonicalRepository";
import { fixture, revision, codec, ids } from "./helpers/storageS3BootstrapFixtures";
import { failureInjectingRepresentationStorage } from "./helpers/failureInjectingRepresentationStorage";
import { sha256Bytes } from "../src/storage/canonicalEncoding";
import {
    canonicalRevisionDigest,
    encodeCanonicalRevisionEnvelope,
    decodeCanonicalRevisionEnvelope,
} from "../src/storage/envelopes";
import { decodeMutationIntent, decodeMutationOutcome } from "../src/storage/recoveryArtifacts";
import { createRevisionId } from "../src/storage/identity";
const encoder = new TextEncoder();
const decoder = new TextDecoder();
async function setup(options = {}, creation = false) {
    const f = await fixture({ records: creation ? [] : [revision()] });
    const fault = failureInjectingRepresentationStorage(f.base, options);
    const request = {
        port: fault.port,
        storeId: ids.storeA,
        branchLocator: f.target.storeCandidateLocator,
        snapshotLocator: `${f.target.storeCandidateLocator}/records/sources/${creation ? "new" : "record-0"}.json`,
        recordKind: codec.recordKind,
        recordId: "s2-fixture-shared-record",
        action: creation ? "create" : "update",
        payload: { value: "changed" },
        codecs: [codec],
        supportedProtocolVersion: 1,
        onBoundary: fault.onBoundary,
    };
    return { f, fault, request };
}
const writes = (fault) => fault.events.filter(({ method }) => method === "writeSnapshot");
const creates = (fault, family) =>
    fault.events.filter(
        ({ method, locator }) => method === "createImmutable" && locator.includes(`/recovery/${family}/`)
    );
async function overwrite(base, locator, bytes) {
    const old = await base.readBytes(locator);
    expect((await base.writeSnapshot(locator, bytes, old.ok ? await sha256Bytes(old.value) : null)).ok).toBe(true);
}
describe("Storage S3 guarded canonical mutation", () => {
    it.each([false, true])(
        "constructs and verifies ordinary mutation (creation=%s) in protocol order",
        async (creation) => {
            const { f, fault, request } = await setup({}, creation);
            const result = await mutateCanonicalRecord(request);
            expect(result.state).toBe("ATTEMPTED");
            expect(result.localAttempt).toBe("VERIFIED_APPLIED");
            expect(result.intentPersistence).toBe("VERIFIED");
            expect(result.outcomePersistence).toBe("VERIFIED");
            expect(result.currentAuthorization.authorized).toBe(true);
            expect(result.intent.after).toMatchObject({
                storeId: ids.storeA,
                recordKind: codec.recordKind,
                recordId: request.recordId,
                parentRevisionId: creation ? null : ids.revisionRoot,
                resolvedRevisionIds: [],
                state: "active",
            });
            expect(result.intent.after.revisionId).not.toBe(ids.revisionRoot);
            expect(result.base.rawByteDigest).toBe(creation ? null : await sha256Bytes(result.base.bytes));
            const intentCreate = fault.events.indexOf(creates(fault, "mutations")[0]);
            const snapshotWrite = fault.events.indexOf(writes(fault)[0]);
            const intentRead = fault.events.findIndex(
                (e, i) => i > intentCreate && e.method === "readBytes" && e.locator.includes("/recovery/mutations/")
            );
            const outcomeCreate = fault.events.indexOf(creates(fault, "outcomes")[0]);
            expect(intentCreate).toBeLessThan(intentRead);
            expect(intentRead).toBeLessThan(snapshotWrite);
            expect(snapshotWrite).toBeLessThan(outcomeCreate);
            expect(
                fault.events.slice(snapshotWrite + 1, outcomeCreate).some(({ method }) => method === "listChildren")
            ).toBe(false);
            expect(fault.events.slice(outcomeCreate + 1).some(({ method }) => method === "listChildren")).toBe(true);
            const intentBytes = await f.base.readBytes(creates(fault, "mutations")[0].locator);
            expect((await decodeMutationIntent(decoder.decode(intentBytes.value), [codec])).mutationId).toBe(
                result.intent.mutationId
            );
            const outcomeBytes = await f.base.readBytes(creates(fault, "outcomes")[0].locator);
            expect(decodeMutationOutcome(decoder.decode(outcomeBytes.value)).status).toBe("VERIFIED_APPLIED");
        }
    );
    it("guards exact raw bytes, not the normalized canonical digest", async () => {
        const { f, fault, request } = await setup();
        const pretty = encoder.encode(JSON.stringify(revision(), null, 2));
        await overwrite(f.base, request.snapshotLocator, pretty);
        expect(await sha256Bytes(pretty)).not.toBe(await canonicalRevisionDigest(revision()));
        const result = await mutateCanonicalRecord(request);
        expect(result.localAttempt).toBe("VERIFIED_APPLIED");
        expect(writes(fault)[0].expectedCurrentDigest).toBe(await sha256Bytes(pretty));
        expect(result.base.canonicalDigest).toBe(await canonicalRevisionDigest(revision()));
    });
    it.each(["applied-error", "absent-error", "unavailable", "conflict"])(
        "intent create %s uses exact reread, no replacement MutationId",
        async (intent) => {
            const { fault, request } = await setup({ intent });
            const result = await mutateCanonicalRecord(request);
            expect(creates(fault, "mutations")).toHaveLength(1);
            if (intent === "applied-error") {
                expect(result.localAttempt).toBe("VERIFIED_APPLIED");
                expect(writes(fault)).toHaveLength(1);
            } else {
                expect(result.state).toBe("INTENT_NOT_ESTABLISHED");
                expect(result.intentPersistence).toBe(
                    { "absent-error": "ABSENT", unavailable: "UNAVAILABLE", conflict: "CONFLICTING" }[intent]
                );
                expect(writes(fault)).toHaveLength(0);
                expect(creates(fault, "outcomes")).toHaveLength(0);
            }
        }
    );
    it("rejects a stale raw-byte guard without touching concurrent bytes", async () => {
        const concurrent = encoder.encode(
            encodeCanonicalRevisionEnvelope(revision(createRevisionId(), ids.revisionRoot, "concurrent"), [codec])
        );
        const { f, fault, request } = await setup({
            beforeSnapshot: (locator, base) => overwrite(base, locator, concurrent),
        });
        const result = await mutateCanonicalRecord(request);
        expect(result.localAttempt).toBe("PRECONDITION_REJECTED");
        expect(Array.from((await f.base.readBytes(request.snapshotLocator)).value)).toEqual(Array.from(concurrent));
        expect(writes(fault)).toHaveLength(1);
        expect(result.outcome.status).toBe("PRECONDITION_REJECTED");
    });
    it.each(["absent-error", "unavailable", "applied-error", "success-unverifiable"])(
        "snapshot %s stays IO_FAILED without retry",
        async (snapshot) => {
            const { f, fault, request } = await setup({ snapshot });
            const result = await mutateCanonicalRecord(request);
            expect(result.localAttempt).toBe("IO_FAILED");
            expect(result.outcome.status).toBe("IO_FAILED");
            expect(writes(fault)).toHaveLength(1);
            const snapshotWrite = fault.events.indexOf(writes(fault)[0]);
            const outcomeCreate = fault.events.indexOf(creates(fault, "outcomes")[0]);
            expect(
                fault.events.slice(snapshotWrite + 1, outcomeCreate).some(({ method }) => method === "listChildren")
            ).toBe(false);
            if (snapshot === "applied-error") {
                expect(
                    decodeCanonicalRevisionEnvelope(
                        decoder.decode((await f.base.readBytes(request.snapshotLocator)).value),
                        [codec]
                    ).revisionId
                ).toBe(result.intent.candidateRevisionId);
                expect(result.aggregate.logicalStores[0].records[0].classification.current.envelope.revisionId).toBe(
                    result.intent.candidateRevisionId
                );
            }
            if (snapshot === "absent-error")
                expect((await f.base.readBytes(request.snapshotLocator)).value).toEqual(result.base.bytes);
            expect(result.currentAuthorization.authorized).toBe(false);
        }
    );
    it.each([undefined, "applied-error"])(
        "third revision after snapshot call never becomes verified application (%s)",
        async (snapshot) => {
            const third = revision(createRevisionId(), ids.revisionRoot, "third");
            const { fault, request } = await setup({
                snapshot,
                afterSnapshot: (locator, base) =>
                    overwrite(base, locator, encoder.encode(encodeCanonicalRevisionEnvelope(third, [codec]))),
            });
            const result = await mutateCanonicalRecord(request);
            expect(result.localAttempt).toBe("IO_FAILED");
            expect(result.outcome.status).toBe("IO_FAILED");
            expect(result.aggregate.logicalStores[0].records[0].classification.current.envelope.revisionId).toBe(
                third.revisionId
            );
            expect(writes(fault)).toHaveLength(1);
        }
    );
    it("verified local fact survives unavailable post-outcome discovery", async () => {
        let unavailable = false;
        const { request } = await setup({
            listUnavailable: () => unavailable,
            boundary: (name) => {
                if (name === "after-outcome-persistence") unavailable = true;
            },
        });
        const result = await mutateCanonicalRecord(request);
        expect(result.localAttempt).toBe("VERIFIED_APPLIED");
        expect(result.aggregate.traversal.state).toBe("UNAVAILABLE");
        expect(result.currentAuthorization.authorized).toBe(false);
    });
    it.each(["applied-error", "absent-error", "unavailable", "conflict"])(
        "outcome create %s preserves snapshot and attempt fact",
        async (outcome) => {
            const { f, fault, request } = await setup({ outcome });
            const result = await mutateCanonicalRecord(request);
            expect(result.localAttempt).toBe("VERIFIED_APPLIED");
            expect(result.outcomePersistence).toBe(
                {
                    "applied-error": "VERIFIED",
                    "absent-error": "ABSENT",
                    unavailable: "UNAVAILABLE",
                    conflict: "CONFLICTING",
                }[outcome]
            );
            expect(creates(fault, "outcomes")).toHaveLength(1);
            expect(writes(fault)).toHaveLength(1);
            expect(
                decodeCanonicalRevisionEnvelope(
                    decoder.decode((await f.base.readBytes(request.snapshotLocator)).value),
                    [codec]
                ).revisionId
            ).toBe(result.intent.candidateRevisionId);
            if (outcome !== "applied-error") expect(result.currentAuthorization.authorized).toBe(false);
        }
    );
    it("verified local outcome coexists with divergent post-write aggregate", async () => {
        const { request } = await setup({
            boundary: async (name, base) => {
                if (name === "after-outcome-persistence")
                    await base.createImmutable(
                        `.finders-keepers/stores/${ids.storeA}/records/sources/provider-conflict.json`,
                        encoder.encode(
                            encodeCanonicalRevisionEnvelope(revision(createRevisionId(), ids.revisionRoot, "other"), [
                                codec,
                            ])
                        )
                    );
            },
        });
        const result = await mutateCanonicalRecord(request);
        expect(result.localAttempt).toBe("VERIFIED_APPLIED");
        expect(result.outcome.status).toBe("VERIFIED_APPLIED");
        expect(result.aggregate.logicalStores[0].records[0].classification.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(result.currentAuthorization.authorized).toBe(false);
    });
    it.each([
        "before-intent",
        "after-intent-create",
        "after-intent-verification",
        "after-snapshot-write",
        "after-snapshot-reread",
        "before-outcome",
        "after-outcome-create",
        "after-outcome-persistence",
    ])("crash at %s preserves protocol-stage evidence", async (crashAt) => {
        const { f, fault, request } = await setup({ crashAt });
        await expect(mutateCanonicalRecord(request)).rejects.toThrow(`fixture crash: ${crashAt}`);
        const early = ["before-intent", "after-intent-create", "after-intent-verification"].includes(crashAt);
        expect(writes(fault)).toHaveLength(early ? 0 : 1);
        expect(creates(fault, "mutations")).toHaveLength(crashAt === "before-intent" ? 0 : 1);
        const outcomePersisted = ["after-outcome-create", "after-outcome-persistence"].includes(crashAt);
        expect(creates(fault, "outcomes")).toHaveLength(outcomePersisted ? 1 : 0);
        if (!early)
            expect(
                decodeCanonicalRevisionEnvelope(
                    decoder.decode((await f.base.readBytes(request.snapshotLocator)).value),
                    [codec]
                ).payload.value
            ).toBe("changed");
    });
    it("can stop on definitive rejection without outcome or overwrite", async () => {
        const { fault, request } = await setup({
            crashAt: "precondition-rejected",
            beforeSnapshot: async (locator, base) => {
                await overwrite(
                    base,
                    locator,
                    encoder.encode(
                        encodeCanonicalRevisionEnvelope(revision(createRevisionId(), ids.revisionRoot), [codec])
                    )
                );
            },
        });
        await expect(mutateCanonicalRecord(request)).rejects.toThrow("fixture crash: precondition-rejected");
        expect(writes(fault)).toHaveLength(1);
        expect(creates(fault, "outcomes")).toHaveLength(0);
    });
    it.each(["renamed", "invalid", "unsupported", "unavailable", "ambiguous", "incomplete"])(
        "creation target absence cannot bypass %s aggregate evidence",
        async (shape) => {
            const { f, fault, request } = await setup({}, true);
            const path = `${request.branchLocator}/records/sources/provider-file.json`;
            const bytes =
                shape === "invalid"
                    ? encoder.encode("{bad")
                    : shape === "unsupported"
                      ? encoder.encode(JSON.stringify({ ...revision(), storageEnvelopeVersion: 999 }))
                      : encoder.encode(encodeCanonicalRevisionEnvelope(revision(), [codec]));
            await f.base.createImmutable(path, bytes);
            if (shape === "unavailable") fault.blockedReads.add(path);
            if (shape === "ambiguous")
                await f.base.createImmutable(
                    `${request.branchLocator}/records/sources/other.json`,
                    encoder.encode(
                        encodeCanonicalRevisionEnvelope({ ...revision(), payload: { value: "different" } }, [codec])
                    )
                );
            if (shape === "incomplete")
                fault.port.listChildren = async () => ({
                    ok: false,
                    failure: { code: "UNAVAILABLE", message: "incomplete fixture" },
                });
            const result = await mutateCanonicalRecord(request);
            expect(result.state).toBe("REFUSED");
            expect(result.authorization.authorized).toBe(false);
            expect(writes(fault)).toHaveLength(0);
            expect(creates(fault, "mutations")).toHaveLength(0);
            expect(creates(fault, "outcomes")).toHaveLength(0);
        }
    );
    it.each(["protocol", "representation", "recovery"])(
        "Batch-2 %s blocker prevents every mutation persistence call",
        async (scope) => {
            const { f, fault, request } = await setup();
            if (scope === "protocol")
                await overwrite(
                    f.base,
                    `${request.branchLocator}/meta/protocol/fence.json`,
                    encoder.encode('{"schema":"finders-keepers.protocol-fence","version":999}')
                );
            if (scope === "representation")
                await overwrite(
                    f.base,
                    `${request.branchLocator}/meta/representation-states/genesis.json`,
                    encoder.encode("{bad")
                );
            if (scope === "recovery")
                await f.base.createImmutable(
                    `${request.branchLocator}/recovery/mutations/bad.json`,
                    encoder.encode("{bad")
                );
            const result = await mutateCanonicalRecord(request);
            expect(result.state).toBe("REFUSED");
            expect(result.authorization.authorized).toBe(false);
            expect(creates(fault, "mutations")).toHaveLength(0);
            expect(creates(fault, "outcomes")).toHaveLength(0);
            expect(writes(fault)).toHaveLength(0);
        }
    );
    it.each(["applied-error", "absent-error"])(
        "stop during uncertain outcome create (%s) retains deterministic bytes",
        async (outcome) => {
            const { f, fault, request } = await setup({ outcome, crashAt: "after-outcome-create" });
            await expect(mutateCanonicalRecord(request)).rejects.toThrow("fixture crash: after-outcome-create");
            expect(writes(fault)).toHaveLength(1);
            expect(creates(fault, "mutations")).toHaveLength(1);
            const outcomeRead = await f.base.readBytes(creates(fault, "outcomes")[0].locator);
            expect(outcomeRead.ok).toBe(outcome === "applied-error");
            expect(
                decodeCanonicalRevisionEnvelope(
                    decoder.decode((await f.base.readBytes(request.snapshotLocator)).value),
                    [codec]
                ).payload.value
            ).toBe("changed");
        }
    );
    it("ordinary update refuses an authorized deleted base before any mutation persistence", async () => {
        const { f, fault, request } = await setup();
        const tombstone = { ...revision(), state: "deleted" };
        const bytes = encoder.encode(encodeCanonicalRevisionEnvelope(tombstone, [codec]));
        await overwrite(f.base, request.snapshotLocator, bytes);
        const result = await mutateCanonicalRecord(request);
        expect(result.authorization.authorized).toBe(true);
        expect(result.state).toBe("REFUSED");
        expect(result.reason).toContain("deleted base");
        expect(result.aggregate.logicalStores[0].records[0].classification.current.envelope).toMatchObject(tombstone);
        expect(creates(fault, "mutations")).toHaveLength(0);
        expect(writes(fault)).toHaveLength(0);
        expect(creates(fault, "outcomes")).toHaveLength(0);
        expect((await f.base.readBytes(request.snapshotLocator)).value).toEqual(bytes);
    });
    it("same candidate RevisionId with different valid content cannot verify application", async () => {
        const { fault, request } = await setup({
            afterSnapshot: async (locator, base, bytes) => {
                const candidate = decodeCanonicalRevisionEnvelope(decoder.decode(bytes), [codec]);
                await overwrite(
                    base,
                    locator,
                    encoder.encode(
                        encodeCanonicalRevisionEnvelope(
                            {
                                ...candidate,
                                payload: { value: "different immutable content" },
                            },
                            [codec]
                        )
                    )
                );
            },
        });
        const result = await mutateCanonicalRecord(request);
        const current = result.aggregate.logicalStores[0].records[0].classification.current;
        expect(writes(fault)).toHaveLength(1);
        expect(current.envelope.revisionId).toBe(result.intent.candidateRevisionId);
        expect(current.digest).not.toBe(result.intent.candidateDigest);
        expect(result.localAttempt).toBe("IO_FAILED");
        expect(result.outcome.status).toBe("IO_FAILED");
        expect(result.outcomePersistence).toBe("VERIFIED");
    });
    it("post-discovery occupied creation target refuses despite authorized aggregate absence", async () => {
        const { f, fault, request } = await setup({}, true);
        const occupied = encoder.encode("concurrent target bytes");
        const originalRead = fault.port.readBytes;
        let injected = false;
        fault.port.readBytes = async (locator) => {
            if (!injected && locator === request.snapshotLocator) {
                injected = true;
                expect((await f.base.createImmutable(locator, occupied)).ok).toBe(true);
            }
            return originalRead(locator);
        };
        const result = await mutateCanonicalRecord(request);
        expect(injected).toBe(true);
        expect(result.authorization.authorized).toBe(true);
        expect(result.aggregate.logicalStores[0].records).toHaveLength(0);
        expect(result.state).toBe("REFUSED");
        expect(result.reason).toContain("locally absent");
        expect(creates(fault, "mutations")).toHaveLength(0);
        expect(writes(fault)).toHaveLength(0);
        expect(creates(fault, "outcomes")).toHaveLength(0);
        expect((await f.base.readBytes(request.snapshotLocator)).value).toEqual(occupied);
    });
    it("invalid payload never persists intent", async () => {
        const { fault, request } = await setup();
        const result = await mutateCanonicalRecord({ ...request, payload: null });
        expect(result.state).toBe("REFUSED");
        expect(creates(fault, "mutations")).toHaveLength(0);
    });
});
