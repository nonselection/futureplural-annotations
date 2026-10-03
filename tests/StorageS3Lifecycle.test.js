import { describe, it, expect } from "vitest";
import {
    mutateCanonicalRecord,
    tombstoneCanonicalRecord,
    reactivateCanonicalRecord,
} from "../src/storage/canonicalRepository";
import { interpretRecovery } from "../src/storage/recoverySemantics";
import { decodeCanonicalRevisionEnvelope } from "../src/storage/envelopes";
import { createRevisionId } from "../src/storage/identity";
import { revision, codec, ids, transitionFixture, overwrite } from "./helpers/storageS3RecoveryFixtures";
const decodedSnapshot = async ({ f, request }) =>
    decodeCanonicalRevisionEnvelope(new TextDecoder().decode((await f.base.readBytes(request.snapshotLocator)).value), [
        codec,
    ]);
const writes = (fault) => fault.events.filter((e) => e.method === "writeSnapshot");
const intents = (fault) =>
    fault.events.filter((e) => e.method === "createImmutable" && e.locator.includes("/mutations/"));
describe("Storage S3 explicit lifecycle", () => {
    it("active deletion and explicit reactivation preserve identity and all guarded evidence", async () => {
        const setup = await transitionFixture();
        const { request, fault } = setup;
        const updated = await mutateCanonicalRecord({ ...request, action: "update" });
        expect(updated.localAttempt).toBe("VERIFIED_APPLIED");
        const removed = await tombstoneCanonicalRecord(request);
        expect(removed.localAttempt).toBe("VERIFIED_APPLIED");
        expect(removed.intent.after).toMatchObject({
            state: "deleted",
            recordId: request.recordId,
            parentRevisionId: updated.intent.after.revisionId,
            resolvedRevisionIds: [],
        });
        expect(removed.intent.after.revisionId).not.toBe(ids.revisionRoot);
        expect(removed.intentPersistence).toBe("VERIFIED");
        expect(removed.outcomePersistence).toBe("VERIFIED");
        const beforeEvents = fault.events.length;
        const refused = await mutateCanonicalRecord({ ...request, action: "update" });
        expect(refused.state).toBe("REFUSED");
        expect(
            fault.events.slice(beforeEvents).some((e) => ["createImmutable", "writeSnapshot"].includes(e.method))
        ).toBe(false);
        const restored = await reactivateCanonicalRecord(request);
        expect(restored.localAttempt).toBe("VERIFIED_APPLIED");
        expect(restored.intent.after).toMatchObject({
            state: "active",
            recordId: request.recordId,
            parentRevisionId: removed.intent.after.revisionId,
            resolvedRevisionIds: [],
        });
        expect(restored.intent.after.revisionId).not.toBe(removed.intent.after.revisionId);
        expect(writes(fault)).toHaveLength(3);
        expect(intents(fault)).toHaveLength(3);
        expect(fault.events.some((e) => ["rename", "delete"].includes(e.method))).toBe(false);
        const history = await interpretRecovery(await setup.discover(), ids.storeA, [codec]);
        expect(history.blockers).toEqual([]);
        expect(history.mutations.map((m) => m.state).sort()).toEqual(
            ["RESOLVED_HISTORICAL_ANCESTRY", "RESOLVED_HISTORICAL_ANCESTRY", "RESOLVED_HISTORY"].sort()
        );
    });
    it("ordinary API cannot be used to smuggle lifecycle/resolution actions", async () => {
        const setup = await transitionFixture([{ ...revision(), state: "deleted" }]);
        expect(() => mutateCanonicalRecord({ ...setup.request, action: "reactivate" })).toThrow(
            "active create/update only"
        );
        expect(writes(setup.fault)).toHaveLength(0);
        expect(intents(setup.fault)).toHaveLength(0);
    });
    it.each(["delete", "reactivate"])("%s rejects a non-codec payload before persistence", async (action) => {
        const setup = await transitionFixture([{ ...revision(), state: action === "delete" ? "active" : "deleted" }]);
        const operation = action === "delete" ? tombstoneCanonicalRecord : reactivateCanonicalRecord;
        const result = await operation({ ...setup.request, payload: null });
        expect(result.state).toBe("REFUSED");
        expect(writes(setup.fault)).toHaveLength(0);
        expect(intents(setup.fault)).toHaveLength(0);
    });
    it("same-ID fresh reset refuses; a distinct record ID can be newly created", async () => {
        const setup = await transitionFixture([{ ...revision(), state: "deleted" }]);
        const reset = await mutateCanonicalRecord({
            ...setup.request,
            action: "create",
            snapshotLocator: `${setup.request.branchLocator}/records/sources/reset.json`,
        });
        expect(reset.state).toBe("REFUSED");
        expect(intents(setup.fault)).toHaveLength(0);
        const created = await mutateCanonicalRecord({
            ...setup.request,
            action: "create",
            recordId: "s2-fixture-genuinely-new-id",
            snapshotLocator: `${setup.request.branchLocator}/records/sources/new-id.json`,
        });
        expect(created.localAttempt).toBe("VERIFIED_APPLIED");
        expect(created.intent.after.recordId).not.toBe(setup.request.recordId);
        expect(created.intent.after.parentRevisionId).toBe(null);
    });
    it.each([
        "already deleted",
        "missing",
        "reactivate active",
        "divergent",
        "indeterminate",
        "identity invalid",
        "protocol",
    ])("refuses %s before intent", async (shape) => {
        const base = revision();
        const t = { ...revision(ids.revisionChildA, base.revisionId), state: "deleted" };
        const rows =
            shape === "missing"
                ? []
                : shape === "already deleted"
                  ? [t]
                  : shape === "divergent"
                    ? [t, revision(ids.revisionChildB, base.revisionId)]
                    : shape === "indeterminate"
                      ? [
                            revision(createRevisionId(), createRevisionId()),
                            revision(createRevisionId(), createRevisionId()),
                        ]
                      : shape === "identity invalid"
                        ? [base, { ...base, payload: { value: "different" } }]
                        : [base];
        const setup = await transitionFixture(rows);
        if (shape === "protocol")
            await setup.f.base.createImmutable(
                `${setup.request.branchLocator}/meta/protocol/unknown.json`,
                new TextEncoder().encode('{"schema":"finders-keepers.protocol-fence","version":99}')
            );
        const result =
            shape === "reactivate active"
                ? await reactivateCanonicalRecord(setup.request)
                : await tombstoneCanonicalRecord(setup.request);
        expect(result.state).toBe("REFUSED");
        expect(intents(setup.fault)).toHaveLength(0);
        expect(writes(setup.fault)).toHaveLength(0);
        if (shape === "divergent")
            expect(result.aggregate.logicalStores[0].records[0].classification.state).toBe("DIVERGENT_VALID_REVISIONS");
    });
    it("reactivation stale guard rejects and preserves the concurrent tombstone", async () => {
        const original = { ...revision(), state: "deleted" };
        const concurrent = { ...revision(createRevisionId(), original.revisionId, "concurrent"), state: "deleted" };
        const setup = await transitionFixture([original], {
            beforeSnapshot: (locator, base) => overwrite(base, locator, concurrent),
        });
        const result = await reactivateCanonicalRecord(setup.request);
        expect(result.localAttempt).toBe("PRECONDITION_REJECTED");
        expect(result.outcome.status).toBe("PRECONDITION_REJECTED");
        expect(await decodedSnapshot(setup)).toEqual(concurrent);
        expect(writes(setup.fault)).toHaveLength(1);
    });
    it.each(["absent-error", "applied-error", "unavailable"])(
        "tombstone %s remains IO_FAILED, never retries",
        async (snapshot) => {
            const setup = await transitionFixture([revision()], { snapshot });
            const result = await tombstoneCanonicalRecord(setup.request);
            expect(result.localAttempt).toBe("IO_FAILED");
            expect(result.outcome.status).toBe("IO_FAILED");
            expect(writes(setup.fault)).toHaveLength(1);
            if (snapshot === "applied-error") expect((await decodedSnapshot(setup)).state).toBe("deleted");
        }
    );
    it.each(["delete", "reactivate"])("%s restart evidence is generic, not replayed", async (action) => {
        for (const [crashAt, state] of [
            ["after-intent-verification", "INTERRUPTED"],
            ["after-snapshot-reread", "CANDIDATE_PRESENT"],
        ]) {
            const setup = await transitionFixture(
                [{ ...revision(), state: action === "delete" ? "active" : "deleted" }],
                { crashAt }
            );
            const operation = action === "delete" ? tombstoneCanonicalRecord : reactivateCanonicalRecord;
            await expect(operation(setup.request)).rejects.toThrow("fixture crash");
            const eventsBefore = setup.fault.events.length;
            const history = await interpretRecovery(await setup.discover(), ids.storeA, [codec]);
            expect(history.mutations[0].state).toBe(state);
            expect(history.mutations[0].mutation.outcome).toBeUndefined();
            expect(
                setup.fault.events
                    .slice(eventsBefore)
                    .some((e) => ["writeSnapshot", "createImmutable"].includes(e.method))
            ).toBe(false);
        }
    });
});
