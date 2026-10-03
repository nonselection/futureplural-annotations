import { describe, it, expect } from "vitest";
import { authorizeWrite } from "../src/storage/writeAuthorization";
import { encodeProtocolFenceArtifact, encodeRepresentationStateArtifact } from "../src/storage/authorityArtifacts";
import { encodeMutationIntent, encodeMutationOutcome, mutationIntentDigest } from "../src/storage/recoveryArtifacts";
import { canonicalRevisionDigest } from "../src/storage/envelopes";
import { createMutationId, createRevisionId } from "../src/storage/identity";
import { fixture, revision, codec, ids } from "./helpers/storageS3BootstrapFixtures";
const encoder = new TextEncoder();
const ordinary = (action = "update", extras = {}) => ({
    mode: "ordinary",
    storeId: ids.storeA,
    record: { recordKind: codec.recordKind, recordId: "s2-fixture-shared-record", action, ...extras },
});
async function check(f, op = ordinary()) {
    return authorizeWrite(await f.discover(), op, f.port, [codec]);
}
async function recoveryFixture(status, overrides = {}) {
    const before = revision();
    const after = revision(ids.revisionChildA, ids.revisionRoot, "after");
    const intent = {
        recoveryFormatVersion: 1,
        storeId: ids.storeA,
        mutationId: createMutationId(),
        recordKind: codec.recordKind,
        recordId: before.recordId,
        baseRevisionId: before.revisionId,
        baseDigest: await canonicalRevisionDigest(before),
        before,
        candidateRevisionId: after.revisionId,
        candidateDigest: await canonicalRevisionDigest(after),
        after,
    };
    const f = await fixture({ records: [after] });
    await f.base.createImmutable(
        `${f.target.storeCandidateLocator}/recovery/mutations/i.json`,
        encoder.encode(await encodeMutationIntent(intent, [codec]))
    );
    if (status)
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/recovery/outcomes/o.json`,
            encoder.encode(
                encodeMutationOutcome({
                    recoveryFormatVersion: 1,
                    storeId: ids.storeA,
                    mutationId: intent.mutationId,
                    intentDigest: await mutationIntentDigest(intent),
                    recordKind: codec.recordKind,
                    recordId: before.recordId,
                    candidateRevisionId: after.revisionId,
                    candidateDigest: intent.candidateDigest,
                    status,
                    ...overrides,
                })
            )
        );
    return { f, intent };
}
describe("Storage S3 composed write authorization", () => {
    it("authorizes healthy update and aggregate-confirmed creation only", async () => {
        const found = await fixture({ records: [revision()] });
        expect((await check(found)).authorized).toBe(true);
        expect((await check(found, ordinary("create"))).authorized).toBe(false);
        expect((await check(await fixture(), ordinary("create"))).authorized).toBe(true);
    });
    it.each([
        [
            "namespace",
            {
                extraFiles: {
                    "Finders Keepers/namespace.json": encoder.encode(
                        '{"schema":"finders-keepers.namespace","version":99}'
                    ),
                },
            },
        ],
        ["discovery", { listUnavailable: true }],
        ["protocol", { protocolVersion: 2 }],
        ["missing protocol", { missing: ["meta/protocol/fence.json"] }],
        ["missing genesis", { missing: ["meta/representation-states/genesis.json"] }],
        ["invalid genesis", { stateOverrides: { establishedByMigrationId: ids.migration } }],
        [
            "indeterminate genesis",
            {
                stateOverrides: {
                    parentRepresentationStateId: ids.stateChildA,
                    establishedByMigrationId: ids.migration,
                },
            },
        ],
        ["partial manifest", { missing: ["store.json"] }],
    ])("healthy record cannot bypass %s", async (_name, options) => {
        const f = await fixture({ records: [revision()], ...options });
        const gate = await check(f);
        expect(gate.authorized).toBe(false);
        expect(gate.blockers.length).toBeGreaterThan(0);
        expect(f.events.some(({ method }) => method === "createImmutable")).toBe(false);
    });
    it("preserves all broader blocker scopes alongside the record blocker", async () => {
        const f = await fixture({
            protocolVersion: 2,
            stateOverrides: { establishedByMigrationId: ids.migration },
            records: [revision(ids.revisionChildA, ids.revisionRoot), revision(ids.revisionChildB, ids.revisionRoot)],
        });
        const gate = await check(f);
        expect(gate.blockers.filter(({ scope }) => scope === "store").length).toBeGreaterThanOrEqual(2);
        expect(gate.blockers.some(({ scope }) => scope === "record")).toBe(true);
    });
    it.each(["separate", "mixed"])("healthy record cannot bypass %s StoreIds", async (shape) => {
        const f = await fixture({ records: [revision()] });
        const other = await fixture({ root: "Finders Keepers", storeId: ids.storeB });
        for (const [path, bytes] of Object.entries(other.files))
            await f.base.createImmutable(
                shape === "mixed" && path.endsWith("store.json")
                    ? `${f.target.storeCandidateLocator}/foreign.json`
                    : path,
                bytes
            );
        expect((await check(f)).authorized).toBe(false);
    });
    it("blocks unknown structures and opaque migration evidence", async () => {
        const f = await fixture({ records: [revision()] });
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/unexpected/nested/deeper/raw.bin`,
            encoder.encode("unknown")
        );
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/meta/migrations/physical/raw.bin`,
            encoder.encode("opaque")
        );
        const gate = await check(f);
        expect(gate.authorized).toBe(false);
        expect(gate.blockers.some(({ reason }) => reason.includes("Unknown structure"))).toBe(true);
        expect(gate.blockers.some(({ reason }) => reason.includes("opaque"))).toBe(true);
    });
    it("split unsupported protocol evidence fails closed despite a clean fence", async () => {
        const f = await fixture({ records: [revision()] });
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/meta/arbitrary/fence.json`,
            encoder.encode('{"schema":"finders-keepers.protocol-fence","version":99}')
        );
        expect((await check(f)).authorized).toBe(false);
    });
    it("competing representation children block a healthy record", async () => {
        const f = await fixture({ records: [revision()] });
        for (const representationStateId of [ids.stateChildA, ids.stateChildB])
            await f.base.createImmutable(
                `${f.target.storeCandidateLocator}/meta/representation-states/${representationStateId}.json`,
                encoder.encode(
                    encodeRepresentationStateArtifact({
                        schema: "finders-keepers.representation-state",
                        version: 1,
                        storeId: ids.storeA,
                        representationStateId,
                        parentRepresentationStateId: ids.stateRoot,
                        establishedByMigrationId: ids.migration,
                        representation: "visible",
                    })
                )
            );
        expect((await check(f)).authorized).toBe(false);
    });
    it.each(["malformed", "unsupported", "orphan", "conflicting", "unresolved", "unknown-io"])(
        "blocks %s recovery evidence",
        async (shape) => {
            const evidence = await recoveryFixture(
                shape === "orphan" ? "VERIFIED_APPLIED" : shape === "unknown-io" ? "IO_FAILED" : undefined,
                shape === "orphan" ? { mutationId: createMutationId() } : {}
            );
            const intent = evidence.intent;
            // Malformed/unsupported cases contain no unrelated pending intent.
            const f =
                shape === "malformed" || shape === "unsupported"
                    ? await fixture({ records: [revision()] })
                    : evidence.f;
            if (shape === "malformed" || shape === "unsupported")
                await f.base.createImmutable(
                    `${f.target.storeCandidateLocator}/recovery/mutations/extra.json`,
                    encoder.encode(
                        shape === "malformed" ? "{bad" : JSON.stringify({ ...intent, recoveryFormatVersion: 99 })
                    )
                );
            if (shape === "conflicting")
                await f.base.createImmutable(
                    `${f.target.storeCandidateLocator}/recovery/mutations/extra.json`,
                    encoder.encode(
                        await encodeMutationIntent(
                            {
                                ...intent,
                                after: { ...intent.after, payload: { value: "different" } },
                                candidateDigest: await canonicalRevisionDigest({
                                    ...intent.after,
                                    payload: { value: "different" },
                                }),
                            },
                            [codec]
                        )
                    )
                );
            const op = shape === "conflicting" ? ordinary("create") : ordinary();
            if (shape === "conflicting") op.record.recordId = "unrelated-creation";
            const gate = await check(f, op);
            expect(gate.authorized).toBe(false);
            if (["malformed", "unsupported", "conflicting"].includes(shape)) {
                const expected = shape === "conflicting" ? "Conflicting same-mutation" : "Unvalidated recovery";
                expect(gate.blockers.some(({ scope, reason }) => scope === "store" && reason.includes(expected))).toBe(
                    true
                );
                expect(gate.blockers.some(({ scope }) => scope === "record")).toBe(false);
                expect(gate.blockers).toHaveLength(1);
            }
        }
    );
    it("non-equivalent outcomes for one MutationId block the entire store", async () => {
        const { f, intent } = await recoveryFixture("VERIFIED_APPLIED");
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/recovery/outcomes/conflict.json`,
            encoder.encode(
                encodeMutationOutcome({
                    recoveryFormatVersion: 1,
                    storeId: ids.storeA,
                    mutationId: intent.mutationId,
                    intentDigest: await mutationIntentDigest(intent),
                    recordKind: codec.recordKind,
                    recordId: intent.recordId,
                    candidateRevisionId: intent.candidateRevisionId,
                    candidateDigest: intent.candidateDigest,
                    status: "PRECONDITION_REJECTED",
                })
            )
        );
        const gate = await check(f);
        expect(gate.authorized).toBe(false);
        expect(gate.blockers.some(({ scope, reason }) => scope === "store" && reason.includes("Conflicting"))).toBe(
            true
        );
    });
    it("unresolved target A cannot be bypassed but does not invent a record gate on unrelated B", async () => {
        const { f } = await recoveryFixture(undefined);
        const op = ordinary("create");
        op.record.recordId = "s2-fixture-unrelated";
        expect((await check(f)).authorized).toBe(false);
        expect((await check(f, op)).authorized).toBe(true);
    });
    it.each(["VERIFIED_APPLIED", "PRECONDITION_REJECTED"])(
        "validated bound %s evidence does not become unknown S2 structure",
        async (status) => {
            const { f } = await recoveryFixture(status);
            expect((await f.discover()).physicalCandidates[0].state).toBe("PARTIAL");
            expect((await check(f)).authorized).toBe(true);
        }
    );
    it("invalid record bytes prevent creation absence", async () => {
        const f = await fixture();
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/records/sources/unknown.json`,
            encoder.encode('{"storageEnvelopeVersion":99}')
        );
        expect((await check(f, ordinary("create"))).authorized).toBe(false);
    });
    it("resolution bypasses only proven divergence with exact S1 coverage", async () => {
        const f = await fixture({
            records: [
                revision(),
                revision(ids.revisionChildA, ids.revisionRoot),
                revision(ids.revisionChildB, ids.revisionRoot),
            ],
        });
        const candidate = {
            ...revision(createRevisionId(), ids.revisionChildA),
            resolvedRevisionIds: [ids.revisionChildA, ids.revisionChildB].sort(),
        };
        expect((await check(f)).authorized).toBe(false);
        expect((await check(f, ordinary("resolve", { resolutionCandidate: candidate }))).authorized).toBe(true);
        expect(
            (await check(f, ordinary("resolve", { resolutionCandidate: { ...candidate, resolvedRevisionIds: [] } })))
                .authorized
        ).toBe(false);
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/meta/protocol/newer.json`,
            encoder.encode(
                encodeProtocolFenceArtifact({
                    schema: "finders-keepers.protocol-fence",
                    version: 1,
                    storeId: ids.storeA,
                    requiredProtocolVersion: 2,
                })
            )
        );
        expect((await check(f, ordinary("resolve", { resolutionCandidate: candidate }))).authorized).toBe(false);
    });
    it.each([
        ["LINEAGE_INDETERMINATE", [revision(ids.revisionChildA), revision(ids.revisionChildB)]],
        [
            "REVISION_IDENTITY_INVALID",
            [revision(ids.revisionChildA, null, "first"), revision(ids.revisionChildA, null, "other")],
        ],
    ])("does not resolve %s by pretending head coverage", async (_state, records) => {
        const f = await fixture({ records });
        expect(
            (
                await check(
                    f,
                    ordinary("resolve", {
                        resolutionCandidate: {
                            ...revision(createRevisionId(), ids.revisionChildA),
                            resolvedRevisionIds: [ids.revisionChildA, ids.revisionChildB].sort(),
                        },
                    })
                )
            ).authorized
        ).toBe(false);
    });
});
