import { describe, expect, it } from "vitest";
import {
    initializeMatrixRepetition,
    inspectMatrixCondition,
    matrixCondition,
    matrixDeviceFixture,
    matrixExpectedUnion,
    matrixOrder,
    matrixRoot,
    matrixRootCandidates,
    matrixStoreId,
    MATRIX_CONDITIONS,
    MATRIX_REPETITION_ORDERS,
    STORAGE_MATRIX_EXPERIMENT,
    STORAGE_MATRIX_REVERSE_EXPERIMENT,
    verifyMatrixFixture,
} from "../src/diagnostics/storageMatrix";

const repetitions = ["R1", "R2", "R3", "R4"];

function memoryFs() {
    const files = new Map();
    const folders = new Set();
    const writes = [];
    const fs = {
        exists: async (path) => folders.has(path) || files.has(path),
        mkdir: async (path) => {
            if (folders.has(path) || files.has(path)) throw new Error(`already exists: ${path}`);
            folders.add(path);
        },
        write: async (path, bytes) => {
            if (files.has(path)) throw new Error(`already exists: ${path}`);
            files.set(path, bytes);
            writes.push(path);
        },
        read: async (path) => {
            if (!files.has(path)) throw new Error(`missing: ${path}`);
            return files.get(path);
        },
        list: async (path) => {
            const prefix = path === "/" ? "" : `${path}/`;
            const directFiles = [...files.keys()].filter((candidate) => {
                if (!candidate.startsWith(prefix)) return false;
                return !candidate.slice(prefix.length).includes("/");
            });
            const directFolders = [...folders].filter((candidate) => {
                if (!candidate.startsWith(prefix) || candidate === path) return false;
                return !candidate.slice(prefix.length).includes("/");
            });
            return { files: directFiles.sort(), folders: directFolders.sort() };
        },
    };
    return { fs, files, folders, writes };
}

function routedMemoryIo() {
    const shared = memoryFs();
    const apiWrites = [];
    const wrap = (api) => ({
        exists: shared.fs.exists,
        read: shared.fs.read,
        list: shared.fs.list,
        mkdir: async (path) => {
            apiWrites.push({ api, type: "directory", path });
            await shared.fs.mkdir(path);
        },
        write: async (path, bytes) => {
            apiWrites.push({ api, type: "file", path });
            await shared.fs.write(path, bytes);
        },
    });
    return { io: { vault: wrap("vault"), adapter: wrap("adapter") }, shared, apiWrites };
}

function exactTree(fs, fixture, rootOverride = fixture.root) {
    const root = fixture.root;
    for (const folder of fixture.folders) {
        const target = folder === root ? rootOverride : `${rootOverride}${folder.slice(root.length)}`;
        fs.folders.add(target);
    }
    for (const file of fixture.files) {
        const target = `${rootOverride}/${file.relativePath}`;
        fs.files.set(target, file.bytes);
        const pieces = target.split("/");
        pieces.pop();
        for (let end = 1; end < pieces.length; end++) fs.folders.add(pieces.slice(0, end).join("/"));
    }
}

describe("replicated storage matrix definitions", () => {
    it("defines fifteen distinct immediate roots per repetition and fresh store IDs across R1-R4", () => {
        expect(MATRIX_CONDITIONS).toHaveLength(15);
        for (const repetition of repetitions) {
            const roots = MATRIX_CONDITIONS.map((condition) =>
                matrixRoot(condition, repetition, STORAGE_MATRIX_EXPERIMENT)
            );
            expect(new Set(roots).size).toBe(15);
            expect(roots.every((root) => !root.slice(1).includes("/"))).toBe(true);
            const ids = ["desktop", "mobile"].map((role) => matrixStoreId(repetition, role, STORAGE_MATRIX_EXPERIMENT));
            expect(new Set(ids).size).toBe(2);
        }
        const allRoots = repetitions.flatMap((repetition) =>
            MATRIX_CONDITIONS.map((condition) => matrixRoot(condition, repetition, STORAGE_MATRIX_EXPERIMENT))
        );
        expect(new Set(allRoots).size).toBe(60);
        const allStoreIds = repetitions.flatMap((repetition) =>
            ["desktop", "mobile"].map((role) => matrixStoreId(repetition, role, STORAGE_MATRIX_EXPERIMENT))
        );
        expect(new Set(allStoreIds).size).toBe(8);
        const reversePhase = {
            experimentId: STORAGE_MATRIX_EXPERIMENT.experimentId,
            directionId: "reverse-desktop-offline",
        };
        expect(matrixStoreId("R1", "desktop", reversePhase)).not.toBe(
            matrixStoreId("R1", "desktop", STORAGE_MATRIX_EXPERIMENT)
        );
    });

    it("uses the exact deterministic R1-R4 execution orders", () => {
        expect(matrixOrder("R1")).toEqual(MATRIX_CONDITIONS.map((condition) => condition.id));
        expect(matrixOrder("R2")).toEqual([
            "A6",
            "A7",
            "B1",
            "B2",
            "B3",
            "B4",
            "B5",
            "B6",
            "C1",
            "C2",
            "A1",
            "A2",
            "A3",
            "A4",
            "A5",
        ]);
        expect(matrixOrder("R3")).toEqual([
            "C2",
            "C1",
            "B6",
            "B5",
            "B4",
            "B3",
            "B2",
            "B1",
            "A7",
            "A6",
            "A5",
            "A4",
            "A3",
            "A2",
            "A1",
        ]);
        expect(matrixOrder("R4")).toEqual([
            "B3",
            "B2",
            "B1",
            "A7",
            "A6",
            "A5",
            "A4",
            "A3",
            "A2",
            "A1",
            "C2",
            "C1",
            "B6",
            "B5",
            "B4",
        ]);
        expect(new Set(Object.values(MATRIX_REPETITION_ORDERS).flat()).size).toBe(15);
    });

    it("defines the two reverse orders and isolates reverse-direction roots from primary roots", () => {
        expect(STORAGE_MATRIX_EXPERIMENT.directionId).toBe("primary-mobile-offline-desktop-online");
        expect(STORAGE_MATRIX_REVERSE_EXPERIMENT).toEqual({
            experimentId: STORAGE_MATRIX_EXPERIMENT.experimentId,
            directionId: "reverse-desktop-offline-mobile-online",
        });
        expect(matrixOrder("RV1")).toEqual([
            "A6",
            "A7",
            "B1",
            "B2",
            "B3",
            "B4",
            "B5",
            "B6",
            "C1",
            "C2",
            "A1",
            "A2",
            "A3",
            "A4",
            "A5",
        ]);
        expect(matrixOrder("RV2")).toEqual([
            "C2",
            "C1",
            "B6",
            "B5",
            "B4",
            "B3",
            "B2",
            "B1",
            "A7",
            "A6",
            "A5",
            "A4",
            "A3",
            "A2",
            "A1",
        ]);

        for (const repetition of ["RV1", "RV2"]) {
            const reversedRoots = MATRIX_CONDITIONS.map((condition) =>
                matrixRoot(condition, repetition, STORAGE_MATRIX_REVERSE_EXPERIMENT)
            );
            const sameLabelPrimaryRoots = MATRIX_CONDITIONS.map((condition) =>
                matrixRoot(condition, repetition, STORAGE_MATRIX_EXPERIMENT)
            );
            expect(new Set(reversedRoots).size).toBe(15);
            expect(reversedRoots).toEqual(
                MATRIX_CONDITIONS.map((condition) =>
                    matrixRoot(condition, repetition, STORAGE_MATRIX_REVERSE_EXPERIMENT)
                )
            );
            expect(reversedRoots.some((root) => sameLabelPrimaryRoots.includes(root))).toBe(false);
        }
        const allReverseRoots = ["RV1", "RV2"].flatMap((repetition) =>
            MATRIX_CONDITIONS.map((condition) => matrixRoot(condition, repetition, STORAGE_MATRIX_REVERSE_EXPERIMENT))
        );
        const allPrimaryRoots = ["R1", "R2", "R3", "R4"].flatMap((repetition) =>
            MATRIX_CONDITIONS.map((condition) => matrixRoot(condition, repetition, STORAGE_MATRIX_EXPERIMENT))
        );
        expect(allReverseRoots.some((root) => allPrimaryRoots.includes(root))).toBe(false);
    });

    it("keeps reverse fixture provenance and desktop/mobile store roles literal", () => {
        const condition = matrixCondition("A6");
        for (const [role, expectedStoreRole] of [
            ["desktop", "A"],
            ["mobile", "B"],
        ]) {
            const fixture = matrixDeviceFixture(condition, "RV1", role, STORAGE_MATRIX_REVERSE_EXPERIMENT);
            expect(fixture.storeId).toContain("reverse-desktop-offline-mobile-online");
            expect(fixture.storeId).toMatch(new RegExp(`-RV1-${role}-${expectedStoreRole}$`));
            for (const file of fixture.files) {
                const provenance = JSON.parse(file.bytes);
                expect(provenance).toMatchObject({
                    experimentId: STORAGE_MATRIX_EXPERIMENT.experimentId,
                    directionId: "reverse-desktop-offline-mobile-online",
                    repetition: "RV1",
                    conditionId: "A6",
                    storeId: fixture.storeId,
                    deviceRole: role,
                    intendedWriterApi: file.intendedWriterApi,
                    fileRole: file.fileRole,
                    fileIndex: file.fileIndex,
                    value: file.value,
                });
            }
        }
    });

    it("assigns the A-family API routes and isolates every A root", () => {
        const apis = (id, role) => matrixCondition(id)[role];
        expect(apis("A1", "desktop")).toEqual({ directory: "vault", manifest: "vault", documents: "vault" });
        expect(apis("A1", "mobile")).toEqual({ directory: "vault", manifest: "vault", documents: "vault" });
        expect(apis("A2", "desktop")).toEqual({ directory: "adapter", manifest: "adapter", documents: "adapter" });
        expect(apis("A2", "mobile")).toEqual({ directory: "adapter", manifest: "adapter", documents: "adapter" });
        expect(apis("A3", "desktop")).toEqual({ directory: "vault", manifest: "vault", documents: "vault" });
        expect(apis("A3", "mobile")).toEqual({ directory: "adapter", manifest: "adapter", documents: "adapter" });
        expect(apis("A4", "desktop")).toEqual({ directory: "adapter", manifest: "adapter", documents: "adapter" });
        expect(apis("A4", "mobile")).toEqual({ directory: "vault", manifest: "vault", documents: "vault" });
        expect(apis("A5", "desktop")).toEqual({ directory: "vault", manifest: "vault", documents: "adapter" });
        expect(apis("A5", "mobile")).toEqual({ directory: "vault", manifest: "vault", documents: "adapter" });
        expect(apis("A6", "desktop")).toEqual({ directory: "adapter", manifest: "adapter", documents: "vault" });
        expect(apis("A6", "mobile")).toEqual({ directory: "adapter", manifest: "adapter", documents: "vault" });
        expect(matrixCondition("A7").visibility).toBe("hidden");
        for (const role of ["desktop", "mobile"])
            expect(apis("A7", role)).toEqual({ directory: "adapter", manifest: "adapter", documents: "adapter" });
        expect(
            new Set(
                MATRIX_CONDITIONS.slice(0, 7).map((condition) => matrixRoot(condition, "R1", STORAGE_MATRIX_EXPERIMENT))
            ).size
        ).toBe(7);
    });

    it("keeps every Hidden condition on Adapter and describes B/C collision layouts exactly", () => {
        for (const condition of MATRIX_CONDITIONS.filter((candidate) => candidate.visibility === "hidden")) {
            expect(condition.desktop).toEqual({ directory: "adapter", manifest: "adapter", documents: "adapter" });
            expect(condition.mobile).toEqual({ directory: "adapter", manifest: "adapter", documents: "adapter" });
        }
        for (const id of ["B1", "B2"]) {
            const desktop = matrixDeviceFixture(matrixCondition(id), "R1", "desktop");
            const mobile = matrixDeviceFixture(matrixCondition(id), "R1", "mobile");
            expect(desktop.files).toHaveLength(1);
            expect(mobile.files).toHaveLength(1);
            expect(desktop.files[0].relativePath).toBe(mobile.files[0].relativePath);
            expect(desktop.files[0].bytes).not.toBe(mobile.files[0].bytes);
        }
        for (const id of ["B3", "B4"]) {
            const desktop = matrixDeviceFixture(matrixCondition(id), "R1", "desktop");
            const mobile = matrixDeviceFixture(matrixCondition(id), "R1", "mobile");
            expect(desktop.files).toHaveLength(10);
            expect(mobile.files).toHaveLength(10);
            expect(
                desktop.files
                    .map((file) => file.relativePath)
                    .filter((path) => mobile.files.some((file) => file.relativePath === path))
            ).toEqual([]);
        }
        for (const id of ["B5", "B6"]) {
            const desktop = matrixDeviceFixture(matrixCondition(id), "R1", "desktop");
            const mobile = matrixDeviceFixture(matrixCondition(id), "R1", "mobile");
            expect(desktop.files).toHaveLength(10);
            expect(mobile.files).toHaveLength(10);
            expect(desktop.files.map((file) => file.relativePath)).toEqual(
                mobile.files.map((file) => file.relativePath)
            );
            expect(desktop.files.every((file, index) => file.bytes !== mobile.files[index].bytes)).toBe(true);
        }
        for (const id of ["C1", "C2"]) {
            const desktop = matrixDeviceFixture(matrixCondition(id), "R1", "desktop");
            const mobile = matrixDeviceFixture(matrixCondition(id), "R1", "mobile");
            expect(desktop.files.map((file) => file.relativePath)).toEqual([
                `stores/${desktop.storeId}/manifest.json`,
                `stores/${desktop.storeId}/document-00.json`,
                `stores/${desktop.storeId}/document-01.json`,
                `stores/${desktop.storeId}/document-02.json`,
            ]);
            expect(desktop.storeId).not.toBe(mobile.storeId);
            expect(desktop.files.every((file) => !file.relativePath.startsWith("manifest.json"))).toBe(true);
        }
    });
});

describe("storage matrix guarded initialization", () => {
    it("initializes and locally validates all fifteen conditions through their declared writer APIs", async () => {
        const { io, shared, apiWrites } = routedMemoryIo();
        const result = await initializeMatrixRepetition(io, "R1", "desktop");
        expect(result.complete).toBe(true);
        expect(result.outcomes).toHaveLength(15);
        for (const condition of MATRIX_CONDITIONS) {
            const fixture = matrixDeviceFixture(condition, "R1", "desktop");
            expect(await verifyMatrixFixture(io.adapter, fixture)).toMatchObject({ valid: true });
            for (const file of fixture.files) {
                const writerCall = apiWrites.find((call) => call.path === `${fixture.root}/${file.relativePath}`);
                expect(writerCall.api).toBe(file.intendedWriterApi);
            }
            expect(apiWrites.find((call) => call.path === fixture.root && call.type === "directory").api).toBe(
                condition.desktop.directory
            );
            expect(shared.files.size).toBeGreaterThan(0);
        }
    });

    it("refuses all writes when any nominal target or plausible provider sibling already exists", async () => {
        for (const existing of [
            matrixRoot(matrixCondition("A1"), "R1", STORAGE_MATRIX_EXPERIMENT),
            `${matrixRoot(matrixCondition("B2"), "R1", STORAGE_MATRIX_EXPERIMENT)} (provider copy arbitrary)`,
        ]) {
            const adapterFs = memoryFs();
            const vaultFs = memoryFs();
            adapterFs.folders.add(existing);
            const result = await initializeMatrixRepetition(
                { vault: vaultFs.fs, adapter: adapterFs.fs },
                "R1",
                "mobile"
            );
            expect(result.complete).toBe(false);
            expect(result.outcomes).toHaveLength(15);
            expect(result.outcomes.every((outcome) => outcome.state === "NOT_RUN")).toBe(true);
            expect(adapterFs.writes).toHaveLength(0);
            expect(vaultFs.writes).toHaveLength(0);
        }
    });

    it("marks a failed middle condition INVALID and continues initializing later independent conditions", async () => {
        for (const change of ["extra", "missing", "foreign"]) {
            const { io, shared, apiWrites } = routedMemoryIo();
            const damagedAdapter = {
                ...io.adapter,
                write: async (path, bytes) => {
                    const conditionRoot = matrixRoot(matrixCondition("A6"), "R1", STORAGE_MATRIX_EXPERIMENT);
                    if (!path.startsWith(`${conditionRoot}/`)) return io.adapter.write(path, bytes);
                    if (change === "missing" && path.endsWith("manifest.json")) return;
                    if (change === "foreign" && path.endsWith("manifest.json")) {
                        bytes = bytes.replace(/"storeId": "[^"]+"/, '"storeId": "foreign-store"');
                    }
                    await io.adapter.write(path, bytes);
                    if (change === "extra" && path.endsWith("manifest.json")) {
                        await io.adapter.write(`${path.slice(0, -"manifest.json".length)}unexpected.json`, "{}");
                    }
                },
            };
            const result = await initializeMatrixRepetition(
                { vault: io.vault, adapter: damagedAdapter },
                "R1",
                "desktop"
            );
            expect(result.complete).toBe(false);
            const failedIndex = result.outcomes.findIndex((outcome) => outcome.conditionId === "A6");
            expect(result.outcomes[failedIndex].state).toBe("INVALID");
            expect(result.outcomes.slice(failedIndex + 1).every((outcome) => outcome.state === "VALID")).toBe(true);
            expect(result.outcomes.some((outcome) => outcome.state === "NOT_RUN")).toBe(false);
            expect(result.outcomes.filter((outcome) => outcome.state === "INVALID")).toHaveLength(1);
            expect(shared.files.size).toBeGreaterThan(0);
            expect(apiWrites.length).toBeGreaterThan(0);
        }
    });

    it("uses the selected direction ID in fixture provenance without coupling the builder to it", () => {
        const challenge = { experimentId: "matrix-challenge-1", directionId: "reverse-desktop-offline" };
        const fixture = matrixDeviceFixture(matrixCondition("C1"), "R2", "mobile", challenge);
        const parsed = JSON.parse(fixture.files[0].bytes);
        expect(parsed.experimentId).toBe(challenge.experimentId);
        expect(parsed.directionId).toBe(challenge.directionId);
    });
});

describe("bounded storage matrix inspection", () => {
    it("discovers arbitrary provider suffixes without scanning outside the immediate root", () => {
        const root = matrixRoot(matrixCondition("A1"), "R1", STORAGE_MATRIX_EXPERIMENT);
        expect(
            matrixRootCandidates(
                [`${root} (Cloud conflict copy)`, `${root}/nested`, root, `${root} (Cloud conflict copy)`, "unrelated"],
                root
            )
        ).toEqual([root, `${root} (Cloud conflict copy)`]);
    });

    it("distinguishes coherent sibling roots from a merged tree and does not mutate during inspection", async () => {
        const memory = memoryFs();
        const condition = matrixCondition("A1");
        const desktop = matrixDeviceFixture(condition, "R1", "desktop");
        const mobile = matrixDeviceFixture(condition, "R1", "mobile");
        exactTree(memory, desktop);
        exactTree(memory, mobile, `${mobile.root} provider generated sibling`);
        const before = [...memory.files.entries()];
        const split = await inspectMatrixCondition(memory.fs, condition, "R1");
        expect(split.summary).toBe("SPLIT_COHERENT");
        expect(split.candidates).toHaveLength(2);
        expect([...memory.files.entries()]).toEqual(before);

        const duplicateMemory = memoryFs();
        const duplicateMobileRoot = `${mobile.root} provider generated duplicate`;
        exactTree(duplicateMemory, desktop);
        exactTree(duplicateMemory, mobile, `${mobile.root} provider generated sibling`);
        exactTree(duplicateMemory, mobile, duplicateMobileRoot);
        const duplicated = await inspectMatrixCondition(duplicateMemory.fs, condition, "R1");
        expect(duplicated.summary).toBe("OTHER_OBSERVED");
        expect(duplicated.candidates).toHaveLength(3);
        expect(duplicated.candidates.map((candidate) => candidate.root)).toEqual(
            [...duplicated.candidates.map((candidate) => candidate.root)].sort()
        );

        const unionMemory = memoryFs();
        for (const fixture of [desktop, mobile]) {
            for (const folder of fixture.folders) unionMemory.folders.add(folder);
            for (const file of fixture.files) {
                if (file.relativePath === "manifest.json" && fixture === mobile) continue;
                unionMemory.files.set(`${fixture.root}/${file.relativePath}`, file.bytes);
            }
        }
        const merged = await inspectMatrixCondition(unionMemory.fs, condition, "R1");
        expect(merged.summary).toBe("MERGED_MIXED_INVALID");
        expect(merged.candidates[0].files.map((file) => file.relativePath)).toContain("document-mobile.json");
    });

    it("keeps root candidates and inspection fingerprints stable across listing order and duplicates", async () => {
        const memory = memoryFs();
        const condition = matrixCondition("A1");
        const desktop = matrixDeviceFixture(condition, "R2", "desktop");
        const mobile = matrixDeviceFixture(condition, "R2", "mobile");
        const sibling = `${mobile.root} arbitrary provider suffix`;
        exactTree(memory, desktop);
        exactTree(memory, mobile, sibling);
        const baseFolders = [...memory.folders].filter((path) => !path.includes("/"));
        const forwardReader = {
            ...memory.fs,
            list: async (path) => (path === "/" ? { files: [], folders: baseFolders } : memory.fs.list(path)),
        };
        const reverseReader = {
            ...memory.fs,
            list: async (path) =>
                path === "/"
                    ? { files: [], folders: [...baseFolders].reverse().concat(baseFolders[0]) }
                    : memory.fs.list(path),
        };
        const forward = await inspectMatrixCondition(forwardReader, condition, "R2");
        const reverse = await inspectMatrixCondition(reverseReader, condition, "R2");
        expect(forward.candidates.map((candidate) => candidate.root)).toEqual(
            reverse.candidates.map((candidate) => candidate.root)
        );
        expect(forward.fingerprint).toBe(reverse.fingerprint);
    });

    it("does not classify altered fixture bytes as a clean known winner", async () => {
        const memory = memoryFs();
        const condition = matrixCondition("B1");
        const desktop = matrixDeviceFixture(condition, "R1", "desktop");
        exactTree(memory, desktop);
        const target = `${desktop.root}/${desktop.files[0].relativePath}`;
        const altered = JSON.parse(memory.files.get(target));
        altered.uncheckedProviderField = "unexpected alteration";
        memory.files.set(target, JSON.stringify(altered));

        const result = await inspectMatrixCondition(memory.fs, condition, "R1");
        expect(result.summary).not.toBe("WINNER_ONLY");
        expect(result.summary).toBe("PARTIAL");
        expect(result.candidates[0].files[0].raw).toBe(JSON.stringify(altered));
    });

    it("identifies coherent B3 disjoint-file union and B5 per-file torn winner distribution", async () => {
        const disjointMemory = memoryFs();
        const disjoint = matrixCondition("B3");
        for (const fixture of matrixExpectedUnion(disjoint, "R1")) exactTree(disjointMemory, fixture);
        expect((await inspectMatrixCondition(disjointMemory.fs, disjoint, "R1")).summary).toBe("MERGED_COHERENT_UNION");

        const tornMemory = memoryFs();
        const torn = matrixCondition("B5");
        const [desktop, mobile] = matrixExpectedUnion(torn, "R1");
        tornMemory.folders.add(desktop.root);
        for (let index = 0; index < 10; index++) {
            const winner = index % 2 === 0 ? desktop : mobile;
            const file = winner.files[index];
            tornMemory.files.set(`${winner.root}/${file.relativePath}`, file.bytes);
        }
        const inspection = await inspectMatrixCondition(tornMemory.fs, torn, "R1");
        expect(inspection.summary).toBe("TORN_MULTI_FILE");
        expect(inspection.winnerDistribution).toEqual({ desktop: 5, mobile: 5 });
        expect(inspection.detail).toContain("per-file winners");
    });

    it("treats merged C1/C2 unique store subtrees as coherent and reports unexpected states raw", async () => {
        for (const id of ["C1", "C2"]) {
            const memory = memoryFs();
            const condition = matrixCondition(id);
            for (const fixture of matrixExpectedUnion(condition, "R3")) exactTree(memory, fixture);
            const result = await inspectMatrixCondition(memory.fs, condition, "R3");
            expect(result.summary).toBe("MERGED_COHERENT_UNION");
            expect(result.candidates[0].files).toHaveLength(8);
        }
        const unknownMemory = memoryFs();
        const condition = matrixCondition("B1");
        const root = matrixRoot(condition, "R1", STORAGE_MATRIX_EXPERIMENT);
        unknownMemory.folders.add(root);
        unknownMemory.files.set(`${root}/provider-surprise.bin`, "raw provider state");
        const result = await inspectMatrixCondition(unknownMemory.fs, condition, "R1");
        expect(result.summary).toBe("OTHER_OBSERVED");
        expect(result.candidates[0].files[0].raw).toBe("raw provider state");
    });

    it("detects a document that crosses its C-family storeId directory boundary", async () => {
        const memory = memoryFs();
        const condition = matrixCondition("C1");
        const [desktop, mobile] = matrixExpectedUnion(condition, "R1");
        for (const fixture of [desktop, mobile]) exactTree(memory, fixture);
        const crossing = `${desktop.root}/stores/${desktop.storeId}/document-00.json`;
        const mobileDoc = mobile.files.find((file) => file.relativePath.endsWith("document-00.json"));
        memory.files.set(crossing, mobileDoc.bytes);
        const result = await inspectMatrixCondition(memory.fs, condition, "R1");
        expect(result.summary).toBe("MERGED_MIXED_INVALID");
        expect(result.detail).toMatch(/crossed or mixed/);
        expect(result.candidates[0].files.some((file) => file.raw === mobileDoc.bytes)).toBe(true);
    });
});
