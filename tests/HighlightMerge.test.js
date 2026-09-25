// Issue 4: extending, overlapping and merging highlights.
import { describe, it, expect } from "vitest";
import { setup, textNodes, highlightRange } from "./WritePath.test.js";
import { getHighlightsFromContent } from "../src/utils/export";

const marks = (s) => getHighlightsFromContent(s);

/** Select from `startText` to `endText` (inclusive) across the rendered block. */
async function selectBetween(ctx, startText, endText) {
    const nodes = textNodes(ctx.content);
    const s = nodes.find((n) => n.nodeValue.includes(startText));
    const e = [...nodes].reverse().find((n) => n.nodeValue.includes(endText));
    const from = s.nodeValue.indexOf(startText);
    const to = e.nodeValue.indexOf(endText) + endText.length;
    await highlightRange(ctx, s, from, e, to);
}

describe("extending a highlight forwards", () => {
    const raw = "==Uno dos tres.== Cuatro cinco seis.";
    const html = "<p><mark>Uno dos tres.</mark> Cuatro cinco seis.</p>";

    it("merges into one highlight, period included", async () => {
        const ctx = await setup(raw, html);
        await selectBetween(ctx, "dos tres", "cinco seis.");
        expect(marks(ctx.out())).toMatchObject([{ text: "Uno dos tres. Cuatro cinco seis.", identityMode: "managed" }]);
    });
});

describe("extending a highlight backwards", () => {
    const raw = "Uno dos tres. ==Cuatro cinco seis.==";
    const html = "<p>Uno dos tres. <mark>Cuatro cinco seis.</mark></p>";

    it("merges into one highlight", async () => {
        const ctx = await setup(raw, html);
        await selectBetween(ctx, "Uno dos", "Cuatro cinco");
        expect(marks(ctx.out())).toMatchObject([{ text: "Uno dos tres. Cuatro cinco seis.", identityMode: "managed" }]);
    });
});

describe("a selection spanning two separate highlights", () => {
    const raw = "==Uno.== Dos tres. ==Cuatro.== Cinco.";
    const html = "<p><mark>Uno.</mark> Dos tres. <mark>Cuatro.</mark> Cinco.</p>";

    it("merges all of them into one", async () => {
        const ctx = await setup(raw, html);
        await selectBetween(ctx, "Uno.", "Cuatro.");
        expect(marks(ctx.out())).toMatchObject([{ text: "Uno. Dos tres. Cuatro.", identityMode: "managed" }]);
    });
});

describe("a selection entirely inside an existing highlight", () => {
    const raw = "==Uno dos tres cuatro.== Cinco.";
    const html = "<p><mark>Uno dos tres cuatro.</mark> Cinco.</p>";

    it("leaves the highlight as it was rather than nesting markers", async () => {
        const ctx = await setup(raw, html);
        await selectBetween(ctx, "dos", "tres");
        expect(ctx.out()).toBe(raw);
        expect(marks(ctx.out())).toHaveLength(1);
    });
});

describe("footnote reference inside the merged span", () => {
    const raw = "==Nació en el norte.[^4] Era del grupo.== Su nombre procedió de un comerciante.";
    const html =
        "<p><mark>Nació en el norte.<sup>1</sup> Era del grupo.</mark> Su nombre procedió de un comerciante.</p>";

    it("keeps the footnote inside and closes after the final period", async () => {
        const ctx = await setup(raw, html);
        await selectBetween(ctx, "Era del grupo", "un comerciante.");
        expect(marks(ctx.out())[0].text).toBe(
            "Nació en el norte.[^4] Era del grupo. Su nombre procedió de un comerciante."
        );
    });
});

describe("closing marker goes after the trailing period", () => {
    const raw = "==Uno dos.== Tres cuatro negros.";
    const html = "<p><mark>Uno dos.</mark> Tres cuatro negros.</p>";

    it("never leaves the period outside", async () => {
        const ctx = await setup(raw, html);
        await selectBetween(ctx, "dos.", "cuatro negros.");
        expect(ctx.out().endsWith("negros.</mark>")).toBe(true);
        expect(ctx.out()).not.toContain("negros</mark>.");
    });
});

describe("a selection touching no highlight is unaffected", () => {
    const raw = "==Uno.== Dos tres cuatro. Cinco.";
    const html = "<p><mark>Uno.</mark> Dos tres cuatro. Cinco.</p>";

    it("adds its own highlight and leaves the other alone", async () => {
        const ctx = await setup(raw, html);
        await selectBetween(ctx, "Dos tres", "tres cuatro.");
        expect(marks(ctx.out()).map((mark) => mark.text)).toEqual(["Uno.", "Dos tres cuatro."]);
        expect(ctx.out()).toContain("==Uno.==");
    });
});
