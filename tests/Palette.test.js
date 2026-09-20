// The toolbar palette: which colours appear, and — the part that can silently
// corrupt notes — which colour a button actually applies once the list is
// filtered.
import { describe, it, expect, beforeEach } from "vitest";
import { FloatingManager } from "../src/ui/FloatingManager";
import { createObsidianWindow } from "./dom-helpers.js";

function makeManager(colors, showOnlyAssignedColors) {
    const window = createObsidianWindow();
    const applied = [];
    const view = { getMode: () => "preview" };
    const plugin = {
        app: { workspace: { getActiveViewOfType: () => view, on: () => {}, off: () => {} } },
        settings: {
            enableColorPalette: true,
            showOnlyAssignedColors,
            semanticColors: colors,
            showTagButton: false,
            showQuoteButton: false,
            showRemoveButton: false,
            enableAnnotations: false,
            showAnnotationButton: false,
            enableReadingProgress: false,
            toolbarPosition: "right",
            lastNotationType: "highlight",
        },
        applyColorByIndex: (_v, index, _selection, notationType) => applied.push({ index, notationType }),
        rememberNotationType: async (notationType) => {
            plugin.settings.lastNotationType = notationType;
        },
        savePdfHighlight: () => {},
    };
    return { manager: new FloatingManager(plugin), applied, plugin, window };
}

const palette = (meanings) => meanings.map((meaning, i) => ({ color: `#00000${i}`, meaning }));

describe("toolbar palette filtering", () => {
    let full;
    beforeEach(() => {
        full = palette(["Disagreement", "", "Key point", "", "", "Definition", "", ""]);
    });

    it("shows only colours that have a meaning", () => {
        const { manager } = makeManager(full, true);
        expect(manager.visiblePaletteColors().map((e) => e.index)).toEqual([0, 2, 5]);
    });

    it("shows every colour when the option is off", () => {
        const { manager } = makeManager(full, false);
        expect(manager.visiblePaletteColors()).toHaveLength(8);
    });

    it("shows every colour when nothing has been named yet", () => {
        const { manager } = makeManager(palette(["", "", ""]), true);
        expect(manager.visiblePaletteColors()).toHaveLength(3);
    });

    it("ignores whitespace-only meanings", () => {
        const { manager } = makeManager(palette(["  ", "Real", "\t"]), true);
        expect(manager.visiblePaletteColors().map((e) => e.index)).toEqual([1]);
    });

    it("renders one button per visible colour, tagged with its real index", () => {
        const { manager } = makeManager(full, true);
        manager.createElements();
        const buttons = [...manager.paletteContainer.querySelectorAll("button")];
        expect(buttons).toHaveLength(3);
        expect(buttons.map((b) => b.getAttribute("data-color-index"))).toEqual(["0", "2", "5"]);
        expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Disagreement", "Key point", "Definition"]);
        expect(buttons.every((button) => button.dataset.testTooltipPlacement === "top")).toBe(true);
    });

    it("applies the colour the button represents, not its position", () => {
        const { manager, applied, window } = makeManager(full, true);
        manager.load();
        const buttons = [...manager.paletteContainer.querySelectorAll("button")];
        // Third visible button is semanticColors[5], not semanticColors[2].
        buttons[2].dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }));
        expect(applied).toEqual([{ index: 5, notationType: "highlight" }]);
    });

    it("still applies the right colour with filtering off", () => {
        const { manager, applied, window } = makeManager(full, false);
        manager.load();
        const buttons = [...manager.paletteContainer.querySelectorAll("button")];
        buttons[5].dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }));
        expect(applied).toEqual([{ index: 5, notationType: "highlight" }]);
    });

    it("renders every notation gesture and marks the remembered gesture active", () => {
        const { manager } = makeManager(full, true);
        manager.activeNotationType = "circle";
        manager.createElements();

        expect(manager.notationButtons.map((button) => button.dataset.fpNotation)).toEqual([
            "highlight",
            "underline",
            "box",
            "circle",
            "strike-through",
            "crossed-off",
        ]);
        expect(manager.notationButtons.find((button) => button.dataset.fpNotation === "circle")?.ariaPressed).toBe(
            "true"
        );
        expect(manager.notationButtons.map((button) => button.dataset.testTooltip)).toEqual([
            "Highlight",
            "Underline",
            "Box",
            "Circle",
            "Strike through",
            "Cross out",
        ]);
        expect(manager.notationButtons.every((button) => button.dataset.testTooltipPlacement === "top")).toBe(true);
    });

    it("selects a gesture without writing, then applies it when a colour is tapped", () => {
        const { manager, applied, plugin, window } = makeManager(full, true);
        manager.load();

        const underline = manager.notationButtons.find((button) => button.dataset.fpNotation === "underline");
        underline.dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }));

        expect(applied).toEqual([]);
        expect(plugin.settings.lastNotationType).toBe("underline");
        expect(underline.getAttribute("aria-pressed")).toBe("true");

        manager.colorButtons[0].dispatchEvent(new window.Event("mousedown", { bubbles: true, cancelable: true }));
        expect(applied).toEqual([{ index: 0, notationType: "underline" }]);
    });
});
