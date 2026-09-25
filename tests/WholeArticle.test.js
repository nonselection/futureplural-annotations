// Issue 3: selecting a whole article. A note mixing headings, lists, footnotes
// cannot be matched as one giant snippet, so the writer uses anchored ends.
import { describe, it, expect } from "vitest";
import { setup, textNodes, highlightRange } from "./WritePath.test.js";
import { getHighlightsFromContent } from "../src/utils/export";
import { parseHighlights } from "../src/utils/highlights";

const raw = [
    "---",
    "tags:",
    "  - x",
    "---",
    "",
    "## Biografía",
    "",
    "Nació en la región del norte, en el occidente del país.[^4] Era del grupo.",
    "",
    "El pueblo del norte no era favorecido por los comerciantes.[^1] Era común entre ellos.",
    "",
    "### En la cultura",
    "",
    "- La novela *Segunda parte* (1991), del autor del sur.",
    "- La novela *Primera*... *las alas del viento* (2023), del autor regional.",
    "",
    "Párrafo final del artículo.",
].join("\n");

const html = [
    "<h2>Biografía</h2>",
    "<p>Nació en la región del norte, en el occidente del país.<sup>1</sup> Era del grupo.</p>",
    "<p>El pueblo del norte no era favorecido por los comerciantes.<sup>2</sup> Era común entre ellos.</p>",
    "<h3>En la cultura</h3>",
    "<ul><li>La novela <em>Segunda parte</em> (1991), del autor del sur.</li>",
    "<li>La novela <em>Primera</em>... <em>las alas del viento</em> (2023), del autor regional.</li></ul>",
    "<p>Párrafo final del artículo.</p>",
].join("");

async function selectEverything(ctx) {
    const nodes = textNodes(ctx.content);
    const last = nodes[nodes.length - 1];
    await highlightRange(ctx, nodes[0], 0, last, last.nodeValue.length);
}

describe("highlighting an entire article", () => {
    it("writes something rather than failing to locate", async () => {
        const ctx = await setup(raw, html);
        await selectEverything(ctx);
        expect(ctx.out()).not.toBe(raw);
    });

    it("never puts the opening marker before a list bullet", async () => {
        const ctx = await setup(raw, html);
        await selectEverything(ctx);
        for (const line of ctx.out().split("\n")) {
            expect(line).not.toMatch(/^[ \t]*<mark[^>]*>[-*+][ \t]/);
        }
        expect(ctx.out()).toMatch(/- <mark[^>]*>La novela \*Primera\*/);
    });

    it("never puts the opening marker before a heading hash", async () => {
        const ctx = await setup(raw, html);
        await selectEverything(ctx);
        for (const line of ctx.out().split("\n")) {
            expect(line).not.toMatch(/^[ \t]*<mark[^>]*>#/);
        }
        expect(ctx.out()).toMatch(/## <mark[^>]*>Biografía<\/mark>/);
    });

    it("leaves balanced markers", async () => {
        const ctx = await setup(raw, html);
        await selectEverything(ctx);
        const parts = parseHighlights(ctx.out()).highlights;
        expect(parts.length).toBeGreaterThan(3);
        expect(new Set(parts.map((part) => part.annotationId)).size).toBe(1);
        expect(getHighlightsFromContent(ctx.out())).toHaveLength(1);
    });

    it("does not disturb the frontmatter", async () => {
        const ctx = await setup(raw, html);
        await selectEverything(ctx);
        expect(ctx.out().startsWith("---\ntags:\n  - x\n---\n")).toBe(true);
    });

    it("keeps the footnote reference inside a managed part", async () => {
        const ctx = await setup(raw, html);
        await selectEverything(ctx);
        const line = ctx
            .out()
            .split("\n")
            .find((l) => l.includes("Nació en la región"));
        expect(line).toMatch(/<mark[^>]*>Nació[^<]*\[\^4\][^<]*<\/mark>/);
    });

    it("refuses to replace an existing external mark during a broad gesture", async () => {
        const markedRaw = raw.replace("Nació en la región", "==Nació en la región==");
        const markedHtml = html.replace("Nació en la región", "<mark>Nació en la región</mark>");
        const ctx = await setup(markedRaw, markedHtml);
        await selectEverything(ctx);
        expect(ctx.out()).toBe(markedRaw);
    });
});
