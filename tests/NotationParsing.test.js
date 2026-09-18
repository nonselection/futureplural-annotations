import { describe, expect, it } from "vitest";
import { createNotationOpenTag, NOTATION_TYPES } from "../src/models/notations";
import { parseHighlights } from "../src/utils/highlights";

describe("FuturePlural notation parsing", () => {
    it("normalizes legacy Markdown highlighting into the shared notation model", () => {
        const [highlight] = parseHighlights("Before ==legacy== after.").highlights;

        expect(highlight.type).toBe("markdown");
        expect(highlight.notationType).toBe("highlight");
        expect(highlight.color).toBeNull();
        expect(highlight.groupId).toBeNull();
    });

    it("normalizes a legacy coloured mark into a highlight notation", () => {
        const raw = 'Before <mark style="background: #ffcc66; color: black;">legacy</mark> after.';

        const [highlight] = parseHighlights(raw).highlights;

        expect(highlight.type).toBe("html");
        expect(highlight.notationType).toBe("highlight");
        expect(highlight.color).toBe("#ffcc66");
        expect(highlight.groupId).toBeNull();
    });

    it.each(NOTATION_TYPES)("parses the %s notation contract", (notationType) => {
        const raw = `<mark data-fp-notation="${notationType}" ` + `data-fp-color="#8fa58f">text</mark>`;

        const [highlight] = parseHighlights(raw).highlights;

        expect(highlight.notationType).toBe(notationType);
        expect(highlight.color).toBe("#8fa58f");
    });

    it("round-trips notation type, colour, and logical group through the canonical contract", () => {
        const openTag = createNotationOpenTag(
            {
                notationType: "underline",
                color: "#8fa58f",
            },
            "reading-list-a"
        );

        const [highlight] = parseHighlights(`${openTag}text</mark>`).highlights;

        expect(openTag).toBe(
            '<mark data-fp-notation="underline" ' + 'data-fp-color="#8fa58f" ' + 'data-fp-group="reading-list-a">'
        );

        expect(highlight.notationType).toBe("underline");
        expect(highlight.color).toBe("#8fa58f");
        expect(highlight.groupId).toBe("reading-list-a");
    });

    it("treats FuturePlural colour metadata as canonical when legacy style is also present", () => {
        const raw =
            '<mark style="background: #ff0000;" ' +
            'data-fp-color="#8fa58f" ' +
            'data-fp-notation="underline">text</mark>';

        const [highlight] = parseHighlights(raw).highlights;

        expect(highlight.notationType).toBe("underline");
        expect(highlight.color).toBe("#8fa58f");
    });

    it("falls back safely when a notation type is unknown", () => {
        const raw = '<mark data-fp-notation="future-squiggle" ' + 'data-fp-color="#8fa58f">text</mark>';

        const [highlight] = parseHighlights(raw).highlights;

        expect(highlight.notationType).toBe("highlight");
        expect(highlight.color).toBe("#8fa58f");
    });

    it("preserves a shared logical group across separate source-safe wrappers", () => {
        const raw = [
            '- <mark data-fp-notation="highlight" data-fp-color="#f3c969" data-fp-group="list-a">One</mark>',
            '- <mark data-fp-notation="highlight" data-fp-color="#f3c969" data-fp-group="list-a">Two</mark>',
        ].join("\n");

        const highlights = parseHighlights(raw).highlights;

        expect(highlights).toHaveLength(2);
        expect(highlights.map((highlight) => highlight.groupId)).toEqual(["list-a", "list-a"]);
    });

    it("keeps tags and footnote comments attached to FuturePlural markup", () => {
        const raw = [
            '#source <mark data-fp-notation="circle" data-fp-color="#8fa58f">important text</mark>[^7]',
            "",
            "[^7]: A retained comment.",
        ].join("\n");

        const [highlight] = parseHighlights(raw).highlights;

        expect(highlight.tagsText).toBe("#source");
        expect(highlight.footnoteId).toBe("7");
        expect(highlight.footnotePlacement).toBe("after");
        expect(highlight.annotation).toBe("A retained comment.");
    });
});
