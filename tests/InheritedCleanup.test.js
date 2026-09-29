import { beforeEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import ReadingHighlighterPlugin from "../src/main";
import { FloatingManager } from "../src/ui/FloatingManager";
import { HIGHLIGHT_NAVIGATOR_VIEW } from "../src/views/HighlightNavigator";
import { RESEARCH_VIEW } from "../src/views/ResearchView";
import { createObsidianWindow } from "./dom-helpers.js";

const modalCaptures = vi.hoisted(() => ({ maintenance: [], tagCallbacks: [], annotationCallbacks: [] }));

vi.mock("../src/modals/MaintenanceModal", () => ({
    MaintenanceModal: class {
        constructor(plugin, file, changed, initialOperation) {
            modalCaptures.maintenance.push({ plugin, file, changed, initialOperation, opened: false });
        }
        open() {
            modalCaptures.maintenance.at(-1).opened = true;
        }
    },
}));

vi.mock("../src/modals/TagSuggestModal", () => ({
    TagSuggestModal: class {
        constructor(_plugin, onChoose) {
            modalCaptures.tagCallbacks.push(onChoose);
        }
        open() {}
    },
}));

vi.mock("../src/modals/AnnotationModal", () => ({
    AnnotationModal: class {
        constructor(_app, onSubmit) {
            modalCaptures.annotationCallbacks.push(onSubmit);
        }
        open() {}
    },
}));

const manifest = { id: "futureplural-annotations", version: "0.1.0" };

beforeEach(() => {
    modalCaptures.maintenance.length = 0;
    modalCaptures.tagCallbacks.length = 0;
    modalCaptures.annotationCallbacks.length = 0;
});

describe("inherited runtime cleanup", () => {
    it("uses the Finders Keepers namespace for registered Obsidian view types", () => {
        expect(HIGHLIGHT_NAVIGATOR_VIEW).toBe("fk-highlight-navigator");
        expect(RESEARCH_VIEW).toBe("fk-research-view");
    });

    it("removes iOS document listeners and the pending long-press timer on unload", () => {
        const window = createObsidianWindow();
        const doc = globalThis.activeDocument;
        const previousIos = Platform.isIosApp;
        Platform.isIosApp = true;
        const scheduled = [];
        const setTimeout = vi.spyOn(window, "setTimeout").mockImplementation((callback, delay) => {
            scheduled.push({ callback, delay });
            return scheduled.length;
        });
        const clearTimeout = vi.spyOn(window, "clearTimeout").mockImplementation(() => {});
        const plugin = {
            app: { workspace: { getActiveViewOfType: vi.fn() } },
            settings: { lastNotationType: "highlight" },
        };
        const first = new FloatingManager(plugin);

        try {
            first.setupMobileGestures();
            doc.dispatchEvent(new window.Event("touchstart"));
            expect(first.longPressTimer).toBe(1);

            first.unload();
            expect(first.longPressTimer).toBeNull();
            expect(clearTimeout).toHaveBeenCalledWith(1);
            doc.dispatchEvent(new window.Event("touchstart"));
            expect(setTimeout).toHaveBeenCalledTimes(1);

            const reloaded = new FloatingManager(plugin);
            reloaded.setupMobileGestures();
            doc.dispatchEvent(new window.Event("touchstart"));
            expect(setTimeout).toHaveBeenCalledTimes(2);
            expect(reloaded.longPressTimer).toBe(2);
            reloaded.unload();
        } finally {
            Platform.isIosApp = previousIos;
            vi.restoreAllMocks();
        }
    });

    it("does not register the retired reading-position, global Undo, or duplicate remove commands", () => {
        const plugin = new ReadingHighlighterPlugin({ workspace: {} }, manifest);
        const commands = [];
        plugin.addCommand = (command) => commands.push(command);

        plugin.registerCommands();

        const ids = commands.map((command) => command.id);
        expect(ids).not.toContain("resume-reading");
        expect(ids).not.toContain("undo-last-highlight");
        expect(ids).not.toContain("remove-all-highlights");
        expect(ids).not.toContain("remove-all-annotations");
        expect(plugin.saveUndoState).toBeUndefined();
        expect(plugin.undoLastHighlight).toBeUndefined();
        expect(ReadingHighlighterPlugin.prototype.removeAllHighlights).toBeUndefined();
        expect(ReadingHighlighterPlugin.prototype.removeAllAnnotations).toBeUndefined();
    });

    it("routes merge, recolor, and span migration commands through previewed maintenance", () => {
        const file = { path: "notes/source.md" };
        const plugin = new ReadingHighlighterPlugin({ workspace: { getActiveViewOfType: () => ({ file }) } }, manifest);
        const commands = [];
        plugin.addCommand = (command) => commands.push(command);
        plugin.registerCommands();

        for (const id of ["merge-adjacent-highlights", "recolor-mark-highlights", "migrate-span-highlights"]) {
            const command = commands.find((candidate) => candidate.id === id);
            expect(command).toBeDefined();
            expect(command.checkCallback(false)).toBe(true);
        }

        expect(
            modalCaptures.maintenance.map(({ initialOperation, file: target, opened }) => ({
                initialOperation,
                file: target,
                opened,
            }))
        ).toEqual([
            { initialOperation: "merge", file, opened: true },
            { initialOperation: "recolor", file, opened: true },
            { initialOperation: "migrate", file, opened: true },
        ]);
    });

    it("ignores obsolete reading-position settings without restoring the feature", async () => {
        const plugin = new ReadingHighlighterPlugin({}, manifest);
        plugin.loadData = async () => ({
            enableReadingProgress: true,
            readingPositions: { "old-note.md": 1234 },
            showTagButton: false,
        });
        plugin.saveData = vi.fn();

        await plugin.loadSettings();

        expect(plugin.settings.showTagButton).toBe(false);
        expect(plugin.settings).not.toHaveProperty("enableReadingProgress");
        expect(plugin.settings).not.toHaveProperty("readingPositions");
        expect(plugin.saveData).not.toHaveBeenCalled();
    });

    it("binds post-modal tag offsets to the same file and raw snapshot", async () => {
        createObsidianWindow();
        const fileA = { path: "notes/a.md" };
        const fileB = { path: "notes/b.md" };
        const request = {
            snippet: "selected text",
            contextText: null,
            occurrenceIndex: 0,
            withinBlock: null,
            contextKind: null,
        };
        const firstResult = { file: fileA, raw: "first snapshot", start: 0, end: 7 };
        const secondResult = { file: fileB, raw: "second snapshot", start: 12, end: 19 };
        const plugin = Object.create(ReadingHighlighterPlugin.prototype);
        plugin.buildSelectionRequest = vi.fn(() => request);
        plugin.logic = {
            locateSelection: vi.fn().mockResolvedValueOnce(firstResult).mockResolvedValueOnce(secondResult),
        };
        plugin.settings = { enableSmartTagSuggestions: false };
        plugin.applyMarkdownModification = vi.fn();
        plugin.restoreScroll = vi.fn();
        const view = { file: fileA, previewMode: { getScroll: () => 8 } };

        await plugin.tagSelection(view);
        await modalCaptures.tagCallbacks[0]("topic");

        expect(plugin.applyMarkdownModification).toHaveBeenCalledWith(fileB, "second snapshot", 12, 19, "tag", "topic");
    });

    it("binds post-modal annotation file, raw snapshot, and offsets to the same resolution", async () => {
        createObsidianWindow();
        const fileA = { path: "notes/a.md" };
        const fileB = { path: "notes/b.md" };
        const request = {
            snippet: "selected text",
            contextText: null,
            occurrenceIndex: 0,
            withinBlock: null,
            contextKind: null,
        };
        const firstResult = { file: fileA, raw: "first snapshot", start: 0, end: 7 };
        const secondResult = { file: fileB, raw: "second snapshot", start: 12, end: 19 };
        const plugin = Object.create(ReadingHighlighterPlugin.prototype);
        plugin.app = { workspace: {} };
        plugin.buildSelectionRequest = vi.fn(() => request);
        plugin.logic = {
            locateSelection: vi.fn().mockResolvedValueOnce(firstResult).mockResolvedValueOnce(secondResult),
        };
        plugin.applyAnnotation = vi.fn();
        plugin.restoreScroll = vi.fn();
        const view = { file: fileA, previewMode: { getScroll: () => 8 } };

        await plugin.annotateSelection(view);
        await modalCaptures.annotationCallbacks[0]("note");

        expect(plugin.applyAnnotation).toHaveBeenCalledWith(fileB, "second snapshot", 12, 19, "note");
    });
});
