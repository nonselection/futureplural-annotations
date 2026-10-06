import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { canonicalSerialize } from "../src/storage/canonicalEncoding";
import {
    canonicalRevisionDigest,
    decodeCanonicalRevisionEnvelope,
    encodeCanonicalRevisionEnvelope,
} from "../src/storage/envelopes";
import {
    validateRecoveryPreparation,
    recoveryPreparationDigest,
    validatePriorPublicationEvidence,
} from "../src/storage/recoveryArtifacts";
import {
    evaluateIndexedHeadRelations,
    indexQualifiedRevisionGraph,
    relateIndexedRevisions,
    validateRevisionIdentityClaims,
    validateExplicitResolutionCoverageFromHeads,
    assessProtocolWriteFence,
    classifyRecordRevisions,
    classifyStoreInventory,
    validateExplicitResolutionCoverage,
    validateRepresentationStateLineage,
} from "../src/storage/repositorySemantics";
import {
    createMutationId,
    createPublicationId,
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

// Synthetic qualified inputs only. These helpers do not claim collection admission.
const graphCodec = {
    recordKind: "test.annotation",
    schemaVersion: 1,
    isRecordId: (value) => value === "test-annotation-a1",
    validatePayload: (value) => {
        if (!value || typeof value.value !== "string") throw new Error("invalid payload");
        return value;
    },
};
const graphStore = "fk-store-00000000-0000-4000-8000-000000000001";
const graphId = (n) => `fk-revision-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function graphObservation(n, parent = null, resolved = [], state = "active", value = String(n)) {
    const input = makeRevision(
        graphStore,
        graphId(n),
        parent === null ? null : graphId(parent),
        { value },
        resolved.map(graphId).sort()
    );
    input.state = state;
    const envelope = decodeCanonicalRevisionEnvelope(encodeCanonicalRevisionEnvelope(input, [graphCodec]), [
        graphCodec,
    ]);
    return { envelope, digest: `sha256:${createHash("sha256").update(canonicalSerialize(envelope)).digest("hex")}` };
}
const qualified = (rows) => rows.map((row) => ({ role: "DIRECT_CANONICAL", ...row }));
function completeIndex(rows, observer, claims = []) {
    const result = indexQualifiedRevisionGraph(qualified(rows), observer, claims);
    expect(result.status).toBe("COMPLETE");
    return result.index;
}
function permutations(rows) {
    if (rows.length > 4)
        return [
            rows,
            [...rows].reverse(),
            ...rows.map((_, i) => [...rows.slice(i), ...rows.slice(0, i)]),
            ...rows.map((_, i) => [...rows.slice(i), ...rows.slice(0, i)].reverse()),
        ];
    if (rows.length < 2) return [rows];
    return rows.flatMap((row, i) => permutations(rows.filter((_, j) => i !== j)).map((tail) => [row, ...tail]));
}
function assertSetClassification(rows, state, currentIds) {
    for (const order of permutations(rows)) {
        const result = classifyRecordRevisions(order);
        expect(result.state).toBe(state);
        const ids = result.current
            ? [result.current.envelope.revisionId]
            : result.currentHeads?.map((head) => head.envelope.revisionId).sort();
        if (currentIds) expect(ids).toEqual(currentIds.map(graphId).sort());
        if (["LINEAGE_INDETERMINATE", "DIVERGENT_VALID_REVISIONS", "REVISION_IDENTITY_INVALID"].includes(state)) {
            expect(result.current).toBeUndefined();
            expect(result.writeGate).toMatchObject({ scope: "record" });
        }
    }
}
function workCounter() {
    const counts = new Map();
    return {
        counts,
        observer(event) {
            counts.set(event.kind, (counts.get(event.kind) ?? 0) + 1);
        },
    };
}

describe("Storage S1 Batch C indexed record kernel under C1/C2", () => {
    it("C1 gates the exact A↔B plus R→A resolving [A,B] contradiction in all six orders", () => {
        const rows = [graphObservation(1, 2), graphObservation(2, 1), graphObservation(3, 1, [1, 2])];
        expect(permutations(rows)).toHaveLength(6);
        assertSetClassification(rows, "LINEAGE_INDETERMINATE", [1, 2, 3]);
        for (const order of permutations(rows)) {
            expect(
                validateExplicitResolutionCoverage(
                    rows[2].envelope,
                    order.slice().filter((row) => row.envelope.revisionId !== graphId(3))
                ).valid
            ).toBe(false);
            const index = completeIndex(order);
            expect(index.hasParentCycle).toBe(true);
            expect(relateIndexedRevisions(index, graphId(1), graphId(3))).toMatchObject({
                relation: "unknown",
                cycleInvolvement: true,
            });
        }
    });
    it.each([
        ["self cycle", [graphObservation(1)]],
        ["two-node cycle", [graphObservation(1, 2), graphObservation(2, 1)]],
        ["longer cycle", [graphObservation(1, 2), graphObservation(2, 3), graphObservation(3, 1)]],
    ])("gates %s independently of resolution", (name, original) => {
        const rows =
            name === "self cycle"
                ? [{ ...original[0], envelope: { ...original[0].envelope, parentRevisionId: graphId(1) } }]
                : original;
        // Normal codecs already reject self-parent; the graph must still fail closed on a forged typed input.
        assertSetClassification(rows, "LINEAGE_INDETERMINATE");
    });
    it("a clean resolver elsewhere cannot hide participating cyclic evidence", () => {
        const rows = [
            graphObservation(1, 2),
            graphObservation(2, 1),
            graphObservation(4),
            graphObservation(5, 4),
            graphObservation(6, 4),
            graphObservation(7, 5, [5, 6]),
        ];
        assertSetClassification(rows, "LINEAGE_INDETERMINATE");
        const index = completeIndex(rows);
        expect(relateIndexedRevisions(index, graphId(5), graphId(6))).toMatchObject({
            relation: "competing",
            cycleInvolvement: false,
        });
        expect(evaluateIndexedHeadRelations(index, [graphId(7)]).classification).toMatchObject({
            state: "LINEAGE_INDETERMINATE",
            writeGate: { scope: "record" },
        });
    });
    it("C2 retains A/B competition while all six mixed-proof orders remain aggregate indeterminate", () => {
        const rows = [graphObservation(1, 90), graphObservation(2, 90), graphObservation(3, 91)];
        assertSetClassification(rows, "LINEAGE_INDETERMINATE", [1, 2, 3]);
        for (const order of permutations(rows)) {
            const index = completeIndex(order);
            expect(relateIndexedRevisions(index, graphId(1), graphId(2))).toMatchObject({
                relation: "competing",
                cycleInvolvement: false,
            });
            expect(relateIndexedRevisions(index, graphId(1), graphId(3)).relation).toBe("unknown");
            expect(relateIndexedRevisions(index, graphId(2), graphId(3)).relation).toBe("unknown");
            const evaluation = evaluateIndexedHeadRelations(
                index,
                rows.map((row) => row.envelope.revisionId)
            );
            expect(evaluation.classification.state).toBe("LINEAGE_INDETERMINATE");
            expect(evaluation.pairRelations.filter((pair) => pair.relation === "competing")).toHaveLength(1);
            expect(evaluation.pairRelations.filter((pair) => pair.relation === "unknown")).toHaveLength(2);
        }
        assertSetClassification(rows.slice(0, 2), "DIVERGENT_VALID_REVISIONS", [1, 2]);
    });
    it("controls mixed proof with a proven descendant, ancestor, three proven branches, and disconnected roots", () => {
        assertSetClassification(
            [graphObservation(1, 90), graphObservation(2, 90), graphObservation(3, 2)],
            "DIVERGENT_VALID_REVISIONS",
            [1, 3]
        );
        assertSetClassification(
            [graphObservation(1, 3), graphObservation(2, 3), graphObservation(3)],
            "DIVERGENT_VALID_REVISIONS",
            [1, 2]
        );
        assertSetClassification(
            [graphObservation(1, 90), graphObservation(2, 90), graphObservation(3, 90)],
            "DIVERGENT_VALID_REVISIONS",
            [1, 2, 3]
        );
        assertSetClassification(
            [graphObservation(1), graphObservation(2), graphObservation(3)],
            "LINEAGE_INDETERMINATE",
            [1, 2, 3]
        );
    });
    it("unknown necessary relation blocks a resolver before it can hide disconnected evidence", () => {
        const rows = [graphObservation(1, 90), graphObservation(2, 91), graphObservation(3, 1, [1, 2])];
        assertSetClassification(rows, "LINEAGE_INDETERMINATE", [2, 3]);
    });
    it("missing selected-parent proof cannot be fabricated by an exact resolution claim", () => {
        const other = graphObservation(2, 90);
        const resolver = graphObservation(3, 1, [1, 2]);
        assertSetClassification([other, resolver], "LINEAGE_INDETERMINATE", [2, 3]);
        // Supplying A's actual retained edge restores clean determinate resolver scope.
        assertSetClassification([graphObservation(1, 90), other, resolver], "RESOLVED_LINEAGE", [3]);
    });
    it("indexes retained ancestors, child lookup, shared missing boundaries and both ancestry directions", () => {
        const index = completeIndex([
            graphObservation(1),
            graphObservation(2, 1),
            graphObservation(3, 2),
            graphObservation(4, 2),
        ]);
        expect(index.parentRevisionId(graphId(3))).toBe(graphId(2));
        expect([...index.children(graphId(2))].sort()).toEqual([graphId(3), graphId(4)]);
        expect(relateIndexedRevisions(index, graphId(1), graphId(3)).relation).toBe("left-ancestor");
        expect(relateIndexedRevisions(index, graphId(3), graphId(1)).relation).toBe("right-ancestor");
        expect(relateIndexedRevisions(index, graphId(3), graphId(4)).relation).toBe("competing");
        expect(relateIndexedRevisions(index, graphId(3), graphId(3)).relation).toBe("equivalent");
        expect(relateIndexedRevisions(index, graphId(99), graphId(3)).relation).toBe("unknown");
        const boundary = completeIndex([graphObservation(5, 90), graphObservation(6, 90)]);
        expect(boundary.missingBoundaryIds).toEqual([graphId(90)]);
        expect(boundary.revisionInfo(graphId(90))).toMatchObject({ missingBoundary: true, cycleInvolvement: false });
        expect(boundary.parentRevisionId(graphId(90))).toBeUndefined();
        expect(boundary.children(graphId(90))).toHaveLength(2);
        expect(relateIndexedRevisions(boundary, graphId(5), graphId(6)).relation).toBe("competing");
    });
    it("keeps equivalent copies and tombstone ancestry set-semantic", () => {
        const root = graphObservation(1);
        assertSetClassification([root, { ...root }], "EQUIVALENT_DUPLICATE", [1]);
        const deleted = graphObservation(2, 1, [], "deleted");
        assertSetClassification([root, deleted], "LINEAR_DESCENDANT", [2]);
        expect(classifyRecordRevisions([root, deleted]).current.envelope.state).toBe("deleted");
    });
    it("rejects same-ID/different content before cycles/qualification and checks equivalent full content", () => {
        const root = graphObservation(1);
        const changed = graphObservation(1, null, [], "active", "changed");
        const validation = validateRevisionIdentityClaims([root, changed]);
        expect(validation).toMatchObject({
            status: "INVALID",
            classification: { state: "REVISION_IDENTITY_INVALID", writeGate: { scope: "record" } },
        });
        expect(
            indexQualifiedRevisionGraph(qualified([graphObservation(2, 3), graphObservation(3, 2), root]), undefined, [
                changed,
            ])
        ).toMatchObject({ status: "INVALID", classification: { state: "REVISION_IDENTITY_INVALID" } });
        const forgedDigest = { ...changed, digest: root.digest };
        expect(validateRevisionIdentityClaims([root, forgedDigest]).classification.state).toBe(
            "REVISION_IDENTITY_INVALID"
        );
        expect(validateRevisionIdentityClaims([root, { ...root }])).toMatchObject({
            status: "VALID",
            sawEquivalentCopy: true,
        });
    });
    it("a complete non-authoritative preparation candidate participates only in identity claims", async () => {
        const direct = graphObservation(1);
        const different = graphObservation(1, null, [], "active", "prepared different content");
        const prepInput = {
            recoveryFormatVersion: 2,
            artifactKind: "preparation",
            requiredProtocolVersion: 2,
            storeId: graphStore,
            recordKind: "test.annotation",
            recordId: "test-annotation-a1",
            mutationId: createMutationId(),
            canonicalPublicationId: createPublicationId(),
            purpose: "transition",
            candidateRevisionId: graphId(1),
            candidateDigest: different.digest,
            after: different.envelope,
            baseRevisionId: null,
            baseDigest: null,
            resolutionHeads: [],
        };
        const prep = await validateRecoveryPreparation(prepInput, [graphCodec]);
        expect(
            indexQualifiedRevisionGraph(qualified([direct]), undefined, [
                { envelope: prep.after, digest: prep.candidateDigest },
            ])
        ).toMatchObject({ status: "INVALID", classification: { state: "REVISION_IDENTITY_INVALID" } });
        const unqualifiedChild = graphObservation(2, 1);
        const index = completeIndex([direct], undefined, [unqualifiedChild]);
        expect(index.revisionIds).toEqual([graphId(1)]);
        expect(index.children(graphId(1))).toHaveLength(0);
        expect(index.observation(graphId(2))).toBeUndefined();
        expect(evaluateIndexedHeadRelations(index, [graphId(1)]).classification).toMatchObject({
            state: "RECORD_FOUND",
            current: direct,
        });
        expect(indexQualifiedRevisionGraph([prep]).status).toBe("INVALID");
        expect(evaluateIndexedHeadRelations(index, [graphId(2)]).classification.state).toBe("RECORD_INVALID");
    });
    it("qualified prior-publication uses the full candidate envelope's edges, never receipt facts as edges", async () => {
        const root = graphObservation(1);
        const child = graphObservation(2, 1);
        const prep = await validateRecoveryPreparation(
            {
                recoveryFormatVersion: 2,
                artifactKind: "preparation",
                requiredProtocolVersion: 2,
                storeId: graphStore,
                recordKind: "test.annotation",
                recordId: "test-annotation-a1",
                mutationId: createMutationId(),
                canonicalPublicationId: createPublicationId(),
                purpose: "transition",
                candidateRevisionId: graphId(2),
                candidateDigest: child.digest,
                after: child.envelope,
                baseRevisionId: graphId(1),
                baseDigest: root.digest,
                resolutionHeads: [],
            },
            [graphCodec]
        );
        const proof = await validatePriorPublicationEvidence(
            prep,
            {
                recoveryFormatVersion: 2,
                artifactKind: "receipt",
                requiredProtocolVersion: 2,
                storeId: graphStore,
                recordKind: "test.annotation",
                recordId: "test-annotation-a1",
                mutationId: prep.mutationId,
                canonicalPublicationId: prep.canonicalPublicationId,
                preparationDigest: await recoveryPreparationDigest(prep, [graphCodec]),
                candidateRevisionId: graphId(2),
                candidateDigest: child.digest,
                physicalEffect: "DISPATCH_OUTCOME_UNKNOWN",
                canonicalObservation: "EXACT_CANDIDATE",
            },
            [graphCodec]
        );
        expect(proof.status).toBe("QUALIFIED_PRIOR_PUBLICATION");
        const built = indexQualifiedRevisionGraph([
            ...qualified([root]),
            { role: "QUALIFIED_PRIOR_PUBLICATION", evidence: proof.evidence },
        ]);
        expect(built.status).toBe("COMPLETE");
        expect(relateIndexedRevisions(built.index, graphId(1), graphId(2)).relation).toBe("left-ancestor");
        expect(evaluateIndexedHeadRelations(built.index, [graphId(2)]).classification.state).toBe("LINEAR_DESCENDANT");
    });
    it("index snapshots and opaque issuance cannot be retargeted by mutable inputs", () => {
        const rows = [graphObservation(1), graphObservation(2, 1)];
        const index = completeIndex(rows);
        rows[1].envelope.parentRevisionId = null;
        rows[1].envelope.payload.value = "mutated";
        expect(index.parentRevisionId(graphId(2))).toBe(graphId(1));
        expect(index.observation(graphId(2)).envelope.payload.value).toBe("2");
        expect(Object.isFrozen(index.observation(graphId(2)).envelope.payload)).toBe(true);
        expect(Object.isFrozen(index.children(graphId(1)))).toBe(true);
        expect(() => evaluateIndexedHeadRelations({ ...index }, [graphId(2)])).toThrow(/issued/);
    });
    it.each(["identity-claim", "node", "parent-edge", "cycle-visit", "interval-visit", "resolution-claim"])(
        "refusal during %s issues no partial graph/classification",
        (phase) => {
            const rows = [
                graphObservation(1),
                graphObservation(2, 1),
                graphObservation(3, 1),
                graphObservation(4, 2, [2, 3]),
            ];
            const result = indexQualifiedRevisionGraph(qualified(rows), (event) => event.kind !== phase);
            expect(result.status).toBe("INCOMPLETE");
            expect(result).not.toHaveProperty("index");
            expect(result).not.toHaveProperty("classification");
        }
    );
    it.each(["candidate-head", "ancestry-relation", "resolution-relation"])(
        "evaluation refusal at %s never returns a partial unique head",
        (phase) => {
            const index = completeIndex([
                graphObservation(1),
                graphObservation(2, 1),
                graphObservation(3, 1),
                graphObservation(4, 2, [2, 3]),
            ]);
            const result = evaluateIndexedHeadRelations(
                index,
                [graphId(3), graphId(4)],
                (event) => event.kind !== phase
            );
            expect(result.status).toBe("INCOMPLETE");
            expect(result).not.toHaveProperty("classification");
        }
    );
    it("observer throw and relation refusal are incomplete rather than unknown proof or authority", () => {
        const rows = [graphObservation(1), graphObservation(2, 1)];
        expect(
            indexQualifiedRevisionGraph(qualified(rows), () => {
                throw new Error("external refusal");
            })
        ).toMatchObject({ status: "INCOMPLETE", reason: expect.stringContaining("external refusal") });
        const index = completeIndex(rows);
        expect(relateIndexedRevisions(index, graphId(1), graphId(2), () => false)).toMatchObject({
            status: "INCOMPLETE",
        });
        expect(validateRevisionIdentityClaims(rows, () => false).status).toBe("INCOMPLETE");
    });
    it("constructs a 12,000-revision chain iteratively with linear index work and constant ancestry queries", () => {
        const length = 12000;
        const rows = Array.from({ length }, (_, i) => graphObservation(i + 1, i ? i : null));
        const work = workCounter();
        const index = completeIndex(rows, work.observer);
        expect(work.counts.get("node")).toBe(length);
        expect(work.counts.get("parent-edge")).toBe(length - 1);
        expect(work.counts.get("cycle-visit")).toBe(length);
        expect(work.counts.get("interval-visit")).toBe(2 * length);
        expect(work.counts.get("identity-claim")).toBe(length);
        expect(work.counts.get("ancestry-relation") ?? 0).toBe(0);
        const query = workCounter();
        for (let i = 0; i < 100; i++)
            expect(relateIndexedRevisions(index, graphId(i + 1), graphId(length), query.observer).relation).toBe(
                "left-ancestor"
            );
        expect(query.counts.get("ancestry-relation")).toBe(100);
        const evaluation = workCounter();
        const result = evaluateIndexedHeadRelations(index, [graphId(length)], evaluation.observer);
        expect(result.classification).toMatchObject({ state: "LINEAR_DESCENDANT", current: rows[length - 1] });
        expect(evaluation.counts.get("ancestry-relation") ?? 0).toBe(0);
        expect(classifyRecordRevisions(rows).current.envelope.revisionId).toBe(graphId(length));
    });
    it("a large branch forest indexes once and compares only supplied candidate heads", () => {
        const branches = 100;
        const depth = 30;
        const rows = [graphObservation(1)];
        const heads = [];
        for (let b = 0; b < branches; b++) {
            let parent = 1;
            for (let d = 0; d < depth; d++) {
                const n = 2 + b * depth + d;
                rows.push(graphObservation(n, parent));
                parent = n;
            }
            heads.push(graphId(parent));
        }
        const work = workCounter();
        const index = completeIndex(rows, work.observer);
        const evaluation = workCounter();
        const result = evaluateIndexedHeadRelations(index, heads, evaluation.observer);
        expect(result.classification.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(result.classification.currentHeads).toHaveLength(branches);
        expect(work.counts.get("node")).toBe(rows.length);
        expect(work.counts.get("parent-edge")).toBe(rows.length - 1);
        expect(evaluation.counts.get("ancestry-relation")).toBe((branches * (branches - 1)) / 2);
        expect(result.pairRelations).toHaveLength((branches * (branches - 1)) / 2);
    });
    it("clean resolver/current descendant suppress only exact old heads; old-head descendants compete", () => {
        const base = graphObservation(1),
            a = graphObservation(2, 1),
            b = graphObservation(3, 1),
            r = graphObservation(4, 2, [2, 3]),
            later = graphObservation(5, 4);
        assertSetClassification([base, a, b, r], "RESOLVED_LINEAGE", [4]);
        assertSetClassification([base, a, b, r, later], "RESOLVED_LINEAGE", [5]);
        assertSetClassification([base, a, b, r, { ...b }], "RESOLVED_LINEAGE", [4]);
        assertSetClassification([base, a, b, r, graphObservation(6, 3)], "DIVERGENT_VALID_REVISIONS", [4, 6]);
    });
    it("dominated resolver cannot exercise stale claims on another remaining branch", () => {
        const rows = [
            graphObservation(1),
            graphObservation(2, 1),
            graphObservation(3, 1),
            graphObservation(4, 2, [2, 3]),
            graphObservation(5, 2),
            graphObservation(6, 5, [4, 5]),
        ];
        assertSetClassification(rows, "DIVERGENT_VALID_REVISIONS", [3, 6]);
    });
    it("detects resolution applicability cycles even with an unrelated clean active branch", () => {
        const rows = [graphObservation(1), graphObservation(2, 1, [1, 3]), graphObservation(3, 1, [1, 2])];
        assertSetClassification(rows, "LINEAGE_INDETERMINATE", [2, 3]);
        assertSetClassification([...rows, graphObservation(4, 1)], "LINEAGE_INDETERMINATE", [2, 3, 4]);
    });
    it("rejects malformed supplied candidate sets rather than inventing admitted maxima", () => {
        const index = completeIndex([graphObservation(1), graphObservation(2, 1)]);
        expect(evaluateIndexedHeadRelations(index, [graphId(1), graphId(2)]).classification.state).toBe(
            "RECORD_INVALID"
        );
        expect(evaluateIndexedHeadRelations(index, []).classification.state).toBe("RECORD_INVALID");
        expect(evaluateIndexedHeadRelations(completeIndex([]), []).classification.state).toBe("RECORD_ABSENT");
    });
});

describe("Storage S1 Batch C exact supplied-head explicit resolution", () => {
    const base = graphObservation(1),
        a = graphObservation(2, 1),
        b = graphObservation(3, 1),
        c = graphObservation(4, 1);
    const resolver = graphObservation(5, 2, [2, 3]);
    const bindings = (rows) => rows.map((row) => ({ revisionId: row.envelope.revisionId, digest: row.digest }));
    function resolutionReferenceFixture(kind) {
        const x = graphObservation(1),
            a = graphObservation(2, 1),
            b = graphObservation(3, 1),
            q = graphObservation(4, 2, [2, 90]);
        if (kind === "stale provenance") {
            const s = graphObservation(5, 3, [3, 4]),
                t = graphObservation(6, 3);
            return { rows: [x, a, b, q, s, t], heads: [s, t], parent: 5 };
        }
        return {
            rows: kind === "complete target" ? [x, a, b, q, graphObservation(90, 1)] : [x, a, b, q],
            heads: [b, q],
            parent: 3,
        };
    }
    it.each(
        ["target-only", "stale provenance", "complete target"].flatMap((kind) =>
            ["supplied-head", "array"].flatMap((api) => [false, true].map((reverse) => [kind, api, reverse]))
        )
    )("residual F2 protects %s through %s coverage, reverse=%s", (kind, api, reverse) => {
        const fixture = resolutionReferenceFixture(kind);
        const rows = reverse ? [...fixture.rows].reverse() : fixture.rows;
        const heads = reverse ? [...fixture.heads].reverse() : fixture.heads;
        const index = completeIndex(rows);
        const ids = heads.map((head) => head.envelope.revisionId);
        const adjudicated = ids.map((value) => Number(value.slice(-12))).sort((a, b) => a - b);
        const classification = classifyRecordRevisions(rows);
        expect(classification.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(classification.currentHeads.map((head) => head.envelope.revisionId).sort()).toEqual([...ids].sort());
        expect(index.observation(graphId(4)).envelope.resolvedRevisionIds).toContain(graphId(90));
        expect(rows.some((row) => row.envelope.parentRevisionId === graphId(90))).toBe(false);
        if (kind !== "complete target") {
            expect(index.observation(graphId(90))).toBeUndefined();
            expect(index.revisionInfo(graphId(90))).toBeUndefined();
        }
        if (kind === "stale provenance") expect(ids).not.toContain(graphId(4));
        const coverage = (envelope) =>
            api === "array"
                ? validateExplicitResolutionCoverage(envelope, rows)
                : validateExplicitResolutionCoverageFromHeads(envelope, index, ids, bindings(heads)).validation;
        expect(coverage(graphObservation(90, fixture.parent, adjudicated).envelope)).toMatchObject({
            valid: false,
            reason: expect.stringContaining("fresh"),
        });
        expect(coverage(graphObservation(7, fixture.parent, adjudicated).envelope)).toEqual({
            valid: true,
            resolvedRevisionIds: [...ids].sort(),
        });
    });
    it.each(["parent", "resolution target"].flatMap((field) => [false, true].map((reverse) => [field, reverse])))(
        "residual F2 protects unqualified-claim %s references without authority edges, reverse=%s",
        (field, reverse) => {
            const original = [graphObservation(1), graphObservation(2, 1), graphObservation(3, 1)];
            const rows = reverse ? [...original].reverse() : original;
            const heads = rows.filter((row) => row.envelope.revisionId !== graphId(1));
            const claim = field === "parent" ? graphObservation(99, 90) : graphObservation(99, 2, [2, 90]);
            const index = completeIndex(rows, undefined, [claim]);
            const ids = heads.map((head) => head.envelope.revisionId);
            expect(index.observation(graphId(99))).toBeUndefined();
            expect(index.revisionInfo(graphId(90))).toBeUndefined();
            expect(evaluateIndexedHeadRelations(index, ids).classification.currentHeads).toHaveLength(2);
            for (const reused of [90, 99])
                expect(
                    validateExplicitResolutionCoverageFromHeads(
                        graphObservation(reused, 2, [2, 3]).envelope,
                        index,
                        ids,
                        bindings(heads)
                    ).validation
                ).toMatchObject({ valid: false, reason: expect.stringContaining("fresh") });
            expect(
                validateExplicitResolutionCoverageFromHeads(
                    graphObservation(7, 2, [2, 3]).envelope,
                    index,
                    ids,
                    bindings(heads)
                ).validation.valid
            ).toBe(true);
        }
    );
    it("residual F2 does not reserve a fresh RevisionId string found only in payload", () => {
        const fixture = resolutionReferenceFixture("target-only");
        fixture.rows[0] = graphObservation(1, null, [], "active", graphId(7));
        const candidate = graphObservation(7, 3, [3, 4]).envelope;
        const ids = fixture.heads.map((head) => head.envelope.revisionId);
        expect(validateExplicitResolutionCoverage(candidate, fixture.rows).valid).toBe(true);
        expect(
            validateExplicitResolutionCoverageFromHeads(
                candidate,
                completeIndex(fixture.rows),
                ids,
                bindings(fixture.heads)
            ).validation.valid
        ).toBe(true);
    });
    it.each([false, true])("F2 rejects missing-parent identity reuse in either head order, reverse=%s", (reverse) => {
        const heads = [graphObservation(2, 90), graphObservation(3, 90)];
        const rows = reverse ? [...heads].reverse() : heads;
        const index = completeIndex(rows);
        const headIds = rows.map((row) => row.envelope.revisionId);
        const reused = graphObservation(90, 2, [2, 3]);
        expect(index.observation(graphId(90))).toBeUndefined();
        expect(index.missingBoundaryIds).toContain(graphId(90));
        expect(evaluateIndexedHeadRelations(index, headIds).classification.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(
            validateExplicitResolutionCoverageFromHeads(reused.envelope, index, headIds, bindings(rows)).validation
        ).toMatchObject({ valid: false, reason: expect.stringContaining("fresh") });
        expect(validateExplicitResolutionCoverage(reused.envelope, rows)).toMatchObject({
            valid: false,
            reason: expect.stringContaining("fresh"),
        });
        // Complete supplied evidence exposes the cycle that reuse would otherwise introduce.
        expect(classifyRecordRevisions([...rows, reused])).toMatchObject({
            state: "LINEAGE_INDETERMINATE",
            writeGate: { scope: "record" },
        });
        const fresh = graphObservation(5, 2, [2, 3]);
        expect(
            validateExplicitResolutionCoverageFromHeads(fresh.envelope, index, headIds, bindings(rows)).validation
        ).toEqual({ valid: true, resolvedRevisionIds: [graphId(2), graphId(3)] });
        expect(validateExplicitResolutionCoverage(fresh.envelope, rows)).toEqual({
            valid: true,
            resolvedRevisionIds: [graphId(2), graphId(3)],
        });
    });
    it("validates exact IDs/digests and parent with the shared kernel, independent of input/head order", () => {
        for (const rows of permutations([base, a, b])) {
            const index = completeIndex(rows);
            expect(
                validateExplicitResolutionCoverageFromHeads(
                    resolver.envelope,
                    index,
                    [graphId(3), graphId(2)],
                    bindings([b, a])
                )
            ).toMatchObject({
                status: "COMPLETE",
                validation: { valid: true, resolvedRevisionIds: [graphId(2), graphId(3)] },
            });
            expect(validateExplicitResolutionCoverage(resolver.envelope, rows).valid).toBe(true);
        }
    });
    it.each([
        ["omitted binding", () => bindings([a])],
        ["extra binding", () => bindings([a, b, c])],
        ["changed digest", () => [{ revisionId: graphId(2), digest: b.digest }, ...bindings([b])]],
        ["duplicate binding", () => bindings([a, a])],
    ])("rejects %s", (_name, makeBindings) => {
        expect(
            validateExplicitResolutionCoverageFromHeads(
                resolver.envelope,
                completeIndex([base, a, b]),
                [graphId(2), graphId(3)],
                makeBindings()
            ).validation.valid
        ).toBe(false);
    });
    it("rejects omitted/extra provenance, absent selected parent, reused history ID and unqualified claim ID", () => {
        const index = completeIndex([base, a, b], undefined, [graphObservation(99)]);
        for (const envelope of [
            { ...resolver.envelope, resolvedRevisionIds: [graphId(2)] },
            { ...resolver.envelope, resolvedRevisionIds: [graphId(2), graphId(3), graphId(4)] },
            { ...resolver.envelope, parentRevisionId: graphId(4) },
            { ...resolver.envelope, revisionId: graphId(1) },
            { ...resolver.envelope, revisionId: graphId(99) },
        ]) {
            expect(
                validateExplicitResolutionCoverageFromHeads(envelope, index, [graphId(2), graphId(3)], bindings([a, b]))
                    .validation.valid
            ).toBe(false);
        }
        expect(
            validateExplicitResolutionCoverageFromHeads(
                resolver.envelope,
                completeIndex([base, a, b, c]),
                [graphId(2), graphId(3), graphId(4)],
                bindings([a, b, c])
            ).validation
        ).toMatchObject({ valid: false, reason: expect.stringContaining("complete") });
    });
    it("C2 cannot use a proven divergent subset to validate an indeterminate complete candidate set", () => {
        const rows = [graphObservation(2, 90), graphObservation(3, 90), graphObservation(4, 91)];
        for (const order of permutations(rows)) {
            expect(
                validateExplicitResolutionCoverageFromHeads(
                    resolver.envelope,
                    completeIndex(order),
                    [graphId(2), graphId(3), graphId(4)],
                    bindings(order)
                ).validation
            ).toMatchObject({ valid: false, reason: expect.stringContaining("proven divergent") });
            expect(validateExplicitResolutionCoverage(resolver.envelope, order).valid).toBe(false);
        }
    });
    it("refusal during coverage binding produces INCOMPLETE, never valid partial coverage", () => {
        let visits = 0;
        const result = validateExplicitResolutionCoverageFromHeads(
            resolver.envelope,
            completeIndex([base, a, b]),
            [graphId(2), graphId(3)],
            bindings([a, b]),
            (event) => event.kind !== "candidate-head" || ++visits < 3
        );
        expect(result.status).toBe("INCOMPLETE");
        expect(result).not.toHaveProperty("validation");
    });
});
