import { ItemView, MarkdownView, Menu, Notice, WorkspaceLeaf, TFile, setIcon, setTooltip } from "obsidian";
import type ReadingHighlighterPlugin from "../main";
import { VaultScanner, type ScanResult } from "../core/VaultScanner";
import { CanvasExportModal } from "../modals/CanvasExportModal";
import { MaintenanceModal } from "../modals/MaintenanceModal";
import { HighlightEditModal } from "../modals/HighlightEditModal";
import type { Highlight } from "../utils/highlights";

export const RESEARCH_VIEW = "reader-research-view";

type ResearchHighlight = Highlight & { file: TFile; frontmatter: Record<string, unknown> };

/**
 * Stringify a value that may be anything. Objects have no useful string form —
 * `String({})` is `"[object Object]"` — so they become empty rather than noise.
 */
function asText(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }
    return "";
}

export class ResearchView extends ItemView {
    plugin: ReadingHighlighterPlugin;
    scanner: VaultScanner;
    scanResults: ScanResult[];
    searchQuery: string;
    filterKey: string;
    filterValue: string;
    allPropertyKeys: Set<string>;
    activeColors: Set<string>;
    isScanning: boolean;
    expandedFiles: Set<string>;
    expandedHighlights: Set<string>;
    progressEl: HTMLElement | null;
    progressTextEl: HTMLElement | null;
    progressContainer!: HTMLElement;
    propertySelect!: HTMLSelectElement;
    selectedFiles: Set<string> | null = null;
    fileFilterEl?: HTMLElement;

    constructor(leaf: WorkspaceLeaf, plugin: ReadingHighlighterPlugin) {
        super(leaf);
        this.plugin = plugin;
        this.scanner = new VaultScanner(plugin.app);

        this.scanResults = [];
        this.searchQuery = "";
        this.filterKey = "All Properties"; // default
        this.filterValue = "";
        this.allPropertyKeys = new Set();
        this.activeColors = new Set();
        this.isScanning = false;
        this.expandedFiles = new Set(); // store file.path of expanded files
        this.expandedHighlights = new Set();

        this.progressEl = null;
        this.progressTextEl = null;
    }

    getViewType() {
        return RESEARCH_VIEW;
    }

    getDisplayText() {
        return "Annotations manager";
    }

    getIcon() {
        return "search";
    }

    async onOpen() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.addClass("research-view-container");

        // Header
        const header = container.createDiv({ cls: "research-view-header" });

        const titleRow = header.createDiv({ cls: "research-view-title-row" });
        titleRow.createEl("h3", { text: "Annotations manager" });

        const scanBtn = titleRow.createEl("button", { text: "Refresh" });
        scanBtn.onclick = () => void this.refreshScan();

        const canvasBtn = titleRow.createEl("button", { text: "Export to canvas…" });
        canvasBtn.onclick = () => void this.exportToCanvas();
        this.fileFilterEl = header.createDiv({ cls: "fp-research-files" });
        this.renderFileFilter();

        // Search Bar & Date Filter
        const searchContainer = header.createDiv({ cls: "research-view-search" });

        const searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: "Search highlights...",
            cls: "research-search-input",
        });

        searchInput.oninput = (e) => {
            this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
            if (this.searchQuery) {
                for (const highlight of this.filteredHighlights()) {
                    this.expandedFiles.add(highlight.file.path);
                }
            }
            this.renderContent();
        };

        // Property Filtering Row
        const propertyFilterRow = header.createDiv({ cls: "research-view-property-filter" });

        this.propertySelect = propertyFilterRow.createEl("select", {
            cls: "research-property-select",
        });
        this.updatePropertySelector();

        this.propertySelect.onchange = (e) => {
            this.filterKey = (e.target as HTMLSelectElement).value;
            this.renderContent();
        };

        const propertyInput = propertyFilterRow.createEl("input", {
            type: "text",
            placeholder: "Filter by value...",
            cls: "research-property-input",
        });

        propertyInput.oninput = (e) => {
            this.filterValue = (e.target as HTMLInputElement).value.toLowerCase();
            this.renderContent();
        };

        // Semantic Color Filters
        if (this.plugin.settings.enableColorPalette) {
            const filterContainer = header.createDiv({ cls: "research-view-color-filters" });
            this.plugin.settings.semanticColors.forEach((colorItem) => {
                if (!colorItem.meaning) return; // Only show colors that have a meaning defined

                const chip = filterContainer.createEl("button", {
                    cls: "research-color-chip",
                });

                // Dot indicator
                const dot = chip.createSpan({ cls: "research-color-dot" });
                dot.setCssStyles({ backgroundColor: colorItem.color });

                chip.createSpan({ text: colorItem.meaning });

                chip.onclick = () => {
                    const lcColor = colorItem.color.toLowerCase();
                    if (this.activeColors.has(lcColor)) {
                        this.activeColors.delete(lcColor);
                        chip.removeClass("is-active");
                    } else {
                        this.activeColors.add(lcColor);
                        chip.addClass("is-active");
                    }
                    this.renderContent();
                };
            });
        }

        // Progress bar container (hidden by default)
        this.progressContainer = header.createDiv({
            cls: "research-progress-container",
            attr: { style: "display: none;" },
        });
        this.progressTextEl = this.progressContainer.createDiv({ cls: "research-progress-text" });
        const progressTrack = this.progressContainer.createDiv({ cls: "research-progress-track" });
        this.progressEl = progressTrack.createDiv({ cls: "research-progress-bar" });

        // Content Area
        this.contentEl = container.createDiv({ cls: "research-view-content" });

        // Auto-scan on open so all highlights display by default
        void this.startScan();
    }

    async startScan() {
        if (this.isScanning) return;

        this.isScanning = true;
        this.progressContainer.setCssStyles({ display: "block" });
        this.contentEl.empty();

        try {
            this.scanResults = await this.scanner.scanVault((current, total, lastFile) => {
                const percent = Math.round((current / total) * 100);
                this.progressEl?.setCssStyles({ width: `${percent}%` });
                if (this.progressTextEl) {
                    this.progressTextEl.textContent = `Scanning: ${current}/${total} (${percent}%) - ${lastFile}...`;
                }
            });

            // Collect all property keys
            this.allPropertyKeys.clear();
            this.allPropertyKeys.add("All Properties");
            for (const res of this.scanResults) {
                if (res.frontmatter) {
                    Object.keys(res.frontmatter).forEach((key) => this.allPropertyKeys.add(key));
                }
            }
            this.updatePropertySelector();
            this.renderFileFilter();

            // Expand first file automatically if any
            if (this.scanResults.length > 0) {
                this.expandedFiles.add(this.scanResults[0].file.path);
            }
        } catch (err) {
            console.error(err);
            this.contentEl.createDiv({
                text: "Error during scan: " + (err instanceof Error ? err.message : String(err)),
                cls: "research-error",
            });
        } finally {
            this.isScanning = false;
            this.progressContainer.setCssStyles({ display: "none" });
            this.renderContent();
        }
    }

    async refreshScan() {
        this.scanner.clearCache();
        await this.startScan();
    }

    updatePropertySelector() {
        if (!this.propertySelect) return;
        const currentVal = this.filterKey;
        this.propertySelect.empty();

        const sortedKeys = Array.from(this.allPropertyKeys).sort((a, b) => {
            if (a === "All Properties") return -1;
            if (b === "All Properties") return 1;
            return a.localeCompare(b);
        });

        sortedKeys.forEach((key) => {
            const opt = this.propertySelect.createEl("option", { text: key, value: key });
            if (key === currentVal) opt.selected = true;
        });
    }

    private collectHighlights(): ResearchHighlight[] {
        const allHighlights: ResearchHighlight[] = [];
        for (const res of this.scanResults) {
            for (const h of res.highlights) {
                allHighlights.push({ ...h, file: res.file, frontmatter: res.frontmatter });
            }
        }
        return allHighlights;
    }

    renderFileFilter() {
        if (!this.fileFilterEl) return;
        this.fileFilterEl.empty();
        const details = this.fileFilterEl.createEl("details");
        const summary = details.createEl("summary");
        const updateSummary = () => {
            const total = this.scanResults.length;
            summary.setText(
                this.selectedFiles === null
                    ? `All notes with highlights (${total})`
                    : `${this.selectedFiles.size} of ${total} notes`
            );
        };
        updateSummary();
        const buttons = details.createDiv();
        buttons.createEl("button", { text: "All" }).onclick = () => {
            this.selectedFiles = null;
            updateSummary();
            renderOptions();
            this.renderContent();
        };
        buttons.createEl("button", { text: "None" }).onclick = () => {
            this.selectedFiles = new Set();
            updateSummary();
            renderOptions();
            this.renderContent();
        };
        const search = details.createEl("input", {
            attr: { type: "search", placeholder: "Find notes by path", "aria-label": "Find notes by path" },
        });
        const options = details.createDiv({ cls: "fp-research-file-options" });
        const renderOptions = () => {
            options.empty();
            for (const result of this.scanResults.filter((r) =>
                r.file.path.toLowerCase().includes(search.value.toLowerCase())
            )) {
                const row = options.createEl("label");
                const check = row.createEl("input", { attr: { type: "checkbox" } });
                check.checked = this.selectedFiles === null || this.selectedFiles.has(result.file.path);
                row.createSpan({ text: result.file.path });
                check.onchange = () => {
                    if (this.selectedFiles === null)
                        this.selectedFiles = new Set(this.scanResults.map((r) => r.file.path));
                    if (check.checked) this.selectedFiles.add(result.file.path);
                    else this.selectedFiles.delete(result.file.path);
                    if (this.selectedFiles.size === this.scanResults.length) this.selectedFiles = null;
                    updateSummary();
                    renderOptions();
                    this.renderContent();
                };
            }
        };
        search.oninput = renderOptions;
        renderOptions();
    }

    filteredHighlights(): ResearchHighlight[] {
        return this.applyPropertyFilter(this.collectHighlights()).filter(
            (h) =>
                (this.selectedFiles === null || this.selectedFiles.has(h.file.path)) &&
                (!this.searchQuery || h.text.toLowerCase().includes(this.searchQuery)) &&
                (!this.activeColors.size || this.matchesActiveColor(h))
        );
    }

    private matchesActiveColor(highlight: ResearchHighlight): boolean {
        return (highlight.members ?? [highlight]).some((part) =>
            part.color ? this.activeColors.has(part.color.toLowerCase()) : false
        );
    }

    private addColorIndicator(itemEl: HTMLElement, highlight: ResearchHighlight) {
        if (highlight.color) {
            const dot = itemEl.createSpan({ cls: "research-color-dot" });
            dot.setCssStyles({ backgroundColor: highlight.color });
        } else if (highlight.members && new Set(highlight.members.map((part) => part.color)).size > 1) {
            itemEl.createSpan({
                cls: "research-color-dot fp-research-mixed-dot",
                attr: { "aria-label": "Mixed colors" },
            });
        }
    }

    private applyPropertyFilter(highlights: ResearchHighlight[]): ResearchHighlight[] {
        if (!(this.filterKey && this.filterKey !== "All Properties" && this.filterValue)) {
            return highlights;
        }
        const filterVal = this.filterValue.toLowerCase().replace(/^#/, "");
        return highlights.filter((h) => {
            const val = h.frontmatter?.[this.filterKey];
            if (val === undefined || val === null) return false;

            // Handle Tags specifically
            if (this.filterKey === "tags" || this.filterKey === "tag") {
                if (Array.isArray(val)) {
                    return (val as unknown[]).some((t) =>
                        asText(t).toLowerCase().replace(/^#/, "").includes(filterVal)
                    );
                }
                return asText(val).toLowerCase().replace(/^#/, "").includes(filterVal);
            }

            // Handle Arrays
            if (Array.isArray(val)) {
                return (val as unknown[]).some((v) => asText(v).toLowerCase().includes(filterVal));
            }

            // Default string match
            return asText(val).toLowerCase().includes(filterVal);
        });
    }

    renderContent() {
        if (this.isScanning) return;

        this.contentEl.empty();

        if (this.scanResults.length === 0) {
            this.contentEl.createDiv({
                cls: "research-empty",
                text: "No highlights found. Click Refresh to scan again.",
            });
            return;
        }

        const allScannedHighlights = this.collectHighlights();
        const totalHighlights = allScannedHighlights.length;
        const visibleHighlights = this.filteredHighlights();
        const statsRow = this.contentEl.createDiv({ cls: "research-stats" });
        const visibleFileCount = new Set(visibleHighlights.map((highlight) => highlight.file.path)).size;
        const totalFileCount = new Set(allScannedHighlights.map((highlight) => highlight.file.path)).size;
        statsRow.textContent = `${visibleHighlights.length} of ${totalHighlights} highlights · ${visibleFileCount} of ${totalFileCount} notes`;

        if (visibleHighlights.length === 0) {
            this.contentEl.createDiv({
                cls: "research-empty",
                text: "No highlights match the current filters.",
            });
            return;
        }

        const fileMap = new Map<string, { file: TFile; highlights: ResearchHighlight[] }>();
        for (const highlight of visibleHighlights) {
            const group = fileMap.get(highlight.file.path) ?? { file: highlight.file, highlights: [] };
            group.highlights.push(highlight);
            fileMap.set(highlight.file.path, group);
        }

        for (const group of fileMap.values()) {
            const groupEl = this.contentEl.createDiv({ cls: "research-group" });
            const headerEl = groupEl.createDiv({ cls: "research-group-header" });
            const toggleBtn = headerEl.createEl("button", {
                cls: "fp-manager-group-toggle",
                attr: { role: "button", tabindex: "0", "aria-expanded": "false" },
            });
            const expandIcon = toggleBtn.createSpan({ cls: "research-expand-icon" });
            const title = toggleBtn.createSpan({ cls: "research-group-title", text: group.file.basename });
            title.setAttribute("title", group.file.path);
            toggleBtn.createSpan({ cls: "research-group-badge", text: `${group.highlights.length}` });
            this.addNoteActionsButton(headerEl, group.file);

            const listEl = groupEl.createDiv({ cls: "research-highlight-list" });
            for (const highlight of group.highlights) this.renderHighlightItem(listEl, highlight);

            const setExpanded = (expanded: boolean) => {
                toggleBtn.setAttribute("aria-expanded", String(expanded));
                listEl.toggleClass("is-collapsed", !expanded);
                setIcon(expandIcon, expanded ? "chevron-down" : "chevron-right");
                if (expanded) this.expandedFiles.add(group.file.path);
                else this.expandedFiles.delete(group.file.path);
            };
            const toggleExpanded = () => setExpanded(!this.expandedFiles.has(group.file.path));
            toggleBtn.onclick = toggleExpanded;
            setExpanded(this.expandedFiles.has(group.file.path));
        }
    }

    private renderHighlightItem(listEl: HTMLElement, highlight: ResearchHighlight) {
        const rowKey = `${highlight.file.path}\u0000${highlight.id}`;
        const itemEl = listEl.createDiv({ cls: "research-highlight-item", attr: { "aria-expanded": "false" } });
        const disclosureBtn = itemEl.createEl("button", { cls: "fp-manager-row-disclosure" });
        disclosureBtn.setAttribute("aria-label", "Show highlight details");
        this.addColorIndicator(itemEl, highlight);

        const bodyEl = itemEl.createDiv({ cls: "fp-manager-item-body" });
        const textEl = bodyEl.createSpan({ cls: "research-item-text" });
        const detailsEl = bodyEl.createDiv({ cls: "fp-manager-item-details" });
        const detailParts = [this.notationLabel(highlight.notationType), `Line ${highlight.line + 1}`];
        if (highlight.members?.length) detailParts.push(`${highlight.members.length} passages grouped`);
        detailsEl.setText(detailParts.join(" · "));

        this.addEditButton(itemEl, highlight);
        this.addSourceButton(itemEl, highlight);

        const setExpanded = (expanded: boolean) => {
            itemEl.toggleClass("is-expanded", expanded);
            itemEl.setAttribute("aria-expanded", String(expanded));
            textEl.setText(
                expanded || highlight.text.length <= 120 ? highlight.text : `${highlight.text.slice(0, 120)}…`
            );
            detailsEl.toggleClass("is-hidden", !expanded);
            disclosureBtn.setAttribute("aria-label", expanded ? "Hide highlight details" : "Show highlight details");
            setIcon(disclosureBtn, expanded ? "chevron-down" : "chevron-right");
            if (expanded) this.expandedHighlights.add(rowKey);
            else this.expandedHighlights.delete(rowKey);
        };
        const toggleExpanded = () => setExpanded(!this.expandedHighlights.has(rowKey));
        itemEl.onclick = toggleExpanded;
        disclosureBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleExpanded();
        };
        setExpanded(this.expandedHighlights.has(rowKey));
    }

    private notationLabel(notationType?: string): string {
        if (!notationType) return "Legacy highlight";
        return notationType
            .split("-")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" ");
    }

    private openHighlightEditor(highlight: ResearchHighlight) {
        new HighlightEditModal(this.plugin, highlight.file, highlight.id, () => {
            void this.refreshScan();
        }).open();
    }

    private addEditButton(itemEl: HTMLElement, highlight: ResearchHighlight) {
        const editBtn = itemEl.createEl("button", { cls: "fp-manager-edit-link" });
        setIcon(editBtn, "pencil");
        editBtn.setAttribute("aria-label", "Edit highlight");
        setTooltip(editBtn, "Edit highlight", { placement: "top" });
        editBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openHighlightEditor(highlight);
        };
    }

    private addSourceButton(itemEl: HTMLElement, highlight: ResearchHighlight) {
        const sourceBtn = itemEl.createEl("button", { cls: "fp-manager-source-link" });
        setIcon(sourceBtn, "arrow-up-right");
        sourceBtn.setAttribute("aria-label", `Open source in new tab: ${highlight.file.basename}`);
        setTooltip(sourceBtn, `Open source in new tab: ${highlight.file.basename}`, { placement: "top" });
        sourceBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            void this.jumpToHighlight(highlight.file, highlight.line);
        };
    }

    private addNoteActionsButton(headerEl: HTMLElement, file: TFile) {
        const actionsBtn = headerEl.createEl("button", { cls: "fp-manager-note-actions" });
        setIcon(actionsBtn, "more-vertical");
        actionsBtn.setAttribute("aria-label", `Note actions for ${file.basename}`);
        setTooltip(actionsBtn, `Note actions for ${file.basename}`, { placement: "top" });
        actionsBtn.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.openNoteActionsMenu(event, file);
        };
    }

    private openNoteActionsMenu(event: MouseEvent, file: TFile) {
        const menu = new Menu();
        menu.addItem((item) =>
            item
                .setTitle("Note maintenance…")
                .setIcon("wrench")
                .onClick(() => {
                    new MaintenanceModal(this.plugin, file, () => void this.refreshScan()).open();
                })
        );
        menu.showAtMouseEvent(event);
    }

    async jumpToHighlight(file: TFile, line: number) {
        // Open file in new leaf/tab OR current active
        const leaf = this.app.workspace.getLeaf("tab");
        await leaf.openFile(file);

        if (leaf.view instanceof MarkdownView) {
            leaf.setEphemeralState({
                line: line,
                focus: true,
            });
        }
    }

    async exportToCanvas() {
        if (this.isScanning) return;

        const allHighlights = this.filteredHighlights();

        if (allHighlights.length === 0) {
            new Notice("No highlights to export to canvas.");
            return;
        }

        try {
            new CanvasExportModal(this.plugin, allHighlights).open();
        } catch (e) {
            console.error(e);
        }
    }
}
