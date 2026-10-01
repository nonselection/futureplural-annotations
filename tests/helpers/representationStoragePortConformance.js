import { describe, expect, it } from "vitest";
import { sha256Bytes } from "../../src/storage/canonicalEncoding";

const bytes = (value) => new TextEncoder().encode(value);
const text = (value) => new TextDecoder().decode(value);

/** Registers reusable behavioral checks for any local RepresentationStoragePort fixture. */
export function addRepresentationStoragePortConformance(name, createPort) {
    describe(`${name} RepresentationStoragePort conformance`, () => {
        it("provides root identity and bounded, deterministic immediate-child listings", async () => {
            const port = createPort("listing");
            expect(port.rootIdentity).toBeTruthy();
            expect(port.localGuarantees).toMatchObject({
                immutableCreate: "refuses-existing",
                guardedSnapshotWrite: "checks-current-content-digest",
                guaranteeScope: "one-local-operation",
            });
            expect((await port.createImmutable("stores/b/store.json", bytes("b"))).ok).toBe(true);
            expect((await port.createImmutable("stores/a/store.json", bytes("a"))).ok).toBe(true);
            expect((await port.createImmutable("namespace.json", bytes("n"))).ok).toBe(true);

            expect(await port.listChildren("", 10)).toMatchObject({
                ok: true,
                value: {
                    entries: [
                        { name: "namespace.json", kind: "file" },
                        { name: "stores", kind: "directory" },
                    ],
                    truncated: false,
                },
            });
            expect(await port.listChildren("stores", 1)).toMatchObject({
                ok: true,
                value: { entries: [{ name: "a", kind: "directory" }], truncated: true },
            });
        });

        it("refuses immutable overwrite and returns defensive read bytes", async () => {
            const port = createPort("immutable");
            const initial = bytes("original");
            expect((await port.createImmutable("artifact.json", initial)).ok).toBe(true);
            initial[0] = 0;
            expect(await port.createImmutable("artifact.json", bytes("replacement"))).toMatchObject({
                ok: false,
                failure: { code: "ALREADY_EXISTS" },
            });
            const read = await port.readBytes("artifact.json");
            expect(read.ok).toBe(true);
            if (read.ok) {
                expect(text(read.value)).toBe("original");
                read.value[0] = 0;
            }
            const reread = await port.readBytes("artifact.json");
            expect(reread.ok && text(reread.value)).toBe("original");
        });

        it("guards mutable snapshots by exact current byte digest and preserves bytes on rejection", async () => {
            const port = createPort("guarded-write");
            const base = bytes("base");
            expect(await port.writeSnapshot("snapshot.json", base, null)).toMatchObject({ ok: true });
            const baseDigest = await sha256Bytes(base);
            expect(
                await port.writeSnapshot(
                    "snapshot.json",
                    bytes("wrong-base-write"),
                    "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                )
            ).toMatchObject({ ok: false, failure: { code: "DIGEST_MISMATCH" } });
            const afterReject = await port.readBytes("snapshot.json");
            expect(afterReject.ok && text(afterReject.value)).toBe("base");
            expect(await port.writeSnapshot("snapshot.json", bytes("next"), baseDigest)).toMatchObject({ ok: true });
            expect(await port.writeSnapshot("snapshot.json", bytes("stale"), baseDigest)).toMatchObject({
                ok: false,
                failure: { code: "DIGEST_MISMATCH" },
            });
            const afterStale = await port.readBytes("snapshot.json");
            expect(afterStale.ok && text(afterStale.value)).toBe("next");
        });

        it("serializes competing local guarded writes so exactly one stale-base writer succeeds", async () => {
            const port = createPort("concurrent-write");
            const base = bytes("base");
            await port.createImmutable("one.json", base);
            const digest = await sha256Bytes(base);
            const results = await Promise.all([
                port.writeSnapshot("one.json", bytes("writer-a"), digest),
                port.writeSnapshot("one.json", bytes("writer-b"), digest),
            ]);
            expect(results.filter((result) => result.ok)).toHaveLength(1);
            expect(results.filter((result) => !result.ok && result.failure.code === "DIGEST_MISMATCH")).toHaveLength(1);
        });

        it("guards rename and delete and preserves the source on rejected operations", async () => {
            const port = createPort("rename-delete");
            const content = bytes("immutable bytes");
            await port.createImmutable("source.json", content);
            const digest = await sha256Bytes(content);
            expect(
                await port.rename(
                    "source.json",
                    "destination.json",
                    "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                )
            ).toMatchObject({ ok: false, failure: { code: "DIGEST_MISMATCH" } });
            const sourceAfterRejectedRename = await port.readBytes("source.json");
            expect(sourceAfterRejectedRename.ok && text(sourceAfterRejectedRename.value)).toBe("immutable bytes");
            expect(await port.readBytes("destination.json")).toMatchObject({
                ok: false,
                failure: { code: "NOT_FOUND" },
            });
            expect(
                await port.delete(
                    "source.json",
                    "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                )
            ).toMatchObject({ ok: false, failure: { code: "DIGEST_MISMATCH" } });
            const sourceAfterRejectedDelete = await port.readBytes("source.json");
            expect(sourceAfterRejectedDelete.ok && text(sourceAfterRejectedDelete.value)).toBe("immutable bytes");
            expect(await port.rename("source.json", "destination.json", digest)).toMatchObject({ ok: true });
            const renamed = await port.readBytes("destination.json");
            expect(renamed.ok && text(renamed.value)).toBe("immutable bytes");
            expect(await port.delete("destination.json", digest)).toMatchObject({ ok: true });
            expect(await port.readBytes("destination.json")).toMatchObject({
                ok: false,
                failure: { code: "NOT_FOUND" },
            });
        });

        it("rejects unsafe locators", async () => {
            const port = createPort("invalid-input");
            expect(await port.readBytes("../outside.json")).toMatchObject({
                ok: false,
                failure: { code: "INVALID_LOCATOR" },
            });
            expect(await port.listChildren("", 0)).toMatchObject({ ok: false, failure: { code: "INVALID_LIMIT" } });
        });
    });
}
