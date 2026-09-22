import { describe, expect, it } from "vitest";
import { HighlightNavigatorView } from "../src/views/HighlightNavigator";
import { getHighlightsFromContent } from "../src/utils/export";
import { parseHighlights } from "../src/utils/highlights";
import { createObsidianWindow } from "./dom-helpers.js";
import { TFile } from "obsidian";

describe("Navigator mark selection", () => {
    it("groups nonadjacent selected rows, then ungroups the resulting entry", async () => {
        const window = createObsidianWindow();
        let raw = ["One", "Two", "Three", "Four"].map((text) => `- <mark>${text}</mark>`).join("\n");
        const file = { path: "test.md" };
        let undoSaves = 0;
        const app = {
            vault: {
                read: async () => raw,
                process: async (_file, change) => {
                    raw = change(raw);
                    return raw;
                },
            },
        };
        const plugin = {
            app,
            saveUndoState: async () => {
                undoSaves++;
            },
        };
        const navigator = new HighlightNavigatorView({}, plugin);
        navigator.app = app;
        navigator.contentEl = window.document.getElementById("content");
        navigator.selectionBarEl = window.document.createElement("div");
        navigator.contentEl.before(navigator.selectionBarEl);
        navigator.currentFile = file;
        navigator.highlights = getHighlightsFromContent(raw);
        navigator.refresh = async () => {
            navigator.highlights = getHighlightsFromContent(raw);
            navigator.selectedIds.clear();
            navigator.renderContent();
        };

        navigator.renderContent();
        expect(navigator.contentEl.querySelectorAll(".fp-navigator-select")).toHaveLength(0);
        navigator.setSelectionMode(true);
        const boxes = navigator.contentEl.querySelectorAll(".fp-navigator-select");
        expect(boxes).toHaveLength(4);
        boxes[0].click();
        boxes[1].click();
        boxes[3].click();
        expect(navigator.selectionBarEl.querySelector(".fp-navigator-selected-count").textContent).toBe("3 selected");
        expect(navigator.groupButton.disabled).toBe(false);

        await navigator.regroupSelected("selected-gap");
        expect(undoSaves).toBe(1);
        expect(parseHighlights(raw).highlights.map((part) => part.groupId)).toEqual([
            "selected-gap",
            "selected-gap",
            null,
            "selected-gap",
        ]);
        expect(navigator.highlights.map((item) => item.text)).toEqual(["One\nTwo\nFour", "Three"]);

        navigator.setSelectionMode(true);
        navigator.contentEl.querySelector(".fp-navigator-select").click();
        expect(navigator.ungroupButton.disabled).toBe(false);
        await navigator.regroupSelected(null);
        expect(undoSaves).toBe(2);
        expect(navigator.highlights.map((item) => item.text)).toEqual(["One", "Two", "Three", "Four"]);
        expect(parseHighlights(raw).highlights.every((part) => part.groupId === null)).toBe(true);
    });

    it("labels the canvas action from the real associated-canvas state", () => {
        const window = createObsidianWindow();
        const source = new TFile("notes/source.md");
        const canvas = new TFile("notes/source — annotations.canvas");
        const app = {
            vault: {
                getAbstractFileByPath: (path) => (path === canvas.path ? canvas : null),
            },
        };
        const plugin = {
            app,
            settings: { canvasAssociations: [{ source: source.path, canvas: canvas.path }] },
        };
        const navigator = new HighlightNavigatorView({}, plugin);
        navigator.app = app;
        navigator.currentFile = source;
        navigator.canvasButton = window.document.createElement("button");

        navigator.updateCanvasButton();
        expect(navigator.canvasButton.textContent).toBe("Add to Canvas");

        plugin.settings.canvasAssociations = [{ source: source.path, canvas: "missing.canvas" }];
        navigator.updateCanvasButton();
        expect(navigator.canvasButton.textContent).toBe("Create Canvas");
    });
});
