import { describe, expect, it, vi } from "vitest";
import { MarkdownView, TFile } from "obsidian";
import { HighlightNavigatorView } from "../src/views/HighlightNavigator";
import { setRepeatedFootnoteDisplay } from "../src/utils/footnotePresentation";
import ReadingHighlighterPlugin, { ReadingHighlighterSettingTab } from "../src/main";
import { createObsidianWindow } from "./dom-helpers.js";

const managedId = "fp-12345678-abcd-4abc-8abc-123456789abc";

function navigatorWithFiles(contents) {
    const window = createObsidianWindow();
    const files = new Map(Object.entries(contents).map(([path]) => [path, new TFile(path)]));
    let active = null;
    let rootLeaf = { view: {} };
    const app = {
        workspace: {
            getActiveFile: () => active,
            rootSplit: {},
            getMostRecentLeaf: (root) => (root === app.workspace.rootSplit ? rootLeaf : null),
            getLeavesOfType: () => [...files.values()].map((file) => ({ view: { file } })),
        },
        vault: { read: vi.fn(async (file) => contents[file.path]) },
    };
    const navigator = new HighlightNavigatorView({}, { app });
    navigator.app = app;
    navigator.contentEl = window.document.getElementById("content");
    const setRootSource = (path) => {
        const file = path ? files.get(path) : null;
        rootLeaf = { view: file ? Object.assign(new MarkdownView(), { file }) : {} };
    };
    const setActive = (path) => {
        active = path ? files.get(path) : null;
        setRootSource(path);
    };
    return {
        navigator,
        app,
        files,
        setActive,
        setGlobalActive: (path) => (active = path ? files.get(path) : null),
        setRootSource,
    };
}

async function openedNavigatorWithFiles(contents) {
    const harness = navigatorWithFiles(contents);
    const handlers = new Map();
    harness.app.workspace.on = vi.fn((event, handler) => {
        handlers.set(event, handler);
        return { event, handler };
    });
    harness.app.vault.on = vi.fn(() => ({}));
    harness.navigator.plugin.settings = { canvasAssociations: [] };
    const document = harness.navigator.contentEl.ownerDocument;
    harness.navigator.containerEl = document.createElement("div");
    harness.navigator.containerEl.createDiv();
    harness.navigator.containerEl.createDiv();
    await harness.navigator.onOpen();
    return { ...harness, layoutChange: () => handlers.get("layout-change")?.() };
}

describe("Slice 1 Navigator corrections", () => {
    it("reconciles the next document on layout-change while sidebar focus remains", async () => {
        const { navigator, setActive, layoutChange } = await openedNavigatorWithFiles({
            "a.md": "==A==",
            "b.md": "==B==",
        });
        setActive("a.md");
        layoutChange();
        await vi.waitFor(() => expect(navigator.currentFile?.path).toBe("a.md"));
        setActive("b.md");
        layoutChange();
        await vi.waitFor(() => expect(navigator.currentFile?.path).toBe("b.md"));
        expect(navigator.highlights.map((item) => item.text)).toEqual(["B"]);
    });

    it("uses the visible root replacement when the global recent-file fallback differs", async () => {
        const { navigator, setActive, setRootSource, setGlobalActive, layoutChange } = await openedNavigatorWithFiles({
            "a.md": "==A==",
            "b.md": "==B==",
            "c.md": "==C==",
        });
        for (const path of ["a.md", "b.md", "c.md", "a.md"]) {
            setActive(path);
            layoutChange();
            await vi.waitFor(() => expect(navigator.currentFile?.path).toBe(path));
        }

        // Closing A reveals B in the root workspace while global recent-file
        // context falls back to C because the sidebar owns focus.
        setRootSource("b.md");
        setGlobalActive("c.md");
        expect(navigator.app.workspace.getActiveFile()?.path).toBe("c.md");
        layoutChange();
        await vi.waitFor(() => expect(navigator.currentFile?.path).toBe("b.md"));
        expect(navigator.highlights.map((item) => item.text)).toEqual(["B"]);
    });

    it("clears the source when the final document closes under sidebar focus", async () => {
        const { navigator, setActive, layoutChange } = await openedNavigatorWithFiles({ "a.md": "==A==" });
        setActive("a.md");
        layoutChange();
        await vi.waitFor(() => expect(navigator.currentFile?.path).toBe("a.md"));
        setActive(null); // an empty root leaf has no Markdown source file
        layoutChange();
        expect(navigator.currentFile).toBeNull();
        expect(navigator.highlights).toEqual([]);
        expect(navigator.contentEl.textContent).not.toContain("A");
    });

    it.each([
        { highlights: false, footnotes: false },
        { highlights: true, footnotes: false },
        { highlights: false, footnotes: true },
        { highlights: true, footnotes: true },
    ])("leaves manual section state intact on same-source layout-change: %j", async (collapsed) => {
        const { navigator, app, setActive, layoutChange } = await openedNavigatorWithFiles({
            "a.md": "==A==[^note]\n\n[^note]: Note",
        });
        setActive("a.md");
        layoutChange();
        await vi.waitFor(() => expect(navigator.currentFile?.path).toBe("a.md"));
        navigator.sectionCollapsed = { ...collapsed };
        const render = vi.spyOn(navigator, "renderContent");
        const reads = app.vault.read.mock.calls.length;
        layoutChange();
        expect(app.vault.read).toHaveBeenCalledTimes(reads);
        expect(render).not.toHaveBeenCalled();
        expect(navigator.sectionCollapsed).toEqual(collapsed);
    });

    it("does not let an older read restore a source after layout-change clears it", async () => {
        const { navigator, app, setActive, layoutChange } = await openedNavigatorWithFiles({ "a.md": "==A==" });
        let resolveRead;
        app.vault.read = vi.fn(() => new Promise((resolve) => (resolveRead = resolve)));
        setActive("a.md");
        layoutChange();
        setActive(null);
        layoutChange();
        resolveRead("==A==");
        await Promise.resolve();
        await Promise.resolve();
        expect(navigator.currentFile).toBeNull();
        expect(navigator.highlights).toEqual([]);
    });
    it.each([
        ["highlights only", "==Highlighted==", { highlights: false, footnotes: true }],
        ["footnotes only", "Text[^note].\n\n[^note]: Footnote", { highlights: true, footnotes: false }],
        ["both", "==Highlighted==[^note]\n\n[^note]: Footnote", { highlights: false, footnotes: false }],
        ["neither", "Plain text", { highlights: false, footnotes: false }],
    ])("derives initial section state for %s", async (_case, raw, expected) => {
        const { navigator, setActive } = navigatorWithFiles({ "note.md": raw });
        setActive("note.md");
        await navigator.refresh();
        expect(navigator.sectionCollapsed).toEqual(expected);
    });

    it("keeps manual collapse for one note and derives fresh state after a source switch", async () => {
        const { navigator, setActive } = navigatorWithFiles({
            "marks.md": "==Mark==",
            "notes.md": "Text[^note].\n\n[^note]: Definition",
        });
        setActive("marks.md");
        await navigator.refresh();
        navigator.sectionCollapsed = { highlights: false, footnotes: false };
        await navigator.refresh(true);
        expect(navigator.sectionCollapsed).toEqual({ highlights: false, footnotes: false });
        setActive("notes.md");
        await navigator.refresh();
        expect(navigator.sectionCollapsed).toEqual({ highlights: true, footnotes: false });
        navigator.sectionCollapsed = { highlights: true, footnotes: true };
        setActive("marks.md");
        await navigator.refresh();
        expect(navigator.sectionCollapsed).toEqual({ highlights: false, footnotes: true });
    });

    it("discards an old read that resolves after the active editor has changed", async () => {
        const { navigator, app, setActive } = navigatorWithFiles({ "old.md": "==Old==", "new.md": "==New==" });
        let resolveOld;
        app.vault.read = vi.fn((file) =>
            file.path === "old.md" ? new Promise((resolve) => (resolveOld = resolve)) : Promise.resolve("==New==")
        );
        setActive("old.md");
        const oldRefresh = navigator.refresh();
        setActive("new.md");
        await navigator.refresh();
        resolveOld("==Old==");
        await oldRefresh;
        expect(navigator.currentFile.path).toBe("new.md");
        expect(navigator.highlights.map((highlight) => highlight.text)).toEqual(["New"]);
    });

    it("shows compact human text, including inline HTML content and decoded entities", () => {
        const { navigator } = navigatorWithFiles({});
        expect(navigator.stripMarkdown("<strong>Bold</strong> &amp; [[Target|alias]] [link](url) `code`")).toBe(
            "Bold & alias link code"
        );
    });

    it("shows an unreferenced managed definition without exposing its opaque ID", () => {
        const { navigator } = navigatorWithFiles({});
        navigator.footnotes = navigator.getFootnotesFromContent(
            `[^${managedId}]: An <strong>orphan</strong> &amp; note`
        );
        navigator.sectionCollapsed = { highlights: true, footnotes: false };
        navigator.renderContent();
        const row = navigator.contentEl.querySelector(".highlight-navigator-item");
        expect(row.textContent).toContain("An orphan & note");
        expect(row.textContent).toContain("Unreferenced");
        expect(row.outerHTML).not.toContain(managedId);
    });
});

describe("repeated footnote reference presentation", () => {
    it("defaults to normalized display, persists a native-rendering choice, and exposes the option", async () => {
        const plugin = new ReadingHighlighterPlugin({ workspace: {} }, { id: "test", version: "0" });
        plugin.loadData = async () => ({});
        await plugin.loadSettings();
        expect(plugin.settings.normalizeRepeatedFootnoteReferences).toBe(true);
        const tab = new ReadingHighlighterSettingTab({}, plugin);
        expect(tab.getSettingDefinitions().find((group) => group.heading === "Footnotes")?.items).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    name: "Normalize repeated footnote references",
                    control: expect.objectContaining({ key: "normalizeRepeatedFootnoteReferences" }),
                }),
            ])
        );
        plugin.loadData = async () => ({ normalizeRepeatedFootnoteReferences: false });
        await plugin.loadSettings();
        expect(plugin.settings.normalizeRepeatedFootnoteReferences).toBe(false);
    });

    it("keeps Obsidian base numbering and occurrence links while restoring native labels on demand", () => {
        const window = createObsidianWindow();
        const root = window.document.getElementById("content");
        root.innerHTML = [
            '<sup class="footnote-ref" id="fnref-2-a"><a class="footnote-link" data-footref="note" href="#fn-2-a">[2]</a></sup>',
            '<sup class="footnote-ref" id="fnref-2-1-a"><a class="footnote-link" data-footref="note" href="#fn-2-a">[2-1]</a></sup>',
            '<sup class="footnote-ref" id="fnref-2-2-a"><a class="footnote-link" data-footref="note" href="#fn-2-a">[2-2]</a></sup>',
            '<span class="sidenote-number" data-footnote-id="note">2-1</span>',
            '<a class="footnote-backref" href="#fnref-2-1-a">↩︎</a>',
        ].join("");
        const originalIds = [...root.querySelectorAll("sup")].map((item) => item.id);
        const originalHrefs = [...root.querySelectorAll("a")].map((item) => item.getAttribute("href"));
        setRepeatedFootnoteDisplay(root, true);
        expect([...root.querySelectorAll("sup a")].map((item) => item.textContent)).toEqual(["[2]", "[2]", "[2]"]);
        expect(root.querySelector(".sidenote-number").textContent).toBe("2-1");
        expect([...root.querySelectorAll("sup")].map((item) => item.id)).toEqual(originalIds);
        expect([...root.querySelectorAll("a")].map((item) => item.getAttribute("href"))).toEqual(originalHrefs);
        setRepeatedFootnoteDisplay(root, false);
        expect([...root.querySelectorAll("sup a")].map((item) => item.textContent)).toEqual(["[2]", "[2-1]", "[2-2]"]);
    });
});
