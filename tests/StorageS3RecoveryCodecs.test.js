import { describe, expect, it } from "vitest";
import { canonicalDigest } from "../src/storage/canonicalEncoding";
import { canonicalRevisionDigest } from "../src/storage/envelopes";
import { InMemoryRepresentationStorage } from "../src/storage/InMemoryRepresentationStorage";
import { discoverPhysicalStorageTree } from "../src/storage/discoveryTraversal";
import { aggregateStructuralDiscovery } from "../src/storage/discoverySemantics";
import {
    decodeMutationIntent,
    decodeMutationOutcome,
    encodeMutationIntent,
    encodeMutationOutcome,
    mutationIntentDigest,
    recognizeRecoveryArtifactBytes,
    validateOutcomeAgainstIntent,
} from "../src/storage/recoveryArtifacts";
import { createMutationId, createRevisionId, createStoreId } from "../src/storage/identity";
import {
    STORAGE_S2_FIXTURE_CODEC,
    STORAGE_S2_FIXTURE_IDS,
    buildStorageS2FixtureCorpus,
} from "./helpers/storageS2FixtureCorpus";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const recordCodec = {
    recordKind: "test.storage-s3-record",
    schemaVersion: 1,
    isRecordId: (value) => value === "s3-record-1",
    validatePayload: (value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object payload");
        return value;
    },
};

function revision(storeId, revisionId, parentRevisionId, value) {
    return {
        storageEnvelopeVersion: 1,
        schemaVersion: 1,
        storeId,
        recordKind: recordCodec.recordKind,
        recordId: "s3-record-1",
        revisionId,
        parentRevisionId,
        resolvedRevisionIds: [],
        state: "active",
        payload: { value },
    };
}

async function makeIntent(overrides = {}) {
    const storeId = overrides.storeId ?? createStoreId();
    const before =
        overrides.before === undefined ? revision(storeId, createRevisionId(), null, "before") : overrides.before;
    const after = overrides.after ?? revision(storeId, createRevisionId(), before?.revisionId ?? null, "after");
    return {
        recoveryFormatVersion: 1,
        storeId,
        mutationId: createMutationId(),
        recordKind: recordCodec.recordKind,
        recordId: "s3-record-1",
        baseRevisionId: before?.revisionId ?? null,
        baseDigest: before ? await canonicalRevisionDigest(before) : null,
        before,
        candidateRevisionId: after.revisionId,
        candidateDigest: await canonicalRevisionDigest(after),
        after,
        ...overrides,
    };
}

describe("Storage S3 recovery artifact codecs", () => {
    it("round-trips strict mutation intents with complete before/after binding", async () => {
        const intent = await makeIntent();
        const raw = await encodeMutationIntent(intent, [recordCodec]);
        const decoded = await decodeMutationIntent(raw, [recordCodec], intent.storeId);

        expect(decoded).toEqual(intent);
        expect(await mutationIntentDigest(decoded)).toBe(await canonicalDigest(intent));
    });

    it("validates creation null invariants and rejects mismatched base/candidate evidence", async () => {
        const storeId = createStoreId();
        const created = revision(storeId, createRevisionId(), null, "created");
        const createIntent = await makeIntent({ storeId, before: null, after: created });
        expect(
            await decodeMutationIntent(await encodeMutationIntent(createIntent, [recordCodec]), [recordCodec])
        ).toEqual(createIntent);

        await expect(
            encodeMutationIntent({ ...createIntent, baseRevisionId: createRevisionId() }, [recordCodec])
        ).rejects.toThrow(/Creation intent requires null base fields/);
        await expect(
            encodeMutationIntent({ ...createIntent, candidateDigest: await canonicalDigest({ wrong: true }) }, [
                recordCodec,
            ])
        ).rejects.toThrow(/candidateDigest does not match/);

        const ordinary = await makeIntent();
        await expect(
            encodeMutationIntent({ ...ordinary, baseDigest: await canonicalDigest({ wrong: true }) }, [recordCodec])
        ).rejects.toThrow(/baseDigest does not match/);
        await expect(
            encodeMutationIntent({ ...ordinary, after: { ...ordinary.after, parentRevisionId: null } }, [recordCodec])
        ).rejects.toThrow(/directly descend/);
    });

    it("rejects unknown fields, unsupported versions, malformed JSON, and wrong-store bindings", async () => {
        const intent = await makeIntent();
        const raw = await encodeMutationIntent(intent, [recordCodec]);
        const parsed = JSON.parse(raw);

        await expect(decodeMutationIntent("{bad", [recordCodec])).rejects.toThrow(/malformed JSON/);
        await expect(decodeMutationIntent(JSON.stringify({ ...parsed, extra: true }), [recordCodec])).rejects.toThrow(
            /unknown field extra/
        );
        await expect(
            decodeMutationIntent(JSON.stringify({ ...parsed, recoveryFormatVersion: 2 }), [recordCodec])
        ).rejects.toMatchObject({ category: "unsupported" });
        await expect(decodeMutationIntent(raw, [recordCodec], createStoreId())).rejects.toThrow(/does not match/);
    });

    it("round-trips only the three bound mutation outcome statuses", async () => {
        const intent = await makeIntent();
        const intentDigest = await mutationIntentDigest(intent);
        for (const status of ["VERIFIED_APPLIED", "PRECONDITION_REJECTED", "IO_FAILED"]) {
            const outcome = {
                recoveryFormatVersion: 1,
                storeId: intent.storeId,
                mutationId: intent.mutationId,
                intentDigest,
                recordKind: intent.recordKind,
                recordId: intent.recordId,
                candidateRevisionId: intent.candidateRevisionId,
                candidateDigest: intent.candidateDigest,
                status,
            };
            const raw = encodeMutationOutcome(outcome, intent.storeId);
            const decoded = decodeMutationOutcome(raw, intent.storeId);
            expect(decoded).toEqual(outcome);
            expect(await validateOutcomeAgainstIntent(decoded, intent)).toBe(true);
            expect(
                await validateOutcomeAgainstIntent({ ...decoded, intentDigest: await canonicalDigest({}) }, intent)
            ).toBe(false);
        }
        expect(() =>
            encodeMutationOutcome({
                recoveryFormatVersion: 1,
                storeId: intent.storeId,
                mutationId: intent.mutationId,
                intentDigest,
                recordKind: intent.recordKind,
                recordId: intent.recordId,
                candidateRevisionId: intent.candidateRevisionId,
                candidateDigest: intent.candidateDigest,
                status: "UNKNOWN",
            })
        ).toThrow(/unsupported status/);
    });

    it("recognizes recovery content by validated shape rather than its filename", async () => {
        const intent = await makeIntent();
        const raw = encoder.encode(await encodeMutationIntent(intent, [recordCodec]));
        const recognized = await recognizeRecoveryArtifactBytes(raw, [recordCodec], intent.storeId);
        expect(recognized).toMatchObject({
            status: "VALID",
            kind: "mutation-intent",
            value: { mutationId: intent.mutationId },
        });
        expect(recognized.status === "VALID" && recognized.digest).toBe(await mutationIntentDigest(intent));
    });

    it("recognizes S3 bytes only from S2-bounded recovery observations and retains their physical locators", async () => {
        const files = buildStorageS2FixtureCorpus().nominalClean;
        const candidate = `.finders-keepers/stores/physical-locator/recovery/mutations/provider-renamed-artifact.bin`;
        const storeId = STORAGE_S2_FIXTURE_IDS.storeA;
        const intent = await makeIntent({ storeId });
        files[candidate] = encoder.encode(await encodeMutationIntent(intent, [recordCodec]));
        files[`.finders-keepers/stores/physical-locator/meta/migrations/arbitrary/opaque.json`] = encoder.encode(
            '{"storeId":"untrusted","phase":"unknown"}'
        );

        const backing = new InMemoryRepresentationStorage("s3-discovery-fixture");
        for (const [locator, bytes] of Object.entries(files)) await backing.createImmutable(locator, bytes);
        const mutationCalls = [];
        const readOnlyPort = {
            rootIdentity: backing.rootIdentity,
            localGuarantees: backing.localGuarantees,
            listChildren: (...args) => backing.listChildren(...args),
            readBytes: (...args) => backing.readBytes(...args),
            createImmutable: (...args) => {
                mutationCalls.push("createImmutable");
                return backing.createImmutable(...args);
            },
            writeSnapshot: (...args) => {
                mutationCalls.push("writeSnapshot");
                return backing.writeSnapshot(...args);
            },
            rename: (...args) => {
                mutationCalls.push("rename");
                return backing.rename(...args);
            },
            delete: (...args) => {
                mutationCalls.push("delete");
                return backing.delete(...args);
            },
        };
        const snapshot = await discoverPhysicalStorageTree(readOnlyPort, [STORAGE_S2_FIXTURE_CODEC]);
        const semantics = await aggregateStructuralDiscovery(snapshot, 1, {
            recognizeRecovery: (observation, expectedStoreId) =>
                recognizeRecoveryArtifactBytes(observation.bytes, [recordCodec], expectedStoreId),
        });
        const store = semantics.logicalStores.find((item) => item.storeId === storeId);
        const recognized = store.recoveryEvidence.find((item) => item.observation.locator === candidate);

        expect(recognized).toMatchObject({
            physicalCandidateLocator: ".finders-keepers/stores/physical-locator",
            observation: { context: "opaque-recovery", recognition: { status: "OPAQUE" } },
            recognition: { status: "VALID", kind: "mutation-intent" },
        });
        expect(recognized.recognition.value.mutationId).toBe(intent.mutationId);
        expect(semantics.recoveryEvidence).toContainEqual(recognized);
        expect(store.opaqueObservations.some((item) => item.observation.context === "opaque-migration")).toBe(true);
        expect(mutationCalls).toEqual([]);
        expect(decoder.decode(recognized.observation.bytes)).toBe(await encodeMutationIntent(intent, [recordCodec]));
    });

    it("recognizes a bounded intent in a partial candidate before any other artifact establishes its StoreId", async () => {
        const files = buildStorageS2FixtureCorpus().nominalClean;
        delete files[".finders-keepers/stores/physical-locator/store.json"];
        const storeId = STORAGE_S2_FIXTURE_IDS.storeA;
        const intent = await makeIntent({ storeId });
        files[".finders-keepers/stores/physical-locator/recovery/mutations/not-an-id.json"] = encoder.encode(
            await encodeMutationIntent(intent, [recordCodec])
        );
        const backing = new InMemoryRepresentationStorage("partial-s3-discovery-fixture");
        for (const [locator, bytes] of Object.entries(files)) await backing.createImmutable(locator, bytes);
        const snapshot = await discoverPhysicalStorageTree(backing, [STORAGE_S2_FIXTURE_CODEC]);

        const semantics = await aggregateStructuralDiscovery(snapshot, 1, {
            recognizeRecovery: (observation, expectedStoreId) =>
                recognizeRecoveryArtifactBytes(observation.bytes, [recordCodec], expectedStoreId),
        });

        expect(snapshot.storeCandidates[0].state).toBe("PARTIAL");
        expect(snapshot.storeCandidates[0].storeIds).toEqual([]);
        expect(semantics.recoveryEvidence).toHaveLength(1);
        expect(semantics.recoveryEvidence[0]).toMatchObject({
            candidateStoreIds: [],
            recognition: { status: "VALID", kind: "mutation-intent", value: { storeId } },
        });
        expect(semantics.logicalStores).toEqual([]);
    });
});
