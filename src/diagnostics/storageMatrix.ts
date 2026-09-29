import type { ProbeDirectoryReader, ProbeDirectoryWriter } from "./storageProbeModel";

export type MatrixDeviceRole = "desktop" | "mobile";
export type MatrixWriterApi = "vault" | "adapter";
export type MatrixRepetition = "R1" | "R2" | "R3" | "R4" | "RV1" | "RV2";
export type MatrixVisibility = "visible" | "hidden";
export type MatrixFamily = "A" | "B" | "C";
export type MatrixTopology = "standard" | "one-collision" | "disjoint-ten" | "collision-ten" | "namespaced-stores";

export interface MatrixApiRoute {
    directory: MatrixWriterApi;
    manifest: MatrixWriterApi;
    documents: MatrixWriterApi;
}

export interface MatrixCondition {
    id: string;
    family: MatrixFamily;
    visibility: MatrixVisibility;
    topology: MatrixTopology;
    desktop: MatrixApiRoute;
    mobile: MatrixApiRoute;
}

export interface MatrixExperiment {
    experimentId: string;
    directionId: string;
}

export interface MatrixFileFixture {
    relativePath: string;
    intendedWriterApi: MatrixWriterApi;
    fileRole: string;
    fileIndex: number | null;
    value: string;
    bytes: string;
}

export interface MatrixDeviceFixture {
    root: string;
    storeId: string;
    folders: string[];
    files: MatrixFileFixture[];
}

export interface MatrixIoByApi {
    vault: ProbeDirectoryWriter;
    adapter: ProbeDirectoryWriter;
}

export interface MatrixConditionOutcome {
    conditionId: string;
    root: string;
    state: "VALID" | "INVALID" | "NOT_RUN";
    detail: string;
}

export interface MatrixInitResult {
    repetition: MatrixRepetition;
    role: MatrixDeviceRole;
    experiment: MatrixExperiment;
    outcomes: MatrixConditionOutcome[];
    complete: boolean;
}

export const STORAGE_MATRIX_EXPERIMENT: MatrixExperiment = {
    experimentId: "fk-icloud-matrix-20260927",
    directionId: "primary-mobile-offline-desktop-online",
};

export const STORAGE_MATRIX_REVERSE_EXPERIMENT: MatrixExperiment = {
    experimentId: STORAGE_MATRIX_EXPERIMENT.experimentId,
    directionId: "reverse-desktop-offline-mobile-online",
};

export const MATRIX_CONDITION_ORDER = [
    "A1",
    "A2",
    "A3",
    "A4",
    "A5",
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
] as const;

export const MATRIX_REPETITION_ORDERS: Record<MatrixRepetition, readonly string[]> = {
    R1: MATRIX_CONDITION_ORDER,
    R2: ["A6", "A7", "B1", "B2", "B3", "B4", "B5", "B6", "C1", "C2", "A1", "A2", "A3", "A4", "A5"],
    R3: [...MATRIX_CONDITION_ORDER].reverse(),
    R4: ["B3", "B2", "B1", "A7", "A6", "A5", "A4", "A3", "A2", "A1", "C2", "C1", "B6", "B5", "B4"],
    RV1: ["A6", "A7", "B1", "B2", "B3", "B4", "B5", "B6", "C1", "C2", "A1", "A2", "A3", "A4", "A5"],
    RV2: ["C2", "C1", "B6", "B5", "B4", "B3", "B2", "B1", "A7", "A6", "A5", "A4", "A3", "A2", "A1"],
};

const ROUTES: Record<string, [MatrixApiRoute, MatrixApiRoute]> = {
    A1: [route("vault", "vault", "vault"), route("vault", "vault", "vault")],
    A2: [route("adapter", "adapter", "adapter"), route("adapter", "adapter", "adapter")],
    A3: [route("vault", "vault", "vault"), route("adapter", "adapter", "adapter")],
    A4: [route("adapter", "adapter", "adapter"), route("vault", "vault", "vault")],
    A5: [route("vault", "vault", "adapter"), route("vault", "vault", "adapter")],
    A6: [route("adapter", "adapter", "vault"), route("adapter", "adapter", "vault")],
    A7: [route("adapter", "adapter", "adapter"), route("adapter", "adapter", "adapter")],
};

export const MATRIX_CONDITIONS: MatrixCondition[] = [
    ...(["A1", "A2", "A3", "A4", "A5", "A6", "A7"] as const).map((id) => ({
        id,
        family: "A" as const,
        visibility: id === "A7" ? ("hidden" as const) : ("visible" as const),
        topology: "standard" as const,
        desktop: ROUTES[id][0],
        mobile: ROUTES[id][1],
    })),
    ...(["B1", "B2", "B3", "B4", "B5", "B6"] as const).map((id) => ({
        id,
        family: "B" as const,
        visibility: id === "B2" || id === "B4" || id === "B6" ? ("hidden" as const) : ("visible" as const),
        topology: bTopology(id),
        desktop: route("adapter", "adapter", "adapter"),
        mobile: route("adapter", "adapter", "adapter"),
    })),
    ...(["C1", "C2"] as const).map((id) => ({
        id,
        family: "C" as const,
        visibility: id === "C2" ? ("hidden" as const) : ("visible" as const),
        topology: "namespaced-stores" as const,
        desktop: route("adapter", "adapter", "adapter"),
        mobile: route("adapter", "adapter", "adapter"),
    })),
];

function route(directory: MatrixWriterApi, manifest: MatrixWriterApi, documents: MatrixWriterApi): MatrixApiRoute {
    return { directory, manifest, documents };
}

function bTopology(id: string): MatrixTopology {
    if (id === "B1" || id === "B2") return "one-collision";
    if (id === "B3" || id === "B4") return "disjoint-ten";
    return "collision-ten";
}

function slug(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function matrixCondition(id: string): MatrixCondition {
    const condition = MATRIX_CONDITIONS.find((candidate) => candidate.id === id);
    if (!condition) throw new Error(`Unknown storage matrix condition ${id}`);
    return condition;
}

export function matrixOrder(repetition: MatrixRepetition): readonly string[] {
    return MATRIX_REPETITION_ORDERS[repetition];
}

export function matrixRoot(
    condition: MatrixCondition,
    repetition: MatrixRepetition,
    experiment: MatrixExperiment
): string {
    const name = `fk-storage-matrix-${slug(experiment.experimentId)}-${slug(experiment.directionId)}-${repetition}-${condition.id}`;
    return condition.visibility === "hidden" ? `.${name}` : `FK-${name}`;
}

export function matrixRootCandidates(folders: string[], nominalRoot: string): string[] {
    const candidates = folders.flatMap((path) => {
        const name = path.startsWith("/") ? path.slice(1) : path;
        return !name.includes("/") && name.startsWith(nominalRoot) ? [name] : [];
    });
    return [...new Set(candidates)].sort();
}

export function matrixStoreId(
    repetition: MatrixRepetition,
    role: MatrixDeviceRole,
    experiment: MatrixExperiment
): string {
    return `fk-${slug(experiment.experimentId)}-${slug(experiment.directionId)}-${repetition}-${role}-${role === "desktop" ? "A" : "B"}`;
}

function encodeFile(
    experiment: MatrixExperiment,
    repetition: MatrixRepetition,
    condition: MatrixCondition,
    role: MatrixDeviceRole,
    storeId: string,
    relativePath: string,
    intendedWriterApi: MatrixWriterApi,
    fileRole: string,
    fileIndex: number | null,
    value: string
): MatrixFileFixture {
    const bytes = JSON.stringify(
        {
            probeKind: "finders-keepers-storage-matrix",
            version: 1,
            experimentId: experiment.experimentId,
            directionId: experiment.directionId,
            repetition,
            conditionId: condition.id,
            storeId,
            deviceRole: role,
            intendedWriterApi,
            fileRole,
            fileIndex,
            value,
        },
        null,
        2
    );
    return { relativePath, intendedWriterApi, fileRole, fileIndex, value, bytes };
}

export function matrixDeviceFixture(
    condition: MatrixCondition,
    repetition: MatrixRepetition,
    role: MatrixDeviceRole,
    experiment: MatrixExperiment = STORAGE_MATRIX_EXPERIMENT
): MatrixDeviceFixture {
    const root = matrixRoot(condition, repetition, experiment);
    const routeForDevice = condition[role];
    const storeId = matrixStoreId(repetition, role, experiment);
    const folders = [root];
    const files: MatrixFileFixture[] = [];
    const add = (
        relativePath: string,
        api: MatrixWriterApi,
        fileRole: string,
        fileIndex: number | null,
        value: string
    ) => {
        files.push(
            encodeFile(experiment, repetition, condition, role, storeId, relativePath, api, fileRole, fileIndex, value)
        );
    };

    if (condition.topology === "namespaced-stores") {
        folders.push(`${root}/stores`, `${root}/stores/${storeId}`);
        const storeBase = `stores/${storeId}`;
        add(`${storeBase}/manifest.json`, routeForDevice.manifest, "manifest", null, `${role}-manifest`);
        for (let index = 0; index < 3; index++) {
            add(
                `${storeBase}/document-${String(index).padStart(2, "0")}.json`,
                routeForDevice.documents,
                "document",
                index,
                `${role}-document-${String(index).padStart(2, "0")}`
            );
        }
    } else if (condition.topology === "one-collision") {
        add("collision.json", routeForDevice.documents, "collision", 0, `${role}-collision`);
    } else if (condition.topology === "disjoint-ten") {
        for (let index = 0; index < 10; index++) {
            const fileRole = `file-${role}-${String(index).padStart(2, "0")}`;
            add(
                `${fileRole}.json`,
                routeForDevice.documents,
                "disjoint",
                index,
                `${role}-${String(index).padStart(2, "0")}`
            );
        }
    } else if (condition.topology === "collision-ten") {
        for (let index = 0; index < 10; index++) {
            const fileName = `file-${String(index).padStart(2, "0")}.json`;
            add(fileName, routeForDevice.documents, "collision", index, `${role}-${String(index).padStart(2, "0")}`);
        }
    } else {
        add("manifest.json", routeForDevice.manifest, "manifest", null, `${role}-manifest`);
        add(`document-${role}.json`, routeForDevice.documents, "document", null, `${role}-document`);
    }

    return { root, storeId, folders, files };
}

export function matrixExpectedUnion(
    condition: MatrixCondition,
    repetition: MatrixRepetition,
    experiment: MatrixExperiment = STORAGE_MATRIX_EXPERIMENT
): MatrixDeviceFixture[] {
    return (["desktop", "mobile"] as const).map((role) => matrixDeviceFixture(condition, repetition, role, experiment));
}

export async function preflightMatrixRepetition(
    reader: ProbeDirectoryReader,
    repetition: MatrixRepetition,
    experiment: MatrixExperiment = STORAGE_MATRIX_EXPERIMENT
): Promise<void> {
    let rootEntries: { files: string[]; folders: string[] };
    try {
        rootEntries = await reader.list("/");
    } catch (error) {
        throw new Error(`Cannot safely enumerate vault root before matrix initialization: ${String(error)}`);
    }
    const conflicts: string[] = [];
    for (const condition of MATRIX_CONDITIONS) {
        const root = matrixRoot(condition, repetition, experiment);
        if (await reader.exists(root)) conflicts.push(`${root} exists`);
        const candidates = matrixRootCandidates(rootEntries.folders, root);
        if (candidates.length) conflicts.push(`${root} has matching root candidates ${JSON.stringify(candidates)}`);
    }
    if (conflicts.length)
        throw new Error(`Refusing matrix repetition ${repetition}; targets must all be fresh: ${conflicts.join("; ")}`);
}

async function listTree(reader: ProbeDirectoryReader, root: string): Promise<{ files: string[]; folders: string[] }> {
    const files: string[] = [];
    const folders: string[] = [];
    const pending = [{ path: root, depth: 0 }];
    while (pending.length) {
        const next = pending.shift();
        if (!next) break;
        if (next.depth > 3 || files.length > 100 || folders.length > 40)
            throw new Error("matrix tree exceeded read bound");
        const entries = await reader.list(next.path);
        files.push(...entries.files);
        folders.push(...entries.folders);
        pending.push(...entries.folders.map((path) => ({ path, depth: next.depth + 1 })));
    }
    return { files: files.sort(), folders: folders.sort() };
}

export async function verifyMatrixFixture(
    reader: ProbeDirectoryReader,
    fixture: MatrixDeviceFixture
): Promise<{ valid: boolean; detail: string }> {
    try {
        const tree = await listTree(reader, fixture.root);
        const expectedFiles = fixture.files.map((file) => `${fixture.root}/${file.relativePath}`).sort();
        const expectedFolders = fixture.folders.filter((folder) => folder !== fixture.root).sort();
        if (JSON.stringify(tree.files) !== JSON.stringify(expectedFiles)) {
            return {
                valid: false,
                detail: `file tree differs; expected=${JSON.stringify(expectedFiles)} observed=${JSON.stringify(tree.files)}`,
            };
        }
        if (JSON.stringify(tree.folders) !== JSON.stringify(expectedFolders)) {
            return {
                valid: false,
                detail: `folder tree differs; expected=${JSON.stringify(expectedFolders)} observed=${JSON.stringify(tree.folders)}`,
            };
        }
        for (const file of fixture.files) {
            const path = `${fixture.root}/${file.relativePath}`;
            const actual = await reader.read(path);
            if (actual !== file.bytes) return { valid: false, detail: `${path} bytes differ from expected fixture` };
            const parsed = JSON.parse(actual) as Record<string, unknown>;
            if (
                parsed.probeKind !== "finders-keepers-storage-matrix" ||
                parsed.version !== 1 ||
                parsed.storeId !== fixture.storeId ||
                parsed.value !== file.value
            )
                return { valid: false, detail: `${path} provenance does not match the local fixture` };
        }
        return { valid: true, detail: `${fixture.files.length} expected files and exact directory tree verified` };
    } catch (error) {
        return { valid: false, detail: `local verification unavailable: ${String(error)}` };
    }
}

export async function initializeMatrixRepetition(
    io: MatrixIoByApi,
    repetition: MatrixRepetition,
    role: MatrixDeviceRole,
    experiment: MatrixExperiment = STORAGE_MATRIX_EXPERIMENT
): Promise<MatrixInitResult> {
    const order = matrixOrder(repetition);
    const outcomes: MatrixConditionOutcome[] = [];
    try {
        await preflightMatrixRepetition(io.adapter, repetition, experiment);
    } catch (error) {
        return {
            repetition,
            role,
            experiment,
            complete: false,
            outcomes: MATRIX_CONDITIONS.map((condition) => ({
                conditionId: condition.id,
                root: matrixRoot(condition, repetition, experiment),
                state: "NOT_RUN",
                detail: `preflight refused before any writes: ${String(error)}`,
            })),
        };
    }

    for (const conditionId of order) {
        const condition = matrixCondition(conditionId);
        const fixture = matrixDeviceFixture(condition, repetition, role, experiment);
        try {
            for (const folder of fixture.folders) await io[condition[role].directory].mkdir(folder);
            for (const file of fixture.files) {
                await io[file.intendedWriterApi].write(`${fixture.root}/${file.relativePath}`, file.bytes);
            }
            const verified = await verifyMatrixFixture(io.adapter, fixture);
            outcomes.push({
                conditionId,
                root: fixture.root,
                state: verified.valid ? "VALID" : "INVALID",
                detail: verified.detail,
            });
        } catch (error) {
            const verified = await verifyMatrixFixture(io.adapter, fixture);
            outcomes.push({
                conditionId,
                root: fixture.root,
                state: "INVALID",
                detail: `initialization failed: ${String(error)}; post-failure reread: ${verified.detail}`,
            });
        }
    }
    return {
        repetition,
        role,
        experiment,
        outcomes,
        complete:
            outcomes.length === MATRIX_CONDITIONS.length && outcomes.every((outcome) => outcome.state === "VALID"),
    };
}

export type MatrixSummary =
    | "ABSENT"
    | "SPLIT_COHERENT"
    | "MERGED_COHERENT_UNION"
    | "MERGED_MIXED_INVALID"
    | "WINNER_ONLY"
    | "TORN_MULTI_FILE"
    | "PARTIAL"
    | "UNAVAILABLE"
    | "OTHER_OBSERVED";

export interface MatrixObservedFile {
    relativePath: string;
    raw: string;
    parsed: unknown;
    parseError?: string;
    provenance?: Record<string, unknown>;
    readError?: string;
}

export interface MatrixRootSnapshot {
    root: string;
    files: MatrixObservedFile[];
    folders: string[];
    missingFiles: string[];
    unexpectedFiles: string[];
    missingFolders: string[];
    unexpectedFolders: string[];
    fingerprint: string;
    error?: string;
}

export interface MatrixInspection {
    repetition: MatrixRepetition;
    conditionId: string;
    candidates: MatrixRootSnapshot[];
    summary: MatrixSummary;
    detail: string;
    fingerprint: string;
    winnerDistribution: Record<string, number>;
}

function fingerprint(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseObserved(raw: string): Pick<MatrixObservedFile, "parsed" | "parseError" | "provenance"> {
    try {
        const parsed: unknown = JSON.parse(raw);
        return {
            parsed,
            provenance:
                parsed && typeof parsed === "object" && !Array.isArray(parsed)
                    ? (parsed as Record<string, unknown>)
                    : undefined,
        };
    } catch (error) {
        return { parsed: null, parseError: String(error) };
    }
}

async function snapshotRoot(reader: ProbeDirectoryReader, root: string): Promise<MatrixRootSnapshot> {
    try {
        const tree = await listTree(reader, root);
        const files: MatrixObservedFile[] = [];
        for (const path of tree.files) {
            const relativePath = path.slice(root.length + 1);
            try {
                const raw = await reader.read(path);
                files.push({ relativePath, raw, ...parseObserved(raw) });
            } catch (error) {
                files.push({ relativePath, raw: "", parsed: null, readError: String(error) });
            }
        }
        const serialized = JSON.stringify({ root, files, folders: tree.folders });
        return {
            root,
            files,
            folders: tree.folders,
            missingFiles: [],
            unexpectedFiles: [],
            missingFolders: [],
            unexpectedFolders: [],
            fingerprint: fingerprint(serialized),
        };
    } catch (error) {
        const detail = String(error);
        return {
            root,
            files: [],
            folders: [],
            missingFiles: [],
            unexpectedFiles: [],
            missingFolders: [],
            unexpectedFolders: [],
            fingerprint: fingerprint(`${root}:${detail}`),
            error: detail,
        };
    }
}

function coherentRoleTree(
    snapshot: MatrixRootSnapshot,
    condition: MatrixCondition,
    repetition: MatrixRepetition,
    experiment: MatrixExperiment
): boolean {
    if (snapshot.error || snapshot.files.some((file) => file.readError || file.parseError || !file.provenance))
        return false;
    const role = snapshot.files[0]?.provenance?.deviceRole;
    if (role !== "desktop" && role !== "mobile") return false;
    if (snapshot.files.some((file) => file.provenance?.deviceRole !== role)) return false;
    const expected = matrixDeviceFixture(condition, repetition, role, experiment);
    if (expected.files.length !== snapshot.files.length) return false;
    const observed = new Map(snapshot.files.map((file) => [file.relativePath, file.raw]));
    return (
        expected.files.every((file) => observed.get(file.relativePath) === file.bytes) &&
        JSON.stringify(snapshot.folders.map((path) => path.slice(snapshot.root.length)).sort()) ===
            JSON.stringify(
                expected.folders
                    .filter((path) => path !== expected.root)
                    .map((path) => path.slice(expected.root.length))
                    .sort()
            )
    );
}

function validProvenance(
    file: MatrixObservedFile,
    condition: MatrixCondition,
    repetition: MatrixRepetition,
    experiment: MatrixExperiment
): boolean {
    const p = file.provenance;
    if (!p || file.parseError || file.readError) return false;
    const role = p.deviceRole;
    if (role !== "desktop" && role !== "mobile") return false;
    const fixture = matrixDeviceFixture(condition, repetition, role, experiment);
    const expected = fixture.files.find((item) => item.relativePath === file.relativePath);
    return (
        !!expected &&
        file.raw === expected.bytes &&
        p.probeKind === "finders-keepers-storage-matrix" &&
        p.version === 1 &&
        p.experimentId === experiment.experimentId &&
        p.directionId === experiment.directionId &&
        p.repetition === repetition &&
        p.conditionId === condition.id &&
        p.storeId === fixture.storeId &&
        p.intendedWriterApi === expected.intendedWriterApi &&
        p.fileRole === expected.fileRole &&
        p.fileIndex === expected.fileIndex &&
        p.value === expected.value
    );
}

function classifyCandidates(
    candidates: MatrixRootSnapshot[],
    condition: MatrixCondition,
    repetition: MatrixRepetition,
    experiment: MatrixExperiment
): { summary: MatrixSummary; detail: string; winners: Record<string, number> } {
    const winners: Record<string, number> = {};
    if (!candidates.length)
        return { summary: "ABSENT", detail: "no nominal or plausible sibling roots found", winners };
    if (candidates.some((candidate) => candidate.error || candidate.files.some((file) => file.readError))) {
        return {
            summary: "UNAVAILABLE",
            detail: "at least one candidate could not be read; raw errors retained",
            winners,
        };
    }
    if (
        candidates.length === 2 &&
        candidates.every((candidate) => coherentRoleTree(candidate, condition, repetition, experiment))
    ) {
        const roles = new Set(candidates.map((candidate) => candidate.files[0]?.provenance?.deviceRole));
        if (roles.size !== 2 || !roles.has("desktop") || !roles.has("mobile")) {
            return {
                summary: "OTHER_OBSERVED",
                detail: "multiple coherent roots do not represent one desktop and one mobile fixture",
                winners,
            };
        }
        return {
            summary: "SPLIT_COHERENT",
            detail: "multiple provider-named roots each contain one coherent device fixture",
            winners,
        };
    }
    if (candidates.length !== 1)
        return {
            summary: "OTHER_OBSERVED",
            detail: "multiple candidate roots do not match coherent single-device fixtures",
            winners,
        };
    const candidate = candidates[0];
    if (candidate.files.some((file) => file.parseError || !file.provenance)) {
        return {
            summary: "OTHER_OBSERVED",
            detail: "malformed or non-object files retained in raw observations",
            winners,
        };
    }
    const allFixtures = matrixExpectedUnion(condition, repetition, experiment);
    const expectedFilePaths = new Set(allFixtures.flatMap((fixture) => fixture.files.map((file) => file.relativePath)));
    const expectedFolderPaths = new Set(
        allFixtures.flatMap((fixture) =>
            fixture.folders.filter((path) => path !== fixture.root).map((path) => path.slice(fixture.root.length + 1))
        )
    );
    const unexpectedFiles = candidate.files
        .map((file) => file.relativePath)
        .filter((path) => !expectedFilePaths.has(path));
    const unexpectedFolders = candidate.folders
        .map((path) => path.slice(candidate.root.length + 1))
        .filter((path) => !expectedFolderPaths.has(path));
    if (unexpectedFiles.length || unexpectedFolders.length) {
        return {
            summary: "OTHER_OBSERVED",
            detail: `unexpected tree entries retained: files=${JSON.stringify(unexpectedFiles)} folders=${JSON.stringify(unexpectedFolders)}`,
            winners,
        };
    }
    const provenanceValid = candidate.files.every((file) => validProvenance(file, condition, repetition, experiment));
    const roleSet = new Set(
        candidate.files
            .map((file) => file.provenance?.deviceRole)
            .filter((role): role is MatrixDeviceRole => role === "desktop" || role === "mobile")
    );
    const manifest = candidate.files.find((file) => file.relativePath === "manifest.json");
    if (
        manifest &&
        candidate.files.some(
            (file) => file.relativePath !== "manifest.json" && file.provenance?.storeId !== manifest.provenance?.storeId
        )
    ) {
        return {
            summary: "MERGED_MIXED_INVALID",
            detail: "single root contains files whose storeId differs from the shared manifest",
            winners,
        };
    }
    if (condition.topology === "namespaced-stores") {
        const storeGroups = new Map<string, MatrixObservedFile[]>();
        for (const file of candidate.files) {
            const match = /^stores\/([^/]+)\//.exec(file.relativePath);
            const storeFolder = match?.[1] ?? "<unbound>";
            const group = storeGroups.get(storeFolder) ?? [];
            group.push(file);
            storeGroups.set(storeFolder, group);
        }
        for (const [storeFolder, files] of storeGroups) {
            if (
                storeFolder === "<unbound>" ||
                files.some((file) => file.provenance?.storeId !== storeFolder) ||
                new Set(files.map((file) => file.provenance?.storeId)).size !== 1 ||
                new Set(files.map((file) => file.provenance?.deviceRole)).size !== 1
            ) {
                return {
                    summary: "MERGED_MIXED_INVALID",
                    detail: `store subtree ${storeFolder} contains crossed or mixed store identity`,
                    winners,
                };
            }
        }
    }
    const uniqueStoreSubtrees =
        condition.topology === "namespaced-stores"
            ? candidate.files.every((file) => validProvenance(file, condition, repetition, experiment)) &&
              candidate.files.length > 0 &&
              candidate.files.every((file) => {
                  const storeId = file.provenance?.storeId;
                  return typeof storeId === "string" && file.relativePath.startsWith(`stores/${storeId}/`);
              })
            : false;
    if (condition.topology === "collision-ten") {
        for (const file of candidate.files) {
            const reportedRole = file.provenance?.deviceRole;
            const role = reportedRole === "desktop" || reportedRole === "mobile" ? reportedRole : "unknown";
            winners[role] = (winners[role] ?? 0) + 1;
        }
        const expectedFiles = 10;
        if (candidate.files.length === expectedFiles && provenanceValid && roleSet.size > 1) {
            return { summary: "TORN_MULTI_FILE", detail: `per-file winners=${JSON.stringify(winners)}`, winners };
        }
        if (candidate.files.length === expectedFiles && provenanceValid && roleSet.size === 1) {
            return {
                summary: "WINNER_ONLY",
                detail: `all ${expectedFiles} colliding files came from ${roleSet.values().next().value}`,
                winners,
            };
        }
    }
    if (condition.topology === "one-collision" && candidate.files.length === 1 && provenanceValid) {
        return { summary: "WINNER_ONLY", detail: `colliding file came from ${roleSet.values().next().value}`, winners };
    }
    const observedPaths = candidate.files.map((file) => file.relativePath).sort();
    const fullUnionPaths = allFixtures.flatMap((fixture) => fixture.files.map((file) => file.relativePath)).sort();
    if (uniqueStoreSubtrees && roleSet.size > 1 && JSON.stringify(observedPaths) === JSON.stringify(fullUnionPaths)) {
        return {
            summary: "MERGED_COHERENT_UNION",
            detail: "each unique storeId subtree remains internally bound and complete",
            winners,
        };
    }
    if (provenanceValid && roleSet.size > 1) {
        if (
            condition.topology === "disjoint-ten" &&
            candidate.files.length === 20 &&
            JSON.stringify(observedPaths) === JSON.stringify(fullUnionPaths)
        ) {
            return {
                summary: "MERGED_COHERENT_UNION",
                detail: "all twenty disjoint device files are present with valid provenance",
                winners,
            };
        }
    }
    if (
        condition.topology === "standard" &&
        provenanceValid &&
        roleSet.size === 1 &&
        coherentRoleTree(candidate, condition, repetition, experiment)
    ) {
        return {
            summary: "WINNER_ONLY",
            detail: `one complete coherent fixture from ${roleSet.values().next().value}`,
            winners,
        };
    }
    const expectedCount = allFixtures.flatMap((fixture) => fixture.files).length;
    if (candidate.files.length < expectedCount || !provenanceValid) {
        return {
            summary: "PARTIAL",
            detail: "tree is incomplete or contains unexpected/mismatched provenance; raw tree retained",
            winners,
        };
    }
    return {
        summary: "OTHER_OBSERVED",
        detail: "observed tree did not match a recognized summary; raw tree retained",
        winners,
    };
}

export async function inspectMatrixCondition(
    reader: ProbeDirectoryReader,
    condition: MatrixCondition,
    repetition: MatrixRepetition,
    experiment: MatrixExperiment = STORAGE_MATRIX_EXPERIMENT
): Promise<MatrixInspection> {
    const nominal = matrixRoot(condition, repetition, experiment);
    let rootEntries: { files: string[]; folders: string[] };
    try {
        rootEntries = await reader.list("/");
    } catch (error) {
        const detail = `vault-root enumeration unavailable: ${String(error)}`;
        return {
            repetition,
            conditionId: condition.id,
            candidates: [],
            summary: "UNAVAILABLE",
            detail,
            fingerprint: fingerprint(detail),
            winnerDistribution: {},
        };
    }
    const roots = matrixRootCandidates(rootEntries.folders, nominal);
    const conditionFixtures = matrixExpectedUnion(condition, repetition, experiment);
    const expectedFiles = conditionFixtures.flatMap((fixture) => fixture.files.map((file) => file.relativePath));
    const expectedFolders = conditionFixtures.flatMap((fixture) =>
        fixture.folders.filter((path) => path !== fixture.root).map((path) => path.slice(fixture.root.length + 1))
    );
    const candidates = await Promise.all(
        roots.map(async (root) => {
            const snapshot = await snapshotRoot(reader, root);
            const observedFiles = snapshot.files.map((file) => file.relativePath);
            const observedFolders = snapshot.folders.map((path) => path.slice(root.length + 1));
            return {
                ...snapshot,
                missingFiles: expectedFiles.filter((path) => !observedFiles.includes(path)),
                unexpectedFiles: observedFiles.filter((path) => !expectedFiles.includes(path)),
                missingFolders: expectedFolders.filter((path) => !observedFolders.includes(path)),
                unexpectedFolders: observedFolders.filter((path) => !expectedFolders.includes(path)),
            };
        })
    );
    const classified = classifyCandidates(candidates, condition, repetition, experiment);
    const fingerprintValue = fingerprint(
        JSON.stringify(candidates.map(({ root, files, folders, error }) => ({ root, files, folders, error })))
    );
    return {
        repetition,
        conditionId: condition.id,
        candidates,
        ...classified,
        fingerprint: fingerprintValue,
        winnerDistribution: classified.winners,
    };
}

export async function inspectMatrixRepetition(
    reader: ProbeDirectoryReader,
    repetition: MatrixRepetition,
    experiment: MatrixExperiment = STORAGE_MATRIX_EXPERIMENT
): Promise<MatrixInspection[]> {
    return Promise.all(
        MATRIX_CONDITIONS.map((condition) => inspectMatrixCondition(reader, condition, repetition, experiment))
    );
}
