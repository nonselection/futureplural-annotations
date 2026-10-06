import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import * as identity from "../src/storage/identity";
import {
    assessStoreDeclarationSupport,
    AuthorityArtifactError,
    compareStoreDeclarations,
    createNamespaceArtifact,
    decodeNamespaceArtifact,
    decodeProtocolFenceArtifact,
    decodeRepresentationStateArtifact,
    decodeStoreArtifact,
    decodeStoreDeclaration,
    encodeNamespaceArtifact,
    encodeProtocolFenceArtifact,
    encodeRepresentationStateArtifact,
    encodeStoreArtifact,
    encodeStoreDeclaration,
    NAMESPACE_MARKER_VERSION,
    PROTOCOL_FENCE_ARTIFACT_VERSION,
    REPRESENTATION_STATE_ARTIFACT_VERSION,
    representationStateArtifactDigest,
    STORE_DECLARATION_VERSION,
    storeDeclarationDigest,
    storeDeclarationsEquivalent,
    validateStoreDeclaration,
} from "../src/storage/authorityArtifacts";
import { artifactDigest, canonicalDigest, isArtifactDigest, isCanonicalDigest } from "../src/storage/canonicalEncoding";
import {
    canonicalRevisionDigest,
    decodeCanonicalRevisionEnvelope,
    encodeCanonicalRevisionEnvelope,
    STORAGE_ENVELOPE_VERSION,
} from "../src/storage/envelopes";
import { REQUIRED_PROTOCOL_VERSION } from "../src/storage/protocol";
import { createAnnotationId, isAnnotationId } from "../src/models/annotation";
import { createSourceRecordId, isSourceRecordId } from "../src/models/canonical";

const uuid = "00000000-0000-4000-8000-000000000000";
const storeId = `fk-store-${uuid}`;
const bootstrapId = `fk-bootstrap-${uuid}`;
const representationStateId = `fk-representation-state-${uuid}`;
const revisionId = `fk-revision-${uuid}`;
const otherUuid = "11111111-1111-4111-9111-111111111111";
const roles = [
    ["Store", "fk-store-"],
    ["Revision", "fk-revision-"],
    ["Mutation", "fk-mutation-"],
    ["Migration", "fk-migration-"],
    ["RepresentationState", "fk-representation-state-"],
    ["Publication", "fk-publication-"],
    ["Bootstrap", "fk-bootstrap-"],
];

function declaration(overrides = {}) {
    return {
        schema: "finders-keepers.store",
        version: 2,
        storeId,
        bootstrapId,
        initialRepresentation: "hidden",
        genesisRepresentationStateId: representationStateId,
        requiredProtocolVersion: 2,
        storageEnvelopeVersion: 1,
        recoveryFormatVersion: 2,
        ...overrides,
    };
}

function expectCategory(action, category, message) {
    expect(action).toThrow(message);
    try {
        action();
    } catch (error) {
        expect(error).toBeInstanceOf(AuthorityArtifactError);
        expect(error.category).toBe(category);
    }
}

const codec = {
    recordKind: "test.annotation",
    schemaVersion: 1,
    isRecordId: (value) => value === "test-annotation-a1",
    validatePayload: (value) => value,
};
function envelope(overrides = {}) {
    return {
        storageEnvelopeVersion: 1,
        schemaVersion: 1,
        storeId,
        recordKind: "test.annotation",
        recordId: "test-annotation-a1",
        revisionId,
        parentRevisionId: null,
        resolvedRevisionIds: [],
        state: "active",
        payload: { quote: "selected text", nested: { second: 2, first: 1 } },
        ...overrides,
    };
}
function independentDigest(raw) {
    return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

describe("Storage S1 Batch A seven storage identity roles", () => {
    it.each(roles)("allocates %s with UUID4 masks and leaves supplied bytes untouched", (role, prefix) => {
        const bytes = new Uint8Array(16).fill(255);
        const provider = vi.fn(() => bytes);
        const id = identity[`create${role}Id`](provider);
        expect(id).toBe(`${prefix}ffffffff-ffff-4fff-bfff-ffffffffffff`);
        expect(identity[`is${role}Id`](id)).toBe(true);
        expect(provider).toHaveBeenCalledExactlyOnceWith(16);
        expect([...bytes]).toEqual(new Array(16).fill(255));
        expect(identity[`is${role}Id`](identity[`create${role}Id`]())).toBe(true);
    });

    it.each(roles)("guards %s against every wrong role and malformed UUID/version/variant", (role, prefix) => {
        const guard = identity[`is${role}Id`];
        for (const [otherRole, otherPrefix] of roles) {
            expect(guard(`${otherPrefix}${uuid}`)).toBe(otherRole === role);
        }
        expect(guard(`${prefix}${uuid}`.toUpperCase())).toBe(true);
        for (const value of [
            null,
            undefined,
            2,
            {},
            [],
            "",
            prefix + uuid + "x",
            "x" + prefix + uuid,
            prefix + uuid.replace("4000", "1000"),
            prefix + uuid.replace("8000", "7000"),
            prefix + uuid.replace("00000000", "g0000000"),
            prefix + uuid.replaceAll("-", ""),
        ]) {
            expect(guard(value)).toBe(false);
        }
        expect(guard(createSourceRecordId())).toBe(false);
        expect(guard(createAnnotationId())).toBe(false);
        expect(isSourceRecordId(`${prefix}${uuid}`)).toBe(false);
        expect(isAnnotationId(`${prefix}${uuid}`)).toBe(false);
    });

    it.each(roles)("fails %s allocation without weak fallback on missing/throwing/invalid secure bytes", (role) => {
        const factory = identity[`create${role}Id`];
        const random = vi.spyOn(Math, "random").mockImplementation(() => {
            throw new Error("weak random used");
        });
        const date = vi.spyOn(Date, "now").mockImplementation(() => {
            throw new Error("clock used");
        });
        try {
            for (const crypto of [
                undefined,
                {},
                {
                    getRandomValues: () => {
                        throw new Error("secure failure");
                    },
                },
            ]) {
                vi.stubGlobal("crypto", crypto);
                expect(() => factory()).toThrow(/secure|Cryptographically/);
            }
            expect(() =>
                factory(() => {
                    throw new Error("provider failure");
                })
            ).toThrow(/provider failure/);
            for (const output of [new Uint8Array(15), new Uint8Array(17), [], null]) {
                expect(() => factory(() => output)).toThrow(/exactly 16 bytes/);
            }
            expect(random).not.toHaveBeenCalled();
            expect(date).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
            random.mockRestore();
            date.mockRestore();
        }
    });

    it("preserves validated imported IDs without allocation and retains domain grammars", () => {
        const imported = declaration({
            storeId: storeId.toUpperCase(),
            bootstrapId: bootstrapId.toUpperCase(),
            genesisRepresentationStateId: representationStateId.toUpperCase(),
        });
        vi.stubGlobal("crypto", undefined);
        try {
            expect(decodeStoreDeclaration(encodeStoreDeclaration(imported))).toEqual(imported);
            expect(
                decodeCanonicalRevisionEnvelope(encodeCanonicalRevisionEnvelope(envelope(), [codec]), [codec])
            ).toEqual(envelope());
            expect(isAnnotationId("fp-external-legacy-id")).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("Storage S1 Batch A strict StoreDeclarationV2", () => {
    it("round-trips complete hidden/visible plans and validates expected StoreId", () => {
        for (const initialRepresentation of ["hidden", "visible"]) {
            const plan = declaration({ initialRepresentation });
            expect(decodeStoreDeclaration(encodeStoreDeclaration(plan), storeId)).toEqual(plan);
            expect(validateStoreDeclaration(plan, storeId)).toEqual(plan);
        }
        expectCategory(
            () => decodeStoreDeclaration(encodeStoreDeclaration(declaration()), `fk-store-${otherUuid}`),
            "invalid",
            /does not match/
        );
    });

    it.each(Object.keys(declaration()))("requires %s", (field) => {
        const plan = declaration();
        delete plan[field];
        expectCategory(() => decodeStoreDeclaration(JSON.stringify(plan)), "invalid", new RegExp(`Missing ${field}`));
    });

    it.each(["path", "filename", "mtime", "publicationId", "activeStoreId", "unexpected"])(
        "rejects extra %s instead of interpreting physical metadata",
        (field) => {
            expectCategory(
                () => validateStoreDeclaration(declaration({ [field]: "value" })),
                "invalid",
                /Unknown authority artifact field/
            );
        }
    );

    it.each(["storeId", "bootstrapId", "genesisRepresentationStateId"])(
        "rejects every wrong storage/domain role in %s",
        (field) => {
            const ownRole = {
                storeId: "Store",
                bootstrapId: "Bootstrap",
                genesisRepresentationStateId: "RepresentationState",
            }[field];
            for (const [role, prefix] of roles) {
                if (role !== ownRole)
                    expect(() => validateStoreDeclaration(declaration({ [field]: `${prefix}${uuid}` }))).toThrow(
                        /Invalid/
                    );
            }
            for (const value of [null, "malformed", createSourceRecordId(), createAnnotationId()]) {
                expect(() => validateStoreDeclaration(declaration({ [field]: value }))).toThrow(/Invalid/);
            }
        }
    );

    it.each([
        ["schema", "unknown", "unsupported"],
        ["schema", null, "unsupported"],
        ["initialRepresentation", "preferred", "invalid"],
        ["initialRepresentation", null, "invalid"],
        ...["version", "requiredProtocolVersion", "storageEnvelopeVersion", "recoveryFormatVersion"].flatMap((field) =>
            [0, -1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1].map((value) => [field, value, "invalid"])
        ),
        ["version", 1, "unsupported"],
        ["version", 3, "unsupported"],
        ["requiredProtocolVersion", 1, "unsupported"],
        ["storageEnvelopeVersion", 2, "unsupported"],
        ["recoveryFormatVersion", 1, "unsupported"],
        ["recoveryFormatVersion", 3, "unsupported"],
    ])("rejects %s=%s as %s", (field, value, category) => {
        expectCategory(() => validateStoreDeclaration(declaration({ [field]: value })), category, /./);
    });

    it.each([null, [], 2, "plan"])("rejects non-object %s", (value) => {
        expectCategory(() => validateStoreDeclaration(value), "invalid", /must be an object/);
    });

    it("rejects malformed JSON, accessors and hidden/symbol fields", () => {
        expectCategory(() => decodeStoreDeclaration("{"), "invalid", /malformed JSON/);
        expect(() => validateStoreDeclaration({ ...declaration(), [Symbol("hidden")]: true })).toThrow(/symbol/);
        expect(() => validateStoreDeclaration(Object.defineProperty(declaration(), "hidden", { value: true }))).toThrow(
            /non-enumerable/
        );
        const getter = vi.fn(() => bootstrapId);
        expect(() =>
            validateStoreDeclaration(
                Object.defineProperty(declaration(), "bootstrapId", { get: getter, enumerable: true })
            )
        ).toThrow(/accessor/);
        expect(getter).not.toHaveBeenCalled();
    });

    it("recognizes legacy/future store formats before demanding v2 plan fields", () => {
        for (const version of [1, 3]) {
            expectCategory(
                () => decodeStoreDeclaration(JSON.stringify({ schema: "finders-keepers.store", version, storeId })),
                "unsupported",
                /Unsupported store declaration version/
            );
        }
    });

    it("separates structural decoding from support and preserves higher-protocol evidence", () => {
        const supported = assessStoreDeclarationSupport(decodeStoreDeclaration(encodeStoreDeclaration(declaration())));
        expect(supported.status).toBe("SUPPORTED");
        expect(supported.declaration.requiredProtocolVersion).toBe(2);
        for (const requiredProtocolVersion of [3, Number.MAX_SAFE_INTEGER]) {
            const raw = encodeStoreDeclaration(declaration({ requiredProtocolVersion }));
            const decoded = decodeStoreDeclaration(raw);
            expect(decoded.requiredProtocolVersion).toBe(requiredProtocolVersion);
            expect(encodeStoreDeclaration(decoded)).toBe(raw);
            const assessment = assessStoreDeclarationSupport(decoded);
            expect(assessment.status).toBe("UNSUPPORTED_REQUIRED_PROTOCOL");
            expect(assessment.declaration).toEqual(decoded);
            expect(assessment.declaration.requiredProtocolVersion).toBe(requiredProtocolVersion);
        }
        expectCategory(
            () => assessStoreDeclarationSupport(declaration({ requiredProtocolVersion: 1 })),
            "unsupported",
            /Legacy required protocol/
        );
        const original = declaration();
        const assessment = assessStoreDeclarationSupport(original);
        original.requiredProtocolVersion = 3;
        expect(assessment.declaration.requiredProtocolVersion).toBe(2);
        expect(Object.isFrozen(assessment.declaration)).toBe(true);
    });

    it("compares exact complete copies independent of property ordering or supported status", async () => {
        const original = declaration();
        const copy = Object.fromEntries(Object.entries(original).reverse());
        expect(compareStoreDeclarations(original, copy)).toBe("EQUIVALENT");
        expect(storeDeclarationsEquivalent(original, copy)).toBe(true);
        expect(await storeDeclarationDigest(original)).toBe(await storeDeclarationDigest(copy));
        const higher = declaration({ requiredProtocolVersion: 3 });
        expect(compareStoreDeclarations(higher, { ...higher })).toBe("EQUIVALENT");
        expect(assessStoreDeclarationSupport(higher).status).toBe("UNSUPPORTED_REQUIRED_PROTOCOL");
    });

    it.each([
        ["bootstrapId", `fk-bootstrap-${otherUuid}`],
        ["initialRepresentation", "visible"],
        ["genesisRepresentationStateId", `fk-representation-state-${otherUuid}`],
        ["requiredProtocolVersion", 3],
    ])("detects same-store conflicting %s in both orders", async (field, value) => {
        const original = declaration();
        const changed = declaration({ [field]: value });
        expect(compareStoreDeclarations(original, changed)).toBe("CONFLICTING_PLAN");
        expect(compareStoreDeclarations(changed, original)).toBe("CONFLICTING_PLAN");
        expect(storeDeclarationsEquivalent(original, changed)).toBe(false);
        expect(await storeDeclarationDigest(original)).not.toBe(await storeDeclarationDigest(changed));
    });

    it.each([
        ["storageEnvelopeVersion", 2],
        ["recoveryFormatVersion", 1],
        ["version", 1],
    ])("refuses incompatible %s before equivalence/support can legitimize it", (field, value) => {
        const changed = declaration({ [field]: value });
        expectCategory(() => compareStoreDeclarations(declaration(), changed), "unsupported", /Unsupported/);
        expectCategory(() => assessStoreDeclarationSupport(changed), "unsupported", /Unsupported/);
    });

    it("classifies different StoreIds as distinct stores rather than competing same-store plans", async () => {
        const changed = declaration({ storeId: `fk-store-${otherUuid}`, bootstrapId: `fk-bootstrap-${otherUuid}` });
        expect(compareStoreDeclarations(declaration(), changed)).toBe("DISTINCT_STORE");
        expect(compareStoreDeclarations(changed, declaration())).toBe("DISTINCT_STORE");
        expect(storeDeclarationsEquivalent(declaration(), changed)).toBe(false);
        expect(await storeDeclarationDigest(declaration())).not.toBe(await storeDeclarationDigest(changed));
    });
});

describe("Storage S1 Batch A digest and version isolation", () => {
    it("uses separate digest roles with the same SHA-256 grammar and algorithm", async () => {
        const value = { z: 2, a: 1 };
        const expected = independentDigest('{"a":1,"z":2}');
        expect(await artifactDigest(value)).toBe(expected);
        expect(await canonicalDigest(value)).toBe(expected);
        expect(isArtifactDigest(expected)).toBe(true);
        expect(isCanonicalDigest(expected)).toBe(true);
        for (const value of [null, 2, `sha256:${"A".repeat(64)}`, `sha256:${"0".repeat(63)}`, "sha1:0000"]) {
            expect(isArtifactDigest(value)).toBe(false);
            expect(isCanonicalDigest(value)).toBe(false);
        }
        expect(await storeDeclarationDigest(declaration())).toBe(
            independentDigest(encodeStoreDeclaration(declaration()))
        );
    });

    it("preserves envelope1 complete canonical bytes/digest and missing-resolution normalization", async () => {
        const golden = `{"parentRevisionId":null,"payload":{"nested":{"first":1,"second":2},"quote":"selected text"},"recordId":"test-annotation-a1","recordKind":"test.annotation","resolvedRevisionIds":[],"revisionId":"${revisionId}","schemaVersion":1,"state":"active","storageEnvelopeVersion":1,"storeId":"${storeId}"}`;
        expect(encodeCanonicalRevisionEnvelope(envelope(), [codec])).toBe(golden);
        const missing = envelope();
        delete missing.resolvedRevisionIds;
        const normalized = decodeCanonicalRevisionEnvelope(JSON.stringify(missing), [codec]);
        expect(encodeCanonicalRevisionEnvelope(normalized, [codec])).toBe(golden);
        expect(await canonicalRevisionDigest(normalized)).toBe(independentDigest(golden));
        for (const changed of [
            envelope({ state: "deleted" }),
            envelope({ payload: { changed: true } }),
            envelope({ parentRevisionId: `fk-revision-${otherUuid}` }),
        ]) {
            expect(await canonicalRevisionDigest(changed)).not.toBe(await canonicalRevisionDigest(normalized));
        }
    });

    it("rejects self-resolution independently of self-parent and sorted/unique/cardinality checks", () => {
        const resolvedRevisionIds = [revisionId, `fk-revision-${otherUuid}`].sort();
        const invalid = envelope({ resolvedRevisionIds });
        expect(() => encodeCanonicalRevisionEnvelope(invalid, [codec])).toThrow(/cannot resolve itself/);
        expect(() => decodeCanonicalRevisionEnvelope(JSON.stringify(invalid), [codec])).toThrow(
            /cannot resolve itself/
        );
        expect(() => encodeCanonicalRevisionEnvelope(envelope({ parentRevisionId: revisionId }), [codec])).toThrow(
            /own parent/
        );
        const valid = envelope({
            revisionId: "fk-revision-22222222-2222-4222-a222-222222222222",
            parentRevisionId: revisionId,
            resolvedRevisionIds,
        });
        expect(decodeCanonicalRevisionEnvelope(encodeCanonicalRevisionEnvelope(valid, [codec]), [codec])).toEqual(
            valid
        );
    });

    it("keeps namespace1/declaration2/fence1/representation1 isolated, including fence1 requiring protocol2", async () => {
        expect(REQUIRED_PROTOCOL_VERSION).toBe(2);
        expect(STORAGE_ENVELOPE_VERSION).toBe(1);
        expect(NAMESPACE_MARKER_VERSION).toBe(1);
        expect(STORE_DECLARATION_VERSION).toBe(2);
        expect(PROTOCOL_FENCE_ARTIFACT_VERSION).toBe(1);
        expect(REPRESENTATION_STATE_ARTIFACT_VERSION).toBe(1);
        const namespaceGolden = '{"schema":"finders-keepers.namespace","version":1}';
        expect(encodeNamespaceArtifact(createNamespaceArtifact())).toBe(namespaceGolden);
        expect(decodeNamespaceArtifact(namespaceGolden)).toEqual({ schema: "finders-keepers.namespace", version: 1 });
        const fence = { schema: "finders-keepers.protocol-fence", version: 1, storeId, requiredProtocolVersion: 2 };
        const fenceGolden = `{"requiredProtocolVersion":2,"schema":"finders-keepers.protocol-fence","storeId":"${storeId}","version":1}`;
        expect(encodeProtocolFenceArtifact(fence)).toBe(fenceGolden);
        expect(decodeProtocolFenceArtifact(fenceGolden, storeId)).toEqual(fence);
        const representation = {
            schema: "finders-keepers.representation-state",
            version: 1,
            storeId,
            representationStateId,
            parentRepresentationStateId: null,
            representation: "hidden",
            establishedByMigrationId: null,
        };
        const representationGolden = `{"establishedByMigrationId":null,"parentRepresentationStateId":null,"representation":"hidden","representationStateId":"${representationStateId}","schema":"finders-keepers.representation-state","storeId":"${storeId}","version":1}`;
        expect(encodeRepresentationStateArtifact(representation)).toBe(representationGolden);
        expect(decodeRepresentationStateArtifact(representationGolden, storeId)).toEqual(representation);
        expect(await representationStateArtifactDigest(representation)).toBe(independentDigest(representationGolden));
        for (const [decode, value] of [
            [decodeNamespaceArtifact, createNamespaceArtifact()],
            [decodeProtocolFenceArtifact, fence],
            [decodeRepresentationStateArtifact, representation],
        ]) {
            expectCategory(() => decode(JSON.stringify({ ...value, version: 2 })), "unsupported", /Unsupported/);
        }
        expect(decodeStoreDeclaration(encodeStoreDeclaration(declaration())).version).toBe(2);
        expect(() => validateStoreDeclaration({ ...declaration(), ...createNamespaceArtifact() })).toThrow(/schema/);
    });

    it("preserves exact legacy Store1 diagnostic codec without promotion to supported protocol2", () => {
        const legacy = { schema: "finders-keepers.store", version: 1, storeId };
        const golden = `{"schema":"finders-keepers.store","storeId":"${storeId}","version":1}`;
        expect(encodeStoreArtifact(legacy)).toBe(golden);
        expect(decodeStoreArtifact(golden, storeId)).toEqual(legacy);
        expectCategory(() => decodeStoreArtifact(golden, `fk-store-${otherUuid}`), "invalid", /does not match/);
        expectCategory(() => decodeStoreDeclaration(golden), "unsupported", /Unsupported store declaration version/);
        expectCategory(
            () => assessStoreDeclarationSupport(legacy),
            "unsupported",
            /Unsupported store declaration version/
        );
        expect(() => decodeStoreArtifact(encodeStoreDeclaration(declaration()))).toThrow();
    });
});
