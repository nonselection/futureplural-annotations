import { Modal, Notice, Setting, TFile } from "obsidian";
import type ReadingHighlighterPlugin from "../main";
import {
    exportHighlightsToCanvas,
    defaultCanvasPath,
    validateCanvasPath,
    type HighlightWithFile,
} from "../utils/canvas";
import { renderCanvasSettings } from "../ui/canvasSettings";

export class CanvasExportModal extends Modal {
    constructor(
        private plugin: ReadingHighlighterPlugin,
        private highlights: HighlightWithFile[]
    ) {
        super(plugin.app);
    }
    onOpen() {
        this.setTitle("Canvas export");
        const { contentEl } = this;
        const defaults = { ...this.plugin.settings.canvasDefaults };
        const fileCount = new Set(this.highlights.map((h) => h.file.path)).size;
        let path = fileCount === 1 ? defaultCanvasPath(this.highlights[0].file, defaults) : "";
        let allowExisting = false;
        contentEl.createEl("p", {
            text: `${this.highlights.length} selected highlights from ${fileCount} files. Existing cards remain unchanged; new cards are appended below the saved layout. These are snapshots, not live synchronized text.`,
        });
        new Setting(contentEl)
            .setName("Canvas path")
            .setDesc("Include the folder and filename ending in .canvas. Multi-file exports require a name.")
            .addText((t) =>
                t
                    .setPlaceholder("Canvases/my annotations.canvas")
                    .setValue(path)
                    .onChange((v) => {
                        path = v.trim();
                        update();
                    })
            );
        new Setting(contentEl)
            .setName("Append to an existing canvas")
            .setDesc("Explicit permission for this export only. No existing cards or arrows will be replaced.")
            .addToggle((t) =>
                t.onChange((v) => {
                    allowExisting = v;
                    update();
                })
            );
        renderCanvasSettings(
            contentEl,
            defaults,
            async () => {
                update();
            },
            true
        );
        const preview = contentEl.createEl("p", { attr: { "aria-live": "polite" } });
        const apply = contentEl.createEl("button", { text: "Create canvas", cls: "mod-cta" });
        function update() {
            try {
                validateCanvasPath(path);
                apply.disabled = false;
                preview.setText(
                    `${allowExisting ? "Create or append" : "Create new"}: ${path}. ${defaults.layout === "grid" ? "Three columns" : "One column"}; ${defaults.connect ? "with arrows" : "no new arrows"}.`
                );
            } catch (e) {
                apply.disabled = true;
                preview.setText(e instanceof Error ? e.message : String(e));
            }
            apply.setText(allowExisting ? "Create or append" : "Create canvas");
        }
        update();
        apply.onclick = () => {
            apply.disabled = true;
            void (async () => {
                try {
                    const result = await exportHighlightsToCanvas(this.app, this.highlights, {
                        path,
                        defaults,
                        allowExisting,
                    });
                    const file = this.app.vault.getAbstractFileByPath(result.path);
                    new Notice(`${result.added} new cards added. Existing cards preserved.`);
                    if (file instanceof TFile) await this.app.workspace.getLeaf("tab").openFile(file);
                    this.close();
                } catch (e) {
                    new Notice(e instanceof Error ? e.message : String(e));
                    update();
                }
            })();
        };
        contentEl.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    }
    onClose() {
        this.contentEl.empty();
    }
}
