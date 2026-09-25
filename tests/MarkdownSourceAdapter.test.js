import { afterEach, describe, expect, it, vi } from "vitest";
import { markdownSourceAdapter } from "../src/adapters/MarkdownSourceAdapter";
import { HighlightNavigatorView } from "../src/views/HighlightNavigator";
import ReadingHighlighterPlugin from "../src/main";
import { parseHighlights } from "../src/utils/highlights";

const uuidA = "12345678-abcd-4abc-8abc-123456789abc";
const uuidB = "87654321-abcd-4abc-8abc-123456789abc";

afterEach(() => vi.restoreAllMocks());

describe("ordinary and managed Markdown footnotes", () => {
    it("observes a managed definition with zero, one, or multiple references", () => {
        const label = `fp-${uuidA}`;
        for (const count of [0, 1, 2]) {
            const raw = `${`Text[^${label}] `.repeat(count)}\n\n[^${label}]: Portable note`;
            const [footnote] = markdownSourceAdapter.observeFootnotes(raw);
            expect(footnote).toMatchObject({
                managedId: label,
                label,
                identityMode: "managed",
                integrity: "resolved",
                text: "Portable note",
            });
            expect(footnote.definitions).toHaveLength(1);
            expect(footnote.references).toHaveLength(count);
            const navigator = new HighlightNavigatorView({}, { app: {} });
            expect(navigator.getFootnotesFromContent(raw)).toHaveLength(1);
        }
    });

    it("generates a collision-checked label carried by the AnnotationId", () => {
        const ids = vi.spyOn(crypto, "randomUUID");
        ids.mockReturnValueOnce(uuidA).mockReturnValueOnce(uuidB);
        const raw = `Existing dangling reference[^fp-${uuidA}].`;
        const result = markdownSourceAdapter.createFootnote(raw, raw.length, "First line\nsecond line");
        expect(result.id).toBe(`fp-${uuidB}`);
        expect(result.raw).toContain(`[^fp-${uuidB}]: First line\n    second line`);
        expect(
            markdownSourceAdapter.observeFootnotes(result.raw).find((item) => item.label === result.id)
        ).toMatchObject({
            integrity: "resolved",
            identityMode: "managed",
            text: "First line\nsecond line",
        });
    });

    it("also checks an existing unreferenced definition before choosing a label", () => {
        vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(uuidA).mockReturnValueOnce(uuidB);
        const raw = `Text.\n\n[^fp-${uuidA}]: Existing orphan`;
        const result = markdownSourceAdapter.createFootnote(raw, 5, "New note");
        expect(result.label).toBe(`fp-${uuidB}`);
        expect(result.raw).toContain(`[^fp-${uuidA}]: Existing orphan`);
    });

    it("reports duplicate definitions as ambiguous and keeps external labels unchanged", () => {
        const raw = "Text[^ordinary].\n\n[^ordinary]: First\n[^ordinary]: Second";
        const [footnote] = markdownSourceAdapter.observeFootnotes(raw);
        expect(footnote).toMatchObject({ label: "ordinary", identityMode: "tracked-legacy", integrity: "ambiguous" });
        expect(footnote.definitions).toHaveLength(2);
        expect(markdownSourceAdapter.observeFootnotes(raw)).toEqual([footnote]);
        expect(raw).toContain("[^ordinary]: First");
        const navigator = new HighlightNavigatorView({}, { app: {} });
        expect(navigator.getFootnotesFromContent(raw)).toMatchObject([{ id: "ordinary", integrity: "ambiguous" }]);
    });

    it("ignores footnote-looking code and comments", () => {
        const raw = "`[^fake]` <!-- [^hidden]: no -->\nReal[^note].\n\n[^note]: yes";
        expect(markdownSourceAdapter.observeFootnotes(raw).map((item) => item.label)).toEqual(["note"]);
    });

    it("refuses a stale source when the plugin writes a managed footnote", async () => {
        const file = { path: "dev-note.md" };
        let raw = "New text.";
        const app = {
            vault: {
                process: async (_file, change) => {
                    raw = change(raw);
                    return raw;
                },
            },
        };
        const plugin = new ReadingHighlighterPlugin(app, { id: "test", version: "0" });
        await expect(plugin.applyAnnotation(file, "Old text.", 4, 4, "note")).rejects.toThrow(/Source changed/);
        expect(raw).toBe("New text.");
        await plugin.applyAnnotation(file, raw, 4, 4, "note");
        expect(
            markdownSourceAdapter.observeFootnotes(raw).find((item) => item.identityMode === "managed")
        ).toMatchObject({ integrity: "resolved" });
    });

    it("refuses a stale source when writing managed marks", async () => {
        const file = { path: "dev-note.md" };
        let raw = "External change";
        const app = {
            vault: {
                process: async (_file, change) => {
                    raw = change(raw);
                    return raw;
                },
            },
        };
        const plugin = new ReadingHighlighterPlugin(app, { id: "test", version: "0" });
        plugin.settings = {
            defaultTagPrefix: "",
            enableColorHighlighting: false,
            highlightColor: "",
            notationOpacity: { highlight: 0.6 },
        };
        await expect(plugin.applyMarkdownModification(file, "Original text", 0, 8, "highlight")).rejects.toThrow(
            /Source changed/
        );
        expect(raw).toBe("External change");
    });
});

describe("managed mark metadata", () => {
    it("does not read identity text embedded in another attribute", () => {
        const raw = `<mark title="data-fp-id='fp-${uuidA}' data-fp-part='1/1'">Legacy</mark>`;
        expect(parseHighlights(raw).highlights[0]).toMatchObject({
            annotationId: null,
            identityMode: "tracked-legacy",
            integrity: "resolved",
        });
    });

    it("treats duplicate identity attributes as an ambiguous conflict", () => {
        const raw = `<mark data-fp-id="fp-${uuidA}" data-fp-id="fp-${uuidB}" data-fp-part="1/1">Copy</mark>`;
        expect(parseHighlights(raw).highlights[0]).toMatchObject({
            annotationId: null,
            identityMode: "tracked-legacy",
            integrity: "ambiguous",
        });
    });

    it("keeps a single surviving managed ID but flags duplicate part metadata", () => {
        const raw = `<mark data-fp-id="fp-${uuidA}" data-fp-part="1/2" data-fp-part="2/2">Part</mark>`;
        expect(parseHighlights(raw).highlights[0]).toMatchObject({
            annotationId: `fp-${uuidA}`,
            identityMode: "managed",
            integrity: "ambiguous",
        });
    });
});
