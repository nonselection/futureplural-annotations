import { describe, expect, it } from "vitest";
import {
    AuthorityArtifactError,
    createNamespaceArtifact,
    decodeNamespaceArtifact,
    decodeProtocolFenceArtifact,
    decodeRepresentationStateArtifact,
    decodeStoreArtifact,
    encodeNamespaceArtifact,
    encodeProtocolFenceArtifact,
    encodeRepresentationStateArtifact,
    encodeStoreArtifact,
    representationStateArtifactDigest,
} from "../src/storage/authorityArtifacts";
import { canonicalDigest, canonicalSerialize, isCanonicalDigest } from "../src/storage/canonicalEncoding";
import {
    CanonicalEnvelopeError,
    canonicalRevisionDigest,
    decodeCanonicalRevisionEnvelope,
    encodeCanonicalRevisionEnvelope,
} from "../src/storage/envelopes";
import {
    createMigrationId,
    createMutationId,
    createRepresentationStateId,
    createRevisionId,
    createStoreId,
    isMigrationId,
    isMutationId,
    isRepresentationStateId,
    isRevisionId,
    isStoreId,
} from "../src/storage/identity";

const recordCodec = {
    recordKind: "test.annotation",
    schemaVersion: 1,
    isRecordId: (value) => typeof value === "string" && /^test-annotation-[a-z0-9-]+$/.test(value),
    validatePayload: (value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("expected object payload");
        return value;
    },
};

function envelope(overrides = {}) {
    return {
        storageEnvelopeVersion: 1,
        schemaVersion: 1,
        storeId: createStoreId(),
        recordKind: "test.annotation",
        recordId: "test-annotation-a1",
        revisionId: createRevisionId(),
        parentRevisionId: null,
        resolvedRevisionIds: [],
        state: "active",
        payload: { quote: "selected text", nested: { second: 2, first: 1 } },
        ...overrides,
    };
}

describe("Storage S1 identity and canonical envelope codecs", () => {
    it("creates distinct opaque storage identity domains and rejects cross-domain IDs", () => {
        const ids = [
            createStoreId(),
            createRevisionId(),
            createMutationId(),
            createMigrationId(),
            createRepresentationStateId(),
        ];
        expect(ids[0]).not.toBe(ids[1]);
        expect(isStoreId(ids[0])).toBe(true);
        expect(isRevisionId(ids[1])).toBe(true);
        expect(isMutationId(ids[2])).toBe(true);
        expect(isMigrationId(ids[3])).toBe(true);
        expect(isRepresentationStateId(ids[4])).toBe(true);
        expect(isStoreId(ids[1])).toBe(false);
        expect(isRevisionId("futureplural.sources/Notes/a.md")).toBe(false);
    });

    it("round-trips a versioned envelope with active and tombstone states", () => {
        const active = envelope();
        const decoded = decodeCanonicalRevisionEnvelope(encodeCanonicalRevisionEnvelope(active, [recordCodec]), [
            recordCodec,
        ]);
        expect(decoded).toEqual(active);
        const tombstone = envelope({ state: "deleted", payload: { deleted: true } });
        expect(
            decodeCanonicalRevisionEnvelope(encodeCanonicalRevisionEnvelope(tombstone, [recordCodec]), [recordCodec])
        ).toEqual(tombstone);
    });

    it("distinguishes malformed, unsupported, and invalid envelope data", () => {
        expect(() => decodeCanonicalRevisionEnvelope("{", [recordCodec])).toThrow(CanonicalEnvelopeError);
        expect(() =>
            decodeCanonicalRevisionEnvelope(JSON.stringify(envelope({ storageEnvelopeVersion: 2 })), [recordCodec])
        ).toThrow(/Unsupported storage envelope version/);
        expect(() =>
            decodeCanonicalRevisionEnvelope(JSON.stringify(envelope({ schemaVersion: 2 })), [recordCodec])
        ).toThrow(/Unsupported test.annotation schema version/);
        expect(() =>
            decodeCanonicalRevisionEnvelope(JSON.stringify(envelope({ recordKind: "future.kind" })), [recordCodec])
        ).toThrow(/Unsupported record kind/);
        expect(() => encodeCanonicalRevisionEnvelope(envelope({ recordId: "wrong-kind-id" }), [recordCodec])).toThrow(
            /Invalid recordId/
        );
        expect(() => encodeCanonicalRevisionEnvelope(envelope({ state: "unknown" }), [recordCodec])).toThrow(
            /record state/
        );
        expect(() => encodeCanonicalRevisionEnvelope(envelope({ payload: [] }), [recordCodec])).toThrow(
            /Invalid payload/
        );
        expect(() => encodeCanonicalRevisionEnvelope({ ...envelope(), unexpected: true }, [recordCodec])).toThrow(
            /Unknown canonical envelope field/
        );
    });

    it("validates well-formed, sorted, unique resolution IDs and permits ordinary empty provenance", () => {
        const first = createRevisionId();
        const second = createRevisionId();
        const ordered = [first, second].sort();
        expect(() =>
            encodeCanonicalRevisionEnvelope(envelope({ resolvedRevisionIds: ordered }), [recordCodec])
        ).not.toThrow();
        expect(() =>
            encodeCanonicalRevisionEnvelope(envelope({ resolvedRevisionIds: [ordered[0]] }), [recordCodec])
        ).toThrow(/at least two heads/);
        expect(() =>
            encodeCanonicalRevisionEnvelope(envelope({ resolvedRevisionIds: [ordered[0], ordered[0]] }), [recordCodec])
        ).toThrow(/unique/);
        expect(() =>
            encodeCanonicalRevisionEnvelope(envelope({ resolvedRevisionIds: [...ordered].reverse() }), [recordCodec])
        ).toThrow(/sorted/);
        expect(
            decodeCanonicalRevisionEnvelope(JSON.stringify({ ...envelope(), resolvedRevisionIds: undefined }), [
                recordCodec,
            ]).resolvedRevisionIds
        ).toEqual([]);
        expect(
            decodeCanonicalRevisionEnvelope(encodeCanonicalRevisionEnvelope(envelope(), [recordCodec]), [recordCodec])
                .resolvedRevisionIds
        ).toEqual([]);
    });
});

describe("Storage S1 canonical encoding and digests", () => {
    it("canonicalizes nested object keys recursively and produces identical bytes and digests", async () => {
        const left = { z: { c: 3, a: [{ y: 2, x: 1 }] }, a: true };
        const right = { a: true, z: { a: [{ x: 1, y: 2 }], c: 3 } };
        expect(canonicalSerialize(left)).toBe(canonicalSerialize(right));
        expect(await canonicalDigest(left)).toBe(await canonicalDigest(right));
        expect(isCanonicalDigest(await canonicalDigest(left))).toBe(true);
    });

    it.each([
        ["undefined object field", () => ({ kept: 1, dropped: undefined })],
        ["non-finite number", () => ({ value: Number.NaN })],
        ["negative zero", () => ({ value: -0 })],
        ["unsafe integer", () => ({ value: Number.MAX_SAFE_INTEGER + 1 })],
        ["bigint", () => ({ value: 1n })],
        ["Date coercion", () => ({ value: new Date("2026-01-01T00:00:00Z") })],
        ["sparse array", () => Object.assign(new Array(2), { 1: "value" })],
    ])("rejects %s instead of normalizing it", (_name, makeValue) => {
        expect(() => canonicalSerialize(makeValue())).toThrow();
    });

    it("preserves array order as meaningful canonical content", async () => {
        const left = [{ a: 1 }, "second"];
        const right = ["second", { a: 1 }];
        expect(canonicalSerialize(left)).not.toBe(canonicalSerialize(right));
        expect(await canonicalDigest(left)).not.toBe(await canonicalDigest(right));
    });

    it("computes a stable digest for a validated canonical revision", async () => {
        const value = envelope();
        const firstBytes = encodeCanonicalRevisionEnvelope(value, [recordCodec]);
        const reordered = {
            payload: { nested: { first: 1, second: 2 }, quote: "selected text" },
            state: "active",
            resolvedRevisionIds: [],
            parentRevisionId: null,
            revisionId: value.revisionId,
            recordId: value.recordId,
            recordKind: value.recordKind,
            storeId: value.storeId,
            schemaVersion: 1,
            storageEnvelopeVersion: 1,
        };
        expect(encodeCanonicalRevisionEnvelope(reordered, [recordCodec])).toBe(firstBytes);
        const decoded = decodeCanonicalRevisionEnvelope(firstBytes, [recordCodec]);
        expect(await canonicalRevisionDigest(decoded)).toBe(
            await canonicalRevisionDigest(decodeCanonicalRevisionEnvelope(firstBytes, [recordCodec]))
        );
    });
});

describe("Storage S1 authority artifact codecs", () => {
    it("keeps namespace identity deterministic and non-store-bound", () => {
        const namespace = createNamespaceArtifact();
        const bytes = encodeNamespaceArtifact(namespace);
        expect(decodeNamespaceArtifact(bytes)).toEqual(namespace);
        expect(namespace).toEqual({ schema: "finders-keepers.namespace", version: 1 });
        expect(() => encodeNamespaceArtifact({ ...namespace, activeStoreId: createStoreId() })).toThrow(
            /Unknown authority artifact field/
        );
        expect(() =>
            decodeNamespaceArtifact('{"schema":"finders-keepers.namespace","version":1,"storeId":"foreign"}')
        ).toThrow(/Unknown authority artifact field/);
    });

    it("round-trips store manifests and rejects a mismatched store binding", () => {
        const storeId = createStoreId();
        const bytes = encodeStoreArtifact({ schema: "finders-keepers.store", version: 1, storeId });
        expect(decodeStoreArtifact(bytes, storeId)).toEqual({ schema: "finders-keepers.store", version: 1, storeId });
        expect(() => decodeStoreArtifact(bytes, createStoreId())).toThrow(AuthorityArtifactError);
    });

    it("validates protocol fences and reports unsupported artifact versions", () => {
        const storeId = createStoreId();
        const marker = { schema: "finders-keepers.protocol-fence", version: 1, storeId, requiredProtocolVersion: 2 };
        expect(decodeProtocolFenceArtifact(encodeProtocolFenceArtifact(marker), storeId)).toEqual(marker);
        expect(() => decodeProtocolFenceArtifact(encodeProtocolFenceArtifact(marker), createStoreId())).toThrow(
            /does not match/
        );
        expect(() => decodeProtocolFenceArtifact(JSON.stringify({ ...marker, version: 3 }), storeId)).toThrow(
            /Unsupported/
        );
    });

    it("round-trips representation-state identity and computes its canonical digest", async () => {
        const artifact = {
            schema: "finders-keepers.representation-state",
            version: 1,
            storeId: createStoreId(),
            representationStateId: createRepresentationStateId(),
            parentRepresentationStateId: null,
            representation: "hidden",
            establishedByMigrationId: null,
        };
        const bytes = encodeRepresentationStateArtifact(artifact);
        expect(decodeRepresentationStateArtifact(bytes, artifact.storeId)).toEqual(artifact);
        expect(isCanonicalDigest(await representationStateArtifactDigest(artifact))).toBe(true);
        expect(() => decodeRepresentationStateArtifact(bytes, createStoreId())).toThrow(/does not match/);
        expect(() =>
            encodeRepresentationStateArtifact({ ...artifact, establishedByMigrationId: createMigrationId() })
        ).not.toThrow();
    });
});
