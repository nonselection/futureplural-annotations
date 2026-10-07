import { describe, it, expect } from "vitest";
import { fixture } from "./helpers/storageS3BootstrapFixtures";
import { sha256Bytes } from "../src/storage/canonicalEncoding";
import { storageFailure, storageSuccess } from "../src/storage/RepresentationStoragePort";
import { fakeObsidianStorageHost, fakeLocalCoordinator } from "./helpers/fakeObsidianStorageHost";

const encoder = new TextEncoder();
const bytes = (value) => encoder.encode(value);
const text = (value) => new TextDecoder("utf-8", { ignoreBOM: true }).decode(value);
const mismatch = Symbol("private pre-dispatch rejection");
const unsupported = Symbol("lossy text path");
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
function losslessText(value) {
    let decoded;
    try {
        decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(value);
    } catch {
        throw unsupported;
    }
    if (!equal(encoder.encode(decoded), value)) throw unsupported;
    return decoded;
}

// REJECTED algorithm candidates, never exported as a conforming port. Success
// here means only that the host calls finished: the counterexamples show why
// these wrappers cannot advertise frozen immutable/rename/delete guarantees.
async function checkedCreate(host, coordinate, path, value) {
    return coordinate(async () => {
        try {
            if (await host.adapter.stat(path))
                return storageFailure("ALREADY_EXISTS", "Observed occupancy before dispatch");
            await host.vault.createBinary(path, Uint8Array.from(value).buffer);
            const actual = new Uint8Array(await host.adapter.readBinary(path));
            return equal(actual, value)
                ? storageSuccess(undefined)
                : storageFailure("IO_ERROR", "Exact create not established");
        } catch {
            return storageFailure("IO_ERROR", "Create may have applied; host failure is not proof of rejection");
        }
    });
}
async function checkedDestructive(host, coordinate, method, path, expected, destination) {
    return coordinate(async () => {
        try {
            const raw = new Uint8Array(await host.adapter.readBinary(path));
            if ((await sha256Bytes(raw)) !== expected)
                return storageFailure("DIGEST_MISMATCH", "Observed stale bytes before dispatch");
            if (method === "rename" && (await host.adapter.stat(destination)))
                return storageFailure("ALREADY_EXISTS", "Observed destination before dispatch");
            if (method === "rename") await host.adapter.rename(path, destination);
            else await host.adapter.remove(path);
            return storageSuccess(undefined);
        } catch {
            return storageFailure("IO_ERROR", "Destructive application uncertain");
        }
    });
}
async function checkedProcess(host, coordinate, path, value, expected) {
    if (expected === null) return checkedCreate(host, coordinate, path, value);
    return coordinate(async () => {
        try {
            const raw = new Uint8Array(await host.adapter.readBinary(path));
            if ((await sha256Bytes(raw)) !== expected) return storageFailure("DIGEST_MISMATCH", "Stale raw preimage");
            const preimage = losslessText(raw);
            const candidate = losslessText(value);
            await host.adapter.process(path, (current) => {
                // No asynchronous hashing in the synchronous host callback.
                if (current !== preimage || !equal(encoder.encode(current), raw)) throw mismatch;
                return candidate;
            });
            const actual = new Uint8Array(await host.adapter.readBinary(path));
            return equal(actual, value)
                ? storageSuccess(undefined)
                : storageFailure("IO_ERROR", "Exact application not established");
        } catch (error) {
            if (error === mismatch)
                return storageFailure("DIGEST_MISMATCH", "Exact process preimage rejected before mutation");
            if (error === unsupported) return storageFailure("UNSUPPORTED", "Text mutation would change raw bytes");
            return storageFailure("IO_ERROR", "Process/readback may have failed after application");
        }
    });
}
const mutationEvents = (host) =>
    host.events.filter((event) => ["writeBinary", "process-write", "rename", "remove", "copy"].includes(event.method));

describe("Storage S4 Batch A — physical-operation feasibility (not adapter conformance)", () => {
    it.each(["equivalent file", "conflicting file", "directory"])(
        "observed %s occupancy is refused before create dispatch",
        async (kind) => {
            const host = fakeObsidianStorageHost();
            if (kind !== "directory")
                host.directSet("record.json", bytes(kind === "equivalent file" ? "candidate" : "existing"));
            else host.folders.add("record.json");
            expect(await checkedCreate(host, fakeLocalCoordinator(), "record.json", bytes("candidate"))).toMatchObject({
                ok: false,
                failure: { code: "ALREADY_EXISTS" },
            });
            expect(mutationEvents(host)).toEqual([]);
        }
    );
    it("COUNTEREXAMPLE: direct creation after exists(false) is overwritten by Vault.createBinary", async () => {
        const host = fakeObsidianStorageHost();
        host.at("after-exists", (path) => host.directSet(path, bytes("external existing")));
        const result = await checkedCreate(host, fakeLocalCoordinator(), "record.json", bytes("FK candidate"));
        expect(result.ok).toBe(true); // Exactly why this candidate is rejected.
        expect(text(host.inspect("record.json"))).toBe("FK candidate");
        expect(mutationEvents(host).map((event) => event.method)).toEqual(["writeBinary"]);
    });
    it("same shared coordinator serializes FK creates but is not a universal lock", async () => {
        const host = fakeObsidianStorageHost();
        const coordinate = fakeLocalCoordinator();
        const results = await Promise.all([
            checkedCreate(host, coordinate, "record.json", bytes("A")),
            checkedCreate(host, coordinate, "record.json", bytes("B")),
        ]);
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok && result.failure.code === "ALREADY_EXISTS")).toHaveLength(1);
    });
    it("independent FK coordinators do not make host publication exclusive", async () => {
        const host = fakeObsidianStorageHost();
        const results = await Promise.all([
            checkedCreate(host, fakeLocalCoordinator(), "record.json", bytes("A")),
            checkedCreate(host, fakeLocalCoordinator(), "record.json", bytes("B")),
        ]);
        expect(mutationEvents(host).filter((event) => event.method === "writeBinary")).toHaveLength(2);
        expect(results.some((result) => result.ok)).toBe(true);
    });
    it("exists false and a missing cached TFile do not establish accessible physical absence", async () => {
        const host = fakeObsidianStorageHost();
        host.directSet("record.json", bytes("inaccessible existing"));
        host.blockedReads.add("record.json");
        expect(await host.adapter.exists("record.json")).toBe(false);
        expect(host.vault.getAbstractFileByPath("record.json")).toBeNull();
        expect(await checkedCreate(host, fakeLocalCoordinator(), "record.json", bytes("candidate"))).toMatchObject({
            ok: false,
            failure: { code: "IO_ERROR" },
        });
        expect(mutationEvents(host)).toEqual([]);
        expect(text(host.inspect("record.json"))).toBe("inaccessible existing");
    });
    it.each(["before-write", "after-write", "unavailable-readback"])(
        "create %s failure cannot be upgraded to a collision",
        async (stage) => {
            const host = fakeObsidianStorageHost();
            if (stage === "unavailable-readback") host.at("after-write", (path) => host.blockedReads.add(path));
            else
                host.at(stage, () => {
                    throw new Error("File already exists.");
                });
            expect(await checkedCreate(host, fakeLocalCoordinator(), "record.json", bytes("candidate"))).toMatchObject({
                ok: false,
                failure: { code: "IO_ERROR" },
            });
            expect(host.inspect("record.json") !== undefined).toBe(stage !== "before-write");
        }
    );
    it.each(["rename", "delete"])("stale %s source is rejected with bytes preserved", async (method) => {
        const host = fakeObsidianStorageHost();
        host.directSet("record.json", bytes("new"));
        expect(
            await checkedDestructive(
                host,
                fakeLocalCoordinator(),
                method,
                "record.json",
                await sha256Bytes(bytes("old")),
                "target.json"
            )
        ).toMatchObject({ ok: false, failure: { code: "DIGEST_MISMATCH" } });
        expect(text(host.inspect("record.json"))).toBe("new");
        expect(mutationEvents(host)).toEqual([]);
    });
    it.each(["rename", "delete"])(
        "COUNTEREXAMPLE: changed bytes in guard-to-%s gap are destructively dispatched",
        async (method) => {
            const host = fakeObsidianStorageHost();
            host.directSet("record.json", bytes("base"));
            host.at(method === "rename" ? "before-rename" : "before-remove", (path) =>
                host.directSet(path, bytes("external new"))
            );
            const result = await checkedDestructive(
                host,
                fakeLocalCoordinator(),
                method,
                "record.json",
                await sha256Bytes(bytes("base")),
                "target.json"
            );
            expect(result.ok).toBe(true); // No late DIGEST_MISMATCH can preserve this source.
            expect(host.inspect("record.json")).toBeUndefined();
            if (method === "rename") expect(text(host.inspect("target.json"))).toBe("external new");
            expect(mutationEvents(host)).toHaveLength(1);
        }
    );
    it("rename refuses observed occupancy, but destination arrival after host check is overwritten", async () => {
        const host = fakeObsidianStorageHost();
        host.directSet("record.json", bytes("base"));
        host.directSet("target.json", bytes("occupied"));
        const digest = await sha256Bytes(bytes("base"));
        expect(
            await checkedDestructive(host, fakeLocalCoordinator(), "rename", "record.json", digest, "target.json")
        ).toMatchObject({ ok: false, failure: { code: "ALREADY_EXISTS" } });
        expect(text(host.inspect("target.json"))).toBe("occupied");
        const race = fakeObsidianStorageHost();
        race.directSet("record.json", bytes("base"));
        race.at("before-rename", () => race.directSet("target.json", bytes("arrival")));
        expect(
            (await checkedDestructive(race, fakeLocalCoordinator(), "rename", "record.json", digest, "target.json")).ok
        ).toBe(true);
        expect(text(race.inspect("target.json"))).toBe("base");
    });
    it.each(["rename", "delete"])("applied-before-error %s stays uncertain and is never retried", async (method) => {
        const host = fakeObsidianStorageHost();
        host.directSet("record.json", bytes("base"));
        host.at(method === "rename" ? "after-rename" : "after-remove", () => {
            throw new Error("DIGEST_MISMATCH");
        });
        expect(
            await checkedDestructive(
                host,
                fakeLocalCoordinator(),
                method,
                "record.json",
                await sha256Bytes(bytes("base")),
                "target.json"
            )
        ).toMatchObject({ ok: false, failure: { code: "IO_ERROR" } });
        expect(host.inspect("record.json")).toBeUndefined();
        expect(mutationEvents(host)).toHaveLength(1);
    });
    it("desktop exclusive-copy evidence does not qualify a mobile native copy or staging policy", async () => {
        for (const copyRefusesExisting of [true, false]) {
            const host = fakeObsidianStorageHost({ copyRefusesExisting });
            host.directSet("unapproved-stage", bytes("candidate"));
            host.directSet("record.json", bytes("existing"));
            if (copyRefusesExisting)
                await expect(host.adapter.copy("unapproved-stage", "record.json")).rejects.toThrow();
            else await host.adapter.copy("unapproved-stage", "record.json");
            expect(text(host.inspect("record.json"))).toBe(copyRefusesExisting ? "existing" : "candidate");
        }
    });
    it.each(["ASCII", "non-ASCII Καλημέρα 日本語", "CRLF\r\ntext\r\n", "LF\ntext\n", "\uFEFFBOM", "e\u0301", "é"])(
        "process preserves exact UTF-8 raw bytes: %s",
        async (value) => {
            const host = fakeObsidianStorageHost();
            host.directSet("record.json", bytes(value));
            const candidate = bytes(`${value} child`);
            expect(
                await checkedProcess(
                    host,
                    fakeLocalCoordinator(),
                    "record.json",
                    candidate,
                    await sha256Bytes(bytes(value))
                )
            ).toMatchObject({ ok: true });
            expect(host.inspect("record.json")).toEqual(candidate);
        }
    );
    it.each([new Uint8Array([0xff, 0xfe]), new Uint8Array([0xc3, 0x28])])(
        "lossy UTF-8 has zero process mutations",
        async (raw) => {
            const host = fakeObsidianStorageHost();
            host.directSet("record.json", raw);
            expect(
                await checkedProcess(
                    host,
                    fakeLocalCoordinator(),
                    "record.json",
                    bytes("candidate"),
                    await sha256Bytes(raw)
                )
            ).toMatchObject({ ok: false, failure: { code: "UNSUPPORTED" } });
            expect(host.inspect("record.json")).toEqual(raw);
            expect(mutationEvents(host)).toEqual([]);
        }
    );
    it("a BOM-stripping host cannot silently normalize the guarded preimage", async () => {
        const host = fakeObsidianStorageHost({ stripProcessBOM: true });
        const raw = bytes("\uFEFFbase");
        host.directSet("record.json", raw);
        expect(
            await checkedProcess(
                host,
                fakeLocalCoordinator(),
                "record.json",
                bytes("candidate"),
                await sha256Bytes(raw)
            )
        ).toMatchObject({ ok: false, failure: { code: "DIGEST_MISMATCH" } });
        expect(host.inspect("record.json")).toEqual(raw);
        expect(mutationEvents(host)).toEqual([]);
    });
    it("direct host edit before process callback is rejected without replacing the edit", async () => {
        const host = fakeObsidianStorageHost();
        host.directSet("record.json", bytes("base"));
        host.at("before-process-read", (path) => host.directSet(path, bytes("edited")));
        expect(
            await checkedProcess(
                host,
                fakeLocalCoordinator(),
                "record.json",
                bytes("candidate"),
                await sha256Bytes(bytes("base"))
            )
        ).toMatchObject({ ok: false, failure: { code: "DIGEST_MISMATCH" } });
        expect(text(host.inspect("record.json"))).toBe("edited");
        expect(mutationEvents(host)).toEqual([]);
    });
    it("two FK same-base process writers have exactly one guarded success", async () => {
        const host = fakeObsidianStorageHost();
        const coordinate = fakeLocalCoordinator();
        host.directSet("record.json", bytes("base"));
        const digest = await sha256Bytes(bytes("base"));
        const results = await Promise.all([
            checkedProcess(host, coordinate, "record.json", bytes("A"), digest),
            checkedProcess(host, coordinate, "record.json", bytes("B"), digest),
        ]);
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.filter((result) => !result.ok && result.failure.code === "DIGEST_MISMATCH")).toHaveLength(1);
    });
    it.each(["after-process-write", "readback"])(
        "apparent process success followed by %s failure remains uncertain",
        async (stage) => {
            const host = fakeObsidianStorageHost();
            host.directSet("record.json", bytes("base"));
            host.at("after-process-write", (path) => {
                if (stage === "readback") host.blockedReads.add(path);
                else throw new Error("not found");
            });
            expect(
                await checkedProcess(
                    host,
                    fakeLocalCoordinator(),
                    "record.json",
                    bytes("candidate"),
                    await sha256Bytes(bytes("base"))
                )
            ).toMatchObject({ ok: false, failure: { code: "IO_ERROR" } });
            expect(text(host.inspect("record.json"))).toBe("candidate");
            expect(mutationEvents(host)).toHaveLength(1);
        }
    );
    it("process is a host queue, not a native-writer lock after its callback", async () => {
        const host = fakeObsidianStorageHost();
        host.directSet("record.json", bytes("base"));
        host.at("before-process-write", (path) => host.directSet(path, bytes("native edit")));
        expect(
            (
                await checkedProcess(
                    host,
                    fakeLocalCoordinator(),
                    "record.json",
                    bytes("candidate"),
                    await sha256Bytes(bytes("base"))
                )
            ).ok
        ).toBe(true);
        expect(text(host.inspect("record.json"))).toBe("candidate");
    });
    it("fake process refuses async callbacks instead of inventing an async atomic primitive", async () => {
        const host = fakeObsidianStorageHost();
        host.directSet("record.json", bytes("base"));
        await expect(host.adapter.process("record.json", async () => "candidate")).rejects.toThrow("synchronously");
        expect(text(host.inspect("record.json"))).toBe("base");
    });
    it("binary reads copy bytes, enumerate immediate children, and can expose both roots", async () => {
        const host = fakeObsidianStorageHost();
        host.directSet(".finders-keepers/store.json", bytes("hidden"));
        host.directSet("Finders Keepers/store.json", bytes("visible"));
        expect((await host.adapter.list("")).folders.sort()).toEqual([".finders-keepers", "Finders Keepers"]);
        expect(await host.adapter.list(".finders-keepers")).toEqual({
            files: [".finders-keepers/store.json"],
            folders: [],
        });
        const observed = new Uint8Array(await host.adapter.readBinary(".finders-keepers/store.json"));
        observed[0] = 0;
        expect(text(host.inspect(".finders-keepers/store.json"))).toBe("hidden");
    });
});

describe("Storage S4 blocked creation/staging routes", () => {
    it("expected-null is create-only; occupied bytes are never routed to process", async () => {
        const host = fakeObsidianStorageHost();
        host.directSet("record.json", bytes("existing"));
        expect(
            await checkedProcess(host, fakeLocalCoordinator(), "record.json", bytes("candidate"), null)
        ).toMatchObject({ ok: false, failure: { code: "ALREADY_EXISTS" } });
        expect(text(host.inspect("record.json"))).toBe("existing");
        expect(mutationEvents(host)).toEqual([]);
    });
    it("expected-null shares the reproduced non-exclusive create contradiction", async () => {
        const host = fakeObsidianStorageHost();
        host.at("after-exists", (path) => host.directSet(path, bytes("external arrival")));
        expect((await checkedProcess(host, fakeLocalCoordinator(), "record.json", bytes("candidate"), null)).ok).toBe(
            true
        );
        expect(text(host.inspect("record.json"))).toBe("candidate");
        expect(mutationEvents(host).map((event) => event.method)).toEqual(["writeBinary"]);
    });
    it("unapproved staging residue inside FK scope is unknown blocking evidence to unchanged S2", async () => {
        const f = await fixture();
        const stageDirectory = `${f.target.storeCandidateLocator}/unapproved-stage`;
        await f.base.createImmutable(`${stageDirectory}/temporary.bin`, bytes("not canonical authority"));
        const aggregate = await f.discover();
        expect(aggregate.physicalCandidates[0].state).toBe("PARTIAL");
        expect(aggregate.unknownEvidenceLocators).toContain(stageDirectory);
        expect((await f.base.readBytes(`${stageDirectory}/temporary.bin`)).value).toEqual(
            bytes("not canonical authority")
        );
    });
});
