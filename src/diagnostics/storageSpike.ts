import { CapacitorAdapter, FileSystemAdapter, Notice, Platform, type Plugin, type TFile } from "obsidian";
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
} from "./storageProbeModel";
import {
    initializeMatrixRepetition,
    inspectMatrixRepetition,
    matrixCondition,
    matrixOrder,
    matrixRoot,
    MATRIX_CONDITIONS,
    STORAGE_MATRIX_EXPERIMENT,
    STORAGE_MATRIX_REVERSE_EXPERIMENT,
    type MatrixDeviceRole,
    type MatrixExperiment,
    type MatrixIoByApi,
    type MatrixRepetition,
} from "./storageMatrix";

const HIDDEN = ".fk-storage-probe-b0";
const VISIBLE = "FK-Storage-Probe-B0";
const MARKER = "__disposable-fk-storage-probe.json";
const STORE_A = "fk-probe-store-A";
const STORE_B = "fk-probe-store-B";
const HIDDEN_PARITY_SHARED = `${HIDDEN}/divergence-hidden-same-document.json`;
const HIDDEN_PARITY_INDEPENDENT = ".fk-storage-probe-b0-hidden-independent";
const LOCAL_KEY = "fk-storage-probe-b0-local-v1";
const PHASES = ["prepared", "copied", "verified", "committed", "cleanup-pending"] as const;

type Mode = "visible" | "hidden";
type Log = string[];

/** Temporary dev-vault diagnostic. Do not use these probe envelopes as canonical data. */
class StorageSpike {
    private readonly events: string[] = [];

    constructor(private readonly plugin: Plugin) {
        const vault = plugin.app.vault;
        plugin.registerEvent(
            vault.on("create", (file) => {
                if (this.isProbePath(file.path)) this.recordEvent(`vault:create ${file.path}`);
            })
        );
        plugin.registerEvent(
            vault.on("modify", (file) => {
                if (this.isProbePath(file.path)) this.recordEvent(`vault:modify ${file.path}`);
            })
        );
        plugin.registerEvent(
            vault.on("delete", (file) => {
                if (this.isProbePath(file.path)) this.recordEvent(`vault:delete ${file.path}`);
            })
        );
        plugin.registerEvent(
            vault.on("rename", (file, oldPath) => {
                if (this.isProbePath(file.path) || this.isProbePath(oldPath))
                    this.recordEvent(`vault:rename ${oldPath} to ${file.path}`);
            })
        );
        plugin.registerEvent(
            plugin.app.workspace.on("layout-change", () => this.recordEvent("workspace:layout-change"))
        );
        plugin.registerEvent(
            plugin.app.workspace.on("active-leaf-change", () => this.recordEvent("workspace:active-leaf-change"))
        );
        plugin.registerEvent(plugin.app.workspace.on("file-open", () => this.recordEvent("workspace:file-open")));
        plugin.registerDomEvent(activeDocument, "visibilitychange", () =>
            this.recordEvent(`document:visibility ${activeDocument.visibilityState}`)
        );
    }

    private recordEvent(value: string): void {
        this.events.push(`${new Date().toISOString()} ${value}`);
        if (this.events.length > 150) this.events.shift();
    }

    private isProbePath(path: string): boolean {
        return path === VISIBLE || path.startsWith(`${VISIBLE}/`) || path === HIDDEN || path.startsWith(`${HIDDEN}/`);
    }

    private get app() {
        return this.plugin.app;
    }

    private get adapter() {
        return this.app.vault.adapter;
    }

    private root(mode: Mode): string {
        return mode === "visible" ? VISIBLE : HIDDEN;
    }

    private device(): string {
        return probeDeviceLabel(Platform.isIosApp, Platform.isMobile);
    }

    private assertDevVault(): void {
        if (this.app.vault.getName() !== "dev-vault") throw new Error("Storage spike is restricted to dev-vault.");
    }

    private async ensureDirectory(mode: Mode, path: string): Promise<void> {
        if (await this.adapter.exists(path)) return;
        if (mode === "visible") await this.app.vault.createFolder(path);
        else await this.adapter.mkdir(path);
    }

    private async ensureRoot(mode: Mode): Promise<void> {
        this.assertDevVault();
        const root = this.root(mode);
        if (await this.adapter.exists(root)) {
            const markerPath = `${root}/${MARKER}`;
            if (!(await this.adapter.exists(markerPath))) {
                throw new Error(`${root} exists without the probe marker; refusing to use it.`);
            }
            const marker = JSON.parse(await this.adapter.read(markerPath)) as Record<string, unknown>;
            if (marker.probeKind !== "finders-keepers-storage-probe") {
                throw new Error(`${root} has an unexpected marker; refusing to use it.`);
            }
            return;
        }
        await this.ensureDirectory(mode, root);
        await this.adapter.write(`${root}/${MARKER}`, probeManifest(`fk-probe-root-${mode}`));
    }

    private async folder(mode: Mode, suffix: string): Promise<string> {
        await this.ensureRoot(mode);
        const parts = suffix.split("/");
        let path = this.root(mode);
        for (const part of parts) {
            path += `/${part}`;
            await this.ensureDirectory(mode, path);
        }
        return path;
    }

    private file(path: string): TFile {
        const file = this.app.vault.getFileByPath(path);
        if (!file) throw new Error(`Vault did not index ${path}`);
        return file;
    }

    private async create(mode: Mode, path: string, value: string): Promise<void> {
        if (await this.adapter.exists(path)) throw new Error(`Probe path already exists: ${path}`);
        if (mode === "visible") await this.app.vault.create(path, value);
        else await this.adapter.write(path, value);
    }

    private async read(mode: Mode, path: string): Promise<string> {
        return mode === "visible" ? this.app.vault.read(this.file(path)) : this.adapter.read(path);
    }

    private async modify(mode: Mode, path: string, value: string): Promise<void> {
        if (mode === "visible") await this.app.vault.modify(this.file(path), value);
        else await this.adapter.write(path, value);
    }

    private async process(mode: Mode, path: string, fn: (value: string) => string): Promise<string> {
        return mode === "visible" ? this.app.vault.process(this.file(path), fn) : this.adapter.process(path, fn);
    }

    private async rename(mode: Mode, from: string, to: string): Promise<void> {
        if (await this.adapter.exists(to)) throw new Error(`Probe rename destination already exists: ${to}`);
        if (mode === "visible") await this.app.vault.rename(this.file(from), to);
        else await this.adapter.rename(from, to);
    }

    private async remove(mode: Mode, path: string): Promise<void> {
        // This deletes only the scratch file created in this same probe run.
        if (mode === "visible") await this.app.vault.delete(this.file(path));
        else await this.adapter.remove(path);
    }

    private async smoke(mode: Mode, log: Log): Promise<void> {
        await this.ensureRoot(mode);
        const root = this.root(mode);
        const token = `${this.device()}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
        const scratch = `${root}/scratch-${token}.json`;
        const renamed = `${root}/renamed-${token}.json`;
        const guard = `${root}/guard-${token}.json`;
        await this.create(mode, scratch, "create");
        log.push(`${mode} create/read: ${await this.read(mode, scratch)}`);
        await this.modify(mode, scratch, "update");
        log.push(`${mode} update/read: ${await this.read(mode, scratch)}`);
        const processed = await this.process(mode, scratch, (current) => `${current}+process`);
        log.push(`${mode} process returned=${processed}; read=${await this.read(mode, scratch)}`);
        await this.rename(mode, scratch, renamed);
        log.push(
            `${mode} rename: old=${await this.adapter.exists(scratch)}, new=${await this.adapter.exists(renamed)}`
        );
        await this.remove(mode, renamed);
        log.push(`${mode} delete: exists=${await this.adapter.exists(renamed)}`);

        // A stale observed base must be rejected. This is an app-level precondition inside the native process callback.
        await this.create(mode, guard, "base");
        const base = await this.read(mode, guard);
        await this.modify(mode, guard, "external-between-read-and-process");
        try {
            await this.process(mode, guard, (current) => {
                if (current !== base) throw new Error("fk-probe-precondition-failed");
                return "unsafe-overwrite";
            });
            log.push(`${mode} stale-base guard: UNEXPECTED SUCCESS`);
        } catch (error) {
            log.push(`${mode} stale-base guard: ${String(error)}; final=${await this.read(mode, guard)}`);
        }
        const observed = await this.read(mode, guard);
        const concurrent = await Promise.allSettled([
            this.process(mode, guard, (current) => {
                if (current !== observed) throw new Error("fk-probe-precondition-failed");
                return "candidate-one";
            }),
            this.process(mode, guard, (current) => {
                if (current !== observed) throw new Error("fk-probe-precondition-failed");
                return "candidate-two";
            }),
        ]);
        log.push(
            `${mode} concurrent guarded process: ${concurrent.map((item) => (item.status === "fulfilled" ? `fulfilled:${item.value}` : `rejected:${String(item.reason)}`)).join(" | ")}; final=${await this.read(mode, guard)}`
        );
        const eventTarget = `${root}/event-target-${this.device()}.json`;
        if (!(await this.adapter.exists(eventTarget))) await this.create(mode, eventTarget, "event-seed");
        log.push(`${mode} retained paths: ${guard}, ${eventTarget}`);
    }

    private async fixtures(log: Log): Promise<void> {
        const reader = {
            exists: (path: string) => this.adapter.exists(path),
            read: (path: string) => this.adapter.read(path),
        };
        for (const mode of ["visible", "hidden"] as const) {
            const base = await this.folder(mode, "discovery");
            const specs = [
                { name: "incomplete", manifest: null, document: null },
                { name: "invalid", manifest: "{malformed", document: null },
                {
                    name: "unsupported",
                    manifest: JSON.stringify({
                        probeKind: "finders-keepers-storage-probe",
                        version: 99,
                        storeId: STORE_A,
                    }),
                    document: null,
                },
                {
                    name: "valid",
                    manifest: probeManifest(STORE_A),
                    document: probeEnvelope(STORE_A, "document", "sample"),
                },
                {
                    name: "collision",
                    manifest: probeManifest(STORE_A),
                    document: probeEnvelope(STORE_B, "document", "foreign"),
                },
            ];
            log.push(`${mode} absent: ${JSON.stringify(await classifyProbeCandidate(reader, `${base}/absent`))}`);
            for (const spec of specs) {
                const folder = await this.folder(mode, `discovery/${spec.name}`);
                if (spec.manifest !== null && !(await this.adapter.exists(`${folder}/manifest.json`))) {
                    await this.create(mode, `${folder}/manifest.json`, spec.manifest);
                }
                if (spec.document !== null && !(await this.adapter.exists(`${folder}/document.json`))) {
                    await this.create(mode, `${folder}/document.json`, spec.document);
                }
                log.push(`${mode} ${spec.name}: ${JSON.stringify(await classifyProbeCandidate(reader, folder))}`);
            }
        }
        const unavailable = await classifyProbeCandidate(
            {
                exists: async () => {
                    throw new Error("simulated I/O failure");
                },
                read: async () => "",
            },
            `${VISIBLE}/discovery/simulated-unavailable`
        );
        log.push(`simulated unavailable (not a real provider error): ${JSON.stringify(unavailable)}`);
    }

    private async localCanaries(log: Log): Promise<void> {
        // These helpers appeared after the current provisional minAppVersion; guard availability without changing it.
        const localApi = this.app as unknown as Record<string, unknown>;
        const load = localApi["loadLocalStorage"];
        const save = localApi["saveLocalStorage"];
        if (typeof load === "function" && typeof save === "function") {
            const read = load as (key: string) => unknown;
            const write = save as (key: string, value: unknown) => void;
            const previous: unknown = read.call(this.app, LOCAL_KEY) as unknown;
            if (previous === null)
                write.call(this.app, LOCAL_KEY, {
                    probe: true,
                    device: this.device(),
                    createdAt: new Date().toISOString(),
                });
            log.push(
                `App localStorage before=${JSON.stringify(previous)}; after=${JSON.stringify(read.call(this.app, LOCAL_KEY))}`
            );
        } else {
            log.push("App vault-scoped localStorage helpers unavailable on this runtime");
        }
        if (typeof indexedDB === "undefined") {
            log.push("IndexedDB unavailable");
            return;
        }
        const databaseName = `fk-storage-probe-b0-${this.app.vault.getName()}`;
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(databaseName, 1);
            request.onupgradeneeded = () => request.result.createObjectStore("canary");
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
        });
        try {
            const value = await new Promise<unknown>((resolve, reject) => {
                const request = database.transaction("canary", "readonly").objectStore("canary").get("device");
                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result as unknown);
            });
            if (value === undefined) {
                await new Promise<void>((resolve, reject) => {
                    const tx = database.transaction("canary", "readwrite");
                    tx.objectStore("canary").put(
                        { probe: true, device: this.device(), createdAt: new Date().toISOString() },
                        "device"
                    );
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
            }
            log.push(`IndexedDB ${databaseName} before=${JSON.stringify(value)}; newlyWritten=${value === undefined}`);
        } finally {
            database.close();
        }
    }

    private async snapshot(log: Log): Promise<void> {
        for (const root of [HIDDEN, VISIBLE]) {
            if (!(await this.adapter.exists(root))) {
                log.push(`${root}: ABSENT`);
                continue;
            }
            const pending = [{ path: root, depth: 0 }];
            let inspected = 0;
            while (pending.length && inspected < 120) {
                const next = pending.shift();
                if (!next) break;
                try {
                    const entries = await this.adapter.list(next.path);
                    log.push(
                        `${next.path}: folders=${JSON.stringify(entries.folders)} files=${JSON.stringify(entries.files)}`
                    );
                    for (const file of entries.files) {
                        inspected++;
                        if (inspected > 120) break;
                        const content = await this.adapter.read(file);
                        log.push(`${file}: ${content.length} chars ${JSON.stringify(content.slice(0, 350))}`);
                    }
                    if (next.depth < 3)
                        pending.push(...entries.folders.map((path) => ({ path, depth: next.depth + 1 })));
                } catch (error) {
                    log.push(`${next.path}: UNAVAILABLE ${String(error)}`);
                }
            }
            if (pending.length || inspected >= 120) log.push(`${root}: bounded snapshot truncated`);
        }
        log.push(`observed events (${this.events.length}): ${JSON.stringify(this.events)}`);
    }

    private async requireExistingHiddenRoot(): Promise<void> {
        await requireHiddenProbeRoot(this.adapter, HIDDEN, MARKER);
    }

    private async requireMatrixProbeRoots(): Promise<void> {
        for (const [root, storeId] of [
            [HIDDEN, "fk-probe-root-hidden"],
            [VISIBLE, "fk-probe-root-visible"],
        ] as const) {
            if (!(await this.adapter.exists(root)))
                throw new Error(`${root} is absent; refusing matrix initialization`);
            const markerPath = `${root}/${MARKER}`;
            if (!(await this.adapter.exists(markerPath)))
                throw new Error(`${root} has no marker; refusing matrix initialization`);
            const bytes = await this.adapter.read(markerPath);
            const parsed: unknown = JSON.parse(bytes);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
                throw new Error(`${root} marker is not an object; refusing matrix initialization`);
            }
            const marker = parsed as Record<string, unknown>;
            if (
                marker.probeKind !== "finders-keepers-storage-probe" ||
                marker.version !== 1 ||
                marker.storeId !== storeId
            ) {
                throw new Error(`${root} marker is unexpected; refusing matrix initialization`);
            }
        }
    }

    private matrixRole(): MatrixDeviceRole {
        return this.device() === "desktop" ? "desktop" : "mobile";
    }

    private matrixIo(): MatrixIoByApi {
        const adapter = this.adapter;
        const vaultWriter = {
            exists: async (path: string) => adapter.exists(path),
            read: async (path: string) => adapter.read(path),
            list: async (path: string) => adapter.list(path),
            mkdir: async (path: string) => {
                await this.app.vault.createFolder(path);
            },
            write: async (path: string, bytes: string) => {
                await this.app.vault.create(path, bytes);
            },
        };
        return { vault: vaultWriter, adapter };
    }

    private async initializeStorageMatrix(
        repetition: MatrixRepetition,
        experiment: MatrixExperiment,
        log: Log
    ): Promise<void> {
        const role = this.matrixRole();
        log.push(`Matrix experiment=${JSON.stringify(experiment)} repetition=${repetition} role=${role}`);
        log.push(`Required deterministic order=${JSON.stringify(matrixOrder(repetition))}`);
        try {
            await this.requireMatrixProbeRoots();
        } catch (error) {
            log.push(`PREFLIGHT REFUSED before matrix writes: ${String(error)}`);
            for (const condition of MATRIX_CONDITIONS) {
                log.push(
                    `${condition.id} NOT_RUN ${matrixRoot(condition, repetition, experiment)}: root-marker preflight refused`
                );
            }
            log.push("COMPLETE=false");
            return;
        }
        const io = this.matrixIo();
        const result = await initializeMatrixRepetition(io, repetition, role, experiment);
        for (const outcome of result.outcomes) {
            const route = matrixCondition(outcome.conditionId)[role];
            log.push(
                `${outcome.conditionId} ${outcome.state} ${outcome.root} route=${JSON.stringify(route)}: ${outcome.detail}`
            );
        }
        log.push(`COMPLETE=${result.complete}`);
    }

    private async inspectStorageMatrix(
        repetition: MatrixRepetition,
        experiment: MatrixExperiment,
        log: Log
    ): Promise<void> {
        const inspections = await inspectMatrixRepetition(this.adapter, repetition, experiment);
        log.push(`Matrix experiment=${JSON.stringify(experiment)} repetition=${repetition}`);
        for (const inspection of inspections) {
            log.push(
                `${inspection.conditionId} ${inspection.summary} fingerprint=${inspection.fingerprint} ` +
                    `winners=${JSON.stringify(inspection.winnerDistribution)} detail=${inspection.detail}`
            );
            for (const candidate of inspection.candidates) {
                log.push(`RAW ${inspection.conditionId} ${candidate.root}: ${JSON.stringify(candidate)}`);
            }
        }
    }

    private parityRole(): "desktop" | "mobile" {
        return hiddenParityRole(probeDeviceLabel(Platform.isIosApp, Platform.isMobile));
    }

    private async inspectHiddenParity(log: Log): Promise<void> {
        const rootEntries = await this.adapter.list("/");
        const candidates = hiddenParityRootCandidates(rootEntries.folders, HIDDEN_PARITY_INDEPENDENT);
        log.push(`Hidden parity root candidates: ${JSON.stringify(candidates)}`);
        for (const folder of candidates) {
            const result = await classifyHiddenParityRoot(this.adapter, folder, STORE_A, STORE_B);
            log.push(`${folder}: ${JSON.stringify(result)}`);
        }
        if (!(await this.adapter.exists(HIDDEN))) {
            log.push(`${HIDDEN}: ABSENT locally; no shared-document candidates`);
            return;
        }
        const sharedEntries = await this.adapter.list(HIDDEN);
        const sharedFiles = prefixedProbeFiles(sharedEntries.files, HIDDEN, "divergence-hidden-same-document");
        log.push(`Hidden parity shared-document candidates: ${JSON.stringify(sharedFiles)}`);
        if (!sharedFiles.includes(HIDDEN_PARITY_SHARED)) log.push(`${HIDDEN_PARITY_SHARED}: ABSENT locally`);
        for (const path of sharedFiles) {
            log.push(`${path}: ${JSON.stringify(await classifyHiddenParityShared(this.adapter, path, STORE_A))}`);
        }
    }

    private async report(title: string, log: Log): Promise<void> {
        await this.ensureRoot("visible");
        const path = `${VISIBLE}/report-${this.device()}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}.md`;
        const adapterType =
            this.adapter instanceof FileSystemAdapter
                ? "FileSystemAdapter"
                : this.adapter instanceof CapacitorAdapter
                  ? "CapacitorAdapter"
                  : "other/unknown";
        const lines = [
            `# Finders Keepers disposable storage probe: ${title}`,
            "",
            `- Time: ${new Date().toISOString()}`,
            `- Device label: ${this.device()}${Platform.isIosApp ? " (physical iPhone/iPad model not inferred)" : ""}`,
            `- Hidden parity fixture role: ${this.parityRole()}`,
            `- Vault: ${this.app.vault.getName()}`,
            `- Adapter runtime type: ${adapterType}`,
            `- Vault.process: ${typeof this.app.vault.process}`,
            `- DataAdapter.process: ${typeof this.adapter.process}`,
            "- Scope: disposable probe only; no canonical store was created.",
            "",
            "## Results",
            "",
            ...log.map((line) => `- ${line}`),
            "",
        ];
        const file = await this.app.vault.create(path, lines.join("\n"));
        new Notice(`Finders Keepers probe report: ${path}`, 10000);
        await this.app.workspace.getLeaf(true).openFile(file);
    }

    private async run(title: string, action: (log: Log) => Promise<void>): Promise<void> {
        const log: Log = [];
        try {
            this.assertDevVault();
            await action(log);
        } catch (error) {
            log.push(`STOPPED: ${String(error)}`);
        }
        try {
            await this.report(title, log);
        } catch (error) {
            new Notice(`Storage probe failed to save report: ${String(error)}`, 15000);
        }
    }

    register(): void {
        const command = (id: string, name: string, action: (log: Log) => Promise<void>) => {
            this.plugin.addCommand({
                id: `fk-storage-probe-${id}`,
                name: `Finders Keepers storage probe: ${name}`,
                callback: () => void this.run(name, action),
            });
        };
        command("local", "run local API checks", async (log) => {
            for (const mode of ["visible", "hidden"] as const) {
                try {
                    await this.smoke(mode, log);
                } catch (error) {
                    log.push(`${mode} smoke ERROR: ${String(error)}`);
                }
            }
            await this.fixtures(log);
            try {
                await this.localCanaries(log);
            } catch (error) {
                log.push(`local canary ERROR: ${String(error)}`);
            }
            await this.snapshot(log);
        });
        command("snapshot", "capture raw probe state and events", async (log) => {
            await this.snapshot(log);
        });
        command("hidden-parity-inspect", "inspect Hidden parity targets (read only)", async (log) => {
            await this.inspectHiddenParity(log);
        });
        command("hidden-parity-seed", "seed Hidden same-store divergence", async (log) => {
            if (this.device() !== "desktop") throw new Error("Hidden base is seeded on desktop only.");
            await this.requireExistingHiddenRoot();
            await this.create("hidden", HIDDEN_PARITY_SHARED, probeEnvelope(STORE_A, "document", "base"));
            log.push(`seeded ${HIDDEN_PARITY_SHARED}: ${await this.adapter.read(HIDDEN_PARITY_SHARED)}`);
        });
        command("hidden-parity-edit", "edit Hidden same-store document from this device", async (log) => {
            const role = this.parityRole();
            await this.requireExistingHiddenRoot();
            if (!(await this.adapter.exists(HIDDEN_PARITY_SHARED))) {
                throw new Error(`${HIDDEN_PARITY_SHARED} is absent; refusing to create it`);
            }
            const result = await this.adapter.process(HIDDEN_PARITY_SHARED, (current) =>
                editHiddenParityBase(current, STORE_A, role)
            );
            log.push(`edited ${HIDDEN_PARITY_SHARED}: ${result}`);
        });
        command("hidden-parity-init", "initialize Hidden different storeId at same path", async (log) => {
            const role = this.parityRole();
            await this.requireExistingHiddenRoot();
            const siblings = hiddenParityRootCandidates(
                (await this.adapter.list("/")).folders,
                HIDDEN_PARITY_INDEPENDENT
            );
            if (siblings.length) {
                throw new Error(`Hidden parity root or sibling already exists: ${JSON.stringify(siblings)}`);
            }
            if (await this.adapter.exists(HIDDEN_PARITY_INDEPENDENT)) {
                throw new Error(`${HIDDEN_PARITY_INDEPENDENT} already exists; refusing to initialize`);
            }
            const verified = await initializeHiddenParityRoot(
                this.adapter,
                HIDDEN_PARITY_INDEPENDENT,
                role,
                STORE_A,
                STORE_B
            );
            log.push(`initialized and locally verified ${HIDDEN_PARITY_INDEPENDENT}: ${JSON.stringify(verified)}`);
        });
        for (const repetition of ["R1", "R2", "R3", "R4"] as const) {
            command(
                `matrix-init-${repetition.toLowerCase()}`,
                `initialize storage matrix ${repetition} from this device`,
                async (log) => {
                    await this.initializeStorageMatrix(repetition, STORAGE_MATRIX_EXPERIMENT, log);
                }
            );
            command(
                `matrix-inspect-${repetition.toLowerCase()}`,
                `inspect storage matrix ${repetition} (read only)`,
                async (log) => {
                    await this.inspectStorageMatrix(repetition, STORAGE_MATRIX_EXPERIMENT, log);
                }
            );
        }
        for (const repetition of ["RV1", "RV2"] as const) {
            command(
                `matrix-init-${repetition.toLowerCase()}`,
                `initialize reverse-direction storage matrix ${repetition} from this device`,
                async (log) => {
                    await this.initializeStorageMatrix(repetition, STORAGE_MATRIX_REVERSE_EXPERIMENT, log);
                }
            );
            command(
                `matrix-inspect-${repetition.toLowerCase()}`,
                `inspect reverse-direction storage matrix ${repetition} (read only)`,
                async (log) => {
                    await this.inspectStorageMatrix(repetition, STORAGE_MATRIX_REVERSE_EXPERIMENT, log);
                }
            );
        }
        command("seed-shared", "seed same-store divergence", async (log) => {
            await this.ensureRoot("visible");
            const path = `${VISIBLE}/divergence-same-document.json`;
            if (await this.adapter.exists(path)) throw new Error(`${path} already exists; refusing to reseed`);
            await this.create("visible", path, probeEnvelope(STORE_A, "document", "base"));
            log.push(`seeded ${path}: ${await this.read("visible", path)}`);
        });
        command("remote-change", "create desktop changes while iPad is offline", async (log) => {
            if (this.device() !== "desktop") throw new Error("This step runs on desktop only.");
            for (const mode of ["visible", "hidden"] as const) {
                await this.ensureRoot(mode);
                const path = `${this.root(mode)}/remote-desktop-while-ipad-offline.json`;
                await this.create(mode, path, probeEnvelope(STORE_A, "document", "desktop-remote-change"));
                log.push(`created ${path}`);
            }
        });
        command("edit-shared", "edit same-store document from this device", async (log) => {
            const path = `${VISIBLE}/divergence-same-document.json`;
            const result = await this.process("visible", path, (current) => {
                const doc = JSON.parse(current) as { value?: string };
                if (doc.value !== "base") throw new Error(`expected base; found ${String(doc.value)}`);
                return probeEnvelope(STORE_A, "document", `${this.device()}-edit`);
            });
            log.push(`edited ${path}: ${result}`);
        });
        command("init-independent", "initialize different storeId at same path", async (log) => {
            const folder = `${VISIBLE}/divergence-independent`;
            await this.ensureRoot("visible");
            if (await this.adapter.exists(folder)) throw new Error(`${folder} already exists; refusing to overwrite`);
            await this.folder("visible", "divergence-independent");
            const id = this.device() === "desktop" ? STORE_A : STORE_B;
            await this.create("visible", `${folder}/manifest.json`, probeManifest(id));
            await this.create(
                "visible",
                `${folder}/document-${this.device()}.json`,
                probeEnvelope(id, "document", this.device())
            );
            log.push(`initialized ${folder} with ${id}`);
        });
        command("init-cross-mode", "initialize Hidden/mobile or Visible/desktop", async (log) => {
            const mode: Mode = this.device() === "desktop" ? "visible" : "hidden";
            const folder = `${this.root(mode)}/divergence-cross-mode`;
            await this.ensureRoot(mode);
            if (await this.adapter.exists(folder)) throw new Error(`${folder} already exists; refusing to overwrite`);
            await this.folder(mode, "divergence-cross-mode");
            const id = mode === "visible" ? STORE_A : STORE_B;
            await this.create(mode, `${folder}/manifest.json`, probeManifest(id));
            await this.create(mode, `${folder}/document.json`, probeEnvelope(id, "document", this.device()));
            log.push(`initialized ${folder} with ${id}`);
        });
        command("migration", "advance disposable migration phase", async (log) => {
            const hidden = await this.folder("hidden", "migration");
            const visible = await this.folder("visible", "migration");
            const record = `${visible}/record.json`;
            const source = `${hidden}/document.json`;
            const destination = `${visible}/document.json`;
            if (!(await this.adapter.exists(record))) {
                if (!(await this.adapter.exists(source)))
                    await this.create("hidden", source, probeEnvelope(STORE_A, "document", "migration-source"));
                await this.create(
                    "visible",
                    record,
                    JSON.stringify(
                        {
                            probeKind: "finders-keepers-storage-probe",
                            migrationId: "fk-probe-migration-1",
                            storeId: STORE_A,
                            phase: "prepared",
                        },
                        null,
                        2
                    )
                );
                log.push("migration phase=prepared; source present; destination absent");
                return;
            }
            const state = JSON.parse(await this.read("visible", record)) as { phase: string };
            const index = PHASES.indexOf(state.phase as (typeof PHASES)[number]);
            if (index < 0 || index === PHASES.length - 1) throw new Error(`cannot advance phase ${state.phase}`);
            const next = PHASES[index + 1];
            if (next === "copied" && !(await this.adapter.exists(destination))) {
                await this.create("visible", destination, await this.read("hidden", source));
            }
            if (
                next === "verified" &&
                (await this.read("hidden", source)) !== (await this.read("visible", destination))
            ) {
                throw new Error("migration probe copies differ; refusing verified phase");
            }
            await this.process("visible", record, (current) => {
                const before = JSON.parse(current) as { phase: string };
                if (before.phase !== state.phase) throw new Error("migration probe phase changed");
                return JSON.stringify({ ...before, phase: next }, null, 2);
            });
            log.push(
                `migration phase=${next}; source=${await this.adapter.exists(source)} destination=${await this.adapter.exists(destination)}`
            );
        });
    }
}

export function registerStorageSpikeCommands(plugin: Plugin): void {
    if (plugin.app.vault.getName() !== "dev-vault") return;
    new StorageSpike(plugin).register();
}
