import { describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { ResearchView } from "../src/views/ResearchView";
import { createObsidianWindow } from "./dom-helpers.js";

function makeView(scanResults) {
    const window = createObsidianWindow();
    const view = new ResearchView({}, { app: {} });
    view.contentEl = window.document.getElementById("content");
    view.scanResults = scanResults;
    return { view, window };
}

describe("Annotations manager interaction grammar", () => {
    it("expands safely from the row, edits only from the pencil, and opens source only from the arrow", () => {
        const file = new TFile("notes/source.md");
        const { view } = makeView([
            {
                file,
                frontmatter: {},
                highlights: [
                    {
                        id: "h1",
                        text: "A useful passage that can be inspected without accidentally opening an editing modal",
                        line: 7,
                        color: "#ffee58",
                    },
                ],
            },
        ]);
        view.expandedFiles.add(file.path);
        view.openHighlightEditor = vi.fn();
        view.jumpToHighlight = vi.fn();

        view.renderContent();
        const row = view.contentEl.querySelector(".research-highlight-item");
        const edit = row.querySelector(".fp-manager-edit-link");
        const source = row.querySelector(".fp-manager-source-link");

        row.click();
        expect(row.classList.contains("is-expanded")).toBe(true);
        expect(view.openHighlightEditor).not.toHaveBeenCalled();
        expect(view.jumpToHighlight).not.toHaveBeenCalled();

        edit.click();
        expect(view.openHighlightEditor).toHaveBeenCalledOnce();
        expect(view.jumpToHighlight).not.toHaveBeenCalled();

        source.click();
        expect(view.jumpToHighlight).toHaveBeenCalledWith(file, 7);
        expect(view.openHighlightEditor).toHaveBeenCalledOnce();
        expect(source.getAttribute("aria-label")).toContain("Open source in new tab");
    });

    it("keeps the same note-grouped results architecture during search and uses real disclosure state", () => {
        const first = new TFile("notes/first.md");
        const second = new TFile("notes/second.md");
        const { view } = makeView([
            {
                file: first,
                frontmatter: {},
                highlights: [{ id: "h1", text: "Amber lantern", line: 1, color: "#ffee58" }],
            },
            {
                file: second,
                frontmatter: {},
                highlights: [{ id: "h2", text: "Quiet shoreline", line: 2, color: "#80cbc4" }],
            },
        ]);
        view.expandedFiles.add(first.path);

        view.renderContent();
        expect(view.contentEl.querySelectorAll(".research-group")).toHaveLength(2);
        expect(view.contentEl.querySelector(".research-flat-list")).toBeNull();

        const firstHeader = view.contentEl.querySelector(".fp-manager-group-toggle");
        const firstList = view.contentEl.querySelector(".research-highlight-list");
        expect(firstHeader.getAttribute("aria-expanded")).toBe("true");
        expect(firstList.classList.contains("is-collapsed")).toBe(false);
        firstHeader.click();
        expect(firstHeader.getAttribute("aria-expanded")).toBe("false");
        expect(firstList.classList.contains("is-collapsed")).toBe(true);

        view.searchQuery = "shore";
        view.renderContent();
        expect(view.contentEl.querySelectorAll(".research-group")).toHaveLength(1);
        expect(view.contentEl.querySelector(".research-group-title").textContent).toContain("second");
        expect(view.contentEl.querySelector(".research-flat-list")).toBeNull();
    });

    it("uses All and None for note scope and puts maintenance in the relevant note menu", () => {
        const file = new TFile("notes/source.md");
        const { view, window } = makeView([
            {
                file,
                frontmatter: {},
                highlights: [{ id: "h1", text: "A useful passage", line: 7, color: "#ffee58" }],
            },
        ]);
        view.fileFilterEl = window.document.createElement("div");
        window.document.body.appendChild(view.fileFilterEl);
        view.renderFileFilter();

        const scopeButtons = [...view.fileFilterEl.querySelectorAll("button")].map((button) => button.textContent);
        expect(scopeButtons).toEqual(["All", "None"]);
        expect(view.fileFilterEl.querySelector("summary").textContent).toBe("All notes with highlights (1)");
        view.fileFilterEl.querySelectorAll("button")[1].click();
        expect(view.fileFilterEl.querySelector("summary").textContent).toBe("0 of 1 notes");

        view.openNoteActionsMenu = vi.fn();
        view.selectedFiles = null;
        view.renderContent();
        const actions = view.contentEl.querySelector(".fp-manager-note-actions");
        actions.click();
        expect(view.openNoteActionsMenu).toHaveBeenCalledWith(expect.anything(), file);
    });
});
