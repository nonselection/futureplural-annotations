import { describe, expect, it } from "vitest";
import {
    classifyHiddenParityRoot,
    classifyHiddenParityShared,
    classifyProbeCandidate,
    editHiddenParityBase,
    hiddenParityRootCandidates,
    hiddenParityRole,
    initializeHiddenParityRoot,
    prefixedProbeFiles,
    probeDeviceLabel,
    probeEnvelope,
    probeManifest,
    requireHiddenProbeRoot,
    validateHiddenProbeRootMarker,
} from "../src/diagnostics/storageProbeModel";

const folder = "FK-Storage-Probe-B0/candidate";
const reader = (entries, failure = null) => ({
    exists: async (path) => {
        if (failure) throw failure;
        return path === folder || Object.hasOwn(entries, path);
    },
    read: async (path) => entries[path],
});

describe("disposable Hidden parity inspection", () => {
    const prefix = ".fk-storage-probe-b0-hidden-independent";
    const candidate = `${prefix} (provider conflict, arbitrary name)`;
    const manifest = `${candidate}/manifest.json`;
    const desktop = `${candidate}/document-desktop.json`;
    const mobile = `${candidate}/document-mobile.json`;
    const directory = (entries, folders = []) => ({
        exists: async () => true,
        read: async (path) => entries[path],
        list: async () => ({ files: Object.keys(entries), folders }),
    });

    it("selects only immediate root folders with the exact diagnostic prefix, regardless of suffix", () => {
        expect(
            hiddenParityRootCandidates(
                [
                    prefix,
                    candidate,
                    `/${prefix} unexpected`,
                    `${prefix}/nested`,
                    `.fk-storage-probe-b0/other`,
                    "unrelated",
                ],
                prefix
            )
        ).toEqual([prefix, candidate, `${prefix} unexpected`]);
        expect(
            prefixedProbeFiles(
                [
                    ".fk-storage-probe-b0/divergence-hidden-same-document.json",
                    ".fk-storage-probe-b0/divergence-hidden-same-document (provider conflict).json",
                    ".fk-storage-probe-b0/nested/divergence-hidden-same-document.json",
                    ".fk-storage-probe-b0/other.json",
                ],
                ".fk-storage-probe-b0",
                "divergence-hidden-same-document"
            )
        ).toHaveLength(2);
    });

    it("validates store B/mobile and store A/desktop envelopes without a naming-suffix assumption", async () => {
        expect(
            await classifyHiddenParityRoot(
                directory({ [manifest]: probeManifest("B"), [mobile]: probeEnvelope("B", "document", "mobile") }),
                candidate,
                "A",
                "B"
            )
        ).toEqual({ state: "VALID", detail: "storeId=B; role=mobile; value=mobile" });
        expect(
            (
                await classifyHiddenParityRoot(
                    directory({ [manifest]: probeManifest("A"), [desktop]: probeEnvelope("A", "document", "desktop") }),
                    candidate,
                    "A",
                    "B"
                )
            ).state
        ).toBe("VALID");
    });

    it("surfaces absent, mixed, malformed, foreign, and unavailable candidates", async () => {
        const classify = (entries, folders = []) =>
            classifyHiddenParityRoot(directory(entries, folders), candidate, "A", "B");
        expect((await classify({})).state).toBe("PRESENT_INCOMPLETE");
        expect((await classify({ [manifest]: probeManifest("A") })).state).toBe("PRESENT_INCOMPLETE");
        expect((await classify({ [manifest]: "{" })).state).toBe("PRESENT_INVALID");
        expect(
            (await classify({ [manifest]: probeManifest("A"), [mobile]: probeEnvelope("A", "document", "mobile") }))
                .state
        ).toBe("PRESENT_INVALID");
        expect(
            (
                await classify({
                    [manifest]: probeManifest("A"),
                    [mobile]: probeEnvelope("B", "document", "mobile"),
                    [desktop]: probeEnvelope("A", "document", "desktop"),
                })
            ).state
        ).toBe("PRESENT_INVALID");
        expect(
            (
                await classify({ [manifest]: probeManifest("B"), [mobile]: probeEnvelope("B", "document", "mobile") }, [
                    `${candidate}/unexpected`,
                ])
            ).state
        ).toBe("PRESENT_INVALID");
        expect(
            (
                await classifyHiddenParityRoot(
                    {
                        exists: async () => true,
                        read: async () => "",
                        list: async () => {
                            throw new Error("offline");
                        },
                    },
                    candidate,
                    "A",
                    "B"
                )
            ).state
        ).toBe("UNAVAILABLE");
    });

    it("edits only the exact Hidden shared base envelope", () => {
        expect(JSON.parse(editHiddenParityBase(probeEnvelope("A", "document", "base"), "A", "mobile"))).toMatchObject({
            storeId: "A",
            value: "mobile-edit",
        });
        expect(() => editHiddenParityBase(probeEnvelope("A", "document", "desktop-edit"), "A", "mobile")).toThrow();
        expect(() => editHiddenParityBase(probeEnvelope("B", "document", "base"), "A", "mobile")).toThrow();
        expect(() => editHiddenParityBase("{", "A", "mobile")).toThrow();
        expect(() => editHiddenParityBase("null", "A", "mobile")).toThrow();
    });

    it("separates provider SyntaxError reads from malformed and non-object JSON bytes", async () => {
        const failedRead = {
            exists: async () => true,
            read: async () => {
                throw new SyntaxError("provider could not read bytes");
            },
            list: async () => ({ files: [manifest, mobile], folders: [] }),
        };
        expect((await classifyHiddenParityRoot(failedRead, candidate, "A", "B")).state).toBe("UNAVAILABLE");
        expect((await classifyHiddenParityShared(failedRead, `${candidate}/shared.json`, "A")).state).toBe(
            "UNAVAILABLE"
        );
        for (const bytes of ["{", "null", "[]", "42", '"text"']) {
            expect(
                (await classifyHiddenParityRoot(directory({ [manifest]: bytes, [mobile]: "{}" }), candidate, "A", "B"))
                    .state
            ).toBe("PRESENT_INVALID");
            expect(
                (
                    await classifyHiddenParityShared(
                        { exists: async () => true, read: async () => bytes },
                        `${candidate}/shared.json`,
                        "A"
                    )
                ).state
            ).toBe("PRESENT_INVALID");
        }
        expect(
            (
                await classifyHiddenParityRoot(
                    directory({ [manifest]: probeManifest("B"), [mobile]: "{" }),
                    candidate,
                    "A",
                    "B"
                )
            ).state
        ).toBe("PRESENT_INVALID");
        for (const bytes of ["null", "[]", "42", '"text"']) {
            expect(
                (
                    await classifyHiddenParityRoot(
                        directory({ [manifest]: probeManifest("B"), [mobile]: bytes }),
                        candidate,
                        "A",
                        "B"
                    )
                ).state
            ).toBe("PRESENT_INVALID");
        }
        expect(
            (
                await classifyHiddenParityRoot(
                    {
                        ...failedRead,
                        read: async (path) => {
                            if (path === manifest) return probeManifest("B");
                            throw new SyntaxError("read document failed");
                        },
                    },
                    candidate,
                    "A",
                    "B"
                )
            ).state
        ).toBe("UNAVAILABLE");
    });

    it("refuses missing, malformed, unsupported, foreign, or wrong-store Hidden root markers before mutation", async () => {
        expect(() => validateHiddenProbeRootMarker(probeManifest("fk-probe-root-hidden"))).not.toThrow();
        const root = ".fk-storage-probe-b0";
        const marker = `${root}/__disposable-fk-storage-probe.json`;
        await expect(
            requireHiddenProbeRoot(
                { exists: async () => false, read: async () => "" },
                root,
                "__disposable-fk-storage-probe.json"
            )
        ).rejects.toThrow();
        await expect(
            requireHiddenProbeRoot(
                { exists: async (path) => path === root, read: async () => "" },
                root,
                "__disposable-fk-storage-probe.json"
            )
        ).rejects.toThrow();
        for (const bytes of [
            "{",
            "null",
            "[]",
            JSON.stringify({ probeKind: "other", version: 1, storeId: "fk-probe-root-hidden" }),
            JSON.stringify({ probeKind: "finders-keepers-storage-probe", version: 2, storeId: "fk-probe-root-hidden" }),
            probeManifest("fk-probe-root-visible"),
        ]) {
            expect(() => validateHiddenProbeRootMarker(bytes)).toThrow();
            await expect(
                requireHiddenProbeRoot(
                    { exists: async (path) => path === root || path === marker, read: async () => bytes },
                    root,
                    "__disposable-fk-storage-probe.json"
                )
            ).rejects.toThrow();
        }
        await expect(
            requireHiddenProbeRoot(
                {
                    exists: async (path) => path === root || path === marker,
                    read: async () => probeManifest("fk-probe-root-hidden"),
                },
                root,
                "__disposable-fk-storage-probe.json"
            )
        ).resolves.toBeUndefined();
    });

    it("rereads and verifies a freshly initialized independent Hidden fixture", async () => {
        const files = {};
        const folders = new Set();
        const writer = {
            exists: async (path) => folders.has(path) || Object.hasOwn(files, path),
            mkdir: async (path) => {
                folders.add(path);
            },
            write: async (path, bytes) => {
                files[path] = bytes;
            },
            read: async (path) => files[path],
            list: async (path) => ({
                files: Object.keys(files).filter((file) => file.startsWith(`${path}/`)),
                folders: [],
            }),
        };
        expect(await initializeHiddenParityRoot(writer, candidate, "mobile", "A", "B")).toEqual({
            state: "VALID",
            detail: "storeId=B; role=mobile; value=mobile",
        });
        expect((await classifyHiddenParityRoot(writer, candidate, "A", "B")).state).toBe("VALID");
        await expect(initializeHiddenParityRoot(writer, candidate, "desktop", "A", "B")).rejects.toThrow(
            /already exists/
        );
        const corrupting = {
            ...writer,
            write: async (path, bytes) => {
                files[path] = path.endsWith("manifest.json") ? bytes : "{";
            },
        };
        await expect(initializeHiddenParityRoot(corrupting, `${prefix}-fresh`, "desktop", "A", "B")).rejects.toThrow(
            /failed local verification/
        );
    });

    it("separates the parity role from an honest iOS report label", () => {
        expect(probeDeviceLabel(true, true)).toBe("ios");
        expect(probeDeviceLabel(false, true)).toBe("mobile");
        expect(probeDeviceLabel(false, false)).toBe("desktop");
        expect(hiddenParityRole("ios")).toBe("mobile");
        expect(hiddenParityRole("desktop")).toBe("desktop");
    });
});

describe("disposable storage candidate classifier", () => {
    it("distinguishes absence, incomplete, invalid, unsupported, valid, and unavailable", async () => {
        expect((await classifyProbeCandidate({ exists: async () => false, read: async () => "" }, folder)).state).toBe(
            "ABSENT"
        );
        expect((await classifyProbeCandidate(reader({}), folder)).state).toBe("PRESENT_INCOMPLETE");
        expect((await classifyProbeCandidate(reader({ [`${folder}/manifest.json`]: "{" }), folder)).state).toBe(
            "PRESENT_INVALID"
        );
        expect(
            (
                await classifyProbeCandidate(
                    reader({
                        [`${folder}/manifest.json`]: JSON.stringify({
                            probeKind: "finders-keepers-storage-probe",
                            version: 99,
                            storeId: "A",
                        }),
                    }),
                    folder
                )
            ).state
        ).toBe("UNSUPPORTED");
        const valid = {
            [`${folder}/manifest.json`]: probeManifest("A"),
            [`${folder}/document.json`]: probeEnvelope("A", "document", "sample"),
        };
        expect((await classifyProbeCandidate(reader(valid), folder)).state).toBe("VALID");
        expect((await classifyProbeCandidate(reader({}, new Error("provider unavailable")), folder)).state).toBe(
            "UNAVAILABLE"
        );
        expect(
            (
                await classifyProbeCandidate(
                    {
                        exists: async () => true,
                        read: async () => {
                            throw new SyntaxError("provider read failed");
                        },
                    },
                    folder
                )
            ).state
        ).toBe("UNAVAILABLE");
    });

    it("detects a foreign document storeId within a valid-looking directory", async () => {
        const result = await classifyProbeCandidate(
            reader({
                [`${folder}/manifest.json`]: probeManifest("A"),
                [`${folder}/document.json`]: probeEnvelope("B", "document", "foreign"),
            }),
            folder
        );
        expect(result).toMatchObject({ state: "PRESENT_INVALID" });
        expect(result.detail).toMatch(/mixed storeId/);
    });
});
