import { describe, expect, it } from "vitest";
import { exportHighlightsToCSV, exportHighlightsToJSON, exportHighlightsToMD } from "../src/utils/export";

describe("logical multipart exports", () => {
    it("exports one record for a multi-line annotation while retaining its constituent source lines", async () => {
        let raw = [
            '- <mark data-fp-notation="highlight" data-fp-color="#f3c969" data-fp-id="fp-12345678-abcd-4abc-8abc-123456789abc" data-fp-part="1/2">One</mark>',
            '- <mark data-fp-notation="highlight" data-fp-color="#f3c969" data-fp-id="fp-12345678-abcd-4abc-8abc-123456789abc" data-fp-part="2/2">Two</mark>',
        ].join("\n");
        const created = new Map();
        const file = { path: "vault/note.md", basename: "note", parent: { path: "vault" } };
        const app = {
            vault: {
                read: async () => raw,
                modify: async (_file, next) => {
                    raw = next;
                },
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
            parts: [
                { text: "One", line: 0 },
                { text: "Two", line: 1 },
            ],
        });

        const csvPath = await exportHighlightsToCSV(app, file);
        expect(created.get(csvPath).split("\n")[0]).toContain("annotation_id");
        expect(created.get(csvPath)).toContain('"One\nTwo"');

        const mdPath = await exportHighlightsToMD(app, file);
        const md = created.get(mdPath);
        expect(md).toContain("Total highlights: 1");
        expect(md).toContain("![[note#^");
        expect(md.match(/!\[\[note#\^/g)).toHaveLength(2);
        expect(md).toMatch(/1\. !\[\[note#\^[^\n]+\n {3}!\[\[note#\^/);
    });
});
