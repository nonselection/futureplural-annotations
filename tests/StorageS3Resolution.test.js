import { describe, it, expect } from "vitest";
import { resolveCanonicalRecord, mutateCanonicalRecord } from "../src/storage/canonicalRepository";
import { interpretRecovery } from "../src/storage/recoverySemantics";
import { encodeCanonicalRevisionEnvelope } from "../src/storage/envelopes";
import { authorizeWrite } from "../src/storage/writeAuthorization";
import { sha256Bytes } from "../src/storage/canonicalEncoding";
import { encodeMutationIntent } from "../src/storage/recoveryArtifacts";
import { createRevisionId } from "../src/storage/identity";
import {
    codec,
    ids,
    revision,
    transitionFixture,
    encoder,
    seedRecovery,
    recoveryMutation,
} from "./helpers/storageS3RecoveryFixtures";
async function setupResolution(options = {}, rows) {
    const heads = rows ?? [
        revision(ids.revisionChildA, ids.revisionRoot),
        revision(ids.revisionChildB, ids.revisionRoot),
    ];
    const setup = await transitionFixture(heads, options);
    return {
        ...setup,
        heads,
        request: {
            ...setup.request,
            parentRevisionId: heads[0].revisionId,
            resolvedRevisionIds: heads.map((row) => row.revisionId).reverse(),
            state: "active",
        },
    };
}
const writes = (fault) => fault.events.filter((e) => e.method === "writeSnapshot");
const intents = (fault) =>
    fault.events.filter((e) => e.method === "createImmutable" && e.locator.includes("/mutations/"));
async function addRecord(setup, row, name) {
    await setup.f.base.createImmutable(
        `${setup.request.branchLocator}/records/sources/${name}.json`,
        encoder.encode(encodeCanonicalRevisionEnvelope(row, [codec]))
    );
}
describe("Storage S3 explicit complete-head resolution", () => {
    it("resolves complete heads through the shared guarded protocol without deleting any evidence", async () => {
        const setup = await setupResolution();
        const result = await resolveCanonicalRecord(setup.request);
        expect(result.localAttempt).toBe("VERIFIED_APPLIED");
        expect(result.intentPersistence).toBe("VERIFIED");
        expect(result.outcomePersistence).toBe("VERIFIED");
        const candidate = result.intent.after;
        expect(candidate.parentRevisionId).toBe(setup.heads[0].revisionId);
        expect(candidate.resolvedRevisionIds).toEqual(setup.heads.map((row) => row.revisionId).sort());
        expect(setup.heads.map((row) => row.revisionId)).not.toContain(candidate.revisionId);
        expect(result.aggregate.logicalStores[0].records[0].classification.state).toBe("RESOLVED_LINEAGE");
        expect(result.aggregate.logicalStores[0].records[0].classification.current.envelope.revisionId).toBe(
            candidate.revisionId
        );
        expect(result.currentAuthorization.authorized).toBe(true);
        expect(writes(setup.fault)).toHaveLength(1);
        expect(setup.fault.events.some((e) => ["delete", "rename"].includes(e.method))).toBe(false);
        // Target head remains in immutable intent; other physical head remains in place.
        expect((await setup.f.base.readBytes(`${setup.request.branchLocator}/records/sources/record-1.json`)).ok).toBe(
            true
        );
        await addRecord(setup, setup.heads[0], "reappeared-exact");
        let discovered = await setup.discover();
        expect(discovered.logicalStores[0].records[0].classification.current.envelope.revisionId).toBe(
            candidate.revisionId
        );
        // Proven descendant of resolving revision retains the exact-head suppression.
        const next = await mutateCanonicalRecord({ ...setup.request, action: "update" });
        expect(next.localAttempt).toBe("VERIFIED_APPLIED");
        discovered = await setup.discover();
        // The resolving revision was replaced at the mutable path. Recovery retains
        // its exact canonical evidence, so S1 can prove the descendant's provenance.
        const interpreted = await interpretRecovery(discovered, ids.storeA, [codec]);
        expect(interpreted.records[0].classification.current.envelope.revisionId).toBe(next.intent.after.revisionId);
        expect(interpreted.records[0].classification.state).toBe("RESOLVED_LINEAGE");
        expect(interpreted.records[0].snapshotClassification.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(interpreted.blockers).toEqual([]);
        const gate = await authorizeWrite(
            discovered,
            {
                mode: "ordinary",
                storeId: ids.storeA,
                record: { recordKind: codec.recordKind, recordId: setup.request.recordId, action: "update" },
            },
            setup.fault.port,
            [codec]
        );
        expect(gate.authorized).toBe(true);
        expect(next.currentAuthorization.authorized).toBe(true);
        const later = await mutateCanonicalRecord({ ...setup.request, action: "update", payload: { value: "E" } });
        expect(later.localAttempt).toBe("VERIFIED_APPLIED");
        expect(later.intent.after.parentRevisionId).toBe(next.intent.after.revisionId);
        expect(later.currentAuthorization.authorized).toBe(true);
        await addRecord(
            setup,
            revision(createRevisionId(), setup.heads[1].revisionId, "new branch"),
            "later-old-head-child"
        );
        expect((await setup.discover()).logicalStores[0].records[0].classification.state).toBe(
            "DIVERGENT_VALID_REVISIONS"
        );
    });
    it("R to D to E keeps actual ordinary authorization with snapshot-only indeterminacy", async () => {
        const setup = await setupResolution();
        const r = await resolveCanonicalRecord(setup.request);
        expect(r.localAttempt).toBe("VERIFIED_APPLIED");
        const d = await mutateCanonicalRecord({ ...setup.request, action: "update" });
        expect(d.localAttempt).toBe("VERIFIED_APPLIED");
        const snapshot = await setup.discover();
        expect(snapshot.logicalStores[0].records[0].classification.state).toBe("LINEAGE_INDETERMINATE");
        const interpreted = await interpretRecovery(snapshot, ids.storeA, [codec]);
        expect(interpreted.records[0].classification.state).toBe("RESOLVED_LINEAGE");
        expect(interpreted.blockers).toEqual([]);
        const gate = await authorizeWrite(
            snapshot,
            {
                mode: "ordinary",
                storeId: ids.storeA,
                record: { recordKind: codec.recordKind, recordId: setup.request.recordId, action: "update" },
            },
            setup.fault.port,
            [codec]
        );
        expect(gate.authorized).toBe(true);
        expect(d.currentAuthorization.authorized).toBe(true);
        const e = await mutateCanonicalRecord({ ...setup.request, action: "update", payload: { value: "E" } });
        expect(e.localAttempt).toBe("VERIFIED_APPLIED");
        expect(e.intent.after.parentRevisionId).toBe(d.intent.after.revisionId);
        expect(e.currentAuthorization.authorized).toBe(true);
    });
    it.each(["snapshot parent", "recovery parent"])(
        "complete recovery-only head resolution uses %s",
        async (choice) => {
            const a = revision(ids.revisionChildA, ids.revisionRoot);
            const b = revision(ids.revisionChildB, ids.revisionRoot);
            const setup = await setupResolution({}, [a]);
            await seedRecovery(setup.f, await recoveryMutation(revision(), b, "VERIFIED_APPLIED"));
            const local = (await setup.f.base.readBytes(setup.request.snapshotLocator)).value;
            const result = await resolveCanonicalRecord({
                ...setup.request,
                resolvedRevisionIds: [a.revisionId, b.revisionId],
                parentRevisionId: choice === "recovery parent" ? b.revisionId : a.revisionId,
            });
            expect(result.localAttempt).toBe("VERIFIED_APPLIED");
            expect(result.intent.after.resolvedRevisionIds).toEqual([a.revisionId, b.revisionId].sort());
            expect(result.base.rawByteDigest).toBe(await sha256Bytes(local));
            expect(result.intent.baseRevisionId).toBe(choice === "recovery parent" ? b.revisionId : a.revisionId);
            expect(result.currentAuthorization.authorized).toBe(true);
            expect((await interpretRecovery(await setup.discover(), ids.storeA, [codec])).blockers).toEqual([]);
            const d = await mutateCanonicalRecord({ ...setup.request, action: "update" });
            expect(d.localAttempt).toBe("VERIFIED_APPLIED");
            expect(d.currentAuthorization.authorized).toBe(true);
            const e = await mutateCanonicalRecord({ ...setup.request, action: "update" });
            expect(e.localAttempt).toBe("VERIFIED_APPLIED");
            expect(e.intent.after.parentRevisionId).toBe(d.intent.after.revisionId);
            expect(e.currentAuthorization.authorized).toBe(true);
        }
    );
    it.each(["A only", "B only", "extra C"])("recovery-head resolution refuses %s", async (shape) => {
        const a = revision(ids.revisionChildA, ids.revisionRoot);
        const b = revision(ids.revisionChildB, ids.revisionRoot);
        const setup = await setupResolution({}, [a]);
        await seedRecovery(setup.f, await recoveryMutation(revision(), b, "VERIFIED_APPLIED"));
        const heads =
            shape === "A only"
                ? [a.revisionId]
                : shape === "B only"
                  ? [b.revisionId]
                  : [a.revisionId, b.revisionId, createRevisionId()];
        const result = await resolveCanonicalRecord({ ...setup.request, resolvedRevisionIds: heads });
        expect(result.state).toBe("REFUSED");
        expect(intents(setup.fault)).toHaveLength(0);
        expect(writes(setup.fault)).toHaveLength(0);
    });
    it.each([false, true])("three-head qualified coverage, complete=%s", async (complete) => {
        const setup = await setupResolution();
        const c = revision(createRevisionId(), ids.revisionRoot);
        await seedRecovery(setup.f, await recoveryMutation(revision(), c, "VERIFIED_APPLIED"));
        const result = await resolveCanonicalRecord({
            ...setup.request,
            resolvedRevisionIds: [...setup.request.resolvedRevisionIds, ...(complete ? [c.revisionId] : [])],
        });
        expect(result.state).toBe(complete ? "ATTEMPTED" : "REFUSED");
        if (complete) expect(result.localAttempt).toBe("VERIFIED_APPLIED");
        else expect(writes(setup.fault)).toHaveLength(0);
    });
    it.each([
        "IO_FAILED",
        "no outcome",
        "conflicting",
        "wrong bound",
        "unavailable",
        "protocol",
        "representation",
        "namespace",
    ])("qualified complete heads cannot bypass %s", async (shape) => {
        const a = revision(ids.revisionChildA, ids.revisionRoot);
        const b = revision(ids.revisionChildB, ids.revisionRoot);
        let unavailable = false;
        const setup = await setupResolution({ listUnavailable: () => unavailable }, [a]);
        const verified = await recoveryMutation(revision(), b, "VERIFIED_APPLIED");
        await seedRecovery(setup.f, verified);
        if (shape === "IO_FAILED" || shape === "no outcome")
            await seedRecovery(
                setup.f,
                await recoveryMutation(
                    revision(),
                    revision(createRevisionId(), ids.revisionRoot),
                    shape === "IO_FAILED" ? "IO_FAILED" : undefined
                )
            );
        if (shape === "conflicting") {
            const copy = await recoveryMutation(revision(), revision(createRevisionId(), ids.revisionRoot));
            copy.intent.mutationId = verified.intent.mutationId;
            await setup.f.base.createImmutable(
                `${setup.request.branchLocator}/recovery/mutations/conflict.json`,
                encoder.encode(await encodeMutationIntent(copy.intent, [codec]))
            );
        }
        if (shape === "wrong bound") {
            const bad = await recoveryMutation(
                revision(),
                revision(createRevisionId(), ids.revisionRoot),
                "VERIFIED_APPLIED"
            );
            bad.outcome.candidateDigest = verified.intent.candidateDigest;
            await seedRecovery(setup.f, bad);
        }
        if (shape === "unavailable")
            setup.fault.blockedReads.add(
                `${setup.request.branchLocator}/recovery/outcomes/provider-copy-${verified.intent.mutationId}.json`
            );
        if (shape === "protocol")
            await setup.f.base.createImmutable(
                `${setup.request.branchLocator}/meta/protocol/new.json`,
                encoder.encode('{"schema":"finders-keepers.protocol-fence","version":99}')
            );
        if (shape === "representation")
            await setup.f.base.createImmutable(
                `${setup.request.branchLocator}/meta/representation-states/invalid.json`,
                encoder.encode('{"schema":"finders-keepers.representation-state","version":99}')
            );
        if (shape === "namespace") unavailable = true;
        const result = await resolveCanonicalRecord({
            ...setup.request,
            resolvedRevisionIds: [a.revisionId, b.revisionId],
        });
        expect(result.state).toBe("REFUSED");
        expect(writes(setup.fault)).toHaveLength(0);
        expect(intents(setup.fault)).toHaveLength(0);
    });
    it("explicit resolution can adjudicate active/tombstone siblings into a codec-valid deleted state", async () => {
        const heads = [
            { ...revision(ids.revisionChildA, ids.revisionRoot), state: "deleted" },
            revision(ids.revisionChildB, ids.revisionRoot),
        ];
        const setup = await setupResolution({}, heads);
        const result = await resolveCanonicalRecord({ ...setup.request, state: "deleted", payload: {} });
        expect(result.localAttempt).toBe("VERIFIED_APPLIED");
        expect(result.intent.after.state).toBe("deleted");
        expect(result.intent.after.parentRevisionId).toBe(heads[0].revisionId);
        expect(result.intent.after.resolvedRevisionIds).toEqual(heads.map((head) => head.revisionId).sort());
    });
    it.each(["subset", "duplicate", "wrong parent", "indeterminate", "identity invalid", "broader", "recovery"])(
        "refuses %s without intent or snapshot",
        async (shape) => {
            let rows;
            if (shape === "subset")
                rows = [
                    revision(ids.revisionChildA, ids.revisionRoot),
                    revision(ids.revisionChildB, ids.revisionRoot),
                    revision(createRevisionId(), ids.revisionRoot),
                ];
            if (shape === "indeterminate")
                rows = [
                    revision(ids.revisionChildA, createRevisionId()),
                    revision(ids.revisionChildB, createRevisionId()),
                ];
            if (shape === "identity invalid")
                rows = [
                    revision(ids.revisionChildA, ids.revisionRoot),
                    revision(ids.revisionChildA, ids.revisionRoot, "changed"),
                ];
            const setup = await setupResolution({}, rows);
            if (shape === "subset") setup.request.resolvedRevisionIds = setup.request.resolvedRevisionIds.slice(0, 2);
            if (shape === "duplicate") setup.request.resolvedRevisionIds.push(setup.request.resolvedRevisionIds[0]);
            if (shape === "wrong parent") setup.request.parentRevisionId = createRevisionId();
            if (shape === "broader")
                await setup.f.base.createImmutable(
                    `${setup.request.branchLocator}/meta/protocol/unknown.json`,
                    encoder.encode('{"schema":"finders-keepers.protocol-fence","version":99}')
                );
            if (shape === "recovery") await seedRecovery(setup.f, await recoveryMutation(revision(), setup.heads[0]));
            const result = await resolveCanonicalRecord(setup.request);
            expect(result.state).toBe("REFUSED");
            expect(writes(setup.fault)).toHaveLength(0);
            expect(intents(setup.fault)).toHaveLength(0);
        }
    );
    it("stale historical resolution provenance cannot suppress current competing evidence", async () => {
        const setup = await setupResolution();
        const result = await resolveCanonicalRecord(setup.request);
        const stale = result.intent.after;
        // Construct later adjudication that dominates the stale resolver while leaving an
        // exact head formerly named by it newly participating in the current state.
        const competing = revision(createRevisionId(), ids.revisionRoot, "competing");
        await addRecord(setup, competing, "competing");
        const current = {
            ...revision(createRevisionId(), competing.revisionId, "current resolver"),
            resolvedRevisionIds: [stale.revisionId, competing.revisionId].sort(),
        };
        await addRecord(setup, current, "current-resolver");
        await addRecord(setup, setup.heads[1], "old-head-reappears");
        const classification = (await setup.discover()).logicalStores[0].records[0].classification;
        expect(classification.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(classification.currentHeads.map((head) => head.envelope.revisionId)).toContain(
            setup.heads[1].revisionId
        );
    });
    it.each(["absent-error", "applied-error", "unavailable"])(
        "uncertain resolution %s keeps IO_FAILED status",
        async (snapshot) => {
            const setup = await setupResolution({ snapshot });
            const result = await resolveCanonicalRecord(setup.request);
            expect(result.localAttempt).toBe("IO_FAILED");
            expect(result.outcome.status).toBe("IO_FAILED");
            expect(writes(setup.fault)).toHaveLength(1);
        }
    );
    it.each(["after-intent-verification", "after-snapshot-reread"])(
        "resolution crash at %s preserves generic recovery evidence",
        async (crashAt) => {
            const setup = await setupResolution({ crashAt });
            await expect(resolveCanonicalRecord(setup.request)).rejects.toThrow("fixture crash");
            const history = await interpretRecovery(await setup.discover(), ids.storeA, [codec]);
            expect(history.mutations[0].mutation.outcome).toBeUndefined();
            if (crashAt === "after-snapshot-reread") expect(history.mutations[0].state).toBe("CANDIDATE_PRESENT");
            else expect(history.mutations[0].state).toBe("INDETERMINATE"); // divergent pre-state, no unique base
            expect(writes(setup.fault)).toHaveLength(crashAt === "after-snapshot-reread" ? 1 : 0);
        }
    );
});

// Real repository-created ancestry retains all intent/outcome files; no history
// is hidden to make either exact resolution succeed.
async function retainedDivergence(branchLocal = false) {
    const setup = await transitionFixture([]);
    const root = await mutateCanonicalRecord({ ...setup.request, action: "create", payload: { value: "R0" } });
    expect(root.localAttempt).toBe("VERIFIED_APPLIED");
    const x = branchLocal
        ? await mutateCanonicalRecord({ ...setup.request, action: "update", payload: { value: "X" } })
        : undefined;
    if (x) expect(x.localAttempt).toBe("VERIFIED_APPLIED");
    const a = await mutateCanonicalRecord({ ...setup.request, action: "update", payload: { value: "A" } });
    expect(a.localAttempt).toBe("VERIFIED_APPLIED");
    const b = revision(createRevisionId(), root.intent.after.revisionId, "B");
    await addRecord(setup, b, "provider-sibling");
    return { ...setup, root, x, a, b };
}
async function exactResolutionRequest(setup) {
    const interpreted = await interpretRecovery(await setup.discover(), ids.storeA, [codec]);
    const record = interpreted.records[0];
    expect(record.classification.state).toBe("DIVERGENT_VALID_REVISIONS");
    const heads = record.classification.currentHeads;
    return {
        ...setup.request,
        state: "active",
        parentRevisionId: heads[0].envelope.revisionId,
        resolvedRevisionIds: heads.map((head) => head.envelope.revisionId),
    };
}
describe("Storage S3 retained-history composition", () => {
    it.each(["A", "B"])("retained R0 history permits exact resolution with parent %s", async (parent) => {
        const setup = await retainedDivergence();
        const before = await interpretRecovery(await setup.discover(), ids.storeA, [codec]);
        const rootFinding = before.mutations.find(
            (row) => row.mutation.intent.mutationId === setup.root.intent.mutationId
        );
        expect(rootFinding.state).toBe("RESOLVED_QUALIFIED_HISTORY");
        expect(rootFinding.writeGate).toBeUndefined();
        const aFinding = before.mutations.find((row) => row.mutation.intent.mutationId === setup.a.intent.mutationId);
        expect(aFinding.state).toBe("COMPETING_BRANCH");
        expect(aFinding.writeGate).toBeDefined();
        const result = await resolveCanonicalRecord({
            ...(await exactResolutionRequest(setup)),
            parentRevisionId: parent === "A" ? setup.a.intent.after.revisionId : setup.b.revisionId,
        });
        expect(result.localAttempt).toBe("VERIFIED_APPLIED");
        expect(result.currentAuthorization.authorized).toBe(true);
        for (const locator of rootFinding.locators) expect((await setup.f.base.readBytes(locator)).ok).toBe(true);
        expect(setup.fault.events.some((event) => event.method === "delete")).toBe(false);
    });
    it("branch-local X is historical beneath A without being an ancestor of B", async () => {
        const setup = await retainedDivergence(true);
        const before = await interpretRecovery(await setup.discover(), ids.storeA, [codec]);
        const finding = before.mutations.find((row) => row.mutation.intent.mutationId === setup.x.intent.mutationId);
        expect(finding.state).toBe("RESOLVED_QUALIFIED_HISTORY");
        expect(finding.writeGate).toBeUndefined();
        expect(before.records[0].classification.currentHeads.map((row) => row.envelope.revisionId).sort()).toEqual(
            [setup.a.intent.after.revisionId, setup.b.revisionId].sort()
        );
        expect((await resolveCanonicalRecord(await exactResolutionRequest(setup))).localAttempt).toBe(
            "VERIFIED_APPLIED"
        );
    });
    it.each(["complete", "omitted", "extra", "IO_FAILED", "no outcome", "identity invalid", "unavailable"])(
        "second exact resolution with retained verified history: %s",
        async (shape) => {
            const setup = await retainedDivergence();
            // B is a real verified branch as well as a provider snapshot. Its exact
            // history is resolved by R's provenance, not ordinary parent ancestry.
            const bHistory = await recoveryMutation(setup.root.intent.after, setup.b, "VERIFIED_APPLIED");
            await seedRecovery(setup.f, bHistory);
            const r = await resolveCanonicalRecord({
                ...(await exactResolutionRequest(setup)),
                parentRevisionId: setup.a.intent.after.revisionId,
            });
            expect(r.localAttempt).toBe("VERIFIED_APPLIED");
            const d = await mutateCanonicalRecord({ ...setup.request, action: "update", payload: { value: "D" } });
            const e = await mutateCanonicalRecord({ ...setup.request, action: "update", payload: { value: "E" } });
            expect(d.localAttempt).toBe("VERIFIED_APPLIED");
            expect(e.localAttempt).toBe("VERIFIED_APPLIED");
            const a2 = revision(createRevisionId(), setup.a.intent.after.revisionId, "A2 new competition");
            await addRecord(setup, a2, "old-head-new-child");
            const request = await exactResolutionRequest(setup);
            // Preserve the current resolver lineage as the one direct parent.
            request.parentRevisionId = e.intent.after.revisionId;
            expect(request.resolvedRevisionIds.sort()).toEqual([e.intent.after.revisionId, a2.revisionId].sort());
            const interpreted = await interpretRecovery(await setup.discover(), ids.storeA, [codec]);
            for (const mutationId of [
                setup.root.intent.mutationId,
                setup.a.intent.mutationId,
                bHistory.intent.mutationId,
                r.intent.mutationId,
                d.intent.mutationId,
            ]) {
                const finding = interpreted.mutations.find((row) => row.mutation.intent.mutationId === mutationId);
                expect(finding.state).toBe("RESOLVED_QUALIFIED_HISTORY");
                expect(finding.writeGate).toBeUndefined();
            }
            if (shape === "omitted") request.resolvedRevisionIds = [e.intent.after.revisionId];
            if (shape === "extra") request.resolvedRevisionIds.push(createRevisionId());
            if (shape === "IO_FAILED" || shape === "no outcome")
                await seedRecovery(
                    setup.f,
                    await recoveryMutation(
                        e.intent.after,
                        revision(createRevisionId(), e.intent.after.revisionId),
                        shape === "IO_FAILED" ? shape : undefined
                    )
                );
            if (shape === "identity invalid")
                await addRecord(setup, { ...a2, payload: { value: "different same identity" } }, "invalid-identity");
            if (shape === "unavailable") setup.fault.blockedReads.add(setup.request.snapshotLocator);
            const priorWrites = writes(setup.fault).length;
            const result = await resolveCanonicalRecord(request);
            if (shape === "complete") {
                expect(result.localAttempt).toBe("VERIFIED_APPLIED");
                expect(result.intent.after.parentRevisionId).toBe(request.parentRevisionId);
                expect(result.intent.after.resolvedRevisionIds).toEqual(request.resolvedRevisionIds.sort());
                expect(result.currentAuthorization.authorized).toBe(true);
            } else {
                expect(result.state).toBe("REFUSED");
                expect(writes(setup.fault)).toHaveLength(priorWrites);
            }
        }
    );
});

describe("qualified recovery still requires physical recovery of candidate-ahead state", () => {
    it("complete head coverage cannot waive a recovered candidate ahead of one physical branch", async () => {
        const root = revision();
        const a = revision(ids.revisionChildA, root.revisionId);
        const b = revision(ids.revisionChildB, root.revisionId);
        const c = revision(createRevisionId(), a.revisionId);
        const setup = await setupResolution({}, [a, b, root]);
        const history = await recoveryMutation(a, c, "VERIFIED_APPLIED");
        await seedRecovery(setup.f, history);
        const interpreted = await interpretRecovery(await setup.discover(), ids.storeA, [codec]);
        expect(
            interpreted.records[0].classification.currentHeads.map((head) => head.envelope.revisionId).sort()
        ).toEqual([b.revisionId, c.revisionId].sort());
        expect(interpreted.mutations[0].state).toBe("CANDIDATE_AHEAD");
        const result = await resolveCanonicalRecord({
            ...setup.request,
            parentRevisionId: b.revisionId,
            resolvedRevisionIds: [b.revisionId, c.revisionId],
        });
        expect(result.state).toBe("REFUSED");
        expect(writes(setup.fault)).toHaveLength(0);
        expect(intents(setup.fault)).toHaveLength(0);
    });
});
