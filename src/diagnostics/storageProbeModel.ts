/** Disposable B0 platform-probe envelopes. These are not canonical schemas. */
export const PROBE_KIND = "finders-keepers-storage-probe";

export type CandidateState =
    | "ABSENT"
    | "VALID"
    | "PRESENT_INCOMPLETE"
    | "PRESENT_INVALID"
    | "UNSUPPORTED"
    | "UNAVAILABLE";

export interface CandidateResult {
    state: CandidateState;
    detail: string;
}

export interface ProbeReader {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
}

export interface ProbeDirectoryReader extends ProbeReader {
    list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

export interface ProbeDirectoryWriter extends ProbeDirectoryReader {
    mkdir(path: string): Promise<void>;
    write(path: string, data: string): Promise<void>;
}

export type ProbeDeviceLabel = "desktop" | "ios" | "mobile";
export type HiddenParityRole = "desktop" | "mobile";

export function probeDeviceLabel(isIosApp: boolean, isMobile: boolean): ProbeDeviceLabel {
    return isIosApp ? "ios" : isMobile ? "mobile" : "desktop";
}

export function hiddenParityRole(device: ProbeDeviceLabel): HiddenParityRole {
    return device === "desktop" ? "desktop" : "mobile";
}

export function validateHiddenProbeRootMarker(bytes: string): void {
    let parsed: unknown;
    try {
        parsed = JSON.parse(bytes);
    } catch {
        throw new Error("Hidden probe-root marker is malformed JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Hidden probe-root marker is not an object");
    }
    const marker = parsed as Record<string, unknown>;
    if (marker.probeKind !== PROBE_KIND || marker.version !== 1 || marker.storeId !== "fk-probe-root-hidden") {
        throw new Error("Hidden probe-root marker has unexpected kind, version, or storeId");
    }
}

export async function requireHiddenProbeRoot(reader: ProbeReader, root: string, markerName: string): Promise<void> {
    if (!(await reader.exists(root))) throw new Error(`${root} is absent; refusing to initialize it`);
    const markerPath = `${root}/${markerName}`;
    if (!(await reader.exists(markerPath))) throw new Error(`${root} has no probe-root marker`);
    validateHiddenProbeRootMarker(await reader.read(markerPath));
}

type JsonRead = { ok: true; value: unknown } | { ok: false; result: CandidateResult };

async function readProbeJson(reader: ProbeReader, path: string): Promise<JsonRead> {
    let bytes: string;
    try {
        bytes = await reader.read(path);
    } catch (error) {
        return { ok: false, result: { state: "UNAVAILABLE", detail: `read ${path}: ${String(error)}` } };
    }
    try {
        return { ok: true, value: JSON.parse(bytes) as unknown };
    } catch {
        return { ok: false, result: { state: "PRESENT_INVALID", detail: `malformed JSON at ${path}` } };
    }
}

/** Select only immediate vault-root folders. Provider-generated suffixes are opaque. */
export function hiddenParityRootCandidates(folders: string[], prefix: string): string[] {
    return folders.flatMap((path) => {
        const name = path.startsWith("/") ? path.slice(1) : path;
        return !name.includes("/") && name.startsWith(prefix) ? [name] : [];
    });
}

/** Match only files directly inside one probe folder; conflict suffixes are opaque. */
export function prefixedProbeFiles(files: string[], folder: string, basenamePrefix: string): string[] {
    return files.filter((path) => {
        if (!path.startsWith(`${folder}/`)) return false;
        const name = path.slice(folder.length + 1);
        return !name.includes("/") && name.startsWith(basenamePrefix);
    });
}

/** Inspect only the known envelope files in one disposable Hidden parity root. */
export async function classifyHiddenParityRoot(
    reader: ProbeDirectoryReader,
    folder: string,
    desktopStoreId: string,
    mobileStoreId: string
): Promise<CandidateResult> {
    let entries: { files: string[]; folders: string[] };
    try {
        entries = await reader.list(folder);
    } catch (error) {
        return { state: "UNAVAILABLE", detail: error instanceof Error ? error.message : String(error) };
    }
    const manifestPath = `${folder}/manifest.json`;
    if (!entries.files.includes(manifestPath)) return { state: "PRESENT_INCOMPLETE", detail: "manifest missing" };
    const manifestRead = await readProbeJson(reader, manifestPath);
    if (manifestRead.ok === false) return manifestRead.result;
    const manifest = manifestRead.value;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        return { state: "PRESENT_INVALID", detail: "manifest is not an object" };
    }
    const head = manifest as Record<string, unknown>;
    if (head.probeKind !== PROBE_KIND || typeof head.storeId !== "string" || !head.storeId) {
        return { state: "PRESENT_INVALID", detail: "unrecognized manifest identity" };
    }
    if (head.version !== 1) return { state: "UNSUPPORTED", detail: "manifest version is not 1" };

    const desktopPath = `${folder}/document-desktop.json`;
    const mobilePath = `${folder}/document-mobile.json`;
    const present = [desktopPath, mobilePath].filter((path) => entries.files.includes(path));
    if (present.length === 0) return { state: "PRESENT_INCOMPLETE", detail: "device document missing" };
    if (present.length !== 1 || entries.folders.length || entries.files.length !== 2) {
        return {
            state: "PRESENT_INVALID",
            detail: `unexpected or mixed directory entries: ${JSON.stringify(entries)}`,
        };
    }
    const role = present[0] === desktopPath ? "desktop" : "mobile";
    const expectedStoreId = role === "desktop" ? desktopStoreId : mobileStoreId;
    const documentRead = await readProbeJson(reader, present[0]);
    if (documentRead.ok === false) return documentRead.result;
    const document = documentRead.value;
    if (!document || typeof document !== "object" || Array.isArray(document)) {
        return { state: "PRESENT_INVALID", detail: "document is not an object" };
    }
    const body = document as Record<string, unknown>;
    if (
        body.probeKind !== PROBE_KIND ||
        body.version !== 1 ||
        body.key !== "document" ||
        body.storeId !== head.storeId ||
        body.storeId !== expectedStoreId ||
        body.value !== role
    ) {
        return { state: "PRESENT_INVALID", detail: `wrong probe kind, storeId, or ${role} binding` };
    }
    return { state: "VALID", detail: `storeId=${expectedStoreId}; role=${role}; value=${role}` };
}

export async function classifyHiddenParityShared(
    reader: ProbeReader,
    path: string,
    expectedStoreId: string
): Promise<CandidateResult> {
    const read = await readProbeJson(reader, path);
    if (read.ok === false) return read.result;
    const parsed = read.value;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { state: "PRESENT_INVALID", detail: "shared document is not an object" };
    }
    const doc = parsed as Record<string, unknown>;
    if (
        doc.probeKind !== PROBE_KIND ||
        doc.version !== 1 ||
        doc.storeId !== expectedStoreId ||
        doc.key !== "document" ||
        typeof doc.value !== "string" ||
        !["base", "desktop-edit", "mobile-edit"].includes(doc.value)
    ) {
        return { state: "PRESENT_INVALID", detail: "shared document has unexpected probe identity or value" };
    }
    return { state: "VALID", detail: `storeId=${expectedStoreId}; value=${doc.value}` };
}

/** Create one disposable root and verify exactly what was reread locally. */
export async function initializeHiddenParityRoot(
    writer: ProbeDirectoryWriter,
    folder: string,
    role: HiddenParityRole,
    desktopStoreId: string,
    mobileStoreId: string
): Promise<CandidateResult> {
    if (await writer.exists(folder)) throw new Error(`${folder} already exists; refusing to initialize`);
    const storeId = role === "desktop" ? desktopStoreId : mobileStoreId;
    await writer.mkdir(folder);
    await writer.write(`${folder}/manifest.json`, probeManifest(storeId));
    await writer.write(`${folder}/document-${role}.json`, probeEnvelope(storeId, "document", role));
    const result = await classifyHiddenParityRoot(writer, folder, desktopStoreId, mobileStoreId);
    if (result.state !== "VALID" || result.detail !== `storeId=${storeId}; role=${role}; value=${role}`) {
        throw new Error(`Hidden parity initialization failed local verification: ${JSON.stringify(result)}`);
    }
    return result;
}

export function probeEnvelope(storeId: string, key: string, value: string): string {
    return JSON.stringify({ probeKind: PROBE_KIND, version: 1, storeId, key, value }, null, 2);
}

export function probeManifest(storeId: string): string {
    return JSON.stringify({ probeKind: PROBE_KIND, version: 1, storeId }, null, 2);
}

/** The disposable same-file edit requires the exact shared base envelope. */
export function editHiddenParityBase(current: string, storeId: string, role: HiddenParityRole): string {
    const parsed = JSON.parse(current) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Hidden shared document is not a probe envelope");
    }
    const doc = parsed as Record<string, unknown>;
    if (
        doc.probeKind !== PROBE_KIND ||
        doc.version !== 1 ||
        doc.storeId !== storeId ||
        doc.key !== "document" ||
        doc.value !== "base"
    ) {
        throw new Error("Hidden shared document differs from the expected store A/base envelope");
    }
    return probeEnvelope(storeId, "document", `${role}-edit`);
}

/** This checks only a disposable two-file fixture, never a production store. */
export async function classifyProbeCandidate(reader: ProbeReader, folder: string): Promise<CandidateResult> {
    try {
        if (!(await reader.exists(folder))) {
            return { state: "ABSENT", detail: "adapter reports folder absent locally; provider hydration is unproven" };
        }
        const manifestPath = `${folder}/manifest.json`;
        if (!(await reader.exists(manifestPath))) {
            return { state: "PRESENT_INCOMPLETE", detail: "folder exists without manifest" };
        }
        const manifestBytes = await reader.read(manifestPath);
        let manifest: unknown;
        try {
            manifest = JSON.parse(manifestBytes);
        } catch {
            return { state: "PRESENT_INVALID", detail: "malformed manifest JSON" };
        }
        if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
            return { state: "PRESENT_INVALID", detail: "manifest is not an object" };
        }
        const head = manifest as Record<string, unknown>;
        if (head.probeKind !== PROBE_KIND || typeof head.storeId !== "string" || !head.storeId) {
            return { state: "PRESENT_INVALID", detail: "unrecognized manifest identity" };
        }
        if (head.version !== 1) return { state: "UNSUPPORTED", detail: "manifest version is not 1" };
        const documentPath = `${folder}/document.json`;
        if (!(await reader.exists(documentPath))) {
            return { state: "PRESENT_INCOMPLETE", detail: "manifest exists without document" };
        }
        const documentBytes = await reader.read(documentPath);
        let document: unknown;
        try {
            document = JSON.parse(documentBytes);
        } catch {
            return { state: "PRESENT_INVALID", detail: "malformed document JSON" };
        }
        if (!document || typeof document !== "object" || Array.isArray(document)) {
            return { state: "PRESENT_INVALID", detail: "document is not an object" };
        }
        const body = document as Record<string, unknown>;
        if (body.probeKind !== PROBE_KIND || body.version !== 1 || body.key !== "document") {
            return { state: "PRESENT_INVALID", detail: "unrecognized document envelope" };
        }
        if (body.storeId !== head.storeId) {
            return { state: "PRESENT_INVALID", detail: `mixed storeId: manifest=${head.storeId}, document differs` };
        }
        return { state: "VALID", detail: `storeId=${head.storeId}` };
    } catch (error) {
        return { state: "UNAVAILABLE", detail: error instanceof Error ? error.message : String(error) };
    }
}
