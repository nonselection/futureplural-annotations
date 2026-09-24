// Issue 1: the navigator's per-highlight menu must be able to delete just that
// highlight, leaving its text and every other highlight untouched.
import { describe, it, expect, vi } from "vitest";
import { HighlightNavigatorView } from "../src/views/HighlightNavigator";
import { parseHighlights } from "../src/utils/highlights";
import { createObsidianWindow } from "./dom-helpers.js";

createObsidianWindow();

function harness(raw) {
    let current = raw;
    const refreshed = [];
    const ctx = {
        currentFile: { path: "n.md" },
        plugin: { saveUndoState: async () => {} },
        app: {
            vault: {
                process: async (_f, fn) => {
                    current = fn(current);
                    return current;
                },
            },
        },
        refresh: async () => refreshed.push(true),
        showUndoNotice: () => {},
    };
    return { ctx, out: () => current, refreshed };
}

const removeSingle = HighlightNavigatorView.prototype.removeSingleHighlight;

describe("navigator search state", () => {
    it("opens both sections for search and restores the exact previous state when cleared", () => {
        const navigator = Object.create(HighlightNavigatorView.prototype);
        navigator.searchQuery = "";
        navigator.sectionCollapsed = { highlights: true, footnotes: false };
        navigator.preSearchCollapsed = null;
        navigator.selectedIds = new Set(["selected"]);
        navigator.renderContent = vi.fn();

        navigator.setSearchQuery("needle");
        expect(navigator.sectionCollapsed).toEqual({ highlights: false, footnotes: false });
        expect(navigator.preSearchCollapsed).toEqual({ highlights: true, footnotes: false });
        expect(navigator.selectedIds.size).toBe(0);

        navigator.setSearchQuery("");
        expect(navigator.sectionCollapsed).toEqual({ highlights: true, footnotes: false });
        expect(navigator.preSearchCollapsed).toBeNull();
        expect(navigator.renderContent).toHaveBeenCalledTimes(2);
    });
});

describe("navigator menu toggling", () => {
    const makeMenu = () => {
        let onHide = () => {};
        return {
            setParentElement: vi.fn().mockReturnThis(),
            onHide: vi.fn((callback) => {
                onHide = callback;
            }),
            showAtMouseEvent: vi.fn(),
            hide: vi.fn(() => onHide()),
        };
    };

    it("closes an open menu when its own kebab is clicked again", () => {
        const window = createObsidianWindow();
        const trigger = window.document.createElement("button");
        window.document.body.appendChild(trigger);
        const event = { currentTarget: trigger };
        const navigator = Object.create(HighlightNavigatorView.prototype);
        navigator.containerEl = window.document.createElement("div");
        navigator.activeMenu = null;
        navigator.activeMenuTrigger = null;
        const first = makeMenu();
        const second = makeMenu();

        navigator.showNavigatorMenu(first, event);
        expect(first.showAtMouseEvent).toHaveBeenCalledOnce();
        expect(first.setParentElement).toHaveBeenCalledWith(trigger);

        navigator.showNavigatorMenu(second, event);
        expect(first.hide).toHaveBeenCalledOnce();
        expect(second.showAtMouseEvent).not.toHaveBeenCalled();
        expect(navigator.activeMenu).toBeNull();
    });
});

describe("remove a single highlight from the navigator", () => {
    it("removes only the chosen highlight, keeping its text", async () => {
        const raw = "Alpha ==one== beta ==two== gamma.";
        const { ctx, out } = harness(raw);
        const target = parseHighlights(raw).highlights[1];
        await removeSingle.call(ctx, target);
        expect(out()).toBe("Alpha ==one== beta two gamma.");
    });

    it("removes the first when the first is chosen", async () => {
        const raw = "Alpha ==one== beta ==two== gamma.";
        const { ctx, out } = harness(raw);
        await removeSingle.call(ctx, parseHighlights(raw).highlights[0]);
        expect(out()).toBe("Alpha one beta ==two== gamma.");
    });

    it("handles an <mark> highlight too", async () => {
        const raw = 'Start <mark style="background: #ff0; color: black;">inner</mark> end.';
        const { ctx, out } = harness(raw);
        await removeSingle.call(ctx, parseHighlights(raw).highlights[0]);
        expect(out()).toBe("Start inner end.");
    });

    it("removes all fragments of a selected grouped passage in one action", async () => {
        const raw = [
            '- <mark data-fp-group="list-a">One</mark>',
            '- <mark data-fp-group="list-a">Two</mark>',
            '- <mark data-fp-group="other">Keep</mark>',
        ].join("\n");
        const { ctx, out } = harness(raw);
        await removeSingle.call(ctx, parseHighlights(raw).highlights[0]);
        expect(out()).toBe('- One\n- Two\n- <mark data-fp-group="other">Keep</mark>');
    });

    it("leaves the note alone when the highlight has since moved", async () => {
        const raw = "Alpha ==one== beta.";
        const target = parseHighlights(raw).highlights[0];
        const { ctx, out } = harness("Completely different text.");
        await removeSingle.call(ctx, target);
        expect(out()).toBe("Completely different text.");
    });

    it("refreshes the panel afterwards", async () => {
        const raw = "Alpha ==one== beta.";
        const { ctx, refreshed } = harness(raw);
        await removeSingle.call(ctx, parseHighlights(raw).highlights[0]);
        expect(refreshed).toHaveLength(1);
    });
});

describe("destructive navigator actions", () => {
    it("does not remove all highlights until the user confirms", async () => {
        let raw = "Alpha ==one== and <mark>two</mark>.";
        const window = createObsidianWindow();
        const file = { path: "n.md", basename: "n" };
        const app = {
            vault: {
                read: async () => raw,
                modify: async (_file, next) => {
                    raw = next;
                },
            },
        };
        const navigator = new HighlightNavigatorView(
            {},
            {
                app,
                saveUndoState: async () => {},
            }
        );
        navigator.app = app;
        navigator.currentFile = file;
        navigator.contentEl = window.document.getElementById("content");
        navigator.selectionBarEl = window.document.createElement("div");
        navigator.refresh = async () => {};
        navigator.showUndoNotice = () => {};
        navigator.confirmDestructive = async () => false;

        await navigator.removeAllHighlightsInNote();
        expect(raw).toBe("Alpha ==one== and <mark>two</mark>.");

        navigator.confirmDestructive = async () => true;
        await navigator.removeAllHighlightsInNote();
        expect(raw).toBe("Alpha one and two.");
    });

    it("treats authored footnote removal as a confirmed, reversible action", async () => {
        let raw = "Body[^note].\n\n[^note]: Authored text.\n";
        const window = createObsidianWindow();
        const file = { path: "n.md", basename: "n" };
        let undoOriginal = null;
        const app = {
            vault: {
                read: async () => raw,
                modify: async (_file, next) => {
                    raw = next;
                },
            },
        };
        const navigator = new HighlightNavigatorView(
            {},
            {
                app,
                saveUndoState: async (_file, original) => {
                    undoOriginal = original;
                },
            }
        );
        navigator.app = app;
        navigator.currentFile = file;
        navigator.contentEl = window.document.getElementById("content");
        navigator.selectionBarEl = window.document.createElement("div");
        navigator.refresh = async () => {};
        navigator.showUndoNotice = () => {};
        navigator.confirmDestructive = async () => true;

        await navigator.removeFootnoteInNote({
            id: "note",
            text: "Authored text.",
            line: 2,
            displayNumber: 1,
            refLine: 0,
        });

        expect(raw).toBe("Body.\n");
        expect(undoOriginal).toBe("Body[^note].\n\n[^note]: Authored text.\n");
    });
});
