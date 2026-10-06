import { describe, expect, it, vi } from "vitest";
import { RepresentationCapabilityIssuer } from "../src/storage/RepresentationCapabilities";
import {
    isPositiveRepresentationListLimit,
    isPublicationArtifactRole,
    representationByteReadResult,
    representationReadFailure,
    validatePublicationCompletion,
} from "../src/storage/RepresentationStoragePort";
import { isPublicationId } from "../src/storage/identity";

function testSecureBytes() {
    let seed = 0;
    return (length) => new Uint8Array(length).fill(++seed);
}
function setup(provider = testSecureBytes(), name = "same diagnostic root") {
    const issuer = new RepresentationCapabilityIssuer(provider);
    const root = issuer.createRoot(name);
    const directory = issuer.directoryHandle(root, "records").value;
    const collection = issuer.bindPublicationCollection(directory, "canonical-revision").value;
    return { issuer, root, directory, collection };
}
function allocated(setup, collection = setup.collection) {
    const result = setup.issuer.allocatePublication(collection);
    expect(result.status).toBe("ALLOCATED");
    return result.allocation;
}
function invoked(setup, allocation = allocated(setup)) {
    const result = setup.issuer.consumePublication(allocation, setup.root);
    expect(result.status).toBe("CONSUMED");
    return { allocation, invocation: result.invocation };
}
const roles = [
    "namespace",
    "store-declaration",
    "canonical-revision",
    "recovery-preparation",
    "recovery-receipt",
    "protocol-fence",
    "representation-state",
];

describe("S1 D pure read handle correlation and result contracts", () => {
    it("equal diagnostic roots do not exchange context/root/directory/file capabilities", () => {
        const a = setup(),
            b = setup();
        const file = a.issuer.fileHandle(a.root, "records/revision.json").value;
        expect(a.root.rootIdentity).toBe(b.root.rootIdentity);
        expect(a.root.context).not.toBe(b.root.context);
        expect(b.issuer.acceptsRoot(a.root)).toBe(false);
        expect(b.issuer.acceptsDirectoryHandle(a.directory)).toBe(false);
        expect(b.issuer.acceptsFileHandle(file)).toBe(false);
        expect(b.issuer.directoryHandle(a.root, "records")).toMatchObject({
            ok: false,
            failure: { code: "CONFINEMENT" },
        });
        expect(b.issuer.fileHandle(a.root, "records/x")).toMatchObject({ ok: false, failure: { code: "CONFINEMENT" } });
    });
    it("directory/file handles are immutable role-distinct issued objects; copied fields cannot qualify", () => {
        const s = setup();
        const file = s.issuer.fileHandle(s.root, "records/same").value;
        const directory = s.issuer.directoryHandle(s.root, "records/same").value;
        expect(s.issuer.acceptsFileHandle(directory)).toBe(false);
        expect(s.issuer.acceptsDirectoryHandle(file)).toBe(false);
        for (const handle of [file, directory]) {
            expect(Object.isFrozen(handle)).toBe(true);
            expect(s.issuer.acceptsFileHandle({ ...handle })).toBe(false);
            expect(s.issuer.acceptsDirectoryHandle(JSON.parse(JSON.stringify(handle)))).toBe(false);
            expect(s.issuer.acceptsDirectoryHandle(Object.create(handle))).toBe(false);
        }
        expect(s.issuer.acceptsRoot({ ...s.root })).toBe(false);
    });
    it.each([
        "",
        "/absolute",
        "..",
        "../outside",
        "records/../outside",
        "records//x",
        "records/.",
        "records/",
        "records\\x",
        "records\0x",
    ])("rejects unsafe file locator %s", (locator) => {
        const s = setup();
        expect(s.issuer.fileHandle(s.root, locator)).toMatchObject({ ok: false, failure: { code: "INVALID_LOCATOR" } });
        if (locator !== "")
            expect(s.issuer.directoryHandle(s.root, locator)).toMatchObject({
                ok: false,
                failure: { code: "INVALID_LOCATOR" },
            });
    });
    it("issuer registry/state are runtime-private and context identity cannot be reassigned", () => {
        const s = setup();
        expect(Object.isFrozen(s.issuer)).toBe(true);
        for (const field of ["roots", "directories", "files", "collections", "allocations", "publicationIds", "closed"])
            expect(s.issuer).not.toHaveProperty(field);
        expect(() => {
            s.issuer.context = setup().issuer.context;
        }).toThrow();
        s.issuer.invalidateContext();
        expect(() => {
            s.issuer.closed = false;
        }).toThrow();
        expect(s.issuer.acceptsDirectoryHandle(s.directory)).toBe(false);
    });
    it("root directory is permitted without asserting existence; one context reads both registered roots", () => {
        const s = setup();
        const other = s.issuer.createRoot("other read root");
        const first = s.issuer.directoryHandle(s.root, "").value,
            second = s.issuer.directoryHandle(other, "").value;
        expect(s.issuer.acceptsDirectoryHandle(first)).toBe(true);
        expect(s.issuer.acceptsDirectoryHandle(second)).toBe(true);
        const a = allocated(s);
        s.issuer.retirePublication(a);
        expect(s.issuer.acceptsDirectoryHandle(second)).toBe(true);
        expect(first).not.toHaveProperty("exists");
        expect(first).not.toHaveProperty("storeId");
    });
    it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null, undefined])(
        "rejects invalid returned-list bound %s",
        (limit) => {
            const s = setup();
            expect(isPositiveRepresentationListLimit(limit)).toBe(false);
            expect(s.issuer.boundedListing(s.directory, [], limit, false)).toMatchObject({
                ok: false,
                failure: { code: "INVALID_LIMIT" },
            });
        }
    );
    it("positive list bound clips only owned immediate output and truthfully preserves truncation", () => {
        const s = setup();
        const files = ["z", "a", "b"].map((name) => ({
            name,
            kind: "file",
            handle: s.issuer.fileHandle(s.root, `records/${name}`).value,
        }));
        const result = s.issuer.boundedListing(s.directory, files, 2, false);
        expect(result.value.entries.map((row) => row.name)).toEqual(["z", "a"]);
        expect(result.value.truncated).toBe(true);
        expect(Object.isFrozen(result.value.entries)).toBe(true);
        expect(Object.isFrozen(result.value.entries[0])).toBe(true);
        files[0].name = "changed";
        files.pop();
        expect(result.value.entries[0].name).toBe("z");
        expect(s.issuer.boundedListing(s.directory, [], 1, true).value.truncated).toBe(true);
        expect(s.issuer.boundedListing(s.directory, [], 1, false).value.truncated).toBe(false);
        expect(isPositiveRepresentationListLimit(Number.MAX_SAFE_INTEGER)).toBe(true);
        // No native allocation/capacity/completeness/traversal promise is present.
        for (const field of ["capacity", "nativeAllocationBounded", "discoveryComplete", "cursor"])
            expect(result.value).not.toHaveProperty(field);
    });
    it("listing requires exact immediate child name/kind/root correlation", () => {
        const s = setup();
        const file = s.issuer.fileHandle(s.root, "records/a").value;
        const child = s.issuer.directoryHandle(s.root, "records/child").value;
        expect(
            s.issuer.boundedListing(s.directory, [{ name: "child", kind: "directory", handle: child }], 1, false).ok
        ).toBe(true);
        const otherRoot = s.issuer.createRoot(s.root.rootIdentity);
        for (const entries of [
            [{ name: "a", kind: "directory", handle: file }],
            [{ name: "a", kind: "file", handle: { ...file } }],
            [{ name: "a", kind: "file", handle: s.issuer.fileHandle(otherRoot, "records/a").value }],
            [{ name: "nested/a", kind: "file", handle: s.issuer.fileHandle(s.root, "records/nested/a").value }],
            [{ name: "a", kind: "file", handle: s.issuer.fileHandle(s.root, "different/a").value }],
            [
                { name: "a", kind: "file", handle: file },
                { name: "a", kind: "file", handle: file },
            ],
        ])
            expect(s.issuer.boundedListing(s.directory, entries, 10, false).ok).toBe(false);
    });
    it("read result owns complete arbitrary binary bytes; clipped reads and mutation failure codes cannot qualify", () => {
        const bytes = new Uint8Array([0, 255, 254, 13, 10, 128]);
        const result = representationByteReadResult(bytes, true);
        bytes.fill(1);
        expect(result.value).toEqual(new Uint8Array([0, 255, 254, 13, 10, 128]));
        expect(result.value).not.toBe(bytes);
        expect(representationByteReadResult(new Uint8Array([0, 255]), false)).toMatchObject({
            ok: false,
            failure: { code: "UNAVAILABLE" },
        });
        expect(representationByteReadResult([], true)).toMatchObject({ ok: false, failure: { code: "INVALID_INPUT" } });
        for (const code of ["NOT_FOUND", "UNAVAILABLE", "UNSUPPORTED", "CONFINEMENT"])
            expect(representationReadFailure(code, "fact").failure.code).toBe(code);
        for (const code of ["DIGEST_MISMATCH", "ALREADY_EXISTS", "APPLIED"])
            expect(() => representationReadFailure(code, "bad")).toThrow(/read failure/);
        expect(result).not.toHaveProperty("physicalEffect");
        expect(result).not.toHaveProperty("canonicalObservation");
    });
});

describe("S1 D publication collection/allocation capabilities without storage behavior", () => {
    it.each(roles)("binds only issued issuer/root/directory and planned role %s", (role) => {
        const s = setup();
        const collection = s.issuer.bindPublicationCollection(s.directory, role).value;
        expect(isPublicationArtifactRole(role)).toBe(true);
        expect(collection.context).toBe(s.issuer.context);
        expect(collection.root).toBe(s.root);
        expect(collection.directory).toBe(s.directory);
        expect(collection.role).toBe(role);
        expect(Object.isFrozen(collection)).toBe(true);
        for (const field of ["authorized", "storeId", "exists", "capacity", "lock"])
            expect(collection).not.toHaveProperty(field);
    });
    it.each(["migration", "backup", "snapshot", "future", "", null])("rejects speculative role %s", (role) => {
        const s = setup();
        expect(isPublicationArtifactRole(role)).toBe(false);
        expect(s.issuer.bindPublicationCollection(s.directory, role).ok).toBe(false);
    });
    it("cannot bind or allocate a copied/foreign collection or wrong directory kind", () => {
        const s = setup(),
            other = setup();
        const file = s.issuer.fileHandle(s.root, "records/a").value;
        for (const directory of [file, { ...s.directory }, other.directory])
            expect(s.issuer.bindPublicationCollection(directory, "namespace").ok).toBe(false);
        for (const collection of [{ ...s.collection }, JSON.parse(JSON.stringify(s.collection)), other.collection])
            expect(s.issuer.allocatePublication(collection)).toMatchObject({
                status: "REFUSED",
                reason: "INVALID_COLLECTION",
            });
    });
    it("allocates secure PublicationId leaf only, not caller destination or reservation", () => {
        const s = setup();
        const a = allocated(s),
            b = allocated(s);
        expect(isPublicationId(a.publicationId)).toBe(true);
        expect(a.publicationId).not.toBe(b.publicationId);
        expect(a.locator).toBe(`records/${a.publicationId}.json`);
        expect(a.role).toBe("canonical-revision");
        expect(a.collection).toBe(s.collection);
        expect(a.context).toBe(s.issuer.context);
        expect(a.root).toBe(s.root);
        expect(Object.isFrozen(a)).toBe(true);
        expect(Object.isFrozen(a.token)).toBe(true);
        expect(a.token).not.toBe(b.token);
        for (const field of ["reserved", "exclusive", "storeId", "revisionId", "mutationId", "durable"])
            expect(a).not.toHaveProperty(field);
        expect(s.issuer).not.toHaveProperty("publishFresh");
        expect(s.issuer).not.toHaveProperty("readBytes");
        expect(s.issuer).not.toHaveProperty("listChildren");
    });
    it("secure failure/malformed byte provider fail closed; same secure output cannot reuse retired ID", () => {
        for (const provider of [
            () => {
                throw new Error("secure failed");
            },
            () => new Uint8Array(15),
        ]) {
            const s = setup(provider);
            expect(s.issuer.allocatePublication(s.collection)).toMatchObject({
                status: "REFUSED",
                reason: "SECURE_RANDOM_UNAVAILABLE",
            });
        }
        const s = setup((n) => new Uint8Array(n));
        const a = allocated(s);
        s.issuer.retirePublication(a);
        expect(s.issuer.allocatePublication(s.collection)).toMatchObject({
            status: "REFUSED",
            reason: "PUBLICATION_ID_COLLISION",
        });
    });
    it("default secure source has no weak fallback when unavailable", () => {
        const production = new RepresentationCapabilityIssuer();
        const root = production.createRoot("diagnostic");
        const directory = production.directoryHandle(root, "").value;
        const collection = production.bindPublicationCollection(directory, "namespace").value;
        vi.stubGlobal("crypto", undefined);
        try {
            expect(production.allocatePublication(collection)).toMatchObject({
                status: "REFUSED",
                reason: "SECURE_RANDOM_UNAVAILABLE",
            });
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe("S1 D one-use local lifecycle and controlled effect construction", () => {
    it("consumption is synchronous before an await; concurrent calls cannot both invoke", async () => {
        const s = setup();
        const a = allocated(s);
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });
        async function holdInvocation() {
            const result = s.issuer.consumePublication(a, s.root);
            await gate;
            return result;
        }
        const first = holdInvocation();
        expect(s.issuer.allocationState(a)).toBe("INVOKED");
        const second = holdInvocation();
        expect(s.issuer.allocationState(a)).toBe("RETIRED");
        release();
        const [one, two] = await Promise.all([first, second]);
        expect(one.status).toBe("CONSUMED");
        expect(two).toMatchObject({
            status: "REFUSED",
            effect: { physicalEffect: "NO_MUTATION_DISPATCHED", reason: "RETIRED_ALLOCATION" },
        });
        expect(
            s.issuer.finishPublication(one.invocation, {
                physicalEffect: "NO_MUTATION_DISPATCHED",
                reason: "PREFLIGHT_UNAVAILABLE",
            }).physicalEffect
        ).toBe("NO_MUTATION_DISPATCHED");
    });
    it.each(["context", "root", "collection", "role"])(
        "wrong %s use refuses and burns the known legitimate token",
        (scope) => {
            const s = setup(),
                other = setup();
            const a = allocated(s);
            const targetRoot = scope === "root" ? s.issuer.createRoot(s.root.rootIdentity) : s.root;
            const differentCollection = s.issuer.bindPublicationCollection(s.directory, "recovery-receipt").value;
            const result =
                scope === "context"
                    ? other.issuer.consumePublication(a, other.root)
                    : s.issuer.consumePublication(
                          a,
                          targetRoot,
                          scope === "collection" ? differentCollection : undefined,
                          scope === "role" ? "recovery-receipt" : undefined
                      );
            expect(result).toMatchObject({
                status: "REFUSED",
                effect: {
                    physicalEffect: "NO_MUTATION_DISPATCHED",
                    reason: "CONFINEMENT",
                    binding: { publicationId: a.publicationId },
                },
            });
            expect(s.issuer.allocationState(a)).toBe("RETIRED");
            expect(s.issuer.consumePublication(a, s.root).status).toBe("REFUSED");
        }
    );
    it.each(["copy", "retarget", "copied-role", "copied-token-only"])(
        "%s cannot invoke and burns the retained real token reference",
        (kind) => {
            const s = setup();
            const a = allocated(s);
            const input =
                kind === "copy"
                    ? { ...a }
                    : kind === "retarget"
                      ? { ...a, locator: "other.json" }
                      : kind === "copied-role"
                        ? { ...a, role: "namespace" }
                        : a.token;
            const result = s.issuer.consumePublication(input, s.root);
            expect(result.effect.reason).toBe("INVALID_ALLOCATION");
            expect(result.effect.binding.locator).toBe(a.locator);
            expect(s.issuer.allocationState(a)).toBe("RETIRED");
        }
    );
    it("serialized/forged objects cannot fabricate capability or valid error binding", () => {
        const s = setup();
        const a = allocated(s);
        for (const input of [
            JSON.parse(JSON.stringify(a)),
            { publicationId: a.publicationId, locator: a.locator, token: {} },
            null,
            {},
            Object.create(a),
        ]) {
            const result = s.issuer.consumePublication(input, s.root);
            expect(result).toEqual({
                status: "REFUSED",
                effect: { physicalEffect: "NO_MUTATION_DISPATCHED", reason: "INVALID_ALLOCATION" },
            });
            expect(result.effect).not.toHaveProperty("binding");
        }
        expect(s.issuer.allocationState(a)).toBe("ALLOCATED");
        const getter = vi.fn(() => a.token);
        const input = Object.defineProperty({}, "token", { get: getter });
        expect(s.issuer.consumePublication(input, s.root).status).toBe("REFUSED");
        expect(getter).not.toHaveBeenCalled();
    });
    it("explicit retirement is idempotent and cannot cancel/restore an existing invocation", () => {
        const s = setup();
        const unused = allocated(s);
        s.issuer.retirePublication(unused);
        s.issuer.retirePublication(unused);
        expect(s.issuer.consumePublication(unused, s.root).effect.reason).toBe("RETIRED_ALLOCATION");
        const active = invoked(s);
        s.issuer.retirePublication(active.allocation);
        s.issuer.markDispatchStarted(active.invocation);
        const effect = s.issuer.finishPublication(active.invocation, {
            physicalEffect: "DISPATCH_OUTCOME_UNKNOWN",
            diagnostic: "caller reports uncertainty",
        });
        expect(effect.physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
        expect(s.issuer.allocationState(active.allocation)).toBe("RETIRED");
        expect(() =>
            s.issuer.finishPublication(active.invocation, { physicalEffect: "DISPATCH_REPORTED_SUCCESS" })
        ).toThrow(/completed/);
    });
    it.each(["OBSERVED_OCCUPANCY", "PREFLIGHT_UNAVAILABLE", "CONFINEMENT", "INVALID_ALLOCATION", "RETIRED_ALLOCATION"])(
        "controlled nondispatch reason %s retires without entering dispatch",
        (reason) => {
            const s = setup();
            const active = invoked(s);
            const effect = s.issuer.finishPublication(active.invocation, {
                physicalEffect: "NO_MUTATION_DISPATCHED",
                reason,
            });
            expect(effect).toMatchObject({
                physicalEffect: "NO_MUTATION_DISPATCHED",
                reason,
                binding: { publicationId: active.allocation.publicationId },
            });
            expect(s.issuer.allocationState(active.allocation)).toBe("RETIRED");
        }
    );
    it.each(["DISPATCH_REPORTED_SUCCESS", "DISPATCH_OUTCOME_UNKNOWN"])(
        "%s remains only a physical fact and requires entered boundary",
        (physicalEffect) => {
            const s = setup();
            const before = invoked(s);
            expect(() => s.issuer.finishPublication(before.invocation, { physicalEffect })).toThrow(
                /entered dispatch boundary/
            );
            expect(s.issuer.allocationState(before.allocation)).toBe("RETIRED");
            const active = invoked(s);
            s.issuer.markDispatchStarted(active.invocation);
            const effect = s.issuer.finishPublication(active.invocation, { physicalEffect });
            expect(effect.physicalEffect).toBe(physicalEffect);
            expect(Object.isFrozen(effect)).toBe(true);
            for (const field of [
                "ok",
                "canonicalObservation",
                "current",
                "healthy",
                "durable",
                "uniqueHead",
                "receipt",
            ])
                expect(effect).not.toHaveProperty(field);
        }
    );
    it("dispatch-entered state never permits definite nondispatch; no reused token or absence revival", () => {
        const s = setup();
        const active = invoked(s);
        s.issuer.markDispatchStarted(active.invocation);
        expect(() =>
            s.issuer.finishPublication(active.invocation, {
                physicalEffect: "NO_MUTATION_DISPATCHED",
                reason: "PREFLIGHT_UNAVAILABLE",
            })
        ).toThrow(/Cannot claim nondispatch/);
        expect(s.issuer.allocationState(active.allocation)).toBe("RETIRED");
        expect(s.issuer.consumePublication(active.allocation, s.root).status).toBe("REFUSED");
        expect(s.issuer.consumePublication({ ...active.allocation, absent: true }, s.root).status).toBe("REFUSED");
        const fresh = allocated(s);
        expect(fresh.publicationId).not.toBe(active.allocation.publicationId);
        expect(fresh.locator).not.toBe(active.allocation.locator);
    });
    it("restart invalidates old roots/handles/tokens instead of reconstructing persisted metadata", () => {
        const s = setup();
        const a = allocated(s);
        const active = invoked(s);
        s.issuer.invalidateContext();
        expect(s.issuer.acceptsRoot(s.root)).toBe(false);
        expect(s.issuer.acceptsDirectoryHandle(s.directory)).toBe(false);
        expect(s.issuer.allocationState(a)).toBe("RETIRED");
        expect(s.issuer.consumePublication(a, s.root).status).toBe("REFUSED");
        expect(() => s.issuer.markDispatchStarted(active.invocation)).toThrow(/inactive/);
        expect(() => s.issuer.createRoot("same")).toThrow(/invalidated/);
        const next = setup((n) => new Uint8Array(n).fill(99));
        expect(next.issuer.consumePublication(JSON.parse(JSON.stringify(a)), next.root).effect).not.toHaveProperty(
            "binding"
        );
        expect(allocated(next).publicationId).not.toBe(a.publicationId);
    });
    it("invalidating context forbids new dispatch but preserves completion of an entered invocation", () => {
        const s = setup();
        const active = invoked(s);
        s.issuer.markDispatchStarted(active.invocation);
        s.issuer.invalidateContext();
        expect(() => s.issuer.markDispatchStarted(active.invocation)).toThrow(/inactive/);
        const effect = s.issuer.finishPublication(active.invocation, {
            physicalEffect: "DISPATCH_OUTCOME_UNKNOWN",
        });
        expect(effect).toMatchObject({
            physicalEffect: "DISPATCH_OUTCOME_UNKNOWN",
            binding: { publicationId: active.allocation.publicationId },
        });
        expect(s.issuer.allocationState(active.allocation)).toBe("RETIRED");
        expect(() =>
            s.issuer.finishPublication(active.invocation, {
                physicalEffect: "DISPATCH_REPORTED_SUCCESS",
            })
        ).toThrow(/completed/);
    });

    it.each(["APPLIED", "VERIFIED_APPLIED", "HOST_COMPLETED"])("rejects unsupported effect %s", (physicalEffect) => {
        expect(() => validatePublicationCompletion({ physicalEffect })).toThrow(/physicalEffect/);
    });
    it.each(["canonicalObservation", "healthy", "durable", "receipt", "role", "binding"])(
        "completion cannot smuggle %s",
        (field) => {
            const s = setup();
            const active = invoked(s);
            s.issuer.markDispatchStarted(active.invocation);
            expect(() =>
                s.issuer.finishPublication(active.invocation, {
                    physicalEffect: "DISPATCH_REPORTED_SUCCESS",
                    [field]: true,
                })
            ).toThrow(/field/);
            expect(s.issuer.allocationState(active.allocation)).toBe("RETIRED");
        }
    );
    it("completion requires explicit own facts and never invokes accessor claims", () => {
        expect(() => validatePublicationCompletion({ physicalEffect: "NO_MUTATION_DISPATCHED" })).toThrow(/reason/);
        expect(() =>
            validatePublicationCompletion(
                Object.assign(Object.create({ reason: "OBSERVED_OCCUPANCY" }), {
                    physicalEffect: "NO_MUTATION_DISPATCHED",
                })
            )
        ).toThrow(/own controlled/);
        const getter = vi.fn(() => "DISPATCH_REPORTED_SUCCESS");
        expect(() =>
            validatePublicationCompletion(
                Object.defineProperty({}, "physicalEffect", { get: getter, enumerable: true })
            )
        ).toThrow();
        expect(getter).not.toHaveBeenCalled();
        expect(() =>
            validatePublicationCompletion({ physicalEffect: "DISPATCH_OUTCOME_UNKNOWN", diagnostic: 12 })
        ).toThrow(/diagnostic/);
    });
    it("forged/copied invocation cannot mark a dispatch or construct reported-success", () => {
        const s = setup();
        const active = invoked(s);
        for (const input of [{ ...active.invocation }, JSON.parse(JSON.stringify(active.invocation)), {}]) {
            expect(() => s.issuer.markDispatchStarted(input)).toThrow(/Unknown/);
            expect(() => s.issuer.finishPublication(input, { physicalEffect: "DISPATCH_REPORTED_SUCCESS" })).toThrow(
                /Unknown/
            );
        }
        s.issuer.markDispatchStarted(active.invocation);
        expect(() => s.issuer.markDispatchStarted(active.invocation)).toThrow(/only once/);
        s.issuer.finishPublication(active.invocation, { physicalEffect: "DISPATCH_OUTCOME_UNKNOWN" });
    });
});
