import { describe, expect, it } from "vitest";
import { groupHighlights, parseHighlights, regroupHighlightsInRaw } from "../src/utils/highlights";

const mark = (text, color = "#f3c969", groupId = null) =>
    `<mark data-fp-notation="highlight" data-fp-color="${color}" data-fp-opacity="0.6"${groupId ? ` data-fp-group="${groupId}"` : ""}>${text}</mark>`;

describe("editable logical annotation groups", () => {
    it("groups items 1, 2 and 4 across a gap while leaving every visible mark intact", () => {
        const original = ["One", "Two", "Three", "Four", "Five"].map((text) => `- ${mark(text)}`).join("\n");
        const items = groupHighlights(parseHighlights(original).highlights);
        const grouped = regroupHighlightsInRaw(original, [items[0], items[1], items[3]], "list-a");

        expect(groupHighlights(parseHighlights(grouped).highlights).map((item) => item.text)).toEqual([
            "One\nTwo\nFour",
            "Three",
            "Five",
        ]);
        expect(parseHighlights(grouped).highlights.map((part) => part.groupId)).toEqual([
            "list-a",
            "list-a",
            null,
            "list-a",
            null,
        ]);
        expect(grouped.match(/data-fp-opacity="0.6"/g)).toHaveLength(5);

        const group = groupHighlights(parseHighlights(grouped).highlights)[0];
        expect(regroupHighlightsInRaw(grouped, [group], null)).toBe(original);
    });

    it("combines an old group and an individual mark without leaving a partial old group", () => {
        const original = [mark("Red", "#a64f48", "old"), mark("Green", "#8fa58f", "old"), mark("Blue", "#8faad6")].join(
            "\n"
        );
        const logical = groupHighlights(parseHighlights(original).highlights);
        const result = regroupHighlightsInRaw(original, logical, "new");
        const [group] = groupHighlights(parseHighlights(result).highlights);
        expect(group.members).toHaveLength(3);
        expect(group.color).toBeNull();
        expect(group.members.map((member) => member.color)).toEqual(["#a64f48", "#8fa58f", "#8faad6"]);
        expect(result).not.toContain('data-fp-group="old"');
    });

    it("converts a default Markdown highlight only when it needs group metadata", () => {
        const original = "First ==plain== and " + mark("colored");
        const items = groupHighlights(parseHighlights(original).highlights);
        const grouped = regroupHighlightsInRaw(original, items, "mix");
        expect(grouped).toContain('<mark data-fp-notation="highlight" data-fp-group="mix">plain</mark>');
        expect(grouped).toContain('data-fp-color="#f3c969" data-fp-opacity="0.6" data-fp-group="mix"');
        expect(groupHighlights(parseHighlights(grouped).highlights)).toHaveLength(1);
    });

    it("refuses stale selections and leaves the source untouched", () => {
        const raw = `${mark("One")} ${mark("Two")}`;
        const stale = groupHighlights(parseHighlights(raw).highlights).map((item) => ({ ...item }));
        stale[0].text = "changed";
        expect(() => regroupHighlightsInRaw(raw, stale, "new")).toThrow(/changed while/);
        expect(raw).not.toContain("data-fp-group");
    });
});
