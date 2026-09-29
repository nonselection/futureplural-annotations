import { describe, expect, it, vi } from "vitest";
import { exportHighlightsToCSV, exportHighlightsToJSON, exportHighlightsToMD } from "../src/utils/export";

describe("logical multipart exports", () => {
    it("exports one record for a multi-line annotation while retaining its constituent source lines", async () => {
        const raw = [
            '- <mark data-fp-notation="highlight" data-fp-color="#f3c969" data-fp-id="fp-12345678-abcd-4abc-8abc-123456789abc" data-fp-part="1/2">One</mark>',
            '- <mark data-fp-notation="highlight" data-fp-color="#f3c969" data-fp-id="fp-12345678-abcd-4abc-8abc-123456789abc" data-fp-part="2/2">Two</mark>',
        ].join("\n");
        const created = new Map();
        const file = { path: "vault/note.md", basename: "note", parent: { path: "vault" } };
        const modify = vi.fn();
        const app = {
            vault: {
                read: async () => raw,
                modify,
                getAbstractFileByPath: () => null,
                create: async (path, content) => {
                    created.set(path, content);
                },
            },
        };

        const jsonPath = await exportHighlightsToJSON(app, file);
        const json = JSON.parse(created.get(jsonPath));
        expect(json.total).toBe(1);
        expect(json.highlights[0]).toMatchObject({
            text: "One\nTwo",
            annotationId: "fp-12345678-abcd-4abc-8abc-123456789abc",
            notationType: "highlight",
            blockId: null,
            blockEmbed: null,
            parts: [
                { text: "One", line: 0 },
                { text: "Two", line: 1 },
            ],
        });

        const csvPath = await exportHighlightsToCSV(app, file);
        expect(created.get(csvPath).split("\n")[0]).toContain("annotation_id");
        expect(created.get(csvPath)).toContain('"One\nTwo"');
        expect(created.get(csvPath)).toContain(',,"One\nTwo"');

        const mdPath = await exportHighlightsToMD(app, file);
        const md = created.get(mdPath);
        expect(md).toContain("Total highlights: 1");
        expect(md).toContain("> One\n> — [[vault/note.md]] (line 1)");
        expect(md).toContain("> Two\n> — [[vault/note.md]] (line 2)");
        expect(md).not.toContain("![[note#^");
        expect(modify).not.toHaveBeenCalled();
        expect(raw).toContain("data-fp-id=");
        expect(raw).not.toContain(" ^");
    });

    it("reuses pre-existing block IDs without changing the source", async () => {
        const raw =
            '- <mark data-fp-id="fp-12345678-abcd-4abc-8abc-123456789abc" data-fp-part="1/1">One</mark> ^line-one';
        const created = new Map();
        const modify = vi.fn();
        const file = { path: "vault/note.md", basename: "note", parent: { path: "vault" } };
        const app = {
            vault: {
                read: async () => raw,
                modify,
                getAbstractFileByPath: () => null,
                create: async (path, content) => created.set(path, content),
            },
        };

        const jsonPath = await exportHighlightsToJSON(app, file);
        expect(JSON.parse(created.get(jsonPath)).highlights[0]).toMatchObject({
            blockId: "^line-one",
            blockEmbed: "![[note#^line-one]]",
        });
        const mdPath = await exportHighlightsToMD(app, file);
        expect(created.get(mdPath)).toContain("![[note#^line-one]]");
        expect(modify).not.toHaveBeenCalled();
    });
});
