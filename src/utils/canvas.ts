import { App, TFile } from "obsidian";
import type { Highlight } from "./highlights";

export type HighlightWithFile = Highlight & { file: TFile };
export interface CanvasDefaults {
    location: "adjacent" | "subfolder" | "folder";
    folder: string;
    prefix: string;
    layout: "grid" | "column";
    connect: boolean;
    width: number;
    height: number;
}
export interface CanvasAssociation {
    source: string;
    canvas: string;
}
export const DEFAULT_CANVAS_SETTINGS: CanvasDefaults = {
    location: "adjacent",
    folder: "Canvases",
    prefix: "Highlights - ",
    layout: "grid",
    connect: false,
    width: 360,
    height: 220,
};
export const MAX_CANVAS_ASSOCIATIONS = 1000;
const MAX_NODES = 5000;
const MAX_BYTES = 5 * 1024 * 1024;
export function normalizeCanvasDefaults(value: Partial<CanvasDefaults> = {}): CanvasDefaults {
    value = value && typeof value === "object" ? value : {};
    return {
        location: ["adjacent", "subfolder", "folder"].includes(value.location) ? value.location : "adjacent",
        folder: typeof value.folder === "string" ? value.folder.slice(0, 200) : "Canvases",
        prefix: typeof value.prefix === "string" ? value.prefix.slice(0, 100) : "Highlights - ",
        layout: value.layout === "column" ? "column" : "grid",
        connect: value.connect === true,
        width: Number.isFinite(value.width) ? Math.min(1000, Math.max(200, Math.round(value.width))) : 360,
        height: Number.isFinite(value.height) ? Math.min(1000, Math.max(100, Math.round(value.height))) : 220,
    };
}
export function validateCanvasPath(path: string): string {
    if (
        !path.endsWith(".canvas") ||
        path.length > 500 ||
        path.split("/").some((p) => !p || p.startsWith(".") || /[\\:*?"<>|#[\]]/.test(p))
    ) {
        throw new Error("Use a vault-relative .canvas path, without hidden folders or special filename characters.");
    }
    return path;
}
export function defaultCanvasPath(file: TFile, defaults: CanvasDefaults): string {
    const pieces = file.path.split("/");
    const name = pieces.pop().replace(/\.md$/i, "");
    const parent = pieces.join("/");
    const folder =
        defaults.location === "adjacent"
            ? parent
            : defaults.location === "subfolder"
              ? [parent, defaults.folder].filter(Boolean).join("/")
              : defaults.folder;
    return validateCanvasPath([folder, `${defaults.prefix}${name}.canvas`].filter(Boolean).join("/"));
}
export function renamedCanvasAssociations(
    items: CanvasAssociation[],
    oldPath: string,
    newPath: string
): CanvasAssociation[] {
    const rename = (path: string) =>
        path === oldPath ? newPath : path.startsWith(oldPath + "/") ? newPath + path.slice(oldPath.length) : path;
    return items.map((item) => ({ source: rename(item.source), canvas: rename(item.canvas) }));
}
interface CanvasNode {
    id: string;
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    file?: string;
    text?: string;
    color?: string;
    [key: string]: unknown;
}
export interface CanvasData {
    nodes: CanvasNode[];
    edges: Record<string, unknown>[];
    [key: string]: unknown;
}
export function parseCanvas(raw: string): CanvasData {
    if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error("Canvas exceeds the 5 MB safety limit.");
    const data = JSON.parse(raw) as CanvasData;
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid canvas document.");
    const nodes = data.nodes ?? [];
    const edges = data.edges ?? [];
    if (
        !Array.isArray(nodes) ||
        !Array.isArray(edges) ||
        nodes.length > MAX_NODES ||
        edges.length > 10000 ||
        nodes.some((n) => !n || typeof n.id !== "string" || ![n.x, n.y, n.width, n.height].every(Number.isFinite)) ||
        new Set(nodes.map((n) => n.id)).size !== nodes.length
    )
        throw new Error("Invalid or oversized canvas. No changes made.");
    return { ...data, nodes, edges };
}
export interface PreparedCanvasMark {
    source: string;
    key: string;
    text: string;
    color?: string;
}
export async function prepareCanvasMarks(highlights: HighlightWithFile[]): Promise<PreparedCanvasMark[]> {
    if (!highlights.length || highlights.length > 2000)
        throw new Error("Choose between 1 and 2,000 highlights per export.");
    if (highlights.some((highlight) => highlight.integrity === "ambiguous"))
        throw new Error("Resolve ambiguous annotation identity before exporting to Canvas.");
    const occurrences = new Map<string, number>();
    return Promise.all(
        highlights.map(async (h) => {
            const identity = h.annotationId
                ? `annotation:${h.annotationId}`
                : `text:${h.text.replace(/\s+/g, " ").trim()}`;
            const occurrenceKey = `${h.file.path}\u0000${identity}`;
            const occurrence = occurrences.get(occurrenceKey) ?? 0;
            occurrences.set(occurrenceKey, occurrence + 1);
            const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
            const hash = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0"))
                .join("")
                .slice(0, 32);
            return { source: h.file.path, key: `${hash}-${occurrence}`, text: h.text, color: h.color };
        })
    );
}
/** Append snapshots only. Existing objects (including edits and unknown fields) stay untouched. */
export function appendCanvasMarks(
    data: CanvasData,
    marks: PreparedCanvasMark[],
    defaults: CanvasDefaults
): { data: CanvasData; added: number } {
    const nodes = [...data.nodes];
    const edges = [...data.edges];
    const ids = new Set(nodes.map((n) => n.id));
    const sources = new Set(marks.map((m) => m.source));
    let y = nodes.length ? Math.max(...nodes.map((n) => n.y + n.height)) + 100 : 0;
    let added = 0;
    for (const source of sources) {
        const sourceLink = `[[${source}]]`;
        let anchor = nodes.find(
            (n) =>
                n.id.startsWith("fps-") &&
                ((n.type === "file" && n.file === source) || (n.type === "text" && n.text === sourceLink))
        );
        const anchorId = anchor?.id ?? `fps-${crypto.randomUUID()}`;
        const pending = marks.filter((m) => m.source === source && !ids.has(`fpm-${anchorId}-${m.key}`));
        if (!pending.length) continue;
        if (!anchor) {
            // Compact provenance rather than embedding the entire source note.
            // The ordinary unaliased wikilink remains clickable and lets
            // Obsidian update its visible filename when the note is renamed.
            anchor = { id: anchorId, type: "text", text: sourceLink, x: 0, y, width: defaults.width, height: 60 };
            nodes.push(anchor);
            y += 120;
        }
        const columns = defaults.layout === "column" ? 1 : 3;
        pending.forEach((mark, index) => {
            const id = `fpm-${anchorId}-${mark.key}`;
            nodes.push({
                id,
                type: "text",
                text: `${mark.text}\n\n[[${source}|↗]]`,
                x: (index % columns) * (defaults.width + 60),
                y: y + Math.floor(index / columns) * (defaults.height + 60),
                width: defaults.width,
                height: defaults.height,
                ...(/^#[\da-f]{6}$/i.test(mark.color ?? "") ? { color: mark.color } : {}),
            });
            if (defaults.connect)
                edges.push({
                    id: crypto.randomUUID(),
                    fromNode: anchorId,
                    fromSide: "bottom",
                    toNode: id,
                    toSide: "top",
                });
            ids.add(id);
            added++;
        });
        y += Math.ceil(pending.length / columns) * (defaults.height + 60) + 100;
    }
    if (nodes.length > MAX_NODES || edges.length > 10000)
        throw new Error("Canvas safety limit reached. Use a separate canvas.");
    return { data: { ...data, nodes, edges }, added };
}
const pendingExports = new WeakMap<App, Set<string>>();
export async function exportHighlightsToCanvas(
    app: App,
    highlights: HighlightWithFile[],
    options: { path: string; defaults: CanvasDefaults; allowExisting: boolean }
): Promise<{ path: string; added: number }> {
    const path = validateCanvasPath(options.path);
    const locks = pendingExports.get(app) ?? new Set<string>();
    pendingExports.set(app, locks);
    if (locks.has(path)) throw new Error("This canvas is already being updated.");
    locks.add(path);
    try {
        const marks = await prepareCanvasMarks(highlights);
        const existing = app.vault.getAbstractFileByPath(path);
        let added = 0;
        const transform = (raw: string) => {
            const result = appendCanvasMarks(parseCanvas(raw), marks, options.defaults);
            added = result.added;
            if (!added) return raw;
            const output = JSON.stringify(result.data, null, 2);
            if (new TextEncoder().encode(output).length > MAX_BYTES)
                throw new Error("Canvas exceeds the 5 MB safety limit.");
            return output;
        };
        if (existing) {
            if (!options.allowExisting || !(existing instanceof TFile))
                throw new Error(
                    "That path already exists. Use Annotations manager → Canvas… to explicitly append, or choose another name."
                );
            await app.vault.process(existing, transform);
        } else {
            const output = transform('{"nodes":[],"edges":[]}');
            const folders = path.split("/").slice(0, -1);
            for (let i = 1; i <= folders.length; i++) {
                const folder = folders.slice(0, i).join("/");
                const entry = app.vault.getAbstractFileByPath(folder);
                if (entry instanceof TFile) throw new Error(`A file occupies the folder path: ${folder}`);
                if (!entry) await app.vault.createFolder(folder);
            }
            await app.vault.create(path, output);
        }
        return { path, added };
    } finally {
        locks.delete(path);
    }
}
