// Issues 3 and 4: where the `==` markers actually land.
import { describe, it, expect } from "vitest";
import ReadingHighlighterPlugin from "../src/main";
import { SelectionLogic } from "../src/core/SelectionLogic";
import { TFile } from "./obsidian-stub.js";
import { createObsidianWindow } from "./dom-helpers.js";
import { getHighlightsFromContent } from "../src/utils/export";
import { parseHighlights, removeLogicalHighlightFromRaw } from "../src/utils/highlights";

export async function setup(raw, html) {
    const window = createObsidianWindow();
    const doc = window.document;
    const content = doc.getElementById("content");
    content.innerHTML = html;

    const file = new TFile("note.md");
    let current = raw;
    let readCount = 0;
    const view = {
        file,
        contentEl: content,
        containerEl: content,
        getMode: () => "preview",
        getViewType: () => "markdown",
    };
    const app = {
        vault: {
            read: async () => {
                readCount += 1;
                return current;
            },
            process: async (_f, transform) => {
                current = transform(current);
                return current;
            },
            modify: async (_f, c) => {
                current = c;
            },
            getAbstractFileByPath: () => null,
        },
        metadataCache: { getFileCache: () => ({ embeds: [] }) },
        fileManager: { processFrontMatter: async () => {} },
        workspace: { getActiveViewOfType: () => view, on: () => {}, off: () => {} },
    };
    const plugin = new ReadingHighlighterPlugin(app, { id: "t", version: "0" });
    await plugin.loadSettings();
    plugin.settings.enableSmartParagraphSelection = false;
    plugin.settings.enableColorHighlighting = false;
    plugin.settings.enableFrontmatterTag = false;
    plugin.settings.enableHaptics = false;
    plugin.settings.defaultTagPrefix = "";
    plugin.settings.learnedNormRules = [];
    plugin.logic = new SelectionLogic(app, () => []);
    return { window, doc, content, plugin, view, out: () => current, reads: () => readCount };
}

/** Text nodes of the rendered container, in document order. */
export function textNodes(root) {
    const out = [];
    const walk = (n) => {
        if (n.nodeType === 3) out.push(n);
        else for (const c of n.childNodes) walk(c);
    };
    walk(root);
    return out;
}

export async function highlightRange(ctx, startNode, startOff, endNode, endOff) {
    const range = ctx.doc.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    const sel = ctx.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    await ctx.plugin.highlightSelection(ctx.view, { text: range.toString(), range });
}

export async function notationRange(ctx, startNode, startOff, endNode, endOff, notationType, color = "#8fa58f") {
    const range = ctx.doc.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    const sel = ctx.window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    await ctx.plugin.applyColorHighlight(ctx.view, color, "", { text: range.toString(), range }, notationType);
}

describe("issue 3: list marker must stay outside the highlight", () => {
    const raw = [
        "# Título",
        "",
        "Párrafo introductorio del artículo.",
        "",
        "- La novela *Primera* (2023), del autor regional.",
        "- Segundo elemento de la lista.",
        "",
        "Párrafo final.",
    ].join("\n");
    const html = [
        "<h1>Título</h1>",
        "<p>Párrafo introductorio del artículo.</p>",
        "<ul><li>La novela <em>Primera</em> (2023), del autor regional.</li>",
        "<li>Segundo elemento de la lista.</li></ul>",
        "<p>Párrafo final.</p>",
    ].join("");

    it("selecting one bullet keeps the marker outside", async () => {
        const ctx = await setup(raw, html);
        const li = ctx.content.querySelectorAll("li")[0];
        const nodes = textNodes(li);
        await highlightRange(ctx, nodes[0], 0, nodes[nodes.length - 1], nodes[nodes.length - 1].nodeValue.length);
        expect(ctx.out()).toMatch(
            /- <mark [^>]*data-fp-part="1\/1">La novela \*Primera\* \(2023\), del autor regional\.<\/mark>/
        );
        expect(ctx.out()).not.toMatch(/<mark[^>]*>- /);
    });

    it("selecting the whole article keeps every marker outside", async () => {
        const ctx = await setup(raw, html);
        const nodes = textNodes(ctx.content);
        const last = nodes[nodes.length - 1];
        await highlightRange(ctx, nodes[0], 0, last, last.nodeValue.length);
        expect(ctx.out()).not.toMatch(/<mark[^>]*>[-#] /);
    });
});

describe("issue 4: extending an existing highlight", () => {
    const raw =
        "==Nació en el norte, en el occidente del país.[^4] Era un miembro del primer grupo, como su esposa.== Su segundo nombre procedió de un comerciante lejano.";
    const html =
        "<p><mark>Nació en el norte, en el occidente del país.<sup>1</sup> Era un miembro del primer grupo, como su esposa.</mark> Su segundo nombre procedió de un comerciante lejano.</p>";

    it("merges into one highlight ending after the final period", async () => {
        const ctx = await setup(raw, html);
        const nodes = textNodes(ctx.content);
        // Start inside the existing highlight, at "Era un miembro…"
        const inner = nodes.find((n) => n.nodeValue.includes("Era un miembro"));
        const startOff = inner.nodeValue.indexOf("Era un miembro");
        const last = nodes[nodes.length - 1];
        await highlightRange(ctx, inner, startOff, last, last.nodeValue.length);

        const out = ctx.out();
        const [mark] = getHighlightsFromContent(out);
        expect(mark.text).toContain("Nació en el norte");
        expect(mark.text).toContain("lejano.");
        expect(mark.annotationId).toMatch(/^fp-/);
    });
});

describe("FuturePlural notation write path", () => {
    it("writes a multi-item reading selection as one logical annotation with separate visible marks", async () => {
        const ctx = await setup(
            "- Alpha one\n- Beta two\n- Gamma three",
            "<ul><li>Alpha one</li><li>Beta two</li><li>Gamma three</li></ul>"
        );
        const items = ctx.content.querySelectorAll("li");
        const first = textNodes(items[0])[0];
        const last = textNodes(items[2])[0];

        await notationRange(ctx, first, 0, last, last.nodeValue.length, "underline");

        const parts = parseHighlights(ctx.out()).highlights;
        expect(parts).toHaveLength(3);
        expect(parts.every((part) => part.notationType === "underline")).toBe(true);
        expect(new Set(parts.map((part) => part.annotationId)).size).toBe(1);
        expect(parts[0].annotationId).toMatch(/^fp-/);
        expect(parts.map((part) => part.partId)).toEqual(["1/3", "2/3", "3/3"]);
        const [logical] = getHighlightsFromContent(ctx.out());
        expect(logical.text).toBe("Alpha one\nBeta two\nGamma three");
        expect(logical.members).toHaveLength(3);
        expect(removeLogicalHighlightFromRaw(ctx.out(), logical)).toBe("- Alpha one\n- Beta two\n- Gamma three");
    });

    it("does not replace existing marks when grouping a passage", async () => {
        const raw = '- <mark data-fp-notation="circle" data-fp-color="#f3c969">Alpha</mark> one\n- Beta two';
        const ctx = await setup(raw, "<ul><li><mark>Alpha</mark> one</li><li>Beta two</li></ul>");
        const first = textNodes(ctx.content.querySelectorAll("li")[0])[0];
        const last = textNodes(ctx.content.querySelectorAll("li")[1])[0];
        await notationRange(ctx, first, 0, last, last.nodeValue.length, "underline");
        expect(ctx.out()).toBe(raw);
    });

    it("keeps one logical ID across blocks regardless of obsolete settings data", async () => {
        const ctx = await setup("- Alpha one\n- Beta two", "<ul><li>Alpha one</li><li>Beta two</li></ul>");
        ctx.plugin.settings.autoGroupMultiBlock = false;
        const items = ctx.content.querySelectorAll("li");
        const first = textNodes(items[0])[0];
        const last = textNodes(items[1])[0];
        await notationRange(ctx, first, 0, last, last.nodeValue.length, "highlight");

        const parts = parseHighlights(ctx.out()).highlights;
        expect(new Set(parts.map((part) => part.annotationId)).size).toBe(1);
        expect(getHighlightsFromContent(ctx.out())).toHaveLength(1);
    });

    it("writes the selected notation type and semantic colour", async () => {
        const ctx = await setup("Alpha beta gamma.", "<p>Alpha beta gamma.</p>");
        const node = textNodes(ctx.content)[0];

        await notationRange(ctx, node, 6, node, 10, "underline");

        expect(ctx.out()).toMatch(
            /Alpha <mark data-fp-notation="underline" data-fp-color="#8fa58f" data-fp-opacity="0.8" data-fp-id="fp-[^"]+" data-fp-part="1\/1">beta<\/mark> gamma\./
        );
        expect(ctx.reads()).toBe(1);
    });

    it("keeps gesture annotations exact when legacy smart paragraph selection is enabled", async () => {
        const ctx = await setup("Alpha beta gamma.", "<p>Alpha beta gamma.</p>");
        ctx.plugin.settings.enableSmartParagraphSelection = true;
        const node = textNodes(ctx.content)[0];

        await notationRange(ctx, node, 6, node, 10, "highlight", "#f3c969");

        expect(ctx.out()).toMatch(
            /Alpha <mark data-fp-notation="highlight" data-fp-color="#f3c969" data-fp-opacity="0.6" data-fp-id="fp-[^"]+" data-fp-part="1\/1">beta<\/mark> gamma\./
        );
    });
});
