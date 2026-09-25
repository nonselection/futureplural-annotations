import { describe, expect, it, vi } from "vitest";
import { HighlightNavigatorView } from "../src/views/HighlightNavigator";
import { getHighlightsFromContent } from "../src/utils/export";
import { createObsidianWindow } from "./dom-helpers.js";
import { Notice, TFile } from "obsidian";
import { DEFAULT_CANVAS_SETTINGS } from "../src/utils/canvas";

describe("Navigator mark selection", () => {
    it("shows highlights and footnotes as compact collapsible sections", () => {
        const window = createObsidianWindow();
        const raw = '<mark style="background: #ffcc00">Amber</mark> text[^note].\n\n[^note]: A footnote';
        const navigator = new HighlightNavigatorView({}, { app: {} });
        navigator.contentEl = window.document.getElementById("content");
        navigator.highlights = getHighlightsFromContent(raw);
        navigator.footnotes = navigator.getFootnotesFromContent(raw);

        navigator.renderContent();
        const sections = navigator.contentEl.querySelectorAll(".fp-navigator-section");
        const headings = navigator.contentEl.querySelectorAll(".fp-navigator-section-heading");
        expect(sections).toHaveLength(2);
        expect(headings[0].getAttribute("aria-expanded")).toBe("true");
        expect(headings[1].getAttribute("aria-expanded")).toBe("false");
        expect(sections[0].querySelector(".fp-navigator-number").textContent).toBe("1");
        expect(sections[0].querySelector(".highlight-color-dot")).not.toBeNull();
        expect(sections[0].querySelector(".fp-navigator-row-actions")).not.toBeNull();

        headings[1].click();
        const expanded = navigator.contentEl.querySelectorAll(".fp-navigator-section-heading");
        expect(expanded[1].getAttribute("aria-expanded")).toBe("true");
        expect(navigator.contentEl.querySelectorAll(".highlight-navigator-item")).toHaveLength(2);
        expect(navigator.contentEl.querySelectorAll(".fp-navigator-number")[1].textContent).toBe("1");
    });

    it("renders ordered source parts as one row without physical grouping controls", () => {
        const window = createObsidianWindow();
        const id = "fp-12345678-abcd-4abc-8abc-123456789abc";
        const raw = [
            `- <mark data-fp-id="${id}" data-fp-part="1/2">One</mark>`,
            `- <mark data-fp-id="${id}" data-fp-part="2/2">Two</mark>`,
        ].join("\n");
        const navigator = new HighlightNavigatorView({}, { app: {} });
        navigator.contentEl = window.document.getElementById("content");
        navigator.highlights = getHighlightsFromContent(raw);
        navigator.jumpToLine = vi.fn();
        navigator.renderContent();
        expect(navigator.highlights).toHaveLength(1);
        expect(navigator.contentEl.querySelectorAll(".highlight-navigator-item")).toHaveLength(1);
        expect(navigator.contentEl.querySelector(".highlight-text").textContent).toBe("One Two");
        expect(navigator.contentEl.querySelector(".fp-navigator-part-count").textContent).toBe("2 parts");
        expect(navigator.contentEl.querySelectorAll(".fp-navigator-select")).toHaveLength(0);
        expect(navigator.contentEl.querySelector(".fp-navigator-source-link")).not.toBeNull();
        navigator.contentEl.querySelector(".fp-navigator-source-link").click();
        expect(navigator.jumpToLine).toHaveBeenCalledWith(0);
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

    it("replaces a stale canvas association with a canvas named from the current note", async () => {
        const window = createObsidianWindow();
        const source = new TFile("Notes/New name.md");
        const files = new Map();
        const create = async (path, raw) => {
            const file = new TFile(path);
            files.set(path, { file, raw });
            return file;
        };
        const app = {
            vault: {
                read: async (file) => (file.path === source.path ? "<mark>Alpha</mark>" : files.get(file.path)?.raw),
                getAbstractFileByPath: (path) => files.get(path)?.file ?? null,
                createFolder: async () => {},
                create,
            },
            workspace: { getLeaf: () => ({ openFile: async () => {} }) },
        };
        const plugin = {
            app,
            settings: {
                canvasAssociations: [{ source: source.path, canvas: "Notes/Highlights - Previous name.canvas" }],
                canvasDefaults: { ...DEFAULT_CANVAS_SETTINGS },
            },
            saveData: async () => {},
        };
        const navigator = new HighlightNavigatorView({}, plugin);
        navigator.app = app;
        navigator.currentFile = source;
        navigator.canvasButton = window.document.createElement("button");
        Notice.messages.length = 0;

        await navigator.exportCurrentFileToCanvas();

        expect(plugin.settings.canvasAssociations).toEqual([
            { source: source.path, canvas: "Notes/Highlights - New name.canvas" },
        ]);
        expect(files.has("Notes/Highlights - New name.canvas")).toBe(true);
        expect(Notice.messages.at(-1)).toBe("Created canvas with 1 card.");
    });
});
