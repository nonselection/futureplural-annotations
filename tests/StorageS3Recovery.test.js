import { describe, expect, it } from "vitest";
import { fixture, revision, codec, ids } from "./helpers/storageS3BootstrapFixtures";
import { canonicalRevisionDigest } from "../src/storage/envelopes";
import { encodeMutationIntent, encodeMutationOutcome, mutationIntentDigest } from "../src/storage/recoveryArtifacts";
import { createMutationId } from "../src/storage/identity";
import { classifyRecordRevisions } from "../src/storage/repositorySemantics";
import { authorizeWrite } from "../src/storage/writeAuthorization";

// Ratified narrow gate correction only; no Batch-4 operation is implemented.
describe("Storage S3 Batch 4 historical authorization seam", () => {
    it("proven historical VERIFIED_APPLIED ancestor no longer blocks the future reactivation gate", async () => {
        const root = revision();
        const active = revision(ids.revisionChildA, root.revisionId, "updated active");
        const tombstone = { ...revision(ids.revisionChildB, active.revisionId, "deleted"), state: "deleted" };
        const f = await fixture({ records: [tombstone] });
        const operation = {
            mode: "ordinary",
            storeId: ids.storeA,
            record: { recordKind: codec.recordKind, recordId: tombstone.recordId, action: "reactivate" },
        };
        async function addVerified(before, after) {
            const intent = {
                recoveryFormatVersion: 1,
                storeId: ids.storeA,
                mutationId: createMutationId(),
                recordKind: codec.recordKind,
                recordId: after.recordId,
                baseRevisionId: before.revisionId,
                baseDigest: await canonicalRevisionDigest(before),
                before,
                candidateRevisionId: after.revisionId,
                candidateDigest: await canonicalRevisionDigest(after),
                after,
            };
            const encoder = new TextEncoder();
            await f.base.createImmutable(
                `${f.target.storeCandidateLocator}/recovery/mutations/${intent.mutationId}.json`,
                encoder.encode(await encodeMutationIntent(intent, [codec]))
            );
            await f.base.createImmutable(
                `${f.target.storeCandidateLocator}/recovery/outcomes/${intent.mutationId}.json`,
                encoder.encode(
                    encodeMutationOutcome({
                        recoveryFormatVersion: 1,
                        storeId: ids.storeA,
                        mutationId: intent.mutationId,
                        intentDigest: await mutationIntentDigest(intent),
                        recordKind: intent.recordKind,
                        recordId: intent.recordId,
                        candidateRevisionId: intent.candidateRevisionId,
                        candidateDigest: intent.candidateDigest,
                        status: "VERIFIED_APPLIED",
                    })
                )
            );
        }
        await addVerified(active, tombstone);
        expect((await authorizeWrite(await f.discover(), operation, f.port, [codec])).authorized).toBe(true);
        await addVerified(root, active);
        const lineage = classifyRecordRevisions([
            { envelope: active, digest: await canonicalRevisionDigest(active) },
            { envelope: tombstone, digest: await canonicalRevisionDigest(tombstone) },
        ]);
        expect(lineage.state).toBe("LINEAR_DESCENDANT");
        expect(lineage.current.envelope.revisionId).toBe(tombstone.revisionId);
        const gate = await authorizeWrite(await f.discover(), operation, f.port, [codec]);
        expect(gate).toMatchObject({ authorized: true, blockers: [] });
        expect(f.events.some(({ method }) => ["writeSnapshot", "delete", "rename"].includes(method))).toBe(false);
    });
});
