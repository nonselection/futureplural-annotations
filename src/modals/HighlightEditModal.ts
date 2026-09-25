import { Modal, Setting, Notice, TFile } from "obsidian";
import type ReadingHighlighterPlugin from "../main";
import { TagSuggestModal } from "./TagSuggestModal";
import {
    parseHighlights,
    findHighlightById,
    logicalHighlights,
    removeLogicalHighlightFromRaw,
    updateHighlightAnnotationInRaw,
    updateHighlightColorInRaw,
    updateHighlightTagsInRaw,
} from "../utils/highlights";

interface EditState {
    color: string;
    tags: string;
    annotation: string;
}

export class HighlightEditModal extends Modal {
    plugin: ReadingHighlighterPlugin;
    file: TFile;
    highlightId: string;
    onApplied: (raw: string) => void;
    state: EditState;
    colorSettingEl!: HTMLElement;
    tagsInput!: HTMLInputElement;
    annotationInput!: HTMLTextAreaElement;
    colorInput!: HTMLInputElement;
    colorTextInput!: HTMLInputElement;
    private observedLegacy: { start: number; text: string; type: string } | null = null;

    constructor(
        plugin: ReadingHighlighterPlugin,
        file: TFile,
        highlightId: string,
        onApplied: (raw: string) => void = () => {}
    ) {
        super(plugin.app);
        this.plugin = plugin;
        this.file = file;
        this.highlightId = highlightId;
        this.onApplied = onApplied;

        this.state = {
            color: "",
            tags: "",
            annotation: "",
        };
    }

    async onOpen() {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        contentEl.addClass("reading-highlighter-highlight-edit-modal");
        modalEl.addClass("reading-highlighter-highlight-edit-modal");

        contentEl.createEl("h2", { text: "Edit highlight" });

        let raw: string;
        try {
            raw = await this.app.vault.read(this.file);
        } catch (err) {
            console.error(err);
            contentEl.createDiv({ cls: "highlight-edit-error", text: "Could not read file." });
            return;
        }

        const parsed = parseHighlights(raw);
        const highlight = logicalHighlights(parsed.highlights).find((item) => item.id === this.highlightId);
        if (!highlight) {
            contentEl.createDiv({ cls: "highlight-edit-error", text: "Highlight not found (it may have moved)." });
            return;
        }
        this.observedLegacy = highlight.annotationId
            ? null
            : {
                  start: highlight.start,
                  text: highlight.text,
                  type: highlight.type,
              };

        this.state.color = highlight.color || "";
        this.state.tags = highlight.tagsText || "";
        this.state.annotation = highlight.annotation || "";

        const preview = contentEl.createDiv({ cls: "highlight-edit-preview" });
        // The current edit preview shows source text; a rendered notation preview
        // is a separate product enhancement.
        preview.createDiv({ cls: "highlight-edit-preview-label", text: "Selected text" });
        preview.createDiv({ cls: "highlight-edit-preview-text", text: highlight.text || "" });

        this.colorSettingEl = contentEl.createDiv({ cls: "highlight-edit-color-setting" });
        this.renderColorControls();

        const tagsSetting = new Setting(contentEl)
            .setName("Tags")
            .setDesc("Tags applied immediately before the highlight.");
        this.tagsInput = tagsSetting.controlEl.createEl("input", {
            type: "text",
            cls: "highlight-edit-tags-input",
        });
        this.tagsInput.value = this.state.tags;
        this.tagsInput.oninput = (e) => {
            this.state.tags = (e.target as HTMLInputElement).value;
        };
        tagsSetting.addButton((btn) =>
            btn.setButtonText("Pick").onClick(() => {
                new TagSuggestModal(this.plugin, (tagText) => {
                    this.state.tags = tagText;
                    this.tagsInput.value = tagText;
                }).open();
            })
        );

        const annotationSetting = new Setting(contentEl)
            .setName("Footnote")
            .setDesc("Stored as a standard footnote definition in the note.");

        this.annotationInput = annotationSetting.controlEl.createEl("textarea", {
            cls: "highlight-edit-annotation-input",
        });
        this.annotationInput.rows = 3;
        this.annotationInput.value = this.state.annotation;
        this.annotationInput.oninput = (e) => {
            this.state.annotation = (e.target as HTMLTextAreaElement).value;
        };

        const footer = contentEl.createDiv({ cls: "modal-footer highlight-edit-footer" });

        const cancelBtn = footer.createEl("button", { text: "Cancel" });
        cancelBtn.onclick = () => this.close();

        const removeBtn = footer.createEl("button", { text: "Remove highlight" });
        removeBtn.onclick = () => void this.applyEdits({ remove: true });

        const applyBtn = footer.createEl("button", { text: "Apply", cls: "mod-cta" });
        applyBtn.onclick = () => void this.applyEdits({ remove: false });
    }

    renderColorControls() {
        this.colorSettingEl.empty();

        const wrapper = this.colorSettingEl.createDiv({ cls: "highlight-edit-color-wrapper" });

        const titleRow = wrapper.createDiv({ cls: "highlight-edit-color-title" });
        titleRow.createSpan({ text: "Color" });

        const inputRow = wrapper.createDiv({ cls: "highlight-edit-color-row" });

        this.colorInput = inputRow.createEl("input", {
            type: "color",
            cls: "highlight-edit-color-input",
        });
        const safeColor = this.state.color && /^#[0-9a-fA-F]{6}$/.test(this.state.color) ? this.state.color : "#ffff00";
        this.colorInput.value = safeColor;

        const colorText = inputRow.createEl("input", {
            type: "text",
            cls: "highlight-edit-color-text",
            attr: { placeholder: "Hex color like #ff0000" },
        });
        colorText.value = this.state.color || "";
        colorText.oninput = (e) => {
            const next = (e.target as HTMLInputElement).value.trim();
            this.state.color = next;
            if (/^#[0-9a-fA-F]{6}$/.test(next)) {
                this.colorInput.value = next;
            }
        };
        this.colorTextInput = colorText;
        this.colorInput.oninput = (e) => {
            const next = (e.target as HTMLInputElement).value;
            this.state.color = next;
            this.colorTextInput.value = next;
        };

        if (this.plugin.settings.enableColorPalette) {
            const palette = wrapper.createDiv({ cls: "highlight-edit-palette" });
            this.plugin.settings.semanticColors.forEach((item) => {
                const btn = palette.createEl("button", {
                    cls: "highlight-edit-palette-btn",
                    attr: { "aria-label": item.meaning || item.color },
                });
                btn.setCssStyles({ backgroundColor: item.color });
                btn.onclick = (evt) => {
                    evt.preventDefault();
                    this.state.color = item.color;
                    this.colorInput.value = item.color;
                    this.colorTextInput.value = item.color;
                };
            });
        }
    }

    async applyEdits({ remove }: { remove: boolean }) {
        try {
            await this.plugin.saveUndoState(this.file);

            const finalRaw = await this.app.vault.process(this.file, (data) => {
                let raw = data;
                const parsed = parseHighlights(raw);
                const highlight = findHighlightById(parsed, this.highlightId);
                if (!highlight) {
                    throw new Error("Highlight not found (it may have moved).");
                }
                if (highlight.integrity === "ambiguous") {
                    throw new Error("Annotation identity is ambiguous; no source changed.");
                }
                if (
                    this.observedLegacy &&
                    (highlight.start !== this.observedLegacy.start ||
                        highlight.text !== this.observedLegacy.text ||
                        highlight.type !== this.observedLegacy.type)
                ) {
                    throw new Error("Legacy highlight changed; reopen it before editing.");
                }

                if (remove) {
                    raw = removeLogicalHighlightFromRaw(raw, highlight);
                    return raw;
                }

                raw = updateHighlightTagsInRaw(raw, highlight, this.state.tags);

                // Re-parse after potential length changes
                let updatedParsed = parseHighlights(raw);
                let updatedHighlight = findHighlightById(updatedParsed, this.highlightId);
                if (!updatedHighlight) {
                    throw new Error("Highlight not found after tag update.");
                }

                const color = String(this.state.color || "").trim();
                if (color) {
                    const parts = highlight.annotationId
                        ? updatedParsed.highlights.filter((part) => part.annotationId === highlight.annotationId)
                        : [updatedHighlight];
                    for (const part of parts.sort((a, b) => b.openTagStart - a.openTagStart)) {
                        raw = updateHighlightColorInRaw(raw, part, color);
                    }
                }

                updatedParsed = parseHighlights(raw);
                updatedHighlight = findHighlightById(updatedParsed, this.highlightId);
                if (!updatedHighlight) {
                    throw new Error("Highlight not found after style update.");
                }

                raw = updateHighlightAnnotationInRaw(raw, updatedHighlight, this.state.annotation);
                return raw;
            });

            this.onApplied(finalRaw);
            this.close();
            new Notice(remove ? "Highlight removed." : "Highlight updated.");
        } catch (err) {
            console.error(err);
            new Notice(err instanceof Error ? err.message : "Failed to update highlight.");
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
