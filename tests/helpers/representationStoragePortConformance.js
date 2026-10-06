import { describe, expect, it } from "vitest";
import { isPublicationId } from "../../src/storage/identity";

const bytes = (...values) => new Uint8Array(values);
const arbitrary = () => bytes(0, 255, 254, 239, 187, 191, 13, 10, 195, 169, 128);
function value(result) {
    expect(result.ok).toBe(true);
    return result.value;
}
async function allocated(port, role = "canonical-revision", directory = "records") {
    const collection = value(port.bindPublicationCollection(value(port.directoryHandle(directory)), role));
    const result = await port.allocatePublication(collection);
    expect(result.status).toBe("ALLOCATED");
    return result.allocation;
}
async function read(port, allocation) {
    return port.readBytes(value(port.fileHandle(allocation.locator)));
}
function assertEffectOnly(result, effect) {
    expect(result.physicalEffect).toBe(effect);
    for (const key of [
        "ok",
        "canonicalObservation",
        "current",
        "healthy",
        "durable",
        "uniqueHead",
        "receipt",
        "applied",
    ])
        expect(result).not.toHaveProperty(key);
}
/**
 * ONE portable v0.5 owner. Harness controls are explicit synthetic/fault instrumentation, never port methods.
 * Results qualify only this controlled implementation; not Obsidian, device/provider exclusion or capacity.
 */
export function addRepresentationStoragePortConformance(name, createFixture) {
    describe(`${name} portable v0.5 conformance`, () => {
        it("has no old destructive/CAS/exclusion surface or fixture ground truth on the port", () => {
            const { port } = createFixture("surface");
            for (const key of [
                "rename",
                "delete",
                "writeSnapshot",
                "createImmutable",
                "localGuarantees",
                "files",
                "pending",
                "controls",
                "issuer",
                "dispatchCount",
            ])
                expect(port).not.toHaveProperty(key);
        });
        it("equal diagnostic identity across independent issuers never permits handle/token exchange", async () => {
            const a = createFixture("equal identity"),
                b = createFixture("equal identity");
            expect(a.port.rootIdentity).toBe(b.port.rootIdentity);
            const directory = value(a.port.directoryHandle(""));
            const file = value(a.port.fileHandle("x"));
            expect(await b.port.listChildren(directory, 1)).toMatchObject({
                ok: false,
                failure: { code: "CONFINEMENT" },
            });
            expect(await b.port.readBytes(file)).toMatchObject({ ok: false, failure: { code: "CONFINEMENT" } });
            const allocation = await allocated(a.port);
            const refused = await b.port.publishFresh(allocation, bytes(1));
            assertEffectOnly(refused, "NO_MUTATION_DISPATCHED");
            expect(refused.reason).toBe("CONFINEMENT");
            expect(a.controls.stats().dispatches + b.controls.stats().dispatches).toBe(0);
            expect((await a.port.publishFresh(allocation, bytes(1))).reason).toBe("RETIRED_ALLOCATION");
        });
        it("read context sees both roots while publication remains root-bound", async () => {
            const { port, secondaryPort, controls } = createFixture("two roots");
            controls.seedFile(port.publicationRoot, "a.bin", bytes(1));
            controls.seedFile(secondaryPort.publicationRoot, "b.bin", bytes(2));
            const secondaryFile = value(secondaryPort.fileHandle("b.bin"));
            expect((await port.readBytes(secondaryFile)).value).toEqual(bytes(2));
            expect((await secondaryPort.readBytes(value(port.fileHandle("a.bin")))).value).toEqual(bytes(1));
            const otherDir = value(secondaryPort.directoryHandle(""));
            expect((await port.listChildren(otherDir, 10)).value.entries.map((e) => e.name)).toEqual(["b.bin"]);
            expect(port.bindPublicationCollection(otherDir, "namespace")).toMatchObject({
                ok: false,
                failure: { code: "CONFINEMENT" },
            });
            const allocation = await allocated(secondaryPort);
            expect((await port.publishFresh(allocation, bytes(3))).reason).toBe("CONFINEMENT");
            expect(controls.stats().dispatches).toBe(0);
        });
        it("lists only bounded immediate children, truthful truncation and correlated handles", async () => {
            const { port, controls } = createFixture("listing");
            const root = port.publicationRoot;
            controls.seedFile(root, "folder/a", bytes(1));
            controls.seedFile(root, "folder/b", bytes(2));
            controls.seedFile(root, "folder/nested/c", bytes(3));
            const directory = value(port.directoryHandle("folder"));
            const limited = value(await port.listChildren(directory, 2));
            expect(limited.entries).toHaveLength(2);
            expect(limited.truncated).toBe(true);
            const full = value(await port.listChildren(directory, 10));
            expect(full.truncated).toBe(false);
            expect(full.entries.map((e) => [e.name, e.kind]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))).toEqual([
                ["a", "file"],
                ["b", "file"],
                ["nested", "directory"],
            ]);
            for (const entry of full.entries) {
                expect(entry.handle.root).toBe(root);
                expect(entry.handle.context).toBe(port.context);
                expect(entry.name.includes("/")).toBe(false);
            }
            expect(Object.isFrozen(full.entries)).toBe(true);
            expect(full).not.toHaveProperty("capacity");
            expect(full).not.toHaveProperty("nativeAllocationBounded");
            controls.setListCondition(root, "folder", "UNAVAILABLE");
            expect(await port.listChildren(directory, 1)).toMatchObject({
                ok: false,
                failure: { code: "UNAVAILABLE" },
            });
            controls.setListCondition(root, "folder", "UNSUPPORTED");
            expect(await port.listChildren(directory, 1)).toMatchObject({
                ok: false,
                failure: { code: "UNSUPPORTED" },
            });
        });
        it.each([0, -1, 1.5, NaN, Infinity, "1"])("rejects invalid returned-result bound %s", async (limit) => {
            const { port } = createFixture("invalid limit");
            expect(await port.listChildren(value(port.directoryHandle("")), limit)).toMatchObject({
                ok: false,
                failure: { code: "INVALID_LIMIT" },
            });
        });
        it.each(["/outside", "../outside", "x/../y", "x//y", "x\\y", "x\0y"])(
            "rejects lexical escape %s without claiming host alias qualification",
            (locator) => {
                const { port } = createFixture("unsafe");
                expect(port.directoryHandle(locator).ok).toBe(false);
                expect(port.fileHandle(locator).ok).toBe(false);
            }
        );
        it("copies raw arbitrary bytes in seeds and reads; partial read is never complete success", async () => {
            const { port, controls } = createFixture("binary");
            const input = arbitrary(),
                expected = Uint8Array.from(input);
            controls.seedFile(port.publicationRoot, "raw.bin", input);
            input.fill(8);
            const file = value(port.fileHandle("raw.bin"));
            const first = value(await port.readBytes(file));
            expect(first).toEqual(expected);
            first.fill(7);
            expect(value(await port.readBytes(file))).toEqual(expected);
            controls.setReadCondition(port.publicationRoot, "raw.bin", "PARTIAL");
            expect(await port.readBytes(file)).toMatchObject({ ok: false, failure: { code: "UNAVAILABLE" } });
            controls.setReadCondition(port.publicationRoot, "raw.bin", "UNSUPPORTED");
            expect(await port.readBytes(file)).toMatchObject({ ok: false, failure: { code: "UNSUPPORTED" } });
            expect(await port.readBytes(value(port.fileHandle("missing")))).toMatchObject({
                ok: false,
                failure: { code: "NOT_FOUND" },
            });
            expect(await port.listChildren(value(port.directoryHandle("missing")), 1)).toMatchObject({
                ok: false,
                failure: { code: "NOT_FOUND" },
            });
        });
        it("copied/serialized directory and file fields never reconstruct read capability", async () => {
            const { port } = createFixture("copied read");
            const directory = value(port.directoryHandle("")),
                file = value(port.fileHandle("x"));
            for (const copy of [{ ...directory }, JSON.parse(JSON.stringify(directory))])
                expect((await port.listChildren(copy, 1)).failure.code).toBe("CONFINEMENT");
            for (const copy of [{ ...file }, JSON.parse(JSON.stringify(file))])
                expect((await port.readBytes(copy)).failure.code).toBe("CONFINEMENT");
        });
        it("fresh allocation is generated identity, not existence/reservation/authority", async () => {
            const { port, controls } = createFixture("allocation");
            const a = await allocated(port),
                b = await allocated(port);
            expect(isPublicationId(a.publicationId)).toBe(true);
            expect(a.publicationId).not.toBe(b.publicationId);
            expect(a.locator).not.toBe(b.locator);
            expect(a.locator).toBe(`records/${a.publicationId}.json`);
            expect(a.collection.root).toBe(port.publicationRoot);
            expect(a.role).toBe("canonical-revision");
            expect(controls.peekBytes(port.publicationRoot, a.locator)).toBeUndefined();
            expect(controls.stats().dispatches).toBe(0);
            expect(a).not.toHaveProperty("reserved");
        });
        it.each(["file", "directory", "ancestor"])(
            "observed %s occupancy refuses before dispatch and permanently retires",
            async (shape) => {
                const { port, controls } = createFixture("occupancy");
                const a = await allocated(port);
                if (shape === "file") controls.seedFile(port.publicationRoot, a.locator, bytes(9));
                else if (shape === "directory") controls.seedDirectory(port.publicationRoot, a.locator);
                else controls.seedFile(port.publicationRoot, "records", bytes(9));
                const result = await port.publishFresh(a, bytes(1));
                assertEffectOnly(result, "NO_MUTATION_DISPATCHED");
                expect(result.reason).toBe("OBSERVED_OCCUPANCY");
                expect(controls.stats().dispatches).toBe(0);
                controls.externalDelete(port.publicationRoot, a.locator);
                expect((await port.publishFresh(a, bytes(1))).reason).toBe("RETIRED_ALLOCATION");
            }
        );
        it.each(["blocked preflight", "known refusal"])(
            "%s is controlled nondispatch, not generic UNKNOWN",
            async (kind) => {
                const { port, controls } = createFixture("preflight");
                const a = await allocated(port);
                if (kind === "blocked preflight")
                    controls.setPreflightUnavailable(port.publicationRoot, a.locator, true);
                else controls.scheduleNext({ kind: "known-nondispatch" });
                const result = await port.publishFresh(a, bytes(1));
                assertEffectOnly(result, "NO_MUTATION_DISPATCHED");
                expect(result.reason).toBe("PREFLIGHT_UNAVAILABLE");
                expect(controls.stats().dispatches).toBe(0);
                expect((await port.publishFresh(a, bytes(1))).reason).toBe("RETIRED_ALLOCATION");
            }
        );
        it("success reports only host completion, owns input before await, and requires independent reread", async () => {
            const { port, controls } = createFixture("success");
            const a = await allocated(port);
            const gate = controls.pauseNextPreflight();
            const input = arbitrary(),
                expected = Uint8Array.from(input);
            const pending = port.publishFresh(a, input);
            input.fill(5);
            await gate.entered;
            expect(controls.stats().dispatches).toBe(0);
            gate.release();
            const result = await pending;
            assertEffectOnly(result, "DISPATCH_REPORTED_SUCCESS");
            expect(value(await read(port, a))).toEqual(expected);
            expect(controls.stats().dispatches).toBe(1);
            expect((await port.publishFresh(a, input)).reason).toBe("RETIRED_ALLOCATION");
        });
        it.each(["applied-before-error", "dispatch-error"])(
            "%s stays UNKNOWN regardless of later bytes/absence",
            async (kind) => {
                const { port, controls } = createFixture("dispatch error");
                const a = await allocated(port);
                controls.scheduleNext({ kind });
                const input = arbitrary();
                const result = await port.publishFresh(a, input);
                assertEffectOnly(result, "DISPATCH_OUTCOME_UNKNOWN");
                expect(controls.stats().dispatches).toBe(1);
                if (kind === "applied-before-error") expect(value(await read(port, a))).toEqual(input);
                else expect((await read(port, a)).failure.code).toBe("NOT_FOUND");
                expect(result.physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
                expect((await port.publishFresh(a, input)).reason).toBe("RETIRED_ALLOCATION");
            }
        );
        it("partial stored application is UNKNOWN; full raw mismatch differs from incomplete read", async () => {
            const { port, controls } = createFixture("partial");
            const a = await allocated(port);
            const partial = bytes(1, 2);
            controls.scheduleNext({ kind: "partial-apply", bytes: partial });
            partial.fill(9);
            const result = await port.publishFresh(a, bytes(1, 2, 3, 4));
            assertEffectOnly(result, "DISPATCH_OUTCOME_UNKNOWN");
            expect(value(await read(port, a))).toEqual(bytes(1, 2));
            controls.setReadCondition(port.publicationRoot, a.locator, "PARTIAL");
            expect((await read(port, a)).failure.code).toBe("UNAVAILABLE");
        });
        it.each(["success-unreadable", "success-mismatch"])(
            "%s cannot upgrade reported success into exact content",
            async (kind) => {
                const { port, controls } = createFixture("success observation");
                const a = await allocated(port);
                controls.scheduleNext(kind === "success-mismatch" ? { kind, bytes: bytes(9) } : { kind });
                const effect = await port.publishFresh(a, bytes(1));
                assertEffectOnly(effect, "DISPATCH_REPORTED_SUCCESS");
                const current = await read(port, a);
                if (kind === "success-unreadable") expect(current.failure.code).toBe("UNAVAILABLE");
                else expect(value(current)).toEqual(bytes(9));
            }
        );
        it("UNKNOWN while pending retires without cancellation; late work uses original bytes after a new publication", async () => {
            const { port, controls } = createFixture("pending");
            const a = await allocated(port);
            controls.scheduleNext({ kind: "unknown-pending" });
            const input = arbitrary(),
                expected = Uint8Array.from(input);
            const result = await port.publishFresh(a, input);
            input.fill(3);
            assertEffectOnly(result, "DISPATCH_OUTCOME_UNKNOWN");
            expect(Object.isFrozen(result)).toBe(true);
            expect(controls.stats().pending).toBe(1);
            expect((await read(port, a)).failure.code).toBe("NOT_FOUND");
            expect((await port.publishFresh(a, expected)).reason).toBe("RETIRED_ALLOCATION");
            const b = await allocated(port);
            expect(b.locator).not.toBe(a.locator);
            assertEffectOnly(await port.publishFresh(b, expected), "DISPATCH_REPORTED_SUCCESS");
            controls.completePending(controls.pendingIds()[0]);
            expect(value(await read(port, a))).toEqual(expected);
            expect(value(await read(port, b))).toEqual(expected);
            expect(result.physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
            expect(controls.stats()).toMatchObject({ dispatches: 2, lateCompletions: 1, pending: 0 });
        });
        it("arrival after preflight permits nonexclusive replacement without requiring it or exclusion", async () => {
            const { port, controls } = createFixture("residual race");
            const a = await allocated(port);
            const external = bytes(7, 7);
            controls.scheduleNext({ kind: "arrival-after-preflight", bytes: external });
            const effect = await port.publishFresh(a, bytes(1, 2));
            if (effect.physicalEffect === "NO_MUTATION_DISPATCHED") {
                // Another conforming implementation may observe/refuse the arrival before its boundary.
                assertEffectOnly(effect, "NO_MUTATION_DISPATCHED");
                expect(effect.reason).toBe("OBSERVED_OCCUPANCY");
                expect(value(await read(port, a))).toEqual(external);
                return;
            }
            assertEffectOnly(effect, "DISPATCH_REPORTED_SUCCESS");
            expect(value(await read(port, a))).toEqual(bytes(1, 2));
            const events = controls.events().filter((event) => event.locator === a.locator);
            expect(events.map((event) => event.kind)).toEqual([
                "preflight-absent",
                "external-write",
                "dispatch",
                "apply",
            ]);
            expect(events[1].bytes).toEqual(external);
            expect(events[3].bytes).not.toEqual(external);
            expect(effect).not.toHaveProperty("exclusive"); // Exact read does NOT certify intermediate preservation.
        });
        it("external replacement/deletion after exact read creates no lease and cannot revive allocation", async () => {
            const { port, controls } = createFixture("external after read");
            const a = await allocated(port);
            const effect = await port.publishFresh(a, bytes(1));
            const observed = value(await read(port, a));
            controls.externalWrite(port.publicationRoot, a.locator, bytes(9));
            expect(observed).toEqual(bytes(1));
            expect(value(await read(port, a))).toEqual(bytes(9));
            expect(effect.physicalEffect).toBe("DISPATCH_REPORTED_SUCCESS");
            controls.externalDelete(port.publicationRoot, a.locator);
            expect((await read(port, a)).failure.code).toBe("NOT_FOUND");
            expect((await port.publishFresh(a, bytes(1))).reason).toBe("RETIRED_ALLOCATION");
            const b = await allocated(port);
            expect(b.publicationId).not.toBe(a.publicationId);
            expect(b.locator).not.toBe(a.locator);
            expect((await port.publishFresh(b, observed)).physicalEffect).toBe("DISPATCH_REPORTED_SUCCESS");
        });
        it("fresh exact republication preserves two physical copies without port authority deduplication", async () => {
            const { port, controls } = createFixture("duplicate copies");
            const a = await allocated(port),
                b = await allocated(port);
            const content = arbitrary();
            await port.publishFresh(a, content);
            await port.publishFresh(b, content);
            expect(a.publicationId).not.toBe(b.publicationId);
            expect(value(await read(port, a))).toEqual(value(await read(port, b)));
            expect(value(await port.listChildren(value(port.directoryHandle("records")), 10)).entries).toHaveLength(2);
            expect(controls.stats().dispatches).toBe(2);
        });
        it.each(["copied", "retargeted collection", "retargeted role"])(
            "%s real-token misuse refuses and burns",
            async (kind) => {
                const { port, controls } = createFixture("known misuse");
                const a = await allocated(port);
                const other = value(
                    port.bindPublicationCollection(value(port.directoryHandle("other")), "recovery-receipt")
                );
                const copy =
                    kind === "copied"
                        ? { ...a }
                        : kind === "retargeted collection"
                          ? { ...a, collection: other }
                          : { ...a, role: "namespace" };
                const result = await port.publishFresh(copy, bytes(1));
                expect(result.reason).toBe("INVALID_ALLOCATION");
                expect(result.binding.locator).toBe(a.locator);
                expect((await port.publishFresh(a, bytes(1))).reason).toBe("RETIRED_ALLOCATION");
                expect(controls.stats().dispatches).toBe(0);
            }
        );
        it("serialized/forged tokens cannot dispatch or manufacture a valid error binding", async () => {
            const { port, controls } = createFixture("forged");
            const a = await allocated(port);
            for (const forged of [
                JSON.parse(JSON.stringify(a)),
                { publicationId: a.publicationId, locator: a.locator, token: {} },
                {},
            ]) {
                const result = await port.publishFresh(forged, bytes(1));
                expect(result.reason).toBe("INVALID_ALLOCATION");
                expect(result).not.toHaveProperty("binding");
            }
            expect(controls.stats().dispatches).toBe(0);
            expect((await port.publishFresh(a, bytes(1))).physicalEffect).toBe("DISPATCH_REPORTED_SUCCESS");
        });
        it("concurrent same-token invocation has one dispatch; other fresh work is not globally serialized", async () => {
            const { port, controls } = createFixture("concurrency");
            const a = await allocated(port);
            const gate = controls.pauseNextPreflight();
            const first = port.publishFresh(a, bytes(1));
            await gate.entered;
            const second = await port.publishFresh(a, bytes(1));
            expect(second.reason).toBe("RETIRED_ALLOCATION");
            expect(controls.stats().dispatches).toBe(0);
            const b = await allocated(port);
            expect((await port.publishFresh(b, bytes(2))).physicalEffect).toBe("DISPATCH_REPORTED_SUCCESS");
            gate.release();
            expect((await first).physicalEffect).toBe("DISPATCH_REPORTED_SUCCESS");
            expect(controls.stats().dispatches).toBe(2);
            expect(
                controls.events().filter((event) => event.kind === "dispatch" && event.locator === a.locator)
            ).toHaveLength(1);
        });
        it("explicit abandonment is idempotent, zero-dispatch, and never deletes external bytes", async () => {
            const { port, controls } = createFixture("abandonment");
            const a = await allocated(port);
            controls.seedFile(port.publicationRoot, a.locator, bytes(9));
            port.retirePublication(a);
            port.retirePublication(a);
            expect((await port.publishFresh(a, bytes(1))).reason).toBe("RETIRED_ALLOCATION");
            expect(value(await read(port, a))).toEqual(bytes(9));
            expect(controls.stats().dispatches).toBe(0);
        });
        it("context invalidation prevents new dispatch but does not cancel entered pending work", async () => {
            const { port, controls } = createFixture("invalidation");
            const a = await allocated(port);
            controls.scheduleNext({ kind: "unknown-pending" });
            const effect = await port.publishFresh(a, bytes(1));
            const b = await allocated(port);
            controls.invalidateContext();
            expect((await port.publishFresh(b, bytes(2))).physicalEffect).toBe("NO_MUTATION_DISPATCHED");
            controls.completePending(controls.pendingIds()[0]);
            expect(controls.peekBytes(port.publicationRoot, a.locator)).toEqual(bytes(1));
            expect(effect.physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
            expect(controls.stats().dispatches).toBe(1);
        });
        it("invalidation while preflight is paused is controlled zero-dispatch, never a revived capability", async () => {
            const { port, controls } = createFixture("preflight invalidate");
            const a = await allocated(port);
            const gate = controls.pauseNextPreflight();
            const task = port.publishFresh(a, bytes(1));
            await gate.entered;
            controls.invalidateContext();
            gate.release();
            assertEffectOnly(await task, "NO_MUTATION_DISPATCHED");
            expect(controls.stats().dispatches).toBe(0);
        });
    });
}
