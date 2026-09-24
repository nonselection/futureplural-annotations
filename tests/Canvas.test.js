import { describe, expect, it, vi } from "vitest";
import {
    DEFAULT_CANVAS_SETTINGS,
    appendCanvasMarks,
    defaultCanvasPath,
    exportHighlightsToCanvas,
    prepareCanvasMarks,
    renamedCanvasAssociations,
    validateCanvasPath,
} from "../src/utils/canvas";
import { TFile } from "obsidian";

const highlight = (file, text, groupId = null) => ({ file, text, groupId });

describe("Canvas snapshots", () => {
    it("preserves unknown data and hand-positioned cards while adding only missing marks", async () => {
        const file = new TFile("Notes/Field note.md");
        const prepared = await prepareCanvasMarks([highlight(file, "Alpha"), highlight(file, "Beta")]);
        const original = {
            nodes: [
                {
                    id: "manual",
                    type: "text",
                    text: "My own card",
                    x: 901,
                    y: -12,
                    width: 300,
                    height: 100,
                    custom: "keep",
                },
            ],
            edges: [{ id: "manual-edge", fromNode: "manual", toNode: "manual", label: "keep" }],
            customTopLevel: { keep: true },
        };
        const first = appendCanvasMarks(original, prepared, DEFAULT_CANVAS_SETTINGS);
        expect(first.added).toBe(2);
        expect(first.data.nodes[0]).toEqual(original.nodes[0]);
        expect(first.data.edges[0]).toEqual(original.edges[0]);
        expect(first.data.customTopLevel).toEqual({ keep: true });
        expect(first.data.edges).toHaveLength(1);
        const sourceHeader = first.data.nodes.find((n) => n.id.startsWith("fps-"));
        expect(sourceHeader).toMatchObject({
            type: "text",
            text: "[[Notes/Field note.md]]",
            height: 60,
        });
        expect(sourceHeader.file).toBeUndefined();
        expect(first.data.nodes.filter((n) => n.type === "text").map((n) => n.text)).toContain(
            "Alpha\n\n[[Notes/Field note.md|↗]]"
        );
        const serialized = JSON.stringify(first.data);
        const second = appendCanvasMarks(JSON.parse(serialized), prepared, DEFAULT_CANVAS_SETTINGS);
        expect(second.added).toBe(0);
        expect(JSON.stringify(second.data)).toBe(serialized);
    });

    it("uses stable group identity and distinct ordinals for repeated text", async () => {
        const file = new TFile("note.md");
        const marks = await prepareCanvasMarks([
            highlight(file, "Same"),
            highlight(file, "Same"),
            highlight(file, "Grouped text", "g-1"),
        ]);
        expect(new Set(marks.map((m) => m.key)).size).toBe(3);
        expect((await prepareCanvasMarks([highlight(file, "Changed text", "g-1")]))[0].key).toBe(marks[2].key);
    });

    it("updates source and canvas associations through file or folder renames", () => {
        expect(
            renamedCanvasAssociations(
                [
                    { source: "Notes/a.md", canvas: "Notes/Highlights - a.canvas" },
                    { source: "Elsewhere/b.md", canvas: "Boards/b.canvas" },
                ],
                "Notes",
                "Archive/Notes"
            )
        ).toEqual([
            { source: "Archive/Notes/a.md", canvas: "Archive/Notes/Highlights - a.canvas" },
            { source: "Elsewhere/b.md", canvas: "Boards/b.canvas" },
        ]);
    });

    it("builds safe paths and rejects traversal, hidden paths, and non-canvas names", () => {
        expect(defaultCanvasPath(new TFile("Notes/a.md"), DEFAULT_CANVAS_SETTINGS)).toBe("Notes/Highlights - a.canvas");
        expect(() => validateCanvasPath("../bad.canvas")).toThrow();
        expect(() => validateCanvasPath("note.md")).toThrow();
    });

    it("atomically appends to an existing associated canvas without rewriting a no-op", async () => {
        const file = new TFile("note.md");
        const canvas = new TFile("Highlights - note.canvas");
        let raw = '{"nodes":[],"edges":[],"untouched":true}';
        const process = vi.fn(async (_file, transform) => {
            raw = transform(raw);
        });
        const app = { vault: { getAbstractFileByPath: () => canvas, process } };
        const options = { path: canvas.path, defaults: DEFAULT_CANVAS_SETTINGS, allowExisting: true };
        expect((await exportHighlightsToCanvas(app, [highlight(file, "Alpha")], options)).added).toBe(1);
        const afterFirst = raw;
        expect((await exportHighlightsToCanvas(app, [highlight(file, "Alpha")], options)).added).toBe(0);
        expect(raw).toBe(afterFirst);
        expect(process).toHaveBeenCalledTimes(2);
    });
});
