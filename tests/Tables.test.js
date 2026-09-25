// Tables: a `==` pair must never span a `|`, escaped pipes are content rather
// than column boundaries, and only the cells the user selected get highlighted.
import { describe, it, expect } from "vitest";
import { setup, textNodes, highlightRange, notationRange } from "./WritePath.test.js";
import { getHighlightsFromContent } from "../src/utils/export";
import { parseHighlights } from "../src/utils/highlights";

const raw = [
    "# Tabla",
    "",
    "| Ref | Fuente | Nota |",
    "| --- | --- | --- |",
    "| A1 | [[Nota\\|Alias]] | `a \\| b` |",
    "| A2 | Lorem ipsum | Dolor sit |",
].join("\n");

const html = [
    "<h1>Tabla</h1>",
    "<table><thead><tr><th>Ref</th><th>Fuente</th><th>Nota</th></tr></thead>",
    "<tbody>",
    "<tr><td>A1</td><td><a>Alias</a></td><td><code>a | b</code></td></tr>",
    "<tr><td>A2</td><td>Lorem ipsum</td><td>Dolor sit</td></tr>",
    "</tbody></table>",
].join("");

const cellOf = (ctx, row, col) => ctx.content.querySelectorAll("tr")[row].children[col];

async function highlightCells(ctx, from, to) {
    const a = textNodes(from);
    const b = textNodes(to);
    await highlightRange(ctx, a[0], 0, b[b.length - 1], b[b.length - 1].nodeValue.length);
}

const lineWith = (out, needle) => out.split("\n").find((l) => l.includes(needle));

describe("table cells", () => {
    it("highlights just the selected cell", async () => {
        const ctx = await setup(raw, html);
        const cell = cellOf(ctx, 2, 1);
        await highlightCells(ctx, cell, cell);
        expect(parseHighlights(ctx.out()).highlights).toMatchObject([{ text: "Lorem ipsum", partId: "1/1" }]);
        expect(lineWith(ctx.out(), "A2")).toMatch(/^\| A2 \| <mark [^>]*>Lorem ipsum<\/mark> \| Dolor sit \|$/);
    });

    it("never lets a highlight span a column boundary", async () => {
        const ctx = await setup(raw, html);
        await highlightCells(ctx, cellOf(ctx, 2, 0), cellOf(ctx, 2, 2));
        const parts = parseHighlights(ctx.out()).highlights;
        expect(parts.map((part) => part.partId)).toEqual(["1/3", "2/3", "3/3"]);
        expect(new Set(parts.map((part) => part.annotationId)).size).toBe(1);
        expect(getHighlightsFromContent(ctx.out())).toHaveLength(1);
        expect(lineWith(ctx.out(), "A2")).not.toMatch(/<mark[^>]*>[^<]*\|/);
    });

    it("highlights a header row cell by cell", async () => {
        const ctx = await setup(raw, html);
        await highlightCells(ctx, cellOf(ctx, 0, 0), cellOf(ctx, 0, 2));
        expect(parseHighlights(ctx.out()).highlights.map((part) => part.text)).toEqual(["Ref", "Fuente", "Nota"]);
    });

    it("treats an escaped pipe as content, not a column boundary", async () => {
        const ctx = await setup(raw, html);
        await highlightCells(ctx, cellOf(ctx, 1, 0), cellOf(ctx, 1, 2));
        const line = lineWith(ctx.out(), "A1");
        expect(parseHighlights(ctx.out()).highlights.map((part) => part.text)).toEqual([
            "A1",
            "[[Nota\\|Alias]]",
            "`a \\| b`",
        ]);
        expect(line).not.toContain("\\<mark");
    });

    it("leaves the delimiter row untouched", async () => {
        const ctx = await setup(raw, html);
        await highlightCells(ctx, cellOf(ctx, 0, 0), cellOf(ctx, 2, 2));
        expect(ctx.out().split("\n")[3]).toBe("| --- | --- | --- |");
    });

    it("keeps the pipe count of every line", async () => {
        const ctx = await setup(raw, html);
        await highlightCells(ctx, cellOf(ctx, 0, 0), cellOf(ctx, 2, 2));
        const pipes = (s) => (s.match(/(?<!\\)\|/g) || []).length;
        raw.split("\n").forEach((l, i) => expect(pipes(ctx.out().split("\n")[i])).toBe(pipes(l)));
    });

    it("does not drag in a neighbouring cell", async () => {
        const ctx = await setup(raw, html);
        const cell = cellOf(ctx, 2, 2);
        await highlightCells(ctx, cell, cell);
        expect(parseHighlights(ctx.out()).highlights.map((part) => part.text)).toEqual(["Dolor sit"]);
        expect(lineWith(ctx.out(), "A2")).toMatch(/^\| A2 \| Lorem ipsum \| <mark [^>]*>Dolor sit<\/mark> \|$/);
    });

    it("writes FuturePlural notation metadata inside a table cell", async () => {
        const ctx = await setup(raw, html);
        const nodes = textNodes(cellOf(ctx, 2, 1));

        await notationRange(ctx, nodes[0], 0, nodes[0], nodes[0].nodeValue.length, "box", "#ed9275");

        expect(lineWith(ctx.out(), "A2")).toMatch(
            /<mark data-fp-notation="box" data-fp-color="#ed9275" data-fp-opacity="0.68" data-fp-id="fp-[^"]+" data-fp-part="1\/1">Lorem ipsum<\/mark>/
        );
    });
});
