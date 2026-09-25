import { describe, expect, it } from "vitest";
import { markdownSourceAdapter } from "../src/adapters/MarkdownSourceAdapter";
import {
    logicalHighlights,
    mergeAdjacentHighlightsInRaw,
    parseHighlights,
    removeLogicalHighlightFromRaw,
} from "../src/utils/highlights";

const id = "fp-12345678-abcd-4abc-8abc-123456789abc";
const part = (text, ordinal, total = 2, managedId = id) =>
    `<mark data-fp-id="${managedId}" data-fp-part="${ordinal}/${total}">${text}</mark>`;

describe("logical Markdown identity", () => {
    it("uses part order rather than source order, and removes one logical annotation", () => {
        const raw = `${part("second", 2)}\n${part("first", 1)}`;
        const [logical] = logicalHighlights(parseHighlights(raw).highlights);
        expect(logical.text).toBe("first\nsecond");
        expect(logical.members.map((member) => member.partId)).toEqual(["1/2", "2/2"]);
        expect(markdownSourceAdapter.observe(raw)[0].anchor.parts.map((item) => item.order)).toEqual([1, 2]);
        expect(removeLogicalHighlightFromRaw(raw, logical)).toBe("second\nfirst");
    });

    it("reports a lost part as managed and degraded without changing surviving identity", () => {
        const [logical] = logicalHighlights(parseHighlights(part("first", 1)).highlights);
        expect(logical).toMatchObject({ annotationId: id, identityMode: "managed", integrity: "degraded" });
    });

    it("reports copied parts with the same identity and ordinal as ambiguous and refuses deletion", () => {
        const raw = `${part("first", 1)}\n${part("copy", 1)}`;
        const [logical] = logicalHighlights(parseHighlights(raw).highlights);
        expect(logical.integrity).toBe("ambiguous");
        expect(() => removeLogicalHighlightFromRaw(raw, logical)).toThrow(/ambiguous/);
    });

    it("does not attach an externally stripped ID to a surviving managed part", () => {
        const raw = `${part("first", 1)}\n<mark data-fp-part="2/2">second</mark>`;
        const logical = logicalHighlights(parseHighlights(raw).highlights);
        expect(logical).toHaveLength(2);
        expect(logical[0]).toMatchObject({ annotationId: id, identityMode: "managed", integrity: "degraded" });
        expect(logical[1]).toMatchObject({ annotationId: null, identityMode: "tracked-legacy", integrity: "degraded" });
    });

    it("discovers a mark whose entire managed carrier was removed as tracked legacy", () => {
        const before = part("passage", 1, 1);
        const after = "<mark>passage</mark>";
        expect(markdownSourceAdapter.observe(before)[0].identityMode).toBe("managed");
        expect(markdownSourceAdapter.observe(after)[0]).toMatchObject({
            managedId: null,
            identityMode: "tracked-legacy",
            integrity: "resolved",
        });
    });

    it("keeps malformed metadata and obsolete pre-B0 group attributes from creating identity", () => {
        const raw = '<mark data-fp-id="bad" data-fp-part="oops" data-fp-group="old">text</mark>';
        const [logical] = logicalHighlights(parseHighlights(raw).highlights);
        expect(logical).toMatchObject({ annotationId: null, identityMode: "tracked-legacy", integrity: "degraded" });
        expect(
            logicalHighlights(
                parseHighlights(`<mark data-fp-group="old">a</mark> <mark data-fp-group="old">b</mark>`).highlights
            )
        ).toHaveLength(2);
    });

    it("never merges adjacent managed wrappers into a new untracked physical mark", () => {
        const raw = `${part("one", 1)} ${part("two", 2)}`;
        expect(mergeAdjacentHighlightsInRaw(raw)).toEqual({ raw, mergedCount: 0 });
    });
});
