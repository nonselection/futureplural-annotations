import { describe, expect, it } from "vitest";
import { canonicalRevisionDigest } from "../src/storage/envelopes";
import {
    assessProtocolWriteFence,
    classifyRecordRevisions,
    classifyStoreInventory,
    validateExplicitResolutionCoverage,
    validateRepresentationStateLineage,
} from "../src/storage/repositorySemantics";
import {
    createMigrationId,
    createRepresentationStateId,
    createRevisionId,
    createStoreId,
} from "../src/storage/identity";
import { representationStateArtifactDigest } from "../src/storage/authorityArtifacts";

function makeRevision(storeId, revisionId, parentRevisionId, payload = { value: "one" }, resolvedRevisionIds = []) {
    return {
        storageEnvelopeVersion: 1,
        schemaVersion: 1,
        storeId,
        recordKind: "test.annotation",
        recordId: "test-annotation-a1",
        revisionId,
        parentRevisionId,
        resolvedRevisionIds,
        state: "active",
        payload,
    };
}

async function observation(envelope) {
    return { envelope, digest: await canonicalRevisionDigest(envelope) };
}

async function representationObservation(artifact) {
    return { artifact, digest: await representationStateArtifactDigest(artifact) };
}

function representationState(storeId, stateId, parentId = null, migrationId = null, representation = "hidden") {
    return {
        schema: "finders-keepers.representation-state",
        version: 1,
        storeId,
        representationStateId: stateId,
        parentRepresentationStateId: parentId,
        representation,
        establishedByMigrationId: migrationId,
    };
}

describe("Storage S1 record repository semantics", () => {
    it("distinguishes absence, one found revision, and equivalent duplicate copies", async () => {
        expect(classifyRecordRevisions([]).state).toBe("RECORD_ABSENT");
        const storeId = createStoreId();
        const root = await observation(makeRevision(storeId, createRevisionId(), null));
        expect(classifyRecordRevisions([root])).toMatchObject({ state: "RECORD_FOUND", current: root });
        expect(classifyRecordRevisions([root, { ...root }])).toMatchObject({
            state: "EQUIVALENT_DUPLICATE",
            current: root,
        });
    });

    it("proves a unique linear descendant only through retained parent links", async () => {
        const storeId = createStoreId();
        const root = await observation(makeRevision(storeId, createRevisionId(), null));
        const child = await observation(
            makeRevision(storeId, createRevisionId(), root.envelope.revisionId, { value: "two" })
        );
        const result = classifyRecordRevisions([child, root]);
        expect(result.state).toBe("LINEAR_DESCENDANT");
        expect(result.current).toEqual(child);
    });

    it("blocks proven divergence at record scope", async () => {
        const storeId = createStoreId();
        const base = await observation(makeRevision(storeId, createRevisionId(), null));
        const left = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "left" })
        );
        const right = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "right" })
        );
        const result = classifyRecordRevisions([base, left, right]);
        expect(result.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(result.currentHeads).toHaveLength(2);
        expect(result.writeGate).toMatchObject({ scope: "record" });
    });

    it("returns LINEAGE_INDETERMINATE when missing parents prevent ancestry proof", async () => {
        const storeId = createStoreId();
        const missingParentA = createRevisionId();
        const missingParentB = createRevisionId();
        const left = await observation(makeRevision(storeId, createRevisionId(), missingParentA));
        const right = await observation(makeRevision(storeId, createRevisionId(), missingParentB));
        const result = classifyRecordRevisions([left, right]);
        expect(result.state).toBe("LINEAGE_INDETERMINATE");
        expect(result.writeGate).toMatchObject({ scope: "record" });
    });

    it("does not call separate roots divergent without evidence of a common base", async () => {
        const storeId = createStoreId();
        const firstRoot = await observation(makeRevision(storeId, createRevisionId(), null, { value: "first root" }));
        const secondRoot = await observation(makeRevision(storeId, createRevisionId(), null, { value: "second root" }));
        expect(classifyRecordRevisions([firstRoot, secondRoot])).toMatchObject({
            state: "LINEAGE_INDETERMINATE",
            writeGate: { scope: "record" },
        });
    });

    it("recognizes sibling branches from the same retained parent ID", async () => {
        const storeId = createStoreId();
        const missingParent = createRevisionId();
        const firstChild = await observation(
            makeRevision(storeId, createRevisionId(), missingParent, { value: "first child" })
        );
        const secondChild = await observation(
            makeRevision(storeId, createRevisionId(), missingParent, { value: "second child" })
        );
        expect(classifyRecordRevisions([firstChild, secondChild]).state).toBe("DIVERGENT_VALID_REVISIONS");
    });

    it("rejects one RevisionId carrying different canonical digests", async () => {
        const storeId = createStoreId();
        const revisionId = createRevisionId();
        const first = await observation(makeRevision(storeId, revisionId, null, { value: "first" }));
        const second = await observation(makeRevision(storeId, revisionId, null, { value: "second" }));
        const result = classifyRecordRevisions([first, second]);
        expect(result.state).toBe("REVISION_IDENTITY_INVALID");
        expect(result.writeGate).toMatchObject({ scope: "record" });
    });

    it("requires explicit resolution to cover the exact complete competing-head set", async () => {
        const storeId = createStoreId();
        const base = await observation(makeRevision(storeId, createRevisionId(), null));
        const firstHead = createRevisionId();
        const secondHead = createRevisionId();
        const thirdHead = createRevisionId();
        const parent = [firstHead, secondHead].sort()[0];
        const resolution = makeRevision(
            storeId,
            createRevisionId(),
            parent,
            { value: "resolved" },
            [firstHead, secondHead].sort()
        );
        const first = await observation(makeRevision(storeId, firstHead, base.envelope.revisionId, { value: "first" }));
        const second = await observation(
            makeRevision(storeId, secondHead, base.envelope.revisionId, { value: "second" })
        );
        const third = await observation(makeRevision(storeId, thirdHead, base.envelope.revisionId, { value: "third" }));
        expect(validateExplicitResolutionCoverage(resolution, [base, first, second])).toMatchObject({ valid: true });
        expect(validateExplicitResolutionCoverage(resolution, [base])).toMatchObject({ valid: false });
        expect(validateExplicitResolutionCoverage(resolution, [base, first, second, third])).toMatchObject({
            valid: false,
            reason: expect.stringContaining("complete"),
        });
        expect(
            validateExplicitResolutionCoverage({ ...resolution, resolvedRevisionIds: [firstHead] }, [
                base,
                first,
                second,
            ]).valid
        ).toBe(false);
        expect(
            validateExplicitResolutionCoverage({ ...resolution, parentRevisionId: createRevisionId() }, [
                base,
                first,
                second,
            ])
        ).toMatchObject({ valid: false, reason: expect.stringContaining("parent") });
    });

    it("rejects an explicit resolution that reuses any pre-resolution revision ID", async () => {
        const storeId = createStoreId();
        const base = await observation(makeRevision(storeId, createRevisionId(), null));
        const first = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "first" })
        );
        const second = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "second" })
        );
        const resolution = makeRevision(
            storeId,
            base.envelope.revisionId,
            first.envelope.revisionId,
            { value: "resolved" },
            [first.envelope.revisionId, second.envelope.revisionId].sort()
        );

        expect(validateExplicitResolutionCoverage(resolution, [base, first, second])).toMatchObject({
            valid: false,
            reason: expect.stringContaining("fresh"),
        });
    });

    it("suppresses exact resolved heads only on the current resolving lineage", async () => {
        const storeId = createStoreId();
        const base = await observation(makeRevision(storeId, createRevisionId(), null));
        const left = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "left" })
        );
        const right = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "right" })
        );
        const resolvedIds = [left.envelope.revisionId, right.envelope.revisionId].sort();
        const resolution = await observation(
            makeRevision(storeId, createRevisionId(), left.envelope.revisionId, { value: "chosen" }, resolvedIds)
        );
        expect(validateExplicitResolutionCoverage(resolution.envelope, [base, left, right]).valid).toBe(true);
        expect(classifyRecordRevisions([base, left, right, resolution])).toMatchObject({
            state: "RESOLVED_LINEAGE",
            current: resolution,
        });

        const descendant = await observation(
            makeRevision(storeId, createRevisionId(), resolution.envelope.revisionId, { value: "later" })
        );
        expect(classifyRecordRevisions([base, left, right, resolution, descendant])).toMatchObject({
            state: "RESOLVED_LINEAGE",
            current: descendant,
        });
    });

    it("does not let stale resolution provenance erase a current competing branch", async () => {
        const storeId = createStoreId();
        const base = await observation(makeRevision(storeId, createRevisionId(), null));
        const left = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "left" })
        );
        const right = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "right" })
        );
        const resolutionIds = [left.envelope.revisionId, right.envelope.revisionId].sort();
        const staleResolution = await observation(
            makeRevision(storeId, createRevisionId(), left.envelope.revisionId, { value: "chosen" }, resolutionIds)
        );
        const laterOnOtherBranch = await observation(
            makeRevision(storeId, createRevisionId(), right.envelope.revisionId, { value: "new evidence" })
        );
        const result = classifyRecordRevisions([base, left, right, staleResolution, laterOnOtherBranch]);
        expect(result.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(result.currentHeads).toHaveLength(2);
    });

    it("does not let a superseded resolver suppress a head it named", async () => {
        const storeId = createStoreId();
        const base = await observation(makeRevision(storeId, createRevisionId(), null));
        const left = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "left" })
        );
        const reappearingHead = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "right" })
        );
        const staleResolution = await observation(
            makeRevision(
                storeId,
                createRevisionId(),
                left.envelope.revisionId,
                { value: "old resolution" },
                [left.envelope.revisionId, reappearingHead.envelope.revisionId].sort()
            )
        );
        const competingBranch = await observation(
            makeRevision(storeId, createRevisionId(), left.envelope.revisionId, { value: "new branch" })
        );
        const currentResolution = await observation(
            makeRevision(
                storeId,
                createRevisionId(),
                competingBranch.envelope.revisionId,
                { value: "resolve current heads" },
                [staleResolution.envelope.revisionId, competingBranch.envelope.revisionId].sort()
            )
        );

        expect(
            validateExplicitResolutionCoverage(currentResolution.envelope, [
                base,
                left,
                reappearingHead,
                staleResolution,
                competingBranch,
            ])
        ).toMatchObject({ valid: true });

        const result = classifyRecordRevisions([
            base,
            left,
            reappearingHead,
            staleResolution,
            competingBranch,
            currentResolution,
        ]);
        expect(result).toMatchObject({ state: "DIVERGENT_VALID_REVISIONS" });
        expect(result.currentHeads?.map((head) => head.envelope.revisionId).sort()).toEqual(
            [reappearingHead.envelope.revisionId, currentResolution.envelope.revisionId].sort()
        );
    });

    it("treats a new descendant from an exact resolved head as new branch evidence", async () => {
        const storeId = createStoreId();
        const base = await observation(makeRevision(storeId, createRevisionId(), null));
        const left = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "left" })
        );
        const right = await observation(
            makeRevision(storeId, createRevisionId(), base.envelope.revisionId, { value: "right" })
        );
        const resolutionIds = [left.envelope.revisionId, right.envelope.revisionId].sort();
        const resolution = await observation(
            makeRevision(storeId, createRevisionId(), left.envelope.revisionId, { value: "chosen" }, resolutionIds)
        );
        const newBranch = await observation(
            makeRevision(storeId, createRevisionId(), right.envelope.revisionId, { value: "new child" })
        );
        const result = classifyRecordRevisions([base, left, right, resolution, newBranch]);
        expect(result.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(result.currentHeads).toHaveLength(2);
    });

    it("rejects mixed record identities from one classification input", async () => {
        const storeId = createStoreId();
        const left = await observation(makeRevision(storeId, createRevisionId(), null));
        const right = await observation({
            ...left.envelope,
            recordId: "test-annotation-b2",
            revisionId: createRevisionId(),
        });
        expect(classifyRecordRevisions([left, right])).toMatchObject({
            state: "RECORD_INVALID",
            writeGate: { scope: "record" },
        });
    });
});

describe("Storage S1 store and protocol write gates", () => {
    it("distinguishes one store, multiple stores, and a mixed candidate", () => {
        const storeA = createStoreId();
        const storeB = createStoreId();
        expect(classifyStoreInventory([{ candidateId: "branch-a", storeIds: [storeA, storeA] }])).toMatchObject({
            state: "ONE_STORE",
            storeIds: [storeA],
        });
        expect(
            classifyStoreInventory([
                { candidateId: "branch-a", storeIds: [storeA] },
                { candidateId: "branch-b", storeIds: [storeB] },
            ])
        ).toMatchObject({
            state: "MULTIPLE_STORE_IDS",
            writeGate: { scope: "namespace/store-selection" },
        });
        expect(classifyStoreInventory([{ candidateId: "mixed", storeIds: [storeA, storeB] }])).toMatchObject({
            state: "MIXED_STORE_INVALID",
            writeGate: { scope: "store" },
        });
        expect(classifyStoreInventory([]).state).toBe("NO_STORE");
    });

    it("fails closed for missing, unrecognized, mixed, and newer protocol fences", () => {
        const storeId = createStoreId();
        const fence = (requiredProtocolVersion) => ({
            schema: "finders-keepers.protocol-fence",
            version: 1,
            storeId,
            requiredProtocolVersion,
        });
        expect(assessProtocolWriteFence(storeId, [fence(1)], 1).state).toBe("WRITES_ALLOWED");
        expect(assessProtocolWriteFence(storeId, [], 1).state).toBe("READ_ONLY_MISSING_FENCE");
        expect(assessProtocolWriteFence(storeId, [fence(1)], 1, 1)).toMatchObject({
            state: "READ_ONLY_UNRECOGNIZED_FENCE",
            writeGate: { scope: "store" },
        });
        expect(assessProtocolWriteFence(storeId, [fence(2)], 1).state).toBe("READ_ONLY_UNSUPPORTED_NEWER_PROTOCOL");
        expect(assessProtocolWriteFence(storeId, [fence(1), { ...fence(1), storeId: createStoreId() }], 1).state).toBe(
            "READ_ONLY_MIXED_STORE"
        );
    });
});

describe("Storage S1 representation-state lineage", () => {
    it("validates a genesis state and one migration child", async () => {
        const storeId = createStoreId();
        const genesis = representationState(storeId, createRepresentationStateId());
        const migrationId = createMigrationId();
        const child = representationState(
            storeId,
            createRepresentationStateId(),
            genesis.representationStateId,
            migrationId,
            "visible"
        );
        expect(validateRepresentationStateLineage([await representationObservation(genesis)])).toMatchObject({
            state: "REPRESENTATION_STATE_VALID",
        });
        expect(
            validateRepresentationStateLineage([
                await representationObservation(genesis),
                await representationObservation(child),
            ])
        ).toMatchObject({ state: "REPRESENTATION_STATE_VALID", currentHeads: [{ artifact: child }] });
    });

    it("distinguishes missing parents, cross-store parents, and competing children", async () => {
        const storeId = createStoreId();
        const genesis = representationState(storeId, createRepresentationStateId());
        const missingParent = representationState(
            storeId,
            createRepresentationStateId(),
            createRepresentationStateId(),
            createMigrationId()
        );
        expect(validateRepresentationStateLineage([await representationObservation(missingParent)]).state).toBe(
            "LINEAGE_INDETERMINATE"
        );

        const foreignChild = representationState(
            createStoreId(),
            createRepresentationStateId(),
            genesis.representationStateId,
            createMigrationId()
        );
        expect(
            validateRepresentationStateLineage([
                await representationObservation(genesis),
                await representationObservation(foreignChild),
            ]).state
        ).toBe("REPRESENTATION_STATE_INVALID");

        const childA = representationState(
            storeId,
            createRepresentationStateId(),
            genesis.representationStateId,
            createMigrationId()
        );
        const childB = representationState(
            storeId,
            createRepresentationStateId(),
            genesis.representationStateId,
            createMigrationId(),
            "visible"
        );
        expect(
            validateRepresentationStateLineage([
                await representationObservation(genesis),
                await representationObservation(childA),
                await representationObservation(childB),
            ])
        ).toMatchObject({ state: "REPRESENTATION_STATE_DIVERGENT", writeGate: { scope: "store" } });
    });

    it("rejects a migration ID on genesis and a missing migration ID on a child", async () => {
        const storeId = createStoreId();
        const genesis = representationState(storeId, createRepresentationStateId());
        const migratedGenesis = representationState(storeId, createRepresentationStateId(), null, createMigrationId());
        const childWithoutMigration = representationState(
            storeId,
            createRepresentationStateId(),
            genesis.representationStateId
        );

        expect(validateRepresentationStateLineage([await representationObservation(migratedGenesis)])).toMatchObject({
            state: "REPRESENTATION_STATE_INVALID",
            reason: expect.stringContaining("genesis"),
        });
        expect(
            validateRepresentationStateLineage([
                await representationObservation(genesis),
                await representationObservation(childWithoutMigration),
            ])
        ).toMatchObject({ state: "REPRESENTATION_STATE_INVALID", reason: expect.stringContaining("migration") });
    });

    it("rejects a cycle in representation-state parent links", async () => {
        const storeId = createStoreId();
        const firstId = createRepresentationStateId();
        const secondId = createRepresentationStateId();
        const first = representationState(storeId, firstId, secondId, createMigrationId());
        const second = representationState(storeId, secondId, firstId, createMigrationId());

        expect(
            validateRepresentationStateLineage([
                await representationObservation(first),
                await representationObservation(second),
            ])
        ).toMatchObject({
            state: "REPRESENTATION_STATE_INVALID",
            reason: expect.stringContaining("cycle"),
        });
    });
});
