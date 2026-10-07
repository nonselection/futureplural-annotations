/**
 * Bounded adversarial model, NOT a conforming storage port or a complete Obsidian
 * implementation. Operation order mirrors inspected Obsidian 1.13.7 app.js
 * (sha256 8efbf581e259cabef4f9c9a34814cfe3c02863757377e56b3603933c50e89898).
 * Native/direct writers deliberately bypass the adapter queue. Mobile copy's
 * collision behavior is an injected countermodel, not an observed mobile fact.
 */
export function fakeObsidianStorageHost({ copyRefusesExisting = true, stripProcessBOM = false } = {}) {
    const files = new Map();
    const folders = new Set([""]);
    const cache = new Map();
    const blockedReads = new Set();
    const events = [];
    const hooks = new Map();
    let tail = Promise.resolve();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder("utf-8", { ignoreBOM: !stripProcessBOM });
    const owned = (bytes) => Uint8Array.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
    const queue = (fn) => {
        const result = tail.then(fn, fn);
        tail = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    };
    const at = (boundary, fn) => hooks.set(boundary, fn);
    const boundary = async (name, path) => {
        const hook = hooks.get(name);
        hooks.delete(name);
        if (hook) await hook(path);
    };
    const directSet = (path, bytes, { cached = false } = {}) => {
        files.set(path, owned(bytes));
        const pieces = path.split("/");
        for (let i = 1; i < pieces.length; i++) folders.add(pieces.slice(0, i).join("/"));
        if (cached) cache.set(path, { path });
        events.push({ method: "direct-set", path });
    };
    const inspect = (path) => (files.has(path) ? owned(files.get(path)) : undefined);
    const read = (path) => {
        if (blockedReads.has(path)) throw new Error("unidentified host read failure");
        if (!files.has(path)) throw new Error("missing physical file");
        return owned(files.get(path));
    };
    const adapter = {
        async stat(path) {
            if (blockedReads.has(path)) throw new Error("unidentified host stat failure");
            return files.has(path) ? { type: "file" } : folders.has(path) ? { type: "folder" } : null;
        },
        async exists(path) {
            // Desktop _exists catches access errors and returns false.
            const result = !blockedReads.has(path) && (files.has(path) || folders.has(path));
            await boundary("after-exists", path);
            return result;
        },
        async readBinary(path) {
            events.push({ method: "readBinary", path });
            await boundary("before-read", path);
            return read(path).buffer;
        },
        async list(path) {
            if (blockedReads.has(path)) throw new Error("unidentified host list failure");
            const prefix = path ? `${path}/` : "";
            const immediate = (item) =>
                item.startsWith(prefix) && item !== path && !item.slice(prefix.length).includes("/");
            return { files: [...files.keys()].filter(immediate), folders: [...folders].filter(immediate) };
        },
        writeBinary(path, bytes) {
            const content = owned(bytes);
            return queue(async () => {
                await boundary("before-write", path);
                files.set(path, content); // Public replacing primitive, not exclusive create.
                events.push({ method: "writeBinary", path });
                await boundary("after-write", path);
            });
        },
        process(path, fn) {
            return queue(async () => {
                await boundary("before-process-read", path);
                const preimage = decoder.decode(read(path));
                const candidate = fn(preimage); // Synchronous callback, just like public API.
                if (typeof candidate !== "string") throw new Error("process callback must synchronously return text");
                if (candidate === preimage) return preimage;
                await boundary("before-process-write", path);
                files.set(path, encoder.encode(candidate));
                events.push({ method: "process-write", path });
                await boundary("after-process-write", path);
                return candidate;
            });
        },
        rename(path, destination) {
            return queue(async () => {
                if (files.has(destination) || folders.has(destination)) throw new Error("occupied destination");
                await boundary("before-rename", path);
                const bytes = read(path); // No digest precondition at dispatch.
                files.delete(path);
                files.set(destination, bytes); // Mirrors replacing native rename after occupancy check.
                events.push({ method: "rename", path, destination });
                await boundary("after-rename", path);
            });
        },
        remove(path) {
            return queue(async () => {
                await boundary("before-remove", path);
                if (!files.has(path)) throw new Error("missing file");
                files.delete(path); // No digest precondition at dispatch.
                events.push({ method: "remove", path });
                await boundary("after-remove", path);
            });
        },
        copy(path, destination) {
            return queue(async () => {
                await boundary("before-copy", destination);
                if (copyRefusesExisting && (files.has(destination) || folders.has(destination)))
                    throw new Error("copy collision");
                files.set(destination, read(path));
                events.push({ method: "copy", path, destination });
            });
        },
    };
    const vault = {
        adapter,
        getAbstractFileByPath: (path) => cache.get(path) ?? null,
        async createBinary(path, bytes) {
            if (await adapter.exists(path)) throw new Error("File already exists.");
            await adapter.writeBinary(path, bytes);
            return cache.get(path) ?? null;
        },
        process: (file, fn) => adapter.process(file.path, fn),
        rename: (file, destination) => adapter.rename(file.path, destination),
        delete: (file) => adapter.remove(file.path),
    };
    return { adapter, vault, directSet, inspect, at, events, blockedReads, folders, cache };
}

/** FK preparatory serialization only; direct host calls are not participants. */
export function fakeLocalCoordinator() {
    let tail = Promise.resolve();
    return (operation) => {
        const result = tail.then(operation, operation);
        tail = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    };
}
