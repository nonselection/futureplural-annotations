import { describe, it, expect } from "vitest";
import { classifyRecordRevisions } from "../src/storage/repositorySemantics";
import { classifyRecoveryMutations } from "../src/storage/recoveryClassification";
import { canonicalRevisionDigest } from "../src/storage/envelopes";
import { createMutationId, createRevisionId } from "../src/storage/identity";
import { encodeMutationIntent, encodeMutationOutcome, mutationIntentDigest } from "../src/storage/recoveryArtifacts";
import { authorizeWrite } from "../src/storage/writeAuthorization";
import { fixture, revision, codec, ids } from "./helpers/storageS3BootstrapFixtures";
const encoder = new TextEncoder();
async function observation(envelope) {
    return { envelope, digest: await canonicalRevisionDigest(envelope) };
}
async function mutation(before, after, status = "VERIFIED_APPLIED") {
    const intent = {
        recoveryFormatVersion: 1,
        storeId: ids.storeA,
        mutationId: createMutationId(),
        recordKind: codec.recordKind,
        recordId: after.recordId,
        baseRevisionId: before?.revisionId ?? null,
        baseDigest: before ? await canonicalRevisionDigest(before) : null,
        before,
        candidateRevisionId: after.revisionId,
        candidateDigest: await canonicalRevisionDigest(after),
        after,
    };
    const outcome = status
        ? {
              recoveryFormatVersion: 1,
              storeId: ids.storeA,
              mutationId: intent.mutationId,
              intentDigest: await mutationIntentDigest(intent),
              recordKind: intent.recordKind,
              recordId: intent.recordId,
              candidateRevisionId: after.revisionId,
              candidateDigest: intent.candidateDigest,
              status,
          }
        : undefined;
    return { intent, outcome, identityValid: true };
}
async function seed(f, rows) {
    for (const { intent, outcome } of rows) {
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/recovery/mutations/provider-${intent.mutationId}.json`,
            encoder.encode(await encodeMutationIntent(intent, [codec]))
        );
        if (outcome)
            await f.base.createImmutable(
                `${f.target.storeCandidateLocator}/recovery/outcomes/provider-${intent.mutationId}.json`,
                encoder.encode(encodeMutationOutcome(outcome))
            );
    }
}
const op = {
    mode: "ordinary",
    storeId: ids.storeA,
    record: { recordKind: codec.recordKind, recordId: revision().recordId, action: "update" },
};
async function gate(f) {
    return authorizeWrite(await f.discover(), op, f.port, [codec]);
}
describe("pure directional recovery classification", () => {
    it.each(["exact", "ancestor", "descendant", "sibling", "unknown", "identity"])(
        "verified %s direction",
        async (shape) => {
            const base = revision();
            const candidate = revision(ids.revisionChildA, base.revisionId);
            const row = await mutation(base, candidate);
            const current =
                shape === "exact"
                    ? candidate
                    : shape === "ancestor"
                      ? revision(ids.revisionChildB, candidate.revisionId)
                      : shape === "descendant"
                        ? base
                        : shape === "sibling"
                          ? revision(ids.revisionChildB, base.revisionId)
                          : shape === "identity"
                            ? { ...candidate, payload: { value: "changed" } }
                            : revision(ids.revisionChildB, createRevisionId());
            const [finding] = classifyRecoveryMutations([row], [await observation(current)], true);
            const states = {
                exact: "RESOLVED_HISTORY",
                ancestor: "RESOLVED_HISTORICAL_ANCESTRY",
                descendant: "CANDIDATE_AHEAD",
                sibling: "COMPETING_BRANCH",
                unknown: "INDETERMINATE",
                identity: "IDENTITY_INVALID",
            };
            expect(finding.state).toBe(states[shape]);
            expect(Boolean(finding.writeGate)).toBe(!["exact", "ancestor"].includes(shape));
            const f = await fixture({ records: [current] });
            await seed(f, [row]);
            expect((await gate(f)).authorized).toBe(["exact", "ancestor"].includes(shape));
        }
    );
    it("multiple retained ancestors resolve independently; competing verified mutation still blocks", async () => {
        const base = revision();
        const c1 = revision(ids.revisionChildA, base.revisionId);
        const c2 = revision(ids.revisionChildB, c1.revisionId);
        const current = revision(createRevisionId(), c2.revisionId);
        const rows = [await mutation(base, c1), await mutation(c1, c2)];
        const observations = [await observation(current)];
        expect(classifyRecoveryMutations(rows, observations, true).map((f) => f.state)).toEqual([
            "RESOLVED_HISTORICAL_ANCESTRY",
            "RESOLVED_HISTORICAL_ANCESTRY",
        ]);
        const f = await fixture({ records: [current] });
        await seed(f, rows);
        expect((await gate(f)).authorized).toBe(true);
        const sibling = await mutation(base, revision(createRevisionId(), base.revisionId));
        const findings = classifyRecoveryMutations([...rows, sibling], observations, true);
        expect(findings.map((f) => f.state)).toEqual([
            "RESOLVED_HISTORICAL_ANCESTRY",
            "RESOLVED_HISTORICAL_ANCESTRY",
            "COMPETING_BRANCH",
        ]);
        await seed(f, [sibling]);
        expect((await gate(f)).authorized).toBe(false);
    });
    it("sibling active verified candidate cannot authorize a current tombstone", async () => {
        const base = revision();
        const candidate = revision(ids.revisionChildA, base.revisionId);
        const current = { ...revision(ids.revisionChildB, base.revisionId), state: "deleted" };
        const row = await mutation(base, candidate);
        expect(classifyRecoveryMutations([row], [await observation(current)], true)[0].state).toBe("COMPETING_BRANCH");
        const f = await fixture({ records: [current] });
        await seed(f, [row]);
        expect(
            (
                await authorizeWrite(
                    await f.discover(),
                    { ...op, record: { ...op.record, action: "reactivate" } },
                    f.port,
                    [codec]
                )
            ).authorized
        ).toBe(false);
    });
    it("rejected candidate never contributes branch evidence", async () => {
        const base = revision();
        const row = await mutation(base, revision(ids.revisionChildA, base.revisionId), "PRECONDITION_REJECTED");
        const current = revision(ids.revisionChildB, base.revisionId);
        expect(classifyRecoveryMutations([row], [await observation(current)], true)[0].state).toBe("REJECTED_HISTORY");
        const f = await fixture({ records: [current] });
        await seed(f, [row]);
        expect((await gate(f)).authorized).toBe(true);
    });
    it.each(["IO_FAILED", undefined])(
        "%s preserves candidate/base/third/unavailable distinctions and blocks",
        async (status) => {
            const base = revision();
            const candidate = revision(ids.revisionChildA, base.revisionId);
            const row = await mutation(base, candidate, status ?? null);
            for (const [current, complete, expected] of [
                [candidate, true, "CANDIDATE_PRESENT"],
                [base, true, "INTERRUPTED"],
                [revision(ids.revisionChildB, base.revisionId), true, "AMBIGUOUS_CURRENT"],
                [candidate, false, "INDETERMINATE"],
            ]) {
                const [finding] = classifyRecoveryMutations([row], [await observation(current)], complete);
                expect(finding.state).toBe(expected);
                expect(finding.writeGate).toBeDefined();
                expect(row.outcome?.status).toBe(status);
                const f = await fixture({ records: [current], listUnavailable: !complete });
                await seed(f, [row]);
                expect((await gate(f)).authorized).toBe(false);
            }
        }
    );
    it.each(["IO_FAILED", null])("%s ancestral candidate receives no verified-history exemption", async (status) => {
        const base = revision();
        const candidate = revision(ids.revisionChildA, base.revisionId);
        const row = await mutation(base, candidate, status);
        const current = revision(ids.revisionChildB, candidate.revisionId);
        const [finding] = classifyRecoveryMutations([row], [await observation(current)], true);
        expect(finding.state).toBe("AMBIGUOUS_CURRENT");
        expect(finding.writeGate).toBeDefined();
        const f = await fixture({ records: [current] });
        await seed(f, [row]);
        expect((await gate(f)).authorized).toBe(false);
    });
    it("invalid identity cannot acquire an ancestor exemption", async () => {
        const base = revision();
        const candidate = revision(ids.revisionChildA, base.revisionId);
        const row = { ...(await mutation(base, candidate)), identityValid: false };
        expect(classifyRecoveryMutations([row], [await observation(candidate)], true)[0].state).toBe(
            "IDENTITY_INVALID"
        );
    });
    it("duplicate equivalent physical history remains logically harmless", async () => {
        const base = revision();
        const candidate = revision(ids.revisionChildA, base.revisionId);
        const f = await fixture({ records: [revision(ids.revisionChildB, candidate.revisionId)] });
        const row = await mutation(base, candidate);
        await seed(f, [row]);
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/recovery/mutations/another.json`,
            encoder.encode(await encodeMutationIntent(row.intent, [codec]))
        );
        expect((await gate(f)).authorized).toBe(true);
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
        ["unavailable", { listUnavailable: true }],
        ["protocol", { protocolVersion: 2 }],
        ["representation", { stateOverrides: { establishedByMigrationId: ids.migration } }],
        ["partial", { missing: ["store.json"] }],
        [
            "unknown",
            { extraFiles: { [`.finders-keepers/stores/${ids.storeA}/unknown/raw`]: encoder.encode("unknown") } },
        ],
        [
            "migration",
            {
                extraFiles: {
                    [`.finders-keepers/stores/${ids.storeA}/meta/migrations/run/raw`]: encoder.encode("opaque"),
                },
            },
        ],
    ])("historical ancestor cannot mask %s blocker", async (_name, options) => {
        const base = revision();
        const candidate = revision(ids.revisionChildA, base.revisionId);
        const f = await fixture({ records: [revision(ids.revisionChildB, candidate.revisionId)], ...options });
        await seed(f, [await mutation(base, candidate)]);
        const result = await gate(f);
        expect(result.authorized).toBe(false);
        expect(result.blockers.some((b) => b.scope !== "record")).toBe(true);
    });
    it.each(["multiple", "mixed", "conflicting recovery", "canonical divergence", "canonical identity"])(
        "history cannot mask %s",
        async (shape) => {
            const base = revision();
            const candidate = revision(ids.revisionChildA, base.revisionId);
            const current = revision(ids.revisionChildB, candidate.revisionId);
            const f = await fixture({ records: [current] });
            const row = await mutation(base, candidate);
            await seed(f, [row]);
            if (shape === "multiple" || shape === "mixed") {
                const other = await fixture({ root: "Finders Keepers", storeId: ids.storeB });
                for (const [locator, bytes] of Object.entries(other.files))
                    await f.base.createImmutable(
                        shape === "mixed" && locator.endsWith("store.json")
                            ? `${f.target.storeCandidateLocator}/foreign.json`
                            : locator,
                        bytes
                    );
            } else if (shape === "conflicting recovery") {
                const conflict = await mutation(base, { ...candidate, payload: { value: "conflicting" } });
                conflict.intent.mutationId = row.intent.mutationId;
                await f.base.createImmutable(
                    `${f.target.storeCandidateLocator}/recovery/mutations/conflict.json`,
                    encoder.encode(await encodeMutationIntent(conflict.intent, [codec]))
                );
            } else {
                const { encodeCanonicalRevisionEnvelope } = await import("../src/storage/envelopes");
                const extra =
                    shape === "canonical identity"
                        ? { ...current, payload: { value: "different" } }
                        : revision(createRevisionId(), base.revisionId);
                await f.base.createImmutable(
                    `${f.target.storeCandidateLocator}/records/sources/extra.json`,
                    encoder.encode(encodeCanonicalRevisionEnvelope(extra, [codec]))
                );
            }
            expect((await gate(f)).authorized).toBe(false);
        }
    );
});

describe("qualified maximal-head recovery relationships", () => {
    async function context(envelopes) {
        const observations = await Promise.all(envelopes.map(observation));
        return { observations, classification: classifyRecordRevisions(observations) };
    }
    it("a qualified current verified head remains competing, not harmless history", async () => {
        const root = revision();
        const a = revision(ids.revisionChildA, root.revisionId);
        const b = revision(ids.revisionChildB, root.revisionId);
        const row = await mutation(root, a);
        const qualified = await context([root, a, b]);
        const [finding] = classifyRecoveryMutations([row], [await observation(a), await observation(b)], true, [
            qualified,
        ]);
        expect(finding.state).toBe("COMPETING_BRANCH");
        expect(finding.writeGate).toBeDefined();
    });
    it("an additional recovered competing head is retained in S1's complete head set", async () => {
        const root = revision();
        const a = revision(ids.revisionChildA, root.revisionId);
        const b = revision(ids.revisionChildB, root.revisionId);
        const c = revision(createRevisionId(), root.revisionId);
        const row = await mutation(root, c);
        const qualified = await context([root, a, b, c]);
        expect(qualified.classification.currentHeads.map((head) => head.envelope.revisionId).sort()).toEqual(
            [a.revisionId, b.revisionId, c.revisionId].sort()
        );
        const [finding] = classifyRecoveryMutations([row], [await observation(a), await observation(b)], true, [
            qualified,
        ]);
        expect(finding.state).toBe("COMPETING_BRANCH");
        expect(finding.writeGate).toBeDefined();
    });
    it("qualified divergence does not turn a candidate ahead of physical current into covered competition", async () => {
        const root = revision();
        const a = revision(ids.revisionChildA, root.revisionId);
        const c = revision(createRevisionId(), a.revisionId);
        const b = revision(ids.revisionChildB, root.revisionId);
        const rows = [await mutation(a, c), await mutation(root, b)];
        const qualified = await context([root, a, b, c]);
        expect(qualified.classification.state).toBe("DIVERGENT_VALID_REVISIONS");
        const findings = classifyRecoveryMutations(rows, [await observation(a)], true, [qualified]);
        expect(findings.map((finding) => finding.state)).toEqual(["CANDIDATE_AHEAD", "COMPETING_BRANCH"]);
        expect(findings.every((finding) => finding.writeGate)).toBe(true);
    });
    it.each(["IO_FAILED", undefined, "PRECONDITION_REJECTED"])(
        "qualified heads do not exempt %s history",
        async (status) => {
            const root = revision();
            const a = revision(ids.revisionChildA, root.revisionId);
            const b = revision(ids.revisionChildB, root.revisionId);
            const row = await mutation(null, root, status);
            if (status === undefined) row.outcome = undefined;
            const qualified = await context([root, a, b]);
            const [finding] = classifyRecoveryMutations([row], [await observation(a), await observation(b)], true, [
                qualified,
            ]);
            expect(finding.state).toBe(status === "PRECONDITION_REJECTED" ? "REJECTED_HISTORY" : "INDETERMINATE");
            expect(Boolean(finding.writeGate)).toBe(status !== "PRECONDITION_REJECTED");
            expect(finding.mutation.outcome?.status).toBe(status);
        }
    );
    it.each(["unavailable", "identity", "unknown", "wrong binding"])(
        "qualified historical proof refuses %s",
        async (shape) => {
            const root = revision();
            const a = revision(ids.revisionChildA, root.revisionId);
            const b = revision(ids.revisionChildB, shape === "unknown" ? createRevisionId() : root.revisionId);
            const row = await mutation(null, root);
            if (shape === "wrong binding") row.identityValid = false;
            const qualified = await context([
                root,
                a,
                b,
                ...(shape === "identity" ? [{ ...root, payload: { value: "changed identity" } }] : []),
            ]);
            const [finding] = classifyRecoveryMutations(
                [row],
                [await observation(a), await observation(b)],
                shape !== "unavailable",
                [qualified]
            );
            expect(finding.state).toBe(
                shape === "identity" || shape === "wrong binding" ? "IDENTITY_INVALID" : "INDETERMINATE"
            );
            expect(finding.writeGate).toBeDefined();
        }
    );
});

describe("candidate-ahead in a physically divergent record", () => {
    it("a verified recovered child ahead of one physical head cannot become an exact-resolution bypass", async () => {
        const root = revision();
        const a = revision(ids.revisionChildA, root.revisionId);
        const b = revision(ids.revisionChildB, root.revisionId);
        const c = revision(createRevisionId(), a.revisionId);
        const row = await mutation(a, c);
        const observations = await Promise.all([root, a, b, c].map(observation));
        const qualified = { observations, classification: classifyRecordRevisions(observations) };
        const [finding] = classifyRecoveryMutations([row], await Promise.all([root, a, b].map(observation)), true, [
            qualified,
        ]);
        expect(finding.state).toBe("CANDIDATE_AHEAD");
        expect(finding.writeGate).toBeDefined();
    });
});
