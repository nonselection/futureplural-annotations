import { describe, it, expect } from "vitest";
import { authorizeWrite } from "../src/storage/writeAuthorization";
import { interpretRecovery } from "../src/storage/recoverySemantics";
import { createRevisionId, createMutationId } from "../src/storage/identity";
import { encodeMutationOutcome, encodeMutationIntent, mutationIntentDigest } from "../src/storage/recoveryArtifacts";
import {
    fixture,
    revision,
    codec,
    ids,
    recoveryMutation,
    seedRecovery,
    transitionFixture,
    encoder,
} from "./helpers/storageS3RecoveryFixtures";
const run = async (f) => interpretRecovery(await f.discover(), ids.storeA, [codec]);
describe("Storage S3 restart interpretation", () => {
    it.each([
        ["VERIFIED_APPLIED", "candidate", "RESOLVED_HISTORY"],
        ["VERIFIED_APPLIED", "descendant", "RESOLVED_HISTORICAL_ANCESTRY"],
        ["VERIFIED_APPLIED", "base", "CANDIDATE_AHEAD"],
        ["VERIFIED_APPLIED", "sibling", "COMPETING_BRANCH"],
        ["PRECONDITION_REJECTED", "sibling", "REJECTED_HISTORY"],
        ...["IO_FAILED", undefined].flatMap((status) => [
            [status, "candidate", "CANDIDATE_PRESENT"],
            [status, "base", "INTERRUPTED"],
            [status, "sibling", "AMBIGUOUS_CURRENT"],
            [status, "unavailable", "INDETERMINATE"],
        ]),
    ])("%s / %s -> %s without replay", async (status, shape, expected) => {
        const base = revision();
        const candidate = revision(ids.revisionChildA, base.revisionId);
        const current =
            shape === "base"
                ? base
                : shape === "sibling"
                  ? revision(ids.revisionChildB, base.revisionId)
                  : shape === "descendant"
                    ? revision(ids.revisionChildB, candidate.revisionId)
                    : candidate;
        const f = await fixture({ records: [current], listUnavailable: shape === "unavailable" });
        const row = await recoveryMutation(base, candidate, status);
        await seedRecovery(f, row);
        const result = await run(f);
        if (shape === "unavailable") {
            expect(result.blockers.length).toBeGreaterThan(0);
            // Listing unavailable may hide recovery itself; neither missing history nor success is inferred.
            expect(result.mutations).toHaveLength(0);
        } else {
            expect(result.mutations[0].state).toBe(expected);
            expect(result.mutations[0].mutation.outcome?.status).toBe(status);
            if (expected === "CANDIDATE_AHEAD") {
                expect(result.records[0].snapshotClassification.current.envelope.revisionId).toBe(base.revisionId);
                expect(result.records[0].classification.current.envelope.revisionId).toBe(candidate.revisionId);
                expect(result.blockers.some((blocker) => blocker.scope === "record")).toBe(true);
            }
            if (expected === "COMPETING_BRANCH")
                expect(result.records[0].classification.state).toBe("DIVERGENT_VALID_REVISIONS");
            if (status === "PRECONDITION_REJECTED") {
                expect(result.records[0].observations.map((o) => o.envelope.revisionId)).not.toContain(
                    candidate.revisionId
                );
                expect(result.blockers).toEqual([]);
            }
        }
        expect(
            f.events.some((event) => ["createImmutable", "writeSnapshot", "delete", "rename"].includes(event.method))
        ).toBe(false);
    });
    it.each(["IO_FAILED", undefined])(
        "%s with observed intent but unreadable snapshot is indeterminate",
        async (status) => {
            const base = revision();
            const candidate = revision(ids.revisionChildA, base.revisionId);
            const setup = await transitionFixture([candidate]);
            await seedRecovery(setup.f, await recoveryMutation(base, candidate, status));
            setup.fault.blockedReads.add(setup.request.snapshotLocator);
            const result = await interpretRecovery(await setup.discover(), ids.storeA, [codec]);
            expect(result.mutations).toHaveLength(1);
            expect(result.mutations[0].state).toBe("INDETERMINATE");
            expect(result.mutations[0].mutation.outcome?.status).toBe(status);
            expect(result.blockers.length).toBeGreaterThan(0);
        }
    );
    it.each(["IO_FAILED", undefined])(
        "uncertain %s candidate is excluded when promotion would create false divergence",
        async (status) => {
            const base = revision();
            const candidate = revision(ids.revisionChildA, base.revisionId);
            const current = revision(ids.revisionChildB, base.revisionId);
            const f = await fixture({ records: [current] });
            await seedRecovery(f, await recoveryMutation(base, candidate, status));
            const result = await run(f);
            expect(result.records[0].observations.map((row) => row.envelope.revisionId)).not.toContain(
                candidate.revisionId
            );
            expect(result.records[0].classification.state).toBe("RECORD_FOUND");
            expect(result.records[0].classification.current.envelope.revisionId).toBe(current.revisionId);
            expect(result.mutations[0].state).toBe("AMBIGUOUS_CURRENT");
            expect(result.mutations[0].mutation.outcome?.status).toBe(status);
        }
    );
    it("single wrong-bound outcome is rejected without a conflicting second outcome", async () => {
        const base = revision();
        const candidate = revision(ids.revisionChildA, base.revisionId);
        const f = await fixture({ records: [candidate] });
        const row = await recoveryMutation(base, candidate, "VERIFIED_APPLIED");
        row.outcome.intentDigest = await mutationIntentDigest((await recoveryMutation(base, candidate)).intent);
        await seedRecovery(f, row);
        const result = await run(f);
        expect(result.mutations).toHaveLength(1);
        expect(result.mutations[0].locators).toHaveLength(2);
        expect(result.mutations[0].mutation.identityValid).toBe(false);
        expect(
            result.blockers.some(
                (blocker) => blocker.scope === "store" && blocker.reason.includes("inconsistently bound")
            )
        ).toBe(true);
        const gate = await authorizeWrite(
            await f.discover(),
            {
                mode: "ordinary",
                storeId: ids.storeA,
                record: { recordKind: codec.recordKind, recordId: candidate.recordId, action: "update" },
            },
            f.port,
            [codec]
        );
        expect(gate.authorized).toBe(false);
        expect(
            gate.blockers.some(
                (blocker) => blocker.scope === "store" && blocker.reason.includes("inconsistently bound")
            )
        ).toBe(true);
        expect(gate.blockers.some((blocker) => blocker.reason.includes("Conflicting same-mutation"))).toBe(false);
    });
    it("candidate stays canonical with missing historical intent", async () => {
        const candidate = revision(ids.revisionChildA, ids.revisionRoot);
        const f = await fixture({ records: [candidate] });
        const result = await run(f);
        expect(result.mutations).toEqual([]);
        expect(result.blockers).toEqual([]);
        expect(result.records[0].classification.current.envelope.revisionId).toBe(candidate.revisionId);
    });
    it("equivalent provider-renamed recovery copies collapse while retaining locators", async () => {
        const before = revision();
        const after = revision(ids.revisionChildA, before.revisionId);
        const f = await fixture({ records: [after] });
        const row = await recoveryMutation(before, after, "VERIFIED_APPLIED");
        await seedRecovery(f, row, "arbitrary");
        await seedRecovery(f, row, "other");
        const result = await run(f);
        expect(result.mutations).toHaveLength(1);
        expect(result.mutations[0].locators).toHaveLength(4);
        expect(result.blockers).toEqual([]);
    });
    it.each([
        "intent conflict",
        "outcome conflict",
        "wrong binding",
        "orphan",
        "wrong store",
        "malformed",
        "unsupported",
    ])("%s evidence blocks without authority promotion", async (shape) => {
        const before = revision();
        const after = revision(ids.revisionChildA, before.revisionId);
        const f = await fixture({ records: [after] });
        const row = await recoveryMutation(before, after, "VERIFIED_APPLIED");
        await seedRecovery(f, row);
        let bytes;
        if (shape === "intent conflict") {
            const alternative = await recoveryMutation(
                before,
                revision(ids.revisionChildB, before.revisionId),
                "VERIFIED_APPLIED"
            );
            alternative.intent.mutationId = row.intent.mutationId;
            bytes = encoder.encode(await encodeMutationIntent(alternative.intent, [codec]));
        } else if (["outcome conflict", "wrong binding", "orphan", "wrong store"].includes(shape)) {
            const outcome = { ...row.outcome };
            if (shape === "outcome conflict") outcome.status = "PRECONDITION_REJECTED";
            if (shape === "wrong binding")
                outcome.intentDigest = await mutationIntentDigest((await recoveryMutation(before, after)).intent);
            if (shape === "orphan") outcome.mutationId = createMutationId();
            if (shape === "wrong store") outcome.storeId = ids.storeB;
            bytes = encoder.encode(encodeMutationOutcome(outcome));
        } else
            bytes = encoder.encode(
                shape === "malformed" ? "{bad" : JSON.stringify({ ...row.intent, recoveryFormatVersion: 99 })
            );
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/recovery/${shape === "intent conflict" ? "mutations" : "outcomes"}/alternate.json`,
            bytes
        );
        const result = await run(f);
        expect(result.blockers.some((b) => b.scope === "store")).toBe(true);
        expect(f.events.some((e) => e.method === "writeSnapshot")).toBe(false);
    });
    it("verified candidate with unprovable ancestry stays read-only", async () => {
        const f = await fixture({ records: [revision(createRevisionId(), createRevisionId())] });
        await seedRecovery(
            f,
            await recoveryMutation(revision(), revision(ids.revisionChildA, ids.revisionRoot), "VERIFIED_APPLIED")
        );
        const result = await run(f);
        expect(result.mutations[0].state).toBe("INDETERMINATE");
        expect(result.records[0].classification.state).toBe("LINEAGE_INDETERMINATE");
    });
});
