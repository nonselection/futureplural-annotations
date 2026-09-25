import {
    ItemView,
    MarkdownView,
    Menu,
    MenuItem,
    Modal,
    Notice,
    Platform,
    WorkspaceLeaf,
    TFile,
    TAbstractFile,
    setIcon,
    setTooltip,
} from "obsidian";
import type ReadingHighlighterPlugin from "../main";
import { getHighlightsFromContent } from "../utils/export";
import type { Highlight } from "../utils/highlights";
import {
    parseHighlights,
    findHighlightById,
    removeAllFootnotesFromRaw,
    removeFootnoteFromRaw,
    removeHighlightFromRaw,
    removeLogicalHighlightFromRaw,
} from "../utils/highlights";
import { markdownSourceAdapter } from "../adapters/MarkdownSourceAdapter";
import { defaultCanvasPath, MAX_CANVAS_ASSOCIATIONS } from "../utils/canvas";
import { HighlightEditModal } from "../modals/HighlightEditModal";
import { navigatorPreviewText } from "../utils/navigatorPreview";

export const HIGHLIGHT_NAVIGATOR_VIEW = "highlight-navigator";

interface NavFootnote {
    id: string;
    text: string;
    line: number;
    displayNumber: number | null;
    refLine: number;
    integrity: "resolved" | "degraded" | "ambiguous" | "missing";
}

type NavItem = Highlight | NavFootnote;
type ListType = "highlights" | "footnotes";

class NavigatorConfirmationModal extends Modal {
    private settled = false;

    constructor(
        app: ReadingHighlighterPlugin["app"],
        private readonly title: string,
        private readonly message: string,
        private readonly confirmLabel: string,
        private readonly resolveChoice: (confirmed: boolean) => void
    ) {
        super(app);
    }

    onOpen() {
        this.setTitle(this.title);
        this.contentEl.createEl("p", { text: this.message });
        const actions = this.contentEl.createDiv({ cls: "fp-navigator-confirm-actions" });
        const cancel = actions.createEl("button", { text: "Cancel" });
        const confirm = actions.createEl("button", { text: this.confirmLabel, cls: "mod-warning" });
        cancel.onclick = () => this.finish(false);
        confirm.onclick = () => this.finish(true);
        cancel.focus();
    }

    onClose() {
        this.contentEl.empty();
        if (!this.settled) {
            this.settled = true;
            this.resolveChoice(false);
        }
    }

    private finish(confirmed: boolean) {
        if (this.settled) return;
        this.settled = true;
        this.resolveChoice(confirmed);
        this.close();
    }
}

/**
 * Sidebar companion for the current document. Highlights and footnotes remain
 * visible as two explicit, independently collapsible sections.
 */
export class HighlightNavigatorView extends ItemView {
    plugin: ReadingHighlighterPlugin;
    highlights: Highlight[];
    footnotes: NavFootnote[];
    currentFile: TFile | null;
    sectionCollapsed: Record<ListType, boolean>;
    preSearchCollapsed: Record<ListType, boolean> | null;
    searchQuery: string;
    canvasButton: HTMLButtonElement | null = null;
    activeMenu: Menu | null = null;
    activeMenuTrigger: HTMLElement | null = null;
    expandedItemIds: Set<string>;
    private refreshGeneration = 0;

    constructor(leaf: WorkspaceLeaf, plugin: ReadingHighlighterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.highlights = [];
        this.footnotes = [];
        this.currentFile = null;
        this.sectionCollapsed = { highlights: false, footnotes: true };
        this.preSearchCollapsed = null;
        this.searchQuery = ""; // Search filter
        this.expandedItemIds = new Set();
    }

    getViewType() {
        return HIGHLIGHT_NAVIGATOR_VIEW;
    }

    getDisplayText() {
        return "Annotation navigator";
    }

    getIcon() {
        return "notebook-pen";
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("highlight-navigator-container");

        // Compact, persistent controls. Content begins immediately underneath.
        const header = container.createDiv({ cls: "highlight-navigator-header" });
        const searchContainer = header.createDiv({ cls: "highlight-navigator-search" });
        const searchField = searchContainer.createDiv({ cls: "fp-navigator-search-field" });
        const searchInput = searchField.createEl("input", {
            type: "text",
            placeholder: "Search...",
            cls: "nav-search-input",
        });
        const clearSearchBtn = searchField.createEl("button", {
            cls: "fp-navigator-search-clear is-hidden",
        });
        setIcon(clearSearchBtn, "x");
        clearSearchBtn.setAttribute("aria-label", "Clear search");
        setTooltip(clearSearchBtn, "Clear search", { placement: "top" });
        const applySearch = (value: string) => {
            this.setSearchQuery(value);
            clearSearchBtn.toggleClass("is-hidden", !this.searchQuery);
        };
        searchInput.oninput = (e) => applySearch((e.target as HTMLInputElement).value);
        clearSearchBtn.onclick = () => {
            searchInput.value = "";
            applySearch("");
            searchInput.focus();
        };
        const overflowBtn = searchContainer.createEl("button", { cls: "fp-navigator-overflow" });
        setIcon(overflowBtn, "ellipsis-vertical");
        overflowBtn.setAttribute("aria-label", "Navigator actions");
        setTooltip(overflowBtn, "Navigator actions", { placement: "top" });
        overflowBtn.onclick = (event) => this.openNavigatorMenu(event);

        // Content area
        this.contentEl = container.createDiv({ cls: "highlight-navigator-content" });

        // Keep only the two primary destinations/actions persistent. Selection
        // and export remain available from the search-row actions menu.
        const footer = container.createDiv({ cls: "highlight-navigator-footer" });
        const footerBtnGroup = footer.createDiv({ cls: "highlight-navigator-footer-buttons" });

        const researchBtn = footerBtnGroup.createEl("button", { text: "Manage", cls: "mod-cta" });
        researchBtn.onclick = () => void this.plugin.activateResearchView();
        setTooltip(researchBtn, "Manage annotations across this vault", { placement: "top" });
        this.canvasButton = footerBtnGroup.createEl("button", { cls: "mod-cta" });
        this.canvasButton.onclick = () => void this.exportCurrentFileToCanvas();
        this.updateCanvasButton();

        // Register for file changes
        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => {
                void this.refresh();
            })
        );
        // On tab close/open, active-leaf-change can fire before the new leaf's
        // file is committed. file-open supplies the resulting file state.
        this.registerEvent(this.app.workspace.on("file-open", () => void this.refresh()));
        // A sidebar can remain the active leaf while a Markdown tab closes.
        // layout-change then carries the updated document context.
        this.registerEvent(this.app.workspace.on("layout-change", () => void this.refresh()));

        this.registerEvent(
            this.app.vault.on("modify", (file: TAbstractFile) => {
                if (this.currentFile && file.path === this.currentFile.path) {
                    void this.refresh(true);
                }
            })
        );

        // Canvas labels describe what will happen *now*, not what was true when
        // the sidebar opened. Creating, deleting or renaming an associated file
        // is therefore reflected without requiring the note to be reopened.
        this.registerEvent(this.app.vault.on("create", () => this.updateCanvasButton()));
        this.registerEvent(this.app.vault.on("delete", () => this.updateCanvasButton()));
        this.registerEvent(this.app.vault.on("rename", () => window.setTimeout(() => this.updateCanvasButton(), 0)));

        void this.refresh();
    }

    setSearchQuery(value: string) {
        const nextQuery = value.toLowerCase();
        const wasSearching = Boolean(this.searchQuery);
        const isSearching = Boolean(nextQuery);

        if (!wasSearching && isSearching) {
            this.preSearchCollapsed = { ...this.sectionCollapsed };
        }

        this.searchQuery = nextQuery;

        if (isSearching) {
            // Search results must never be hidden behind a collapsed section.
            this.sectionCollapsed.highlights = false;
            this.sectionCollapsed.footnotes = false;
        } else if (wasSearching && this.preSearchCollapsed) {
            this.sectionCollapsed = { ...this.preSearchCollapsed };
            this.preSearchCollapsed = null;
        }

        this.renderContent();
    }

    async refresh(force = false) {
        // The root workspace's most-recent leaf represents the document still
        // occupying the main editor when a sidebar owns focus. Global active
        // file may instead fall back to a different recently used note.
        const targetFile = this.resolveAnnotationSourceFile();
        if (!targetFile) {
            // Invalidate an in-flight read even if no source has committed yet.
            this.refreshGeneration++;
            if (this.currentFile) {
                this.currentFile = null;
                this.highlights = [];
                this.footnotes = [];
                this.expandedItemIds.clear();
                this.sectionCollapsed = { highlights: false, footnotes: false };
                this.preSearchCollapsed = null;
                this.renderContent();
                this.updateCanvasButton();
            }
            return;
        }
        if (!force && this.currentFile?.path === targetFile.path) return;
        const generation = ++this.refreshGeneration;

        try {
            const raw = await this.app.vault.read(targetFile);
            if (generation !== this.refreshGeneration) return;
            const fileChanged = this.currentFile?.path !== targetFile.path;
            if (fileChanged) this.expandedItemIds.clear();
            this.currentFile = targetFile;
            this.highlights = getHighlightsFromContent(raw);
            this.footnotes = this.getFootnotesFromContent(raw);
            if (fileChanged) this.initializeSectionsForSource();
            this.updateCanvasButton();
            const validExpandedIds = new Set([
                ...this.highlights.map((highlight) => `highlight:${highlight.id}`),
                ...this.footnotes.map((footnote) => `footnote:${footnote.id}`),
            ]);
            for (const id of this.expandedItemIds) {
                if (!validExpandedIds.has(id)) this.expandedItemIds.delete(id);
            }
            this.renderContent();
        } catch (err) {
            if (generation !== this.refreshGeneration) return;
            this.showEmpty("Error loading content.");
            console.error(err);
        }
    }

    private resolveAnnotationSourceFile(): TFile | null {
        const workspace = this.app.workspace;
        const rootLeaf = workspace.getMostRecentLeaf(workspace.rootSplit);
        const view = rootLeaf?.view;
        if (!(view instanceof MarkdownView)) return null;
        return view.file instanceof TFile ? view.file : null;
    }

    private initializeSectionsForSource() {
        const hasHighlights = this.highlights.length > 0;
        const hasFootnotes = this.footnotes.length > 0;
        const initial = {
            highlights: hasFootnotes && !hasHighlights,
            footnotes: hasHighlights && !hasFootnotes,
        };
        this.preSearchCollapsed = this.searchQuery ? initial : null;
        this.sectionCollapsed = this.searchQuery ? { highlights: false, footnotes: false } : initial;
    }

    getFootnotesFromContent(raw: string): NavFootnote[] {
        const observed = markdownSourceAdapter.observeFootnotes(raw);
        const defined = observed.filter((item) => item.definitions.length > 0);
        const orderedReferences = defined
            .filter((item) => item.references.length > 0)
            .sort((a, b) => a.references[0].start - b.references[0].start);
        const displayNumberById = new Map(orderedReferences.map((item, index) => [item.label, index + 1]));
        let footnotes: NavFootnote[] = defined.map((item) => ({
            id: item.label,
            text: item.text,
            line: item.definitions[0].line,
            displayNumber: displayNumberById.get(item.label) ?? null,
            refLine: item.references[0]?.line ?? item.definitions[0].line,
            integrity: item.integrity,
        }));

        // Orphan handling is SCOPED, so normal notes are never affected.
        // "Grouped-notes style" notes — i.e. the Obsidian Web Clipper output,
        // which always defines a `[^0]` catch-all — produce many unreferenced
        // definitions (references that only existed inside removed tables/
        // figures/infoboxes). For those notes only, hide the orphans so every
        // entry has a clean sequential number matching Reading View. A normal,
        // hand-written note has no `[^0]` marker, so all of its definitions stay
        // visible exactly as before (orphans show their `[^id]`).
        const isGroupedNotesStyle = defined.some((item) => item.label === "0");
        if (isGroupedNotesStyle) {
            footnotes = footnotes.filter((f) => f.displayNumber != null || f.id.startsWith("fp-"));
        }

        // Order to match Reading View: referenced footnotes by rendered number;
        // any retained orphans (normal notes only) sort to the end, in source order.
        footnotes.sort((a, b) => {
            if (a.displayNumber == null && b.displayNumber == null) return a.line - b.line;
            if (a.displayNumber == null) return 1;
            if (b.displayNumber == null) return -1;
            return a.displayNumber - b.displayNumber;
        });

        return footnotes;
    }

    showEmpty(message: string, container: HTMLElement = this.contentEl) {
        container.empty();
        container.createDiv({ cls: "highlight-navigator-empty", text: message });
    }

    stripMarkdown(text: string): string {
        return navigatorPreviewText(text);
    }

    renderContent() {
        this.contentEl.empty();
        this.renderSection(this.highlights, "highlights");
        this.renderSection(this.footnotes, "footnotes");
    }

    renderSection(items: NavItem[], type: ListType) {
        // Filter items based on search query
        const filteredItems = items.filter((item) => {
            if (!this.searchQuery) return true;
            return this.stripMarkdown(item.text).toLowerCase().includes(this.searchQuery);
        });

        const collapsed = this.sectionCollapsed[type];
        const title = type === "highlights" ? "Highlights" : "Footnotes";
        const section = this.contentEl.createDiv({
            cls: `fp-navigator-section${collapsed ? " is-collapsed" : ""}`,
        });
        const heading = section.createEl("button", {
            cls: "fp-navigator-section-heading",
            attr: { "aria-expanded": String(!collapsed), "aria-label": `${collapsed ? "Show" : "Hide"} ${title}` },
        });
        const disclosure = heading.createSpan({ cls: "fp-navigator-section-disclosure" });
        setIcon(disclosure, collapsed ? "chevron-right" : "chevron-down");
        heading.createSpan({ cls: "fp-navigator-section-title", text: title });
        heading.createSpan({
            cls: "fp-navigator-section-count",
            text:
                this.searchQuery && filteredItems.length !== items.length
                    ? `${filteredItems.length}/${items.length}`
                    : String(items.length),
        });
        heading.onclick = () => {
            this.sectionCollapsed[type] = !this.sectionCollapsed[type];
            this.renderContent();
        };

        if (collapsed) return;

        const body = section.createDiv({ cls: "fp-navigator-section-body" });

        if (filteredItems.length === 0) {
            if (this.searchQuery) {
                this.showEmpty(`No matches for "${this.searchQuery}".`, body);
            } else {
                this.showEmpty(`No ${type} found.`, body);
            }
            return;
        }

        const list = body.createDiv({ cls: "highlight-navigator-list" });
        const fragment = createFragment();

        filteredItems.forEach((item) => {
            const el = fragment.createDiv({ cls: "highlight-navigator-item" });
            const integrity = item.integrity;
            if (integrity !== "resolved") {
                el.setAttribute("data-integrity", integrity);
                el.setAttribute("title", `Annotation integrity: ${integrity}. Review before editing.`);
            }

            const leading = el.createSpan({ cls: "fp-navigator-leading" });
            const leadingMeta = leading.createSpan({ cls: "fp-navigator-leading-meta" });
            const number = type === "highlights" ? items.indexOf(item) + 1 : (item as NavFootnote).displayNumber;
            const numberEl = leadingMeta.createSpan({ cls: "fp-navigator-number" });
            numberEl.textContent = number != null ? String(number) : "—";

            if (type === "highlights") {
                const highlight = item as Highlight;
                if (highlight.color) {
                    const colorDot = leadingMeta.createSpan({ cls: "highlight-color-dot" });
                    colorDot.setCssStyles({ backgroundColor: highlight.color });
                } else {
                    leadingMeta.createSpan({ cls: "highlight-color-dot highlight-default" });
                }
                if (highlight.members && new Set(highlight.members.map((part) => part.color)).size > 1) {
                    el.addClass("fp-navigator-mixed-parts");
                }
            } else {
                const footnote = item as NavFootnote;
                numberEl.setAttribute("title", footnote.displayNumber == null ? "No references" : `Footnote ${number}`);
            }

            // Create the right-side controls before the text so their float
            // affects only the opening line. Wrapped text then reclaims the
            // complete row width instead of inheriting a permanent actions
            // column.
            const rowActions = el.createSpan({ cls: "fp-navigator-row-actions" });

            const sourceBtn = rowActions.createEl("button", { cls: "fp-navigator-source-link" });
            setIcon(sourceBtn, "arrow-up-right");
            sourceBtn.setAttribute(
                "aria-label",
                type === "highlights" ? "Go to highlight in note" : "Go to footnote in note"
            );
            setTooltip(sourceBtn, type === "highlights" ? "Go to highlight in note" : "Go to footnote in note", {
                placement: "top",
            });
            sourceBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (type === "footnotes") void this.jumpToFootnote(item as NavFootnote);
                else void this.jumpToLine(markdownSourceAdapter.navigationLine(item as Highlight));
            };

            // The actions control lives in the narrow metadata rail. Keeping
            // it visible avoids an essential hover-only interaction and does
            // not consume a permanent text column.
            const openMenu = (e: MouseEvent) => {
                if (type === "highlights") {
                    this.openHighlightActionsMenu(item as Highlight, e);
                } else {
                    this.openFootnoteActionsMenu(item as NavFootnote, e);
                }
            };

            const menuBtn = leading.createEl("button", { cls: "highlight-item-menu" });
            menuBtn.setAttribute(
                "aria-label",
                `Actions for ${type === "highlights" ? "highlight" : "footnote"}: ${item.text.slice(0, 80)}`
            );
            setTooltip(menuBtn, "Actions", { placement: "top" });
            setIcon(menuBtn, "ellipsis-vertical");
            menuBtn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                openMenu(e);
            };
            el.oncontextmenu = (e) => {
                e.preventDefault();
                e.stopPropagation();
                openMenu(e);
            };

            const itemBody = el.createSpan({ cls: "fp-navigator-item-body" });
            const textSpan = itemBody.createSpan({ cls: "highlight-text" });
            textSpan.textContent = this.stripMarkdown(item.text) || (type === "footnotes" ? "(Empty footnote)" : "");
            if (type === "footnotes" && (item as NavFootnote).displayNumber == null) {
                itemBody.createSpan({ cls: "fp-navigator-footnote-status", text: "Unreferenced" });
            }
            const itemKey =
                type === "highlights" ? `highlight:${(item as Highlight).id}` : `footnote:${(item as NavFootnote).id}`;
            let expanded = this.expandedItemIds.has(itemKey);
            let expandable = expanded;
            const expandButton = itemBody.createEl("button", {
                cls: "fp-navigator-expand is-hidden",
                text: expanded ? "Show less" : "Show more",
            });
            const updateExpansion = () => {
                textSpan.toggleClass("is-expanded", expanded);
                expandButton.setText(expanded ? "Show less" : "Show more");
                expandButton.setAttribute("aria-expanded", String(expanded));
                expandButton.setAttribute(
                    "aria-label",
                    `${expanded ? "Show less of" : "Show more of"} this ${type === "highlights" ? "highlight" : "footnote"}`
                );
            };
            updateExpansion();
            expandButton.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!expandable) return;
                expanded = !expanded;
                if (expanded) this.expandedItemIds.add(itemKey);
                else this.expandedItemIds.delete(itemKey);
                updateExpansion();
            };
            const checkOverflow = () => {
                if (!textSpan.isConnected) return;
                expandable = expanded || textSpan.scrollHeight > textSpan.clientHeight + 1;
                expandButton.toggleClass("is-hidden", !expandable);
            };
            if (typeof window.requestAnimationFrame === "function") {
                window.requestAnimationFrame(checkOverflow);
            } else {
                window.setTimeout(checkOverflow, 0);
            }
            if (type === "highlights" && (item as Highlight).members?.length) {
                itemBody.createSpan({
                    cls: "fp-navigator-part-count",
                    text: `${(item as Highlight).members?.length} parts`,
                });
            }

            // Rows stay inert during ordinary reading. The explicit source
            // control above prevents an accidental scroll while using the
            // Navigator as a companion to the note.
            el.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
            };
        });

        list.appendChild(fragment);
    }

    async copyItemText(item: NavItem) {
        const text = (item?.text ?? "").trim();
        if (!text) {
            new Notice("Nothing to copy.");
            return;
        }
        const ok = await this.plugin.writeClipboardText(text);
        new Notice(ok ? "Copied to clipboard." : "Failed to copy.");
    }

    openHighlightActionsMenu(item: Highlight, event: MouseEvent) {
        const currentFile = this.currentFile;
        if (!currentFile) return;

        const menu = new Menu().setUseNativeMenu(false);
        menu.addItem((mi: MenuItem) => {
            mi.setTitle("Copy")
                .setIcon("copy")
                .onClick(() => void this.copyItemText(item));
        });

        menu.addItem((mi: MenuItem) => {
            mi.setTitle("Edit…")
                .setIcon("pencil")
                .onClick(() => {
                    new HighlightEditModal(this.plugin, currentFile, item.id, () => {
                        void this.refresh(true);
                    }).open();
                });
        });

        menu.addSeparator();

        menu.addItem((mi: MenuItem) => {
            mi.setTitle("Remove highlight")
                .setIcon("trash-2")
                .onClick(() => void this.removeSingleHighlight(item));
        });

        this.showNavigatorMenu(menu, event);
    }

    /**
     * Delete one highlight, leaving its text in place. Removing a single
     * highlight previously meant opening the edit modal, which is several taps
     * for the most common cleanup there is.
     */
    async removeSingleHighlight(item: Highlight) {
        const currentFile = this.currentFile;
        if (!currentFile) return;
        try {
            await this.plugin.saveUndoState(currentFile);
            let found = false;
            await this.app.vault.process(currentFile, (data) => {
                const highlight = findHighlightById(parseHighlights(data), item.id);
                if (!highlight) return data;
                if (
                    !item.annotationId &&
                    (highlight.start !== item.start || highlight.text !== item.text || highlight.type !== item.type)
                ) {
                    throw new Error("Legacy highlight changed; select it again before removal.");
                }
                found = true;
                return removeLogicalHighlightFromRaw(data, highlight);
            });
            if (!found) {
                new Notice("Highlight not found (it may have moved).");
            } else {
                this.showUndoNotice("Highlight removed.", "Highlight restored.");
            }
            await this.refresh(true);
        } catch (err) {
            console.error("Reader Highlighter Tags: failed to remove highlight.", err);
            new Notice("Failed to remove highlight.");
        }
    }

    async confirmDestructive(title: string, message: string, confirmLabel: string): Promise<boolean> {
        return new Promise((resolve) => {
            new NavigatorConfirmationModal(this.app, title, message, confirmLabel, resolve).open();
        });
    }

    showUndoNotice(message: string, undoMessage: string) {
        const fragment = createFragment();
        fragment.createSpan({ text: `${message} ` });
        const undo = fragment.createEl("button", { text: "Undo", cls: "mod-cta fp-navigator-undo" });
        const progress = fragment.createDiv({ cls: "fp-navigator-undo-progress" });
        progress.setAttribute("aria-hidden", "true");
        progress.createSpan({ cls: "fp-navigator-undo-progress-bar" });
        const notice = new Notice(fragment, 10000);
        undo.onclick = () => {
            void (async () => {
                await this.plugin.undoLastHighlight(undoMessage);
                notice.hide();
                await this.refresh(true);
            })();
        };
    }

    async writeCheckedSource(file: TFile, observedRaw: string, nextRaw: string, action: string): Promise<boolean> {
        try {
            await this.app.vault.process(file, (current) => {
                if (current !== observedRaw) throw new Error(`Source changed; no ${action} removed.`);
                return nextRaw;
            });
            return true;
        } catch (err) {
            new Notice(err instanceof Error ? err.message : `Could not remove ${action}.`);
            return false;
        }
    }

    async removeAllHighlightsInNote() {
        const currentFile = this.currentFile;
        if (!currentFile) return;
        const raw = await this.app.vault.read(currentFile);
        const highlights = parseHighlights(raw).highlights;
        const logicalCount = getHighlightsFromContent(raw).length;
        if (!highlights.length) {
            new Notice("No highlights to remove.");
            return;
        }
        const confirmed = await this.confirmDestructive(
            "Remove all highlights?",
            `Remove ${logicalCount} highlight${logicalCount === 1 ? "" : "s"} from “${currentFile.basename}”? The text will remain in place.`,
            "Remove all"
        );
        if (!confirmed) return;

        const updated = [...highlights]
            .sort((a, b) => b.openTagStart - a.openTagStart)
            .reduce((content, highlight) => removeHighlightFromRaw(content, highlight), raw);
        await this.plugin.saveUndoState(currentFile, raw);
        if (!(await this.writeCheckedSource(currentFile, raw, updated, "highlights"))) return;
        await this.refresh(true);
        this.showUndoNotice(
            `Removed ${logicalCount} highlight${logicalCount === 1 ? "" : "s"}.`,
            `Restored ${logicalCount} highlight${logicalCount === 1 ? "" : "s"}.`
        );
    }

    openFootnoteActionsMenu(item: NavFootnote, event: MouseEvent) {
        const currentFile = this.currentFile;
        if (!currentFile) return;

        const menu = new Menu().setUseNativeMenu(false);
        menu.addItem((mi: MenuItem) => {
            mi.setTitle("Copy")
                .setIcon("copy")
                .onClick(() => void this.copyItemText(item));
        });

        menu.addSeparator();

        menu.addItem((mi: MenuItem) => {
            mi.setTitle("Remove footnote")
                .setIcon("trash-2")
                .setWarning(true)
                .onClick(() => void this.removeFootnoteInNote(item));
        });

        this.showNavigatorMenu(menu, event);
    }

    showNavigatorMenu(menu: Menu, event: MouseEvent) {
        const body = this.containerEl.ownerDocument.body;
        const HTMLElementConstructor = this.containerEl.ownerDocument.defaultView?.HTMLElement;
        const trigger =
            HTMLElementConstructor && event.currentTarget instanceof HTMLElementConstructor
                ? event.currentTarget
                : null;
        if (this.activeMenu && trigger && this.activeMenuTrigger === trigger) {
            this.activeMenu.hide();
            return;
        }
        this.activeMenu?.hide();
        this.activeMenu = menu;
        this.activeMenuTrigger = trigger;
        if (trigger) menu.setParentElement(trigger);
        body.addClass("fp-navigator-menu-open");
        menu.onHide(() => {
            if (this.activeMenu !== menu) return;
            this.activeMenu = null;
            this.activeMenuTrigger = null;
            body.removeClass("fp-navigator-menu-open");
        });
        menu.showAtMouseEvent(event);
    }

    async removeFootnoteInNote(item: NavFootnote) {
        const currentFile = this.currentFile;
        if (!currentFile) return;
        if (item.integrity === "ambiguous") {
            new Notice("Duplicate footnote definitions need review before removal.");
            return;
        }
        const raw = await this.app.vault.read(currentFile);
        const result = removeFootnoteFromRaw(raw, item.id);
        if (!result.changed) {
            new Notice("Footnote not found.");
            return;
        }
        const confirmed = await this.confirmDestructive(
            "Remove footnote?",
            `Remove footnote ${item.displayNumber ?? `[^${item.id}]`} from “${currentFile.basename}”? Its reference and authored text will be deleted.`,
            "Remove footnote"
        );
        if (!confirmed) return;

        await this.plugin.saveUndoState(currentFile, raw);
        if (!(await this.writeCheckedSource(currentFile, raw, result.raw, "footnote"))) return;
        await this.refresh(true);
        this.showUndoNotice("Footnote removed.", "Footnote restored.");
    }

    async removeAllFootnotesInNote() {
        const currentFile = this.currentFile;
        if (!currentFile) return;
        const raw = await this.app.vault.read(currentFile);
        const result = removeAllFootnotesFromRaw(raw);
        if (!result.removedCount) {
            new Notice("No footnotes to remove.");
            return;
        }
        const confirmed = await this.confirmDestructive(
            "Remove all footnotes?",
            `Remove ${result.removedCount} footnote${result.removedCount === 1 ? "" : "s"} from “${currentFile.basename}”? References and definitions will be removed.`,
            "Remove all"
        );
        if (!confirmed) return;

        await this.plugin.saveUndoState(currentFile, raw);
        if (!(await this.writeCheckedSource(currentFile, raw, result.raw, "footnotes"))) return;
        await this.refresh(true);
        this.showUndoNotice(
            `Removed ${result.removedCount} footnote${result.removedCount === 1 ? "" : "s"}.`,
            `Restored ${result.removedCount} footnote${result.removedCount === 1 ? "" : "s"}.`
        );
    }

    async jumpToLine(line: number) {
        const leaf = this.app.workspace.getMostRecentLeaf();
        if (leaf && leaf.view instanceof MarkdownView) {
            leaf.setEphemeralState({
                line: line,
                focus: true,
            });
        }
        this.collapseSidebarOnMobile();
    }

    /**
     * Jump to a footnote's *definition* (the entry at the bottom), not its
     * inline reference. In an editor (source/Live Preview) the definition line
     * is directly scrollable. In Reading View the definition lives in an
     * aggregated, virtualized section that is not line-addressable, so we bring
     * the reference into view and then trigger Obsidian's own footnote
     * navigation by clicking the rendered reference link — that scrolls to the
     * definition and flashes it. If the link can't be found we fall back to the
     * reference, so behavior never regresses below "show me where it's used".
     */
    async jumpToFootnote(item: NavFootnote) {
        const leaf = this.app.workspace.getMostRecentLeaf();
        const view = leaf && leaf.view instanceof MarkdownView ? leaf.view : null;

        if (!leaf || !view) {
            this.collapseSidebarOnMobile();
            return;
        }

        if (view.getMode() !== "preview" || item.displayNumber == null) {
            // Editor mode, or an unreferenced (orphan) footnote that has no
            // rendered reference to click: scroll straight to the definition line.
            leaf.setEphemeralState({ line: item.line, focus: true });
            this.collapseSidebarOnMobile();
            return;
        }

        // Reading View: surface the reference, then hand off to Obsidian's
        // native footnote scroll/flash via the rendered reference link.
        leaf.setEphemeralState({ line: item.refLine ?? item.line, focus: true });
        window.setTimeout(() => {
            const anchor = markdownSourceAdapter.findRenderedFootnoteReference(view.contentEl, item.displayNumber);
            if (anchor) {
                anchor.click();
            }
        }, 120);

        this.collapseSidebarOnMobile();
    }

    collapseSidebarOnMobile() {
        if (!Platform.isMobile) return;
        const root = this.leaf.getRoot();
        if (root === this.app.workspace.leftSplit) {
            this.app.workspace.leftSplit.collapse();
        } else if (root === this.app.workspace.rightSplit) {
            this.app.workspace.rightSplit.collapse();
        }
    }

    async exportHighlights() {
        const currentFile = this.currentFile;
        if (!currentFile) return;

        try {
            const { exportHighlightsToMD } = await import("../utils/export");
            const exportPath = await exportHighlightsToMD(this.app, currentFile);

            // Open the exported file
            const exportFile = this.app.vault.getAbstractFileByPath(exportPath);
            if (exportFile instanceof TFile) {
                await this.app.workspace.getLeaf("tab").openFile(exportFile);
            }
        } catch (err) {
            console.error(err);
        }
    }

    openNavigatorMenu(event: MouseEvent) {
        const menu = new Menu().setUseNativeMenu(false);
        menu.addItem((mi: MenuItem) => {
            mi.setTitle("Export Markdown")
                .setIcon("file-text")
                .onClick(() => void this.exportHighlights());
        });
        menu.addItem((mi: MenuItem) => {
            mi.setTitle("Export JSON")
                .setIcon("code")
                .onClick(() => void this.exportHighlightsJSON());
        });
        menu.addItem((mi: MenuItem) => {
            mi.setTitle("Export CSV")
                .setIcon("table")
                .onClick(() => void this.exportHighlightsCSV());
        });
        menu.addSeparator();
        menu.addItem((mi: MenuItem) => {
            mi.setTitle("Remove note highlights")
                .setIcon("eraser")
                .setWarning(true)
                .onClick(() => void this.removeAllHighlightsInNote());
        });
        menu.addItem((mi: MenuItem) => {
            mi.setTitle("Remove note footnotes")
                .setIcon("eraser")
                .setWarning(true)
                .onClick(() => void this.removeAllFootnotesInNote());
        });
        this.showNavigatorMenu(menu, event);
    }

    async exportHighlightsJSON() {
        const currentFile = this.currentFile;
        if (!currentFile) return;
        try {
            const { exportHighlightsToJSON } = await import("../utils/export");
            const exportPath = await exportHighlightsToJSON(this.app, currentFile);
            const exportFile = this.app.vault.getAbstractFileByPath(exportPath);
            if (exportFile instanceof TFile) {
                await this.app.workspace.getLeaf("tab").openFile(exportFile);
            }
        } catch (err) {
            console.error(err);
        }
    }

    async exportHighlightsCSV() {
        const currentFile = this.currentFile;
        if (!currentFile) return;
        try {
            const { exportHighlightsToCSV } = await import("../utils/export");
            const exportPath = await exportHighlightsToCSV(this.app, currentFile);
            const exportFile = this.app.vault.getAbstractFileByPath(exportPath);
            if (exportFile instanceof TFile) {
                await this.app.workspace.getLeaf("tab").openFile(exportFile);
            }
        } catch (err) {
            console.error(err);
        }
    }

    async exportCurrentFileToCanvas() {
        const currentFile = this.currentFile;
        if (!currentFile) return;

        try {
            const { exportHighlightsToCanvas } = await import("../utils/canvas");

            // Re-read: the note may have changed since the sidebar last refreshed.
            const fresh = getHighlightsFromContent(await this.app.vault.read(currentFile)).map((h) => ({
                ...h,
                file: currentFile,
            }));
            if (fresh.length === 0) {
                new Notice("No highlights to export.");
                return;
            }
            const associations = this.plugin.settings.canvasAssociations;
            const associationIndex = associations.findIndex((item) => item.source === currentFile.path);
            const association = associationIndex >= 0 ? associations[associationIndex] : null;
            const associatedFile = association ? this.app.vault.getAbstractFileByPath(association.canvas) : null;
            const hasExistingCanvas = associatedFile instanceof TFile;
            if (!association && associations.length >= MAX_CANVAS_ASSOCIATIONS)
                throw new Error(
                    "Canvas association limit reached. Use Annotations manager → Canvas… for an explicit export."
                );
            // A stale association describes a deleted canvas, not a filename
            // promise. Create a fresh canvas from the note's *current* name and
            // replace the stale association; never resurrect an obsolete name.
            const exportPath = hasExistingCanvas
                ? association.canvas
                : defaultCanvasPath(currentFile, this.plugin.settings.canvasDefaults);
            const result = await exportHighlightsToCanvas(this.app, fresh, {
                path: exportPath,
                defaults: this.plugin.settings.canvasDefaults,
                allowExisting: hasExistingCanvas,
            });
            if (!hasExistingCanvas) {
                if (associationIndex >= 0)
                    associations[associationIndex] = { source: currentFile.path, canvas: exportPath };
                else {
                    associations.push({ source: currentFile.path, canvas: exportPath });
                }
                await this.plugin.saveData(this.plugin.settings);
            }
            this.updateCanvasButton();
            if (!hasExistingCanvas) {
                new Notice(`Created canvas with ${result.added} card${result.added === 1 ? "" : "s"}.`);
            } else if (result.added) {
                new Notice(`Added ${result.added} new card${result.added === 1 ? "" : "s"}. Existing cards preserved.`);
            } else {
                new Notice("Canvas already contains all current highlights. No cards added.");
            }

            const file = this.app.vault.getAbstractFileByPath(exportPath);
            if (file instanceof TFile) {
                await this.app.workspace.getLeaf("tab").openFile(file);
            }
        } catch (err) {
            console.error(err);
            new Notice(err instanceof Error ? err.message : String(err));
        }
    }

    updateCanvasButton() {
        if (!this.canvasButton) return;
        const association = this.currentFile
            ? this.plugin.settings.canvasAssociations.find((item) => item.source === this.currentFile?.path)
            : null;
        const associatedFile = association ? this.app.vault.getAbstractFileByPath(association.canvas) : null;
        const willAppend = associatedFile instanceof TFile;
        this.canvasButton.setText(willAppend ? "Add to Canvas" : "Create Canvas");
        setTooltip(
            this.canvasButton,
            willAppend
                ? "Add new highlights to this note’s associated canvas"
                : "Create a canvas from this note’s highlights",
            { placement: "top" }
        );
    }

    async onClose() {
        this.activeMenu?.hide();
        this.activeMenu = null;
        this.activeMenuTrigger = null;
    }
}
