import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
    compareLogicalMutationBindings,
    compareRecoveryExecutionArtifacts,
    decodeRecoveryPreparation,
    decodeRecoveryReceipt,
    encodeRecoveryPreparation,
    encodeRecoveryReceipt,
    projectLogicalMutationBinding,
    RECOVERY_FORMAT_VERSION,
    recoveryPreparationDigest,
    recoveryReceiptDigest,
    recognizeRecoveryV2ArtifactBytes,
    RecoveryV2ArtifactError,
    validatePriorPublicationEvidence,
    validateReceiptAgainstPreparation,
    validateRecoveryPreparation,
    validateRecoveryReceipt,
} from "../src/storage/recoveryArtifacts";
import { canonicalSerialize, isArtifactDigest, isCanonicalDigest } from "../src/storage/canonicalEncoding";
import {
    canonicalRevisionDigest,
    decodeCanonicalRevisionEnvelope,
    encodeCanonicalRevisionEnvelope,
} from "../src/storage/envelopes";
import { isCanonicalObservation, isPhysicalEffect } from "../src/storage/publicationEffects";

const id = (role, n) => `fk-${role}-00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const storeId = id("store", 1);
const mutationId = id("mutation", 1);
const publicationId = id("publication", 1);
const revision = (n) => id("revision", n);
const digest = (n) => `sha256:${String(n).padStart(64, "0")}`;
const codec = {
    recordKind: "test.record",
    schemaVersion: 1,
    isRecordId: (value) => typeof value === "string" && /^record-[ab]$/.test(value),
    validatePayload(value) {
        if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.text !== "string")
            throw new Error("invalid payload");
        return value;
    },
};
const codecs = [codec];
const otherCodec = { ...codec, recordKind: "other.record" };
const multiCodecs = [codec, otherCodec];
function after(overrides = {}) {
    return {
        storageEnvelopeVersion: 1,
        schemaVersion: 1,
        storeId,
        recordKind: "test.record",
        recordId: "record-a",
        revisionId: revision(3),
        parentRevisionId: revision(1),
        resolvedRevisionIds: [],
        state: "active",
        payload: { text: "candidate", nested: { z: 2, a: 1 } },
        ...overrides,
    };
}
async function preparation(overrides = {}, afterOverrides = {}) {
    const candidate = after(afterOverrides);
    return {
        recoveryFormatVersion: 2,
        artifactKind: "preparation",
        requiredProtocolVersion: 2,
        storeId: candidate.storeId,
        recordKind: candidate.recordKind,
        recordId: candidate.recordId,
        mutationId,
        canonicalPublicationId: publicationId,
        purpose: "transition",
        candidateRevisionId: candidate.revisionId,
        candidateDigest: await canonicalRevisionDigest(candidate),
        after: candidate,
        baseRevisionId: candidate.parentRevisionId,
        baseDigest: candidate.parentRevisionId === null ? null : digest(1),
        resolutionHeads: [],
        ...overrides,
    };
}
async function resolution(overrides = {}, afterOverrides = {}) {
    return preparation(
        {
            resolutionHeads: [
                { revisionId: revision(1), digest: digest(1) },
                { revisionId: revision(2), digest: digest(2) },
            ],
            ...overrides,
        },
        { resolvedRevisionIds: [revision(1), revision(2)], ...afterOverrides }
    );
}
async function receipt(prep, overrides = {}) {
    return {
        recoveryFormatVersion: 2,
        artifactKind: "receipt",
        requiredProtocolVersion: 2,
        storeId: prep.storeId,
        recordKind: prep.recordKind,
        recordId: prep.recordId,
        mutationId: prep.mutationId,
        canonicalPublicationId: prep.canonicalPublicationId,
        preparationDigest: await recoveryPreparationDigest(prep, multiCodecs),
        candidateRevisionId: prep.candidateRevisionId,
        candidateDigest: prep.candidateDigest,
        physicalEffect: "DISPATCH_OUTCOME_UNKNOWN",
        canonicalObservation: "EXACT_CANDIDATE",
        ...overrides,
    };
}
function rawDigest(raw) {
    return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}
async function invalidPreparation(value, pattern = /./, category = "invalid", registry = multiCodecs) {
    await expect(validateRecoveryPreparation(value, registry)).rejects.toMatchObject({
        name: "RecoveryV2ArtifactError",
        category,
    });
    await expect(validateRecoveryPreparation(value, registry)).rejects.toThrow(pattern);
}
function invalidReceipt(value, pattern = /./, category = "invalid", registry = multiCodecs) {
    expect(() => validateRecoveryReceipt(value, registry)).toThrow(RecoveryV2ArtifactError);
    expect(() => validateRecoveryReceipt(value, registry)).toThrow(pattern);
    try {
        validateRecoveryReceipt(value, registry);
    } catch (error) {
        expect(error.category).toBe(category);
    }
}
const preparationFields = [
    "recoveryFormatVersion",
    "artifactKind",
    "requiredProtocolVersion",
    "storeId",
    "recordKind",
    "recordId",
    "mutationId",
    "canonicalPublicationId",
    "purpose",
    "candidateRevisionId",
    "candidateDigest",
    "after",
    "baseRevisionId",
    "baseDigest",
    "resolutionHeads",
];
const receiptFields = [
    "recoveryFormatVersion",
    "artifactKind",
    "requiredProtocolVersion",
    "storeId",
    "recordKind",
    "recordId",
    "mutationId",
    "canonicalPublicationId",
    "preparationDigest",
    "candidateRevisionId",
    "candidateDigest",
    "physicalEffect",
    "canonicalObservation",
];
const factPairs = [
    ["NO_MUTATION_DISPATCHED", "NOT_ESTABLISHED", true],
    ["NO_MUTATION_DISPATCHED", "EXACT_CANDIDATE", false],
    ["DISPATCH_REPORTED_SUCCESS", "NOT_ESTABLISHED", true],
    ["DISPATCH_REPORTED_SUCCESS", "EXACT_CANDIDATE", true],
    ["DISPATCH_OUTCOME_UNKNOWN", "NOT_ESTABLISHED", true],
    ["DISPATCH_OUTCOME_UNKNOWN", "EXACT_CANDIDATE", true],
];

describe("S1 Recovery2 strict preparation codec", () => {
    it("round-trips complete ordinary, creation, resolution and exact-materialization shapes", async () => {
        expect(RECOVERY_FORMAT_VERSION).toBe(2);
        for (const value of [
            await preparation(),
            await preparation({}, { parentRevisionId: null }),
            await resolution(),
            await resolution({ purpose: "exact-materialization" }),
        ]) {
            const encoded = await encodeRecoveryPreparation(value, codecs, storeId);
            const decoded = await decodeRecoveryPreparation(encoded, codecs, storeId);
            expect(decoded).toEqual(value);
            expect(Object.keys(decoded).sort()).toEqual([...preparationFields].sort());
            expect(Object.isFrozen(decoded)).toBe(true);
            expect(Object.isFrozen(decoded.after.payload.nested)).toBe(true);
            expect(Object.isFrozen(decoded.resolutionHeads)).toBe(true);
            expect(Object.isFrozen(value)).toBe(false);
        }
    });
    it.each(preparationFields)("requires preparation field %s", async (field) => {
        const value = await preparation();
        delete value[field];
        await invalidPreparation(value, new RegExp(`missing ${field}`));
    });
    it.each([
        "before",
        "locator",
        "preparationPublicationId",
        "physicalEffect",
        "schemaVersion",
        "storageEnvelopeVersion",
        "role",
        "unexpected",
    ])("rejects forbidden/extra preparation field %s", async (field) => {
        await invalidPreparation(await preparation({ [field]: null }), /unknown field/);
    });
    it.each([
        ["recoveryFormatVersion", 1, "unsupported"],
        ["recoveryFormatVersion", 3, "unsupported"],
        ["recoveryFormatVersion", 0, "invalid"],
        ["recoveryFormatVersion", 2.5, "invalid"],
        ["recoveryFormatVersion", "2", "invalid"],
        ["artifactKind", "receipt", "invalid"],
        ["artifactKind", "intent", "invalid"],
        ["requiredProtocolVersion", 1, "unsupported"],
        ["requiredProtocolVersion", 3, "unsupported"],
        ["requiredProtocolVersion", 0, "invalid"],
        ["requiredProtocolVersion", null, "invalid"],
        ["storeId", revision(1), "invalid"],
        ["mutationId", publicationId, "invalid"],
        ["canonicalPublicationId", mutationId, "invalid"],
        ["candidateRevisionId", publicationId, "invalid"],
        ["candidateDigest", "sha256:bad", "invalid"],
        ["purpose", "retry", "invalid"],
        ["recordKind", "", "invalid"],
        ["recordKind", "future.record", "unsupported"],
        ["recordId", "wrong-role", "invalid"],
        ["baseRevisionId", mutationId, "invalid"],
        ["baseDigest", "bad", "invalid"],
        ["resolutionHeads", {}, "invalid"],
    ])("rejects preparation %s=%s as %s", async (field, value, category) => {
        await invalidPreparation(await preparation({ [field]: value }), /./, category);
    });
    it("classifies recovery1 before demanding preparation2 fields", async () => {
        await invalidPreparation(
            { recoveryFormatVersion: 1, before: null, after: after() },
            /Unsupported recovery format/,
            "unsupported"
        );
    });
    it.each([null, [], "preparation", 2])("rejects nonobject preparation %s", async (value) => {
        await invalidPreparation(value, /must be an object/);
    });
    it("rejects malformed/noncanonical content and invalid codec registries", async () => {
        await expect(decodeRecoveryPreparation("{", codecs)).rejects.toThrow(/malformed JSON/);
        const value = await preparation();
        await invalidPreparation({ ...value, [Symbol("hidden")]: 1 }, /symbol/);
        const getter = vi.fn(() => value.after);
        await invalidPreparation(Object.defineProperty(value, "after", { enumerable: true, get: getter }), /accessor/);
        expect(getter).not.toHaveBeenCalled();
        await invalidPreparation(await preparation(), /Duplicate record codec/, "invalid", [codec, codec]);
        await invalidPreparation(await preparation(), /Invalid record codec/, "invalid", [
            { ...codec, schemaVersion: 0 },
        ]);
    });
    it.each(["storeId", "recordKind", "recordId", "revisionId"])(
        "checks nested after %s against outer binding",
        async (field) => {
            const value = await preparation();
            value.after[field] = {
                storeId: id("store", 2),
                recordKind: "other.record",
                recordId: "record-b",
                revisionId: revision(4),
            }[field];
            await invalidPreparation(value, /identity|candidateRevisionId/);
        }
    );
    it("validates expected StoreId, nested schema/payload, candidate digest and parent/base", async () => {
        await expect(validateRecoveryPreparation(await preparation(), codecs, id("store", 2))).rejects.toThrow(
            /expected logical store/
        );
        await invalidPreparation(await preparation({}, { schemaVersion: 2 }), /unsupported/, "unsupported");
        await invalidPreparation(await preparation({}, { storageEnvelopeVersion: 2 }), /unsupported/, "unsupported");
        await invalidPreparation(await preparation({}, { payload: { bad: true } }), /after is invalid/);
        await invalidPreparation(await preparation({ candidateDigest: digest(9) }), /candidateDigest does not match/);
        await invalidPreparation(await preparation({ baseRevisionId: revision(2) }), /parentRevisionId/);
    });
    it("enforces complete null/non-null base pairs and creation-only null shape", async () => {
        await invalidPreparation(await preparation({ baseDigest: null }), /both be null/);
        await invalidPreparation(await preparation({ baseRevisionId: null }), /both be null/);
        await invalidPreparation(await preparation({ baseRevisionId: null, baseDigest: null }), /parentRevisionId/);
        await invalidPreparation(
            await preparation(
                {
                    resolutionHeads: [
                        { revisionId: revision(1), digest: digest(1) },
                        { revisionId: revision(2), digest: digest(2) },
                    ],
                },
                { parentRevisionId: null, resolvedRevisionIds: [revision(1), revision(2)] }
            ),
            /Null base/
        );
        const noParent = await preparation(
            {},
            { parentRevisionId: null, resolvedRevisionIds: [revision(1), revision(2)] }
        );
        await invalidPreparation(noParent, /Null base/);
        const creation = await preparation({}, { parentRevisionId: null });
        expect((await validateRecoveryPreparation(creation, codecs)).baseDigest).toBe(null);
    });
    it("forbids ordinary resolution provenance for both operation purposes", async () => {
        for (const purpose of ["transition", "exact-materialization"]) {
            await invalidPreparation(
                await preparation({ purpose }, { resolvedRevisionIds: [revision(1), revision(2)] }),
                /Ordinary preparation/
            );
        }
    });
    it.each([
        [
            "one head",
            (v) => {
                v.resolutionHeads.pop();
            },
            /at least two/,
        ],
        [
            "unsorted",
            (v) => {
                v.resolutionHeads.reverse();
            },
            /sorted/,
        ],
        [
            "duplicate",
            (v) => {
                v.resolutionHeads[1] = { ...v.resolutionHeads[0] };
            },
            /unique/,
        ],
        [
            "candidate head",
            (v) => {
                v.resolutionHeads.push({ revisionId: revision(3), digest: digest(3) });
            },
            /own resolution head/,
        ],
        [
            "selected parent absent",
            (v) => {
                v.resolutionHeads = [
                    { revisionId: revision(2), digest: digest(2) },
                    { revisionId: revision(4), digest: digest(4) },
                ];
            },
            /Selected base parent/,
        ],
        [
            "selected parent digest",
            (v) => {
                v.resolutionHeads[0].digest = digest(9);
            },
            /Selected parent digest/,
        ],
        [
            "head coverage",
            (v) => {
                v.resolutionHeads[1].revisionId = revision(4);
            },
            /exactly match/,
        ],
        [
            "extra head row field",
            (v) => {
                v.resolutionHeads[0].locator = "path";
            },
            /unknown field/,
        ],
        [
            "missing head ID",
            (v) => {
                delete v.resolutionHeads[0].revisionId;
            },
            /missing revisionId/,
        ],
        [
            "missing head digest",
            (v) => {
                delete v.resolutionHeads[0].digest;
            },
            /missing digest/,
        ],
        [
            "wrong head role",
            (v) => {
                v.resolutionHeads[0].revisionId = mutationId;
            },
            /Invalid resolution head RevisionId/,
        ],
        [
            "bad head digest",
            (v) => {
                v.resolutionHeads[0].digest = "bad";
            },
            /Invalid resolution head digest/,
        ],
        [
            "nonobject row",
            (v) => {
                v.resolutionHeads[0] = null;
            },
            /must be an object/,
        ],
    ])("rejects resolution %s", async (_name, mutate, pattern) => {
        const value = await resolution();
        mutate(value);
        await invalidPreparation(value, pattern);
    });
    it("never manufactures repository-head completeness or materialization eligibility", async () => {
        const value = await resolution({ purpose: "exact-materialization" });
        const decoded = await validateRecoveryPreparation(value, codecs);
        expect(decoded).toEqual(value);
        expect(await validatePriorPublicationEvidence(value, undefined, codecs)).toMatchObject({
            status: "NOT_QUALIFIED",
        });
        expect(Object.keys(decoded)).not.toContain("mayMutate");
    });
    it("preserves imported IDs and omitted-envelope-provenance normalization without allocating IDs", async () => {
        const value = await preparation();
        for (const field of [
            "storeId",
            "mutationId",
            "canonicalPublicationId",
            "candidateRevisionId",
            "baseRevisionId",
        ])
            value[field] = value[field].toUpperCase();
        value.after.storeId = value.storeId;
        value.after.revisionId = value.candidateRevisionId;
        value.after.parentRevisionId = value.baseRevisionId;
        delete value.after.resolvedRevisionIds;
        value.candidateDigest = await canonicalRevisionDigest({ ...value.after, resolvedRevisionIds: [] });
        const random = vi.spyOn(window.crypto, "getRandomValues").mockImplementation(() => {
            throw new Error("unexpected allocation");
        });
        try {
            const decoded = await validateRecoveryPreparation(value, codecs);
            expect(decoded.canonicalPublicationId).toBe(value.canonicalPublicationId);
            expect(decoded.after.resolvedRevisionIds).toEqual([]);
            expect(random).not.toHaveBeenCalled();
        } finally {
            random.mockRestore();
        }
    });
});

describe("S1 Recovery2 complete digests and logical mutation binding", () => {
    it("hashes complete deterministic preparation including purpose/execution, separately from candidate digest", async () => {
        const value = await preparation();
        const bytes = await encodeRecoveryPreparation(value, codecs);
        expect(await recoveryPreparationDigest(value, codecs)).toBe(rawDigest(bytes));
        const reordered = Object.fromEntries(Object.entries(value).reverse());
        reordered.after.payload = { nested: { a: 1, z: 2 }, text: "candidate" };
        expect(await encodeRecoveryPreparation(reordered, codecs)).toBe(bytes);
        expect(await recoveryPreparationDigest(reordered, codecs)).toBe(rawDigest(bytes));
        expect(await recoveryPreparationDigest(value, codecs)).not.toBe(value.candidateDigest);
        for (const changed of [
            { ...value, canonicalPublicationId: id("publication", 2) },
            { ...value, purpose: "exact-materialization" },
        ]) {
            expect(changed.candidateDigest).toBe(value.candidateDigest);
            expect(await recoveryPreparationDigest(changed, codecs)).not.toBe(
                await recoveryPreparationDigest(value, codecs)
            );
            expect(await compareLogicalMutationBindings(value, changed, codecs)).toBe("EQUIVALENT_LOGICAL_MUTATION");
        }
        const projected = await projectLogicalMutationBinding(value, codecs);
        expect(Object.keys(projected).sort()).toEqual(
            [
                "storeId",
                "recordKind",
                "recordId",
                "candidateRevisionId",
                "candidateDigest",
                "after",
                "baseRevisionId",
                "baseDigest",
                "resolutionHeads",
            ].sort()
        );
        expect(projected.baseRevisionId).toBe(value.baseRevisionId);
    });
    it.each([
        ["candidate ID", async () => preparation({}, { revisionId: revision(4) })],
        ["payload", async () => preparation({}, { payload: { text: "changed" } })],
        ["state", async () => preparation({}, { state: "deleted" })],
        ["base ID", async () => preparation({}, { parentRevisionId: revision(2) })],
        ["base digest", async () => preparation({ baseDigest: digest(9) })],
        ["store", async () => preparation({}, { storeId: id("store", 2) })],
        ["record ID", async () => preparation({}, { recordId: "record-b" })],
        ["record kind", async () => preparation({}, { recordKind: "other.record" })],
    ])("detects same MutationId changed %s as conflict", async (_name, changed) => {
        const first = await preparation();
        const second = await changed();
        expect(await compareLogicalMutationBindings(first, second, multiCodecs)).toBe("MUTATION_IDENTITY_CONFLICT");
        expect(await compareLogicalMutationBindings(second, first, multiCodecs)).toBe("MUTATION_IDENTITY_CONFLICT");
    });
    it("detects isolated schema changes using each claim's explicit domain codec context", async () => {
        const first = await preparation();
        const second = await preparation({}, { schemaVersion: 2 });
        await expect(compareLogicalMutationBindings(first, second, codecs)).rejects.toMatchObject({
            category: "unsupported",
        });
        expect(await compareLogicalMutationBindings(first, second, codecs, [{ ...codec, schemaVersion: 2 }])).toBe(
            "MUTATION_IDENTITY_CONFLICT"
        );
    });
    it.each([
        [
            "membership",
            () =>
                resolution(
                    {
                        resolutionHeads: [
                            { revisionId: revision(1), digest: digest(1) },
                            { revisionId: revision(4), digest: digest(4) },
                        ],
                    },
                    { resolvedRevisionIds: [revision(1), revision(4)] }
                ),
        ],
        [
            "head digest",
            () =>
                resolution({
                    resolutionHeads: [
                        { revisionId: revision(1), digest: digest(1) },
                        { revisionId: revision(2), digest: digest(9) },
                    ],
                }),
        ],
        ["selected parent", () => resolution({ baseDigest: digest(2) }, { parentRevisionId: revision(2) })],
    ])("binds resolution %s to the logical intention", async (_name, makeChanged) => {
        const original = await resolution();
        const changed = await makeChanged();
        expect(await compareLogicalMutationBindings(original, changed, codecs)).toBe("MUTATION_IDENTITY_CONFLICT");
    });
    it("does not let exact-materialization change the original intention or invent qualification", async () => {
        const original = await resolution();
        const same = { ...original, purpose: "exact-materialization", canonicalPublicationId: id("publication", 2) };
        expect(await compareLogicalMutationBindings(original, same, codecs)).toBe("EQUIVALENT_LOGICAL_MUTATION");
        const changed = await resolution({ purpose: "exact-materialization" }, { payload: { text: "changed" } });
        expect(await compareLogicalMutationBindings(original, changed, codecs)).toBe("MUTATION_IDENTITY_CONFLICT");
        expect(await compareLogicalMutationBindings(original, { ...same, mutationId: id("mutation", 2) }, codecs)).toBe(
            "DISTINCT_MUTATION"
        );
        expect(await validatePriorPublicationEvidence(same, undefined, codecs)).toMatchObject({
            status: "NOT_QUALIFIED",
        });
    });

    it("keeps different MutationIds distinct despite identical candidate content", async () => {
        const first = await preparation();
        expect(await compareLogicalMutationBindings(first, { ...first, mutationId: id("mutation", 2) }, codecs)).toBe(
            "DISTINCT_MUTATION"
        );
    });
    it("does not trust forged casts or digest-only equivalence", async () => {
        const value = await preparation();
        const changed = structuredClone(value);
        changed.after.payload.text = "changed";
        await expect(compareLogicalMutationBindings(value, changed, codecs)).rejects.toThrow(/candidateDigest/);
    });
    it("detaches caller and codec-owned mutable content before an awaited hash", async () => {
        const value = await preparation();
        const original = structuredClone(value);
        const owned = { text: "candidate", nested: { z: 2, a: 1 } };
        const registry = [{ ...codec, validatePayload: () => owned }];
        const originalDigest = window.crypto.subtle.digest.bind(window.crypto.subtle);
        let release;
        let started;
        const barrier = new Promise((resolve) => {
            started = resolve;
        });
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        const spy = vi.spyOn(window.crypto.subtle, "digest").mockImplementation(async (...args) => {
            started();
            await gate;
            return originalDigest(...args);
        });
        try {
            const pending = validateRecoveryPreparation(value, registry);
            await barrier;
            value.after.payload.text = "mutated caller";
            value.baseDigest = digest(9);
            owned.text = "mutated codec";
            release();
            const validated = await pending;
            expect(validated).toEqual(original);
            expect(Object.isFrozen(owned)).toBe(false);
            expect(Object.isFrozen(validated.after.payload)).toBe(true);
            expect(await recoveryPreparationDigest(validated, codecs)).toBe(rawDigest(canonicalSerialize(original)));
        } finally {
            release();
            spy.mockRestore();
        }
    });
    it("snapshots complete preparation encoding/digest across their internal validation await", async () => {
        const original = await preparation();
        const forEncoding = structuredClone(original);
        const forDigest = structuredClone(original);
        const encoded = encodeRecoveryPreparation(forEncoding, codecs);
        const hashed = recoveryPreparationDigest(forDigest, codecs);
        forEncoding.after.payload.text = "changed after encoding entry";
        forDigest.purpose = "exact-materialization";
        forDigest.canonicalPublicationId = id("publication", 2);
        expect(await encoded).toBe(canonicalSerialize(original));
        expect(await hashed).toBe(rawDigest(canonicalSerialize(original)));
    });

    it("snapshots both claims before parallel comparison hashes yield", async () => {
        const first = await preparation();
        const second = structuredClone(first);
        const pending = compareLogicalMutationBindings(first, second, codecs);
        first.after.payload.text = "changed first";
        second.baseDigest = digest(9);
        expect(await pending).toBe("EQUIVALENT_LOGICAL_MUTATION");
    });
});

describe("S1 Recovery2 receipt codec, sealed executions and exact preparation binding", () => {
    it.each(receiptFields)("requires receipt field %s", async (field) => {
        const value = await receipt(await preparation());
        delete value[field];
        invalidReceipt(value, new RegExp(`missing ${field}`));
    });
    it.each(["role", "schemaVersion", "payload", "locator", "receiptPublicationId", "status", "unexpected"])(
        "rejects extra receipt field %s",
        async (field) => {
            invalidReceipt(await receipt(await preparation(), { [field]: null }), /unknown field/);
        }
    );
    it.each([
        ["recoveryFormatVersion", 1, "unsupported"],
        ["recoveryFormatVersion", 3, "unsupported"],
        ["recoveryFormatVersion", 0, "invalid"],
        ["artifactKind", "preparation", "invalid"],
        ["requiredProtocolVersion", 1, "unsupported"],
        ["requiredProtocolVersion", 3, "unsupported"],
        ["requiredProtocolVersion", 0, "invalid"],
        ["storeId", mutationId, "invalid"],
        ["mutationId", publicationId, "invalid"],
        ["canonicalPublicationId", mutationId, "invalid"],
        ["candidateRevisionId", publicationId, "invalid"],
        ["candidateDigest", "bad", "invalid"],
        ["preparationDigest", "bad", "invalid"],
        ["recordKind", "future.record", "unsupported"],
        ["recordId", "wrong-role", "invalid"],
        ["physicalEffect", "APPLIED", "invalid"],
        ["canonicalObservation", "ABSENT", "invalid"],
    ])("rejects receipt %s=%s as %s", async (field, value, category) => {
        invalidReceipt(await receipt(await preparation(), { [field]: value }), /./, category);
    });
    it.each(factPairs)("validates %s + %s exactly", async (physicalEffect, canonicalObservation, valid) => {
        const value = await receipt(await preparation(), { physicalEffect, canonicalObservation });
        expect(isPhysicalEffect(physicalEffect)).toBe(true);
        expect(isCanonicalObservation(canonicalObservation)).toBe(true);
        if (!valid) {
            invalidReceipt(value, /Nondispatch/);
            return;
        }
        const encoded = encodeRecoveryReceipt(value, codecs, storeId);
        expect(decodeRecoveryReceipt(encoded, codecs, storeId)).toEqual(value);
        expect(await recoveryReceiptDigest(value, codecs)).toBe(rawDigest(encoded));
        expect(Object.isFrozen(validateRecoveryReceipt(value, codecs))).toBe(true);
        expect(isArtifactDigest(await recoveryReceiptDigest(value, codecs))).toBe(true);
        expect(isCanonicalDigest(value.candidateDigest)).toBe(true);
    });
    it("validates receipt expected store, malformed objects and record-codec boundaries", async () => {
        const value = await receipt(await preparation());
        expect(() => validateRecoveryReceipt(value, codecs, id("store", 2))).toThrow(/expected logical store/);
        expect(() => decodeRecoveryReceipt("{", codecs)).toThrow(/malformed JSON/);
        for (const input of [null, [], 2]) invalidReceipt(input, /must be an object/);
        expect(() => validateRecoveryReceipt(value, [codec, codec])).toThrow(/Duplicate/);
        expect(isPhysicalEffect("VERIFIED_APPLIED")).toBe(false);
        expect(isCanonicalObservation("healthy")).toBe(false);
    });
    it.each([
        "storeId",
        "recordKind",
        "recordId",
        "mutationId",
        "canonicalPublicationId",
        "candidateRevisionId",
        "candidateDigest",
        "preparationDigest",
    ])("binds receipt %s to the exact preparation", async (field) => {
        const prep = await preparation();
        const value = await receipt(prep);
        expect(await validateReceiptAgainstPreparation(value, prep, multiCodecs)).toBe(true);
        value[field] = {
            storeId: id("store", 2),
            recordKind: "other.record",
            recordId: "record-b",
            mutationId: id("mutation", 2),
            canonicalPublicationId: id("publication", 2),
            candidateRevisionId: revision(4),
            candidateDigest: digest(9),
            preparationDigest: digest(9),
        }[field];
        expect(await validateReceiptAgainstPreparation(value, prep, multiCodecs)).toBe(false);
        expect(await validatePriorPublicationEvidence(prep, value, multiCodecs)).toMatchObject({ status: "INVALID" });
    });
    it("recomputes whole preparation digest including purpose/execution and revalidates cast inputs", async () => {
        const prep = await preparation();
        const value = await receipt(prep);
        expect(
            await validateReceiptAgainstPreparation(value, { ...prep, purpose: "exact-materialization" }, codecs)
        ).toBe(false);
        await expect(
            validateReceiptAgainstPreparation({ ...value, physicalEffect: "APPLIED" }, prep, codecs)
        ).rejects.toThrow(/physicalEffect/);
        const corrupted = structuredClone(prep);
        corrupted.after.payload.text = "changed";
        await expect(validateReceiptAgainstPreparation(value, corrupted, codecs)).rejects.toThrow(/candidateDigest/);
    });
    it("keeps exact physical copies equivalent and detects changed complete preparation under the same execution", async () => {
        const prep = await preparation();
        expect(await compareRecoveryExecutionArtifacts(prep, structuredClone(prep), codecs)).toBe("EQUIVALENT");
        for (const changed of [
            { ...prep, purpose: "exact-materialization" },
            { ...prep, baseDigest: digest(9) },
            await preparation({}, { payload: { text: "different" } }),
        ]) {
            expect(await compareRecoveryExecutionArtifacts(prep, changed, codecs)).toBe("EXECUTION_ARTIFACT_CONFLICT");
        }
    });
    it("keeps sealed receipt copies equivalent, conflicting facts invalid, and different executions independent", async () => {
        const prep = await preparation();
        const unknown = await receipt(prep);
        expect(await compareRecoveryExecutionArtifacts(unknown, structuredClone(unknown), codecs)).toBe("EQUIVALENT");
        for (const changed of [
            { ...unknown, physicalEffect: "DISPATCH_REPORTED_SUCCESS" },
            { ...unknown, canonicalObservation: "NOT_ESTABLISHED" },
            { ...unknown, preparationDigest: digest(9) },
        ]) {
            expect(await compareRecoveryExecutionArtifacts(unknown, changed, codecs)).toBe(
                "EXECUTION_ARTIFACT_CONFLICT"
            );
        }
        const secondPrep = { ...prep, canonicalPublicationId: id("publication", 2) };
        const success = await receipt(secondPrep, { physicalEffect: "DISPATCH_REPORTED_SUCCESS" });
        expect(await compareRecoveryExecutionArtifacts(prep, secondPrep, codecs)).toBe("DISTINCT_EXECUTION_ARTIFACT");
        expect(await compareRecoveryExecutionArtifacts(unknown, success, codecs)).toBe("DISTINCT_EXECUTION_ARTIFACT");
        expect(await compareRecoveryExecutionArtifacts(prep, unknown, codecs)).toBe("DISTINCT_EXECUTION_ARTIFACT");
        expect(await compareRecoveryExecutionArtifacts(unknown, prep, codecs)).toBe("DISTINCT_EXECUTION_ARTIFACT");
        expect(unknown.physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
    });
    it.each(
        ["preparation", "receipt"].flatMap((kind) =>
            ["recordKind", "recordId"].flatMap((field) => [false, true].map((reverse) => [kind, field, reverse]))
        )
    )("F1 same-identity %s conflicts on changed %s, reverse=%s", async (kind, field, reverse) => {
        const originalPrep = await validateRecoveryPreparation(await preparation(), multiCodecs);
        const changedPrep = await validateRecoveryPreparation(
            await preparation({}, { [field]: field === "recordKind" ? "other.record" : "record-b" }),
            multiCodecs
        );
        const original =
            kind === "preparation" ? originalPrep : validateRecoveryReceipt(await receipt(originalPrep), multiCodecs);
        const changed =
            kind === "preparation" ? changedPrep : validateRecoveryReceipt(await receipt(changedPrep), multiCodecs);
        if (kind === "receipt") {
            expect(await validateReceiptAgainstPreparation(original, originalPrep, multiCodecs)).toBe(true);
            expect(await validateReceiptAgainstPreparation(changed, changedPrep, multiCodecs)).toBe(true);
        }
        expect(original[field]).not.toBe(changed[field]);
        for (const key of ["artifactKind", "storeId", "mutationId", "canonicalPublicationId"])
            expect(original[key]).toBe(changed[key]);
        expect(
            await compareRecoveryExecutionArtifacts(
                reverse ? changed : original,
                reverse ? original : changed,
                multiCodecs
            )
        ).toBe("EXECUTION_ARTIFACT_CONFLICT");
    });
    it.each(
        ["preparation", "receipt"].flatMap((kind) =>
            ["storeId", "mutationId", "canonicalPublicationId"].map((field) => [kind, field])
        )
    )("F1 keeps %s with a different identity field %s distinct", async (kind, field) => {
        const originalPrep = await validateRecoveryPreparation(await preparation(), multiCodecs);
        const changedPrep = await validateRecoveryPreparation(
            field === "storeId"
                ? await preparation({}, { storeId: id("store", 2) })
                : { ...originalPrep, [field]: field === "mutationId" ? id("mutation", 2) : id("publication", 2) },
            multiCodecs
        );
        const original = kind === "preparation" ? originalPrep : await receipt(originalPrep);
        const changed = kind === "preparation" ? changedPrep : await receipt(changedPrep);
        for (const [left, right] of [
            [original, changed],
            [changed, original],
        ])
            expect(await compareRecoveryExecutionArtifacts(left, right, multiCodecs)).toBe(
                "DISTINCT_EXECUTION_ARTIFACT"
            );
        expect(await compareRecoveryExecutionArtifacts(original, structuredClone(original), multiCodecs)).toBe(
            "EQUIVALENT"
        );
    });
});

describe("S1 Recovery2 pure prior-publication evidence and content-only recognition", () => {
    it.each(factPairs)(
        "qualifies only exact dispatched facts: %s + %s",
        async (physicalEffect, canonicalObservation, valid) => {
            const prep = await preparation();
            const value = await receipt(prep, { physicalEffect, canonicalObservation });
            const result = await validatePriorPublicationEvidence(prep, value, codecs);
            const qualifies = valid && canonicalObservation === "EXACT_CANDIDATE";
            expect(result.status).toBe(
                !valid ? "INVALID" : qualifies ? "QUALIFIED_PRIOR_PUBLICATION" : "NOT_QUALIFIED"
            );
            if (qualifies) {
                expect(result.evidence.physicalEffect).toBe(physicalEffect);
                expect(result.evidence.canonicalObservation).toBe("EXACT_CANDIDATE");
                expect(result.evidence.envelope).toEqual(prep.after);
                expect(result.evidence.preparationDigest).toBe(await recoveryPreparationDigest(prep, codecs));
                expect(result.evidence.receiptDigest).toBe(await recoveryReceiptDigest(value, codecs));
                expect(result.evidence.logicalBinding.baseRevisionId).toBe(prep.baseRevisionId);
                expect(Object.isFrozen(result.evidence.receipt)).toBe(true);
                for (const field of [
                    "healthy",
                    "current",
                    "mayMutate",
                    "writable",
                    "uniqueHead",
                    "canonicalLocatorPresent",
                ])
                    expect(result.evidence).not.toHaveProperty(field);
            }
        }
    );
    it("preparation alone never qualifies; direct canonical envelopes validate independently", async () => {
        const prep = await preparation();
        for (const missing of [undefined, null])
            expect(await validatePriorPublicationEvidence(prep, missing, codecs)).toMatchObject({
                status: "NOT_QUALIFIED",
            });
        const raw = encodeCanonicalRevisionEnvelope(prep.after, codecs);
        expect(decodeCanonicalRevisionEnvelope(raw, codecs)).toEqual(prep.after);
        expect(await canonicalRevisionDigest(decodeCanonicalRevisionEnvelope(raw, codecs))).toBe(prep.candidateDigest);
    });
    it("refuses partial/malformed/legacy evidence without translating statuses", async () => {
        const prep = await preparation();
        const value = await receipt(prep);
        for (const bad of [null, {}, { recoveryFormatVersion: 2 }, { ...prep, after: null }])
            expect(await validatePriorPublicationEvidence(bad, value, codecs)).toMatchObject({ status: "INVALID" });
        const partial = { ...value };
        delete partial.preparationDigest;
        expect(await validatePriorPublicationEvidence(prep, partial, codecs)).toMatchObject({ status: "INVALID" });
        for (const bad of [
            { recoveryFormatVersion: 1, before: null },
            { ...prep, recoveryFormatVersion: 3 },
        ])
            expect(await validatePriorPublicationEvidence(bad, value, codecs)).toMatchObject({ status: "UNSUPPORTED" });
        expect(
            await validatePriorPublicationEvidence(
                prep,
                { recoveryFormatVersion: 1, status: "VERIFIED_APPLIED" },
                codecs
            )
        ).toMatchObject({ status: "UNSUPPORTED" });
    });
    it("snapshots preparation and receipt before awaits and returns immutable independent proof", async () => {
        const prep = await preparation();
        const value = await receipt(prep);
        const pending = validatePriorPublicationEvidence(prep, value, codecs);
        prep.after.payload.text = "changed";
        value.canonicalObservation = "NOT_ESTABLISHED";
        const result = await pending;
        expect(result.status).toBe("QUALIFIED_PRIOR_PUBLICATION");
        expect(result.evidence.envelope.payload.text).toBe("candidate");
        expect(result.evidence.receipt.canonicalObservation).toBe("EXACT_CANDIDATE");
    });
    it("recognizes preparation/receipt2 and supplies complete artifact digests", async () => {
        const prep = await preparation();
        const value = await receipt(prep);
        for (const [kind, artifact] of [
            ["preparation", prep],
            ["receipt", value],
        ]) {
            const bytes = new TextEncoder().encode(canonicalSerialize(artifact));
            const result = await recognizeRecoveryV2ArtifactBytes(bytes, codecs, storeId);
            expect(result.status).toBe("VALID");
            expect(result.kind).toBe(kind);
            expect(result.value).toEqual(artifact);
            expect(result.digest).toBe(rawDigest(canonicalSerialize(artifact)));
        }
    });
    it.each([
        ["version1", { recoveryFormatVersion: 1, before: null, after: {} }, "UNSUPPORTED"],
        ["future version", { recoveryFormatVersion: 3 }, "UNSUPPORTED"],
        ["invalid version", { recoveryFormatVersion: 0 }, "INVALID"],
        ["missing version", { artifactKind: "preparation" }, "INVALID"],
        ["wrong role", { recoveryFormatVersion: 2, artifactKind: "intent" }, "INVALID"],
        ["partial preparation", { recoveryFormatVersion: 2, artifactKind: "preparation" }, "INVALID"],
        ["partial receipt", { recoveryFormatVersion: 2, artifactKind: "receipt" }, "INVALID"],
        ["nonrecovery", { ordinary: true }, "UNRECOGNIZED"],
        ["nonobject", [], "INVALID"],
    ])("retains raw %s evidence with status %s", async (_name, artifact, status) => {
        const bytes = new TextEncoder().encode(JSON.stringify(artifact));
        const saved = Uint8Array.from(bytes);
        const result = await recognizeRecoveryV2ArtifactBytes(bytes, codecs);
        bytes.fill(0);
        expect(result.status).toBe(status);
        expect(result.bytes).toEqual(saved);
        expect(result.bytes).not.toBe(bytes);
        expect(result.reason).toBeTruthy();
    });
    it("retains malformed UTF-8/JSON and reports wrong-store/digest recognition failures", async () => {
        for (const bytes of [new Uint8Array([255]), new TextEncoder().encode("{")]) {
            const result = await recognizeRecoveryV2ArtifactBytes(bytes, codecs);
            expect(result.status).toBe("INVALID");
            expect(result.bytes).toEqual(bytes);
        }
        const prep = await preparation();
        const bytes = new TextEncoder().encode(canonicalSerialize(prep));
        expect(await recognizeRecoveryV2ArtifactBytes(bytes, codecs, id("store", 2))).toMatchObject({
            status: "INVALID",
        });
        prep.candidateDigest = digest(9);
        expect(
            await recognizeRecoveryV2ArtifactBytes(new TextEncoder().encode(canonicalSerialize(prep)), codecs)
        ).toMatchObject({ status: "INVALID" });
    });
});
