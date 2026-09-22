import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { parseHighlights, migrateSpanHighlightsInRaw } from "../src/utils/highlights";
import { maintenancePreview } from "../src/modals/MaintenanceModal";

describe("downloadable parser field test", () => {
    it("finds exactly the twelve positive examples and no deceptive examples", () => {
        const raw = readFileSync(new URL("./fixtures/Parser-Spike.md", import.meta.url), "utf8");
        const marks = parseHighlights(raw).highlights;
        expect(marks.map((h) => h.text.match(/^P\d+/)?.[0])).toEqual(
            Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`)
        );
        expect(marks.some((h) => h.text.includes("NEG"))).toBe(false);
    });
    it("migrates only real spans, preserves attributes, and ignores nested spans", () => {
        const real = '<span title="A > B" style="background-color: #fff; opacity: .5">real\ntext</span>';
        const negatives = [
            '`<span style="background:red">code</span>`',
            '<!-- <span style="background:red">comment</span> -->',
            "<i title=\"<span style='background:red'>attribute</span>\">ok</i>",
            '<span style="background:red"><span>nested</span></span>',
        ].join("\n\n");
        const result = migrateSpanHighlightsInRaw(real + "\n\n" + negatives);
        expect(result.changedCount).toBe(1);
        expect(result.raw).toBe(real.replace("<span", "<mark").replace("</span>", "</mark>") + "\n\n" + negatives);
    });
    it("previews maintenance without changing input and validates colors", () => {
        const raw = "==a== ==b==";
        expect(maintenancePreview(raw, "merge", "", "")).toEqual({ raw: "==a b==", count: 1 });
        expect(() => maintenancePreview(raw, "recolor", "", "oops")).toThrow();
    });
});
