import { describe, it, expect } from "vitest";
import { pruneRecoveryHistory } from "../src/storage/recoveryRetention";
import { interpretRecovery } from "../src/storage/recoverySemantics";
import { encodeMutationIntent, encodeMutationOutcome } from "../src/storage/recoveryArtifacts";
import { createRevisionId } from "../src/storage/identity";
import { sha256Bytes } from "../src/storage/canonicalEncoding";
import { storageFailure } from "../src/storage/RepresentationStoragePort";
import {
    mutateCanonicalRecord,
    resolveCanonicalRecord,
    tombstoneCanonicalRecord,
    reactivateCanonicalRecord,
} from "../src/storage/canonicalRepository";
import {
    fixture,
    codec,
    ids,
    revision,
    seedRecovery,
    recoveryMutation,
    encoder,
    transitionFixture,
} from "./helpers/storageS3RecoveryFixtures";

async function setup(records = [revision()], options = {}) {
    const f = await fixture({ records, ...options });
    const deletes = [];
    let unavailable = false;
    const port = {
        ...f.port,
        async readBytes(locator) {
            return unavailable
                ? storageFailure("UNAVAILABLE", "test observation unavailable")
                : f.port.readBytes(locator);
        },
        async delete(locator, digest) {
            deletes.push({ locator, digest });
            return options.onDelete
                ? options.onDelete(locator, digest, f.base, deletes.length, () => {
                      unavailable = true;
                  })
                : f.base.delete(locator, digest);
        },
    };
    const request = { port, storeId: ids.storeA, codecs: [codec], supportedProtocolVersion: 1 };
    const run = (policy = { maxMutationCount: 0, maxBytes: 0 }) => pruneRecoveryHistory({ ...request, policy });
    return { f, deletes, port, request, run };
}
async function rejected(s, suffix) {
    const row = await recoveryMutation(
        revision(),
        revision(createRevisionId(), ids.revisionRoot),
        "PRECONDITION_REJECTED"
    );
    await seedRecovery(s.f, row, suffix);
    return row;
}
async function chain(options = {}) {
    const rows = [revision()];
    for (let i = 0; i < 3; i++) rows.push(revision(createRevisionId(), rows.at(-1).revisionId, `revision ${i}`));
    const s = await setup([rows.at(-1)], options);
    const history = [];
    for (let i = 1; i < rows.length; i++) {
        const row = await recoveryMutation(rows[i - 1], rows[i], "VERIFIED_APPLIED");
        history.push(row);
        await seedRecovery(s.f, row);
    }
    return { ...s, rows, history };
}
async function preserved(s, result, expected) {
    expect(s.deletes).toEqual([]);
    for (const [locator, bytes] of expected) {
        const observed = await s.f.base.readBytes(locator);
        expect(observed.ok).toBe(true);
        expect(observed.value).toEqual(bytes);
    }
    expect(result.aggregate.physicalCandidates.flatMap((b) => b.artifactObservations.map((a) => a.locator))).toEqual(
        expect.arrayContaining(expected.map(([path]) => path))
    );
}
async function recoveryBytes(s) {
    const discovery = await s.f.discover();
    return discovery.physicalCandidates.flatMap((b) =>
        b.artifactObservations.filter((a) => a.context === "opaque-recovery").map((a) => [a.locator, a.bytes])
    );
}

describe("Storage S3 bounded recovery retention", () => {
    it("no policy deliberately disables pruning", async () => {
        const s = await setup();
        await rejected(s);
        const result = await pruneRecoveryHistory(s.request);
        expect(result.state).toBe("DISABLED");
        expect(s.deletes).toEqual([]);
    });
    it.each([
        null,
        {},
        [],
        0,
        { maxBytes: Infinity },
        { maxBytes: NaN },
        { maxBytes: -1 },
        { maxBytes: 0.5 },
        { maxMutationCount: Number.MAX_SAFE_INTEGER + 1 },
        { maxBytes: 0, unexpected: 1 },
        { maxMutationCount: "0" },
    ])("invalid policy %j never prunes", async (policy) => {
        const s = await setup();
        await rejected(s);
        const bytes = await recoveryBytes(s);
        const result = await s.run(policy);
        expect(result.state).toBe("INVALID_POLICY");
        await preserved(s, result, bytes);
    });
    it.each([{ maxMutationCount: 1 }, { maxBytes: 0 }, { maxMutationCount: 0, maxBytes: 0 }])(
        "finite %j policy preserves predecessor above budget when necessary",
        async (policy) => {
            const s = await chain();
            const result = await s.run(policy);
            expect(result.deletedLocators.length).toBeGreaterThan(0);
            expect(result.authorization.authorized).toBe(true);
            const record = result.authorization.qualifiedLineage.records[0];
            expect(record.classification.current.envelope.revisionId).toBe(s.rows.at(-1).revisionId);
            expect(record.observations.map((r) => r.envelope.revisionId)).toContain(s.rows.at(-2).revisionId);
            expect(result.remainingMutationCount).toBe(1);
            expect(result.state).toBe(policy.maxBytes === 0 ? "BUDGET_PROTECTED" : "COMPLETED");
            expect(result.budgetSatisfied).toBe(policy.maxBytes !== 0);
            for (const deletion of s.deletes) expect(deletion.digest).toMatch(/^sha256:/);
        }
    );
    it("byte accounting uses actual physical bytes including equivalent copies", async () => {
        const s = await setup();
        const row = await rejected(s, "one");
        await seedRecovery(s.f, row, "two");
        const bytes = await recoveryBytes(s);
        const total = bytes.reduce((sum, [, value]) => sum + value.length, 0);
        const untouched = await s.run({ maxBytes: total });
        expect(untouched.remainingBytes).toBe(total);
        expect(s.deletes).toEqual([]);
        const result = await s.run({ maxBytes: total - 1 });
        expect(result.state).toBe("COMPLETED");
        expect(result.remainingBytes).toBeLessThan(total);
        expect(result.remainingMutationCount).toBe(1);
        expect(s.deletes).toHaveLength(1);
        expect(result.authorization.qualifiedLineage.mutations[0].state).toBe("REJECTED_HISTORY");
    });
    it("resolved rejected group may be removed without promoting candidate or deleting snapshots", async () => {
        const s = await setup();
        await rejected(s);
        const snapshot = `${s.f.target.storeCandidateLocator}/records/sources/record-0.json`;
        const original = await s.f.base.readBytes(snapshot);
        const result = await s.run();
        expect(result.state).toBe("COMPLETED");
        expect(result.remainingMutationCount).toBe(0);
        expect(s.deletes).toHaveLength(2);
        expect((await s.f.base.readBytes(snapshot)).value).toEqual(original.value);
    });
    it.each(["PRECONDITION_REJECTED", "VERIFIED_APPLIED"])(
        "pruned %s history reappears as original resolved evidence, never a new mutation",
        async (status) => {
            const root = revision();
            const candidate = revision(createRevisionId(), root.revisionId);
            const s = await setup([
                status === "VERIFIED_APPLIED" ? candidate : root,
                ...(status === "VERIFIED_APPLIED" ? [root] : []),
            ]);
            const row = await recoveryMutation(root, candidate, status);
            await seedRecovery(s.f, row);
            expect((await s.run()).state).toBe("COMPLETED");
            await seedRecovery(s.f, row, "provider-returned");
            const recovery = await interpretRecovery(await s.f.discover(), ids.storeA, [codec]);
            expect(recovery.mutations).toHaveLength(1);
            expect(recovery.mutations[0].mutation.intent.mutationId).toBe(row.intent.mutationId);
            expect(recovery.mutations[0].state).toBe(
                status === "VERIFIED_APPLIED" ? "RESOLVED_HISTORY" : "REJECTED_HISTORY"
            );
            expect(s.f.events.some((e) => e.method === "writeSnapshot")).toBe(false);
        }
    );
    it.each(["candidate", "base", "third", "unavailable"])(
        "IO_FAILED %s remains protected with bytes/locators",
        async (shape) => {
            await unresolved("IO_FAILED", shape);
        }
    );
    it.each(["candidate", "base", "third", "unavailable"])(
        "no outcome %s remains protected with bytes/locators",
        async (shape) => {
            await unresolved(undefined, shape);
        }
    );
    async function unresolved(status, shape) {
        const root = revision();
        const candidate = revision(ids.revisionChildA, root.revisionId);
        const current =
            shape === "candidate"
                ? candidate
                : shape === "third"
                  ? revision(ids.revisionChildB, root.revisionId)
                  : root;
        const s = await setup([current], { listUnavailable: shape === "unavailable" });
        await seedRecovery(s.f, await recoveryMutation(root, candidate, status));
        // Use the physical fixture itself even when bounded observation is unavailable.
        const expected = [];
        for (const directory of ["mutations", "outcomes"]) {
            const listed = await s.f.base.listChildren(
                `${s.f.target.storeCandidateLocator}/recovery/${directory}`,
                100
            );
            if (listed.ok)
                for (const entry of listed.value.entries) {
                    const locator = `${s.f.target.storeCandidateLocator}/recovery/${directory}/${entry.name}`;
                    expected.push([locator, (await s.f.base.readBytes(locator)).value]);
                }
        }
        const result = await s.run();
        expect(result.state).toBe("BLOCKED");
        expect(s.deletes).toEqual([]);
        for (const [locator, bytes] of expected) expect((await s.f.base.readBytes(locator)).value).toEqual(bytes);
        if (shape !== "unavailable")
            expect(
                result.aggregate.physicalCandidates.flatMap((b) => b.artifactObservations.map((a) => a.locator))
            ).toEqual(expect.arrayContaining(expected.map(([p]) => p)));
    }
    it.each([
        "malformed",
        "unsupported",
        "wrong binding",
        "intent conflict",
        "outcome conflict",
        "orphan",
        "wrong store",
        "mixed store",
        "multiple stores",
        "migration",
        "identity invalid",
        "divergence",
        "candidate ahead",
        "indeterminate",
    ])("%s cannot be cleaned into writable state", async (shape) => {
        const root = revision();
        const child = revision(ids.revisionChildA, root.revisionId);
        const s = await setup(
            shape === "divergence"
                ? [child, revision(ids.revisionChildB, root.revisionId)]
                : shape === "identity invalid"
                  ? [child, { ...child, payload: { value: "corrupt identity" } }]
                  : shape === "indeterminate"
                    ? [child, revision(ids.revisionChildB, createRevisionId())]
                    : [root]
        );
        let row = await recoveryMutation(
            root,
            child,
            shape === "candidate ahead" ? "VERIFIED_APPLIED" : "PRECONDITION_REJECTED"
        );
        if (shape === "wrong binding") row.outcome.intentDigest = row.intent.candidateDigest;
        if (shape === "wrong store")
            row = await recoveryMutation(
                { ...root, storeId: ids.storeB },
                { ...child, storeId: ids.storeB },
                "VERIFIED_APPLIED"
            );
        if (shape !== "orphan") await seedRecovery(s.f, row);
        const branch = s.f.target.storeCandidateLocator;
        if (shape === "malformed" || shape === "unsupported")
            await s.f.base.createImmutable(
                `${branch}/recovery/mutations/bad.json`,
                encoder.encode(
                    shape === "malformed" ? "{bad" : JSON.stringify({ ...row.intent, recoveryFormatVersion: 99 })
                )
            );
        if (shape === "intent conflict") {
            const other = await recoveryMutation(root, revision(ids.revisionChildB, root.revisionId));
            other.intent.mutationId = row.intent.mutationId;
            await s.f.base.createImmutable(
                `${branch}/recovery/mutations/conflict.json`,
                encoder.encode(await encodeMutationIntent(other.intent, [codec]))
            );
        }
        if (shape === "outcome conflict" || shape === "orphan")
            await s.f.base.createImmutable(
                `${branch}/recovery/outcomes/other.json`,
                encoder.encode(encodeMutationOutcome({ ...row.outcome, status: "IO_FAILED" }))
            );
        if (shape === "mixed store")
            await s.f.base.createImmutable(
                `${branch}/meta/protocol/other-store.json`,
                encoder.encode(
                    JSON.stringify({
                        schema: "finders-keepers.protocol-fence",
                        version: 1,
                        storeId: ids.storeB,
                        requiredProtocolVersion: 1,
                    })
                )
            );
        if (shape === "multiple stores")
            await s.f.base.createImmutable(
                `${s.f.target.representationRootLocator}/stores/${ids.storeB}/store.json`,
                encoder.encode(JSON.stringify({ schema: "finders-keepers.store", version: 1, storeId: ids.storeB }))
            );
        if (shape === "migration")
            await s.f.base.createImmutable(
                `${branch}/meta/migrations/provider-branch/intent.json`,
                encoder.encode('{"migration":"opaque"}')
            );
        const expected = await recoveryBytes(s);
        const result = await s.run();
        expect(result.state).toBe("BLOCKED");
        await preserved(s, result, expected);
        if (shape === "mixed store")
            expect(result.aggregate.physicalCandidates.some((b) => b.state === "MIXED_STORE_INVALID")).toBe(true);
        if (shape === "multiple stores") expect(result.aggregate.inventory.state).toBe("MULTIPLE_STORE_IDS");
    });
    it.each([
        "invalid",
        "unsupported",
        "unavailable",
        "incomplete",
        "protocol",
        "representation",
        "missing predecessor",
    ])("fresh current %s blocks otherwise resolved history", async (shape) => {
        const current = shape === "missing predecessor" ? revision(ids.revisionChildA, ids.revisionRoot) : revision();
        const s = await setup([current], {
            listUnavailable: shape === "incomplete",
            protocolVersion: shape === "protocol" ? 2 : 1,
        });
        await rejected(s);
        const branch = s.f.target.storeCandidateLocator;
        const snapshot = `${branch}/records/sources/record-0.json`;
        if (shape === "invalid" || shape === "unsupported") {
            const bytes = encoder.encode(
                shape === "invalid" ? "{bad" : JSON.stringify({ ...current, schemaVersion: 99 })
            );
            const old = await s.f.base.readBytes(snapshot);
            await s.f.base.writeSnapshot(snapshot, bytes, await sha256Bytes(old.value));
        }
        if (shape === "representation")
            await s.f.base.createImmutable(
                `${branch}/meta/representation-states/bad.json`,
                encoder.encode('{"schema":"finders-keepers.representation-state","version":99}')
            );
        if (shape === "unavailable")
            s.port.readBytes = () => Promise.resolve(storageFailure("UNAVAILABLE", "current unavailable"));
        const expected = shape === "incomplete" ? [] : await recoveryBytes(s);
        const result = await s.run();
        expect(result.state).toBe("BLOCKED");
        expect(s.deletes).toEqual([]);
        for (const [p, b] of expected) expect((await s.f.base.readBytes(p)).value).toEqual(b);
    });
    it.each(["guard", "absent-error", "applied-error", "unavailable", "throw"])(
        "guarded deletion %s stops without automatic retry",
        async (shape) => {
            let changed;
            const s = await setup(undefined, {
                onDelete: async (locator, digest, base, _count, block) => {
                    if (shape === "guard") {
                        changed = encoder.encode('{"changed":"do not delete"}');
                        const old = await base.readBytes(locator);
                        await base.writeSnapshot(locator, changed, await sha256Bytes(old.value));
                        return base.delete(locator, digest);
                    }
                    if (shape === "applied-error") await base.delete(locator, digest);
                    if (shape === "unavailable") block();
                    if (shape === "throw") throw new Error("fixture uncertain delete");
                    return storageFailure("IO_ERROR", "fixture delete uncertainty");
                },
            });
            await rejected(s);
            const original = await recoveryBytes(s);
            const result = await s.run();
            expect(result.state).toBe(shape === "guard" ? "GUARD_REJECTED" : "IO_UNCERTAIN");
            expect(s.deletes).toHaveLength(1);
            expect(result.deletedLocators).toEqual([]);
            const physical = await s.f.base.readBytes(s.deletes[0].locator);
            if (shape === "unavailable") {
                expect(result.accountingComplete).toBe(false);
                expect(result.budgetSatisfied).toBe(false);
            }
            if (shape === "applied-error") {
                expect(physical.ok).toBe(false);
                expect(result.authorization.authorized).toBe(false);
                expect(result.authorization.qualifiedLineage.mutations[0].state).toBe("INTERRUPTED");
            } else {
                expect(physical.ok).toBe(true);
                expect(physical.value).toEqual(
                    shape === "guard" ? changed : original.find(([p]) => p === s.deletes[0].locator)[1]
                );
            }
        }
    );
    it("partial group deletion exposes intent without outcome and preserves canonical snapshot", async () => {
        const s = await setup(undefined, {
            onDelete: async (locator, digest, base, count) =>
                count === 1 ? base.delete(locator, digest) : storageFailure("IO_ERROR", "second delete uncertain"),
        });
        await rejected(s);
        const result = await s.run();
        expect(result.state).toBe("IO_UNCERTAIN");
        expect(result.deletedLocators).toHaveLength(1);
        expect(s.deletes).toHaveLength(2);
        expect(result.authorization.authorized).toBe(false);
        expect(result.authorization.qualifiedLineage.mutations[0].state).toBe("INTERRUPTED");
        expect((await s.f.base.readBytes(s.deletes[1].locator)).ok).toBe(true);
    });
    it("duplicate guard rejection does not compensate by deleting another copy", async () => {
        const s = await setup(undefined, {
            onDelete: async () => storageFailure("DIGEST_MISMATCH", "stale duplicate"),
        });
        const row = await rejected(s, "one");
        await seedRecovery(s.f, row, "two");
        const expected = await recoveryBytes(s);
        const result = await s.run({ maxBytes: 0 });
        expect(result.state).toBe("GUARD_REJECTED");
        expect(s.deletes).toHaveLength(1);
        for (const [p, b] of expected) expect((await s.f.base.readBytes(p)).value).toEqual(b);
        expect(result.authorization.qualifiedLineage.mutations).toHaveLength(1);
    });
    it("provider reappearance after duplicate pruning preserves logical identity", async () => {
        const s = await setup();
        const row = await rejected(s, "one");
        await seedRecovery(s.f, row, "two");
        const expected = await recoveryBytes(s);
        const total = expected.reduce((n, [, b]) => n + b.length, 0);
        const result = await s.run({ maxBytes: total - 1 });
        expect(result.deletedLocators).toHaveLength(1);
        const [p, b] = expected.find(([p]) => p === result.deletedLocators[0]);
        await s.f.base.createImmutable(p, b);
        const interpreted = await interpretRecovery(await s.f.discover(), ids.storeA, [codec]);
        expect(interpreted.mutations).toHaveLength(1);
        expect(interpreted.mutations[0].state).toBe("REJECTED_HISTORY");
        expect(interpreted.mutations[0].locators).toHaveLength(4);
    });
    it("post-delete reappearance stops rather than repeating maintenance", async () => {
        const s = await setup(undefined, {
            onDelete: async (locator, digest, base) => {
                const bytes = (await base.readBytes(locator)).value;
                const deleted = await base.delete(locator, digest);
                await base.createImmutable(locator, bytes);
                return deleted;
            },
        });
        const row = await rejected(s, "one");
        await seedRecovery(s.f, row, "two");
        const result = await s.run({ maxBytes: 0 });
        expect(result.state).toBe("IO_UNCERTAIN");
        expect(s.deletes).toHaveLength(1);
        expect(result.authorization.authorized).toBe(true);
    });
    it("resolved ancestry required for current resolution remains proven after pruning", async () => {
        const a = revision(ids.revisionChildA, ids.revisionRoot),
            b = revision(ids.revisionChildB, ids.revisionRoot);
        const setup = await transitionFixture([a, b]);
        const resolved = await resolveCanonicalRecord({
            ...setup.request,
            parentRevisionId: a.revisionId,
            resolvedRevisionIds: [a.revisionId, b.revisionId],
            state: "active",
        });
        expect(resolved.localAttempt).toBe("VERIFIED_APPLIED");
        const d = await mutateCanonicalRecord({ ...setup.request, action: "update" });
        expect(d.localAttempt).toBe("VERIFIED_APPLIED");
        const result = await pruneRecoveryHistory({
            port: setup.fault.port,
            storeId: ids.storeA,
            codecs: [codec],
            supportedProtocolVersion: 1,
            policy: { maxMutationCount: 0, maxBytes: 0 },
        });
        expect(result.state).toBe("BUDGET_PROTECTED");
        expect(result.authorization.authorized).toBe(true);
        const record = result.authorization.qualifiedLineage.records[0];
        expect(record.classification.state).toBe("RESOLVED_LINEAGE");
        expect(record.observations.map((row) => row.envelope.revisionId)).toContain(resolved.intent.after.revisionId);
        const later = await mutateCanonicalRecord({ ...setup.request, action: "update" });
        expect(later.localAttempt).toBe("VERIFIED_APPLIED");
        const competing = revision(createRevisionId(), b.revisionId);
        await setup.f.base.createImmutable(
            `${setup.request.branchLocator}/records/sources/new-branch.json`,
            encoder.encode(JSON.stringify(competing))
        );
        const blocked = await pruneRecoveryHistory({
            port: setup.fault.port,
            storeId: ids.storeA,
            codecs: [codec],
            supportedProtocolVersion: 1,
            policy: { maxBytes: 0 },
        });
        expect(blocked.state).toBe("BLOCKED");
        expect(blocked.deletedLocators).toEqual([]);
    });
    it("tombstone/reactivation chain preserves predecessor and never compacts canonical identity", async () => {
        const setup = await transitionFixture();
        const tombstone = await tombstoneCanonicalRecord({ ...setup.request, payload: {} });
        expect(tombstone.localAttempt).toBe("VERIFIED_APPLIED");
        const active = await reactivateCanonicalRecord(setup.request);
        expect(active.localAttempt).toBe("VERIFIED_APPLIED");
        const result = await pruneRecoveryHistory({
            port: setup.fault.port,
            storeId: ids.storeA,
            codecs: [codec],
            supportedProtocolVersion: 1,
            policy: { maxBytes: 0 },
        });
        expect(result.authorization.authorized).toBe(true);
        expect(result.state).toBe("BUDGET_PROTECTED");
        expect(result.authorization.qualifiedLineage.records[0].observations).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    envelope: expect.objectContaining({
                        revisionId: tombstone.intent.after.revisionId,
                        state: "deleted",
                    }),
                }),
            ])
        );
        expect((await setup.f.base.readBytes(setup.request.snapshotLocator)).ok).toBe(true);
    });
    it("split equivalent recovery evidence across validated physical branches remains one logical item", async () => {
        const s = await setup();
        const row = await rejected(s, "nominal");
        const branch = `${s.f.target.representationRootLocator}/stores/provider-renamed-branch`;
        await s.f.base.createImmutable(
            `${branch}/store.json`,
            s.f.files[`${s.f.target.storeCandidateLocator}/store.json`]
        );
        await s.f.base.createImmutable(
            `${branch}/recovery/mutations/renamed.json`,
            encoder.encode(await encodeMutationIntent(row.intent, [codec]))
        );
        await s.f.base.createImmutable(
            `${branch}/recovery/outcomes/renamed.json`,
            encoder.encode(encodeMutationOutcome(row.outcome))
        );
        const before = await s.f.discover();
        expect(before.physicalCandidates).toHaveLength(2);
        const interpreted = await interpretRecovery(before, ids.storeA, [codec]);
        expect(interpreted.mutations).toHaveLength(1);
        expect(interpreted.mutations[0].locators).toHaveLength(4);
        const result = await s.run();
        expect(result.state).toBe("COMPLETED");
        expect(result.remainingMutationCount).toBe(0);
        expect(result.aggregate.inventory.state).toBe("ONE_STORE");
        expect(result.authorization.authorized).toBe(true);
    });
    it("reappearing old verified history with a pruned ancestry gap becomes indeterminate, not a winner", async () => {
        const rows = [revision()];
        for (let i = 0; i < 5; i++) rows.push(revision(createRevisionId(), rows.at(-1).revisionId));
        const s = await setup([rows.at(-1)]);
        const history = [];
        for (let i = 1; i < rows.length; i++) {
            const item = await recoveryMutation(rows[i - 1], rows[i], "VERIFIED_APPLIED");
            history.push(item);
            await seedRecovery(s.f, item);
        }
        const result = await s.run({ maxMutationCount: 1 });
        expect(result.authorization.authorized).toBe(true);
        expect(result.remainingMutationCount).toBe(1);
        await seedRecovery(s.f, history[0], "provider-reappeared-old");
        const current = await interpretRecovery(await s.f.discover(), ids.storeA, [codec]);
        expect(current.records[0].classification.state).toBe("LINEAGE_INDETERMINATE");
        expect(current.blockers.length).toBeGreaterThan(0);
    });
    it("a large protected immediate-predecessor group may exceed the byte budget", async () => {
        const root = revision();
        const child = revision(createRevisionId(), root.revisionId, "large " + "x".repeat(10000));
        const s = await setup([child]);
        await seedRecovery(s.f, await recoveryMutation(root, child, "VERIFIED_APPLIED"));
        const bytes = await recoveryBytes(s);
        const result = await s.run({ maxBytes: 1 });
        expect(result.state).toBe("BUDGET_PROTECTED");
        expect(result.remainingBytes).toBe(bytes.reduce((n, [, b]) => n + b.length, 0));
        await preserved(s, result, bytes);
    });
    it("Visible fixture retention uses the same authority and finite policy", async () => {
        const s = await setup([revision()], { root: "Finders Keepers", representation: "visible" });
        await rejected(s);
        const result = await s.run();
        expect(result.state).toBe("COMPLETED");
        expect(result.authorization.authorized).toBe(true);
        expect(result.deletedLocators).toHaveLength(2);
    });
    it.each(["conflicting intent", "new canonical child", "outcome reappearance"])(
        "between-delete barrier preserves evidence after %s arrival",
        async (arrival) => {
            const root = revision();
            const child = revision(ids.revisionChildA, root.revisionId);
            let originalIntent, extraIntent, outcomeLocator, intentLocator, row;
            const s = await setup([child, root], {
                onDelete: async (locator, digest, base, count) => {
                    const original = await base.readBytes(locator);
                    const removed = await base.delete(locator, digest);
                    if (count === 1) {
                        expect(locator).toBe(outcomeLocator);
                        if (arrival === "conflicting intent") {
                            const alternative = await recoveryMutation(
                                root,
                                revision(ids.revisionChildB, root.revisionId),
                                "VERIFIED_APPLIED"
                            );
                            alternative.intent.mutationId = row.intent.mutationId;
                            extraIntent = `${s.f.target.storeCandidateLocator}/recovery/mutations/new-conflicting-copy.json`;
                            await base.createImmutable(
                                extraIntent,
                                encoder.encode(await encodeMutationIntent(alternative.intent, [codec]))
                            );
                        }
                        if (arrival === "new canonical child") {
                            const target = `${s.f.target.storeCandidateLocator}/records/sources/record-0.json`;
                            const bytes = await base.readBytes(target);
                            await base.writeSnapshot(
                                target,
                                encoder.encode(
                                    JSON.stringify(revision(createRevisionId(), child.revisionId, "arrived child"))
                                ),
                                await sha256Bytes(bytes.value)
                            );
                        }
                        if (arrival === "outcome reappearance") await base.createImmutable(locator, original.value);
                    }
                    return removed;
                },
            });
            row = await recoveryMutation(root, child, "VERIFIED_APPLIED");
            await seedRecovery(s.f, row);
            intentLocator = `${s.f.target.storeCandidateLocator}/recovery/mutations/provider-copy-${row.intent.mutationId}.json`;
            outcomeLocator = `${s.f.target.storeCandidateLocator}/recovery/outcomes/provider-copy-${row.intent.mutationId}.json`;
            originalIntent = (await s.f.base.readBytes(intentLocator)).value;
            const result = await s.run();
            expect(result.state).toBe(arrival === "outcome reappearance" ? "IO_UNCERTAIN" : "BLOCKED");
            expect(s.deletes).toHaveLength(1);
            expect(result.deletedLocators).toEqual([outcomeLocator]);
            expect((await s.f.base.readBytes(intentLocator)).value).toEqual(originalIntent);
            expect(result.aggregate.traversal.artifacts.map((a) => a.locator)).toContain(intentLocator);
            if (arrival === "conflicting intent") {
                expect((await s.f.base.readBytes(extraIntent)).ok).toBe(true);
                expect(result.authorization.blockers.some((b) => b.reason.includes("Conflicting same-mutation"))).toBe(
                    true
                );
            }
            if (arrival === "new canonical child") {
                expect(result.authorization.authorized).toBe(false);
                const remaining = result.authorization.qualifiedLineage.mutations[0].mutation.intent;
                expect(remaining.after.revisionId).toBe(child.revisionId);
                expect(
                    result.authorization.qualifiedLineage.records[0].classification.current?.envelope.revisionId
                ).not.toBe(child.revisionId);
            }
            if (arrival === "outcome reappearance") {
                expect((await s.f.base.readBytes(outcomeLocator)).ok).toBe(true);
                expect(result.authorization.authorized).toBe(true);
                expect(result.authorization.qualifiedLineage.mutations[0].state).toBe("RESOLVED_HISTORY");
            }
        }
    );
    it("successful first delete then unavailable rediscovery stops before remaining intent", async () => {
        const s = await setup(undefined, {
            onDelete: async (locator, digest, base, _count, block) => {
                const result = await base.delete(locator, digest);
                block();
                return result;
            },
        });
        const row = await rejected(s);
        const intent = `${s.f.target.storeCandidateLocator}/recovery/mutations/provider-copy-${row.intent.mutationId}.json`;
        const result = await s.run();
        expect(result.state).toBe("IO_UNCERTAIN");
        expect(s.deletes).toHaveLength(1);
        expect(result.deletedLocators).toHaveLength(1);
        expect((await s.f.base.readBytes(intent)).ok).toBe(true);
        expect(result.authorization.authorized).toBe(false);
    });
    it("stable whole group completes through the exact expected intent-without-outcome intermediate", async () => {
        const s = await setup(undefined, {
            onDelete: async (locator, digest, base, count) => {
                s.f.events.push({ method: "retention-delete", locator });
                if (count === 2) {
                    const firstIndex = s.f.events.findIndex((e) => e.method === "retention-delete");
                    expect(s.f.events.slice(firstIndex + 1, -1).some((e) => e.method === "listChildren")).toBe(true);
                    expect(
                        (await base.listChildren(`${s.f.target.storeCandidateLocator}/recovery/outcomes`, 100)).value
                            .entries
                    ).toEqual([]);
                }
                return base.delete(locator, digest);
            },
        });
        await rejected(s);
        const result = await s.run();
        expect(result.state).toBe("COMPLETED");
        expect(s.deletes).toHaveLength(2);
        expect(result.authorization.authorized).toBe(true);
        expect(result.remainingMutationCount).toBe(0);
    });
    it("stable multiple-copy pruning reobserves cumulative progress before every subsequent delete", async () => {
        const s = await setup(undefined, {
            onDelete: async (locator, digest, base) => {
                const previous = s.f.events.map((e) => e.method).lastIndexOf("retention-delete");
                if (previous >= 0)
                    expect(s.f.events.slice(previous + 1).some((e) => e.method === "listChildren")).toBe(true);
                s.f.events.push({ method: "retention-delete", locator });
                return base.delete(locator, digest);
            },
        });
        const row = await rejected(s, "first");
        await seedRecovery(s.f, row, "second");
        await seedRecovery(s.f, row, "third");
        const result = await s.run();
        expect(result.state).toBe("COMPLETED");
        expect(s.deletes).toHaveLength(6);
        expect(result.authorization.authorized).toBe(true);
    });
    it("unexpected change in the second group stops the whole pass before the third group", async () => {
        const rows = [];
        const s = await setup(undefined, {
            onDelete: async (locator, digest, base, count) => {
                const removed = await base.delete(locator, digest);
                if (count === 3) {
                    const active = rows.find((row) => locator.includes(row.intent.mutationId));
                    const competing = await recoveryMutation(
                        revision(),
                        revision(createRevisionId(), ids.revisionRoot)
                    );
                    competing.intent.mutationId = active.intent.mutationId;
                    await base.createImmutable(
                        `${s.f.target.storeCandidateLocator}/recovery/mutations/arrived-conflict.json`,
                        encoder.encode(await encodeMutationIntent(competing.intent, [codec]))
                    );
                }
                return removed;
            },
        });
        for (let i = 0; i < 3; i++) rows.push(await rejected(s, `group-${i}`));
        const ordered = [...rows].sort((a, b) => a.intent.mutationId.localeCompare(b.intent.mutationId));
        const third = ordered[2];
        const result = await s.run();
        expect(result.state).toBe("BLOCKED");
        expect(s.deletes).toHaveLength(3);
        expect(result.deletedLocators).toHaveLength(3);
        const remaining = result.aggregate.traversal.artifacts.filter((a) =>
            a.locator.includes(third.intent.mutationId)
        );
        expect(remaining).toHaveLength(2);
        for (const row of remaining) expect((await s.f.base.readBytes(row.locator)).value).toEqual(row.bytes);
    });
    it.each(["exact bytes", "different bytes"])(
        "post-unit %s reappearance never deletes a locator twice",
        async (shape) => {
            let active = false,
                roots = 0,
                injected = false;
            let saved = [];
            const s = await setup(undefined, {
                beforeList: async (locator, base) => {
                    if (!active || locator !== "") return;
                    roots++;
                    if (roots === 4 && !injected) {
                        // I+O were removed and verified absent at root observation 3.
                        injected = true;
                        for (const [path, original] of saved) {
                            let bytes = original;
                            if (shape === "different bytes" && path.includes("/outcomes/"))
                                bytes = encoder.encode(
                                    JSON.stringify({
                                        ...JSON.parse(new TextDecoder().decode(original)),
                                        status: "IO_FAILED",
                                    })
                                );
                            await base.createImmutable(path, bytes);
                        }
                    }
                },
            });
            await rejected(s);
            saved = await recoveryBytes(s);
            active = true;
            const result = await s.run();
            expect(injected).toBe(true);
            expect(result.state).toBe("IO_UNCERTAIN");
            expect(result.reason).toContain("same invocation");
            expect(s.deletes).toHaveLength(2);
            expect(new Set(s.deletes.map((row) => row.locator)).size).toBe(s.deletes.length);
            expect(result.deletedLocators).toHaveLength(2);
            for (const [path, original] of saved) {
                const observed = await s.f.base.readBytes(path);
                expect(observed.ok).toBe(true);
                if (shape === "exact bytes" || !path.includes("/outcomes/")) expect(observed.value).toEqual(original);
                else {
                    expect(observed.value).not.toEqual(original);
                    expect(JSON.parse(new TextDecoder().decode(observed.value)).status).toBe("IO_FAILED");
                }
                expect(result.aggregate.traversal.artifacts.map((row) => row.locator)).toContain(path);
            }
            if (shape === "exact bytes") {
                expect(result.authorization.authorized).toBe(true);
                // A NEW explicit invocation may assess the reappeared history afresh.
                const fresh = await s.run();
                expect(fresh.state).toBe("COMPLETED");
                expect(s.deletes.slice(2)).toHaveLength(2);
            } else expect(result.authorization.authorized).toBe(false);
        }
    );
    it("G1 artifact returning at outer replanning stops before any G2 delete", async () => {
        let active = false,
            roots = 0,
            restore;
        const s = await setup(undefined, {
            beforeList: async (locator, base) => {
                if (active && locator === "" && ++roots === 4) await base.createImmutable(restore[0], restore[1]);
            },
        });
        const rows = [await rejected(s, "first"), await rejected(s, "second")].sort((a, b) =>
            a.intent.mutationId.localeCompare(b.intent.mutationId)
        );
        const saved = await recoveryBytes(s);
        restore = saved.find(([path]) => path.includes("/mutations/") && path.includes(rows[0].intent.mutationId));
        active = true;
        const result = await s.run();
        expect(result.state).toBe("IO_UNCERTAIN");
        expect(result.reason).toContain("same invocation");
        expect(s.deletes).toHaveLength(2);
        expect(s.deletes.every((row) => row.locator.includes(rows[0].intent.mutationId))).toBe(true);
        expect((await s.f.base.readBytes(restore[0])).value).toEqual(restore[1]);
        const g2 = result.aggregate.traversal.artifacts.filter((row) =>
            row.locator.includes(rows[1].intent.mutationId)
        );
        expect(g2).toHaveLength(2);
    });
    it("G1 artifact returning during G2 stops G2 and never enters G3", async () => {
        let restore;
        const s = await setup(undefined, {
            onDelete: async (locator, digest, base, count) => {
                const result = await base.delete(locator, digest);
                if (count === 3) await base.createImmutable(restore[0], restore[1]);
                return result;
            },
        });
        const rows = [await rejected(s, "first"), await rejected(s, "second"), await rejected(s, "third")].sort(
            (a, b) => a.intent.mutationId.localeCompare(b.intent.mutationId)
        );
        const saved = await recoveryBytes(s);
        restore = saved.find(([path]) => path.includes("/outcomes/") && path.includes(rows[0].intent.mutationId));
        const result = await s.run();
        expect(result.state).toBe("IO_UNCERTAIN");
        expect(result.reason).toContain("same invocation");
        expect(s.deletes).toHaveLength(3);
        expect(new Set(s.deletes.map((row) => row.locator)).size).toBe(3);
        expect((await s.f.base.readBytes(restore[0])).value).toEqual(restore[1]);
        expect(
            result.aggregate.traversal.artifacts.filter((row) => row.locator.includes(rows[2].intent.mutationId))
        ).toHaveLength(2);
        expect(
            result.aggregate.traversal.artifacts.filter(
                (row) => row.locator.includes("/mutations/") && row.locator.includes(rows[1].intent.mutationId)
            )
        ).toHaveLength(1);
    });
    it("stable three-group budget replanning completes with unique successful physical deletes", async () => {
        const s = await setup();
        await rejected(s, "one");
        await rejected(s, "two");
        await rejected(s, "three");
        const result = await s.run();
        expect(result.state).toBe("COMPLETED");
        expect(result.budgetSatisfied).toBe(true);
        expect(s.deletes).toHaveLength(6);
        expect(new Set(s.deletes.map((row) => row.locator)).size).toBe(6);
        expect(new Set(result.deletedLocators).size).toBe(6);
    });
});
