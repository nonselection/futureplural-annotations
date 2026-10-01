import { describe, expect, it, vi } from "vitest";
import {
    createDevVaultDiscoveryReadPort,
    registerStorageDiscoveryReadOnlyCommand,
} from "../src/diagnostics/storageDiscoveryCheck";

function makeApp(vaultName = "dev-vault") {
    const adapter = {
        list: vi.fn(async (path) =>
            path === "/"
                ? { files: ["a.json"], folders: ["folder", "another"] }
                : { files: [`${path}/z.json`], folders: [] }
        ),
        readBinary: vi.fn(async () => Uint8Array.from([1, 2, 3]).buffer),
        write: vi.fn(),
        writeBinary: vi.fn(),
        mkdir: vi.fn(),
        rename: vi.fn(),
        remove: vi.fn(),
    };
    return { app: { vault: { getName: () => vaultName, adapter } }, adapter };
}

describe("Storage S2 dev-vault read-only integration bridge", () => {
    it("asserts dev-vault and exposes only bounded listing plus byte reads", async () => {
        const { app, adapter } = makeApp();
        const port = createDevVaultDiscoveryReadPort(app);

        expect(Object.keys(port).sort()).toEqual(["listChildren", "readBytes", "rootIdentity"]);
        const root = await port.listChildren("", 2);
        const nested = await port.listChildren("folder", 10);
        const bytes = await port.readBytes("folder/item.bin");

        expect(adapter.list).toHaveBeenNthCalledWith(1, "/");
        expect(adapter.list).toHaveBeenNthCalledWith(2, "folder");
        expect(root).toEqual({
            ok: true,
            value: {
                entries: [
                    { name: "a.json", kind: "file" },
                    { name: "another", kind: "directory" },
                ],
                truncated: true,
            },
        });
        expect(nested).toEqual({
            ok: true,
            value: {
                entries: [{ name: "z.json", kind: "file" }],
                truncated: false,
            },
        });
        expect(bytes.ok).toBe(true);
        if (bytes.ok) expect([...bytes.value]).toEqual([1, 2, 3]);
        expect(adapter.write).not.toHaveBeenCalled();
        expect(adapter.writeBinary).not.toHaveBeenCalled();
        expect(adapter.mkdir).not.toHaveBeenCalled();
        expect(adapter.rename).not.toHaveBeenCalled();
        expect(adapter.remove).not.toHaveBeenCalled();
    });

    it("refuses the wrong vault before listing or reading and validates locators", async () => {
        const wrong = makeApp("another-vault");
        expect(() => createDevVaultDiscoveryReadPort(wrong.app)).toThrow(/restricted to dev-vault/);
        expect(wrong.adapter.list).not.toHaveBeenCalled();
        expect(wrong.adapter.readBinary).not.toHaveBeenCalled();

        const { app, adapter } = makeApp();
        const port = createDevVaultDiscoveryReadPort(app);
        const invalid = await port.readBytes("../outside.json");
        expect(invalid).toMatchObject({ ok: false, failure: { code: "INVALID_LOCATOR" } });
        expect(adapter.readBinary).not.toHaveBeenCalled();
    });

    it("maps host read/list failures to unavailable and registers only in dev-vault", async () => {
        const { app, adapter } = makeApp();
        adapter.list.mockRejectedValueOnce(new Error("offline"));
        adapter.readBinary.mockRejectedValueOnce(new Error("offline"));
        const port = createDevVaultDiscoveryReadPort(app);

        expect(await port.listChildren("", 1)).toMatchObject({ ok: false, failure: { code: "UNAVAILABLE" } });
        expect(await port.readBytes("known/file.json")).toMatchObject({ ok: false, failure: { code: "UNAVAILABLE" } });

        const addCommand = vi.fn();
        registerStorageDiscoveryReadOnlyCommand({ app, addCommand });
        expect(addCommand).toHaveBeenCalledOnce();
        expect(addCommand.mock.calls[0][0]).toMatchObject({
            id: "fk-storage-s2-discovery-readonly",
            name: "Inspect bounded storage structure (read only, dev vault)",
        });

        const nonDev = makeApp("personal-vault");
        const nonDevAddCommand = vi.fn();
        registerStorageDiscoveryReadOnlyCommand({ app: nonDev.app, addCommand: nonDevAddCommand });
        expect(nonDevAddCommand).not.toHaveBeenCalled();
        expect(nonDev.adapter.list).not.toHaveBeenCalled();
    });
});
