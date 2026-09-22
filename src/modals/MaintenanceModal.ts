import { Modal, Notice, Setting, TFile } from "obsidian";
import type ReadingHighlighterPlugin from "../main";
import {
    mergeAdjacentHighlightsInRaw,
    migrateSpanHighlightsInRaw,
    recolorMarkHighlightsInRaw,
} from "../utils/highlights";

export function maintenancePreview(raw: string, operation: string, fromColor: string, toColor: string) {
    if (new TextEncoder().encode(raw).length > 2 * 1024 * 1024)
        throw new Error("Note exceeds the 2 MB maintenance safety limit.");
    if (operation === "merge") {
        const r = mergeAdjacentHighlightsInRaw(raw);
        return { raw: r.raw, count: r.mergedCount };
    }
    if (operation === "migrate") {
        const r = migrateSpanHighlightsInRaw(raw);
        return { raw: r.raw, count: r.changedCount };
    }
    if (
        !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(toColor) ||
        (fromColor && !/^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(fromColor))
    )
        throw new Error("Enter a six- or eight-digit hex color. Leave the old color blank to match all colored marks.");
    const r = recolorMarkHighlightsInRaw(raw, { fromColor, toColor });
    return { raw: r.raw, count: r.changedCount };
}

/** Explicit, single-note maintenance with optimistic concurrency and local guarded undo. */
export class MaintenanceModal extends Modal {
    constructor(
        private plugin: ReadingHighlighterPlugin,
        private file: TFile,
        private changed: () => void
    ) {
        super(plugin.app);
    }
    onOpen() {
        this.setTitle("Manage note");
        const { contentEl } = this;
        contentEl.createEl("p", {
            text: `${this.file.path} — whole-note operations. Annotations manager text, color, and property filters do not limit these changes. Nothing is written until you preview and apply.`,
        });
        let operation = "merge",
            from = "",
            to = "#ffff00";
        let before: string | null = null,
            after: string | null = null;
        let busy = false;
        const invalidate = () => {
            before = after = null;
            apply.disabled = true;
            previewText.setText("Preview again after changing options.");
        };
        const options = contentEl.createEl("fieldset");
        new Setting(options).setName("Operation").addDropdown((d) =>
            d
                .addOptions({
                    merge: "Merge adjacent highlights",
                    recolor: "Recolor colored marks",
                    migrate: "Convert background spans to marks",
                })
                .onChange((v) => {
                    operation = v;
                    invalidate();
                })
        );
        contentEl.createEl("p", {
            text: "Merge joins compatible adjacent marks within a line, not separate list items. Span conversion preserves attributes and skips code, comments and nested spans. Use grouping in the navigator for separate items.",
        });
        new Setting(options)
            .setName("Old color (recolor only)")
            .setDesc("Blank matches all colored marks; otherwise an exact hex match.")
            .addText((t) =>
                t.onChange((v) => {
                    from = v.trim();
                    invalidate();
                })
            );
        new Setting(options).setName("New color (recolor only)").addText((t) =>
            t.setValue(to).onChange((v) => {
                to = v.trim();
                invalidate();
            })
        );
        const previewText = contentEl.createEl("p", { attr: { "aria-live": "polite" } });
        const sourcePreview = contentEl.createEl("pre", { cls: "fp-maintenance-preview" });
        const preview = contentEl.createEl("button", { text: "Preview changes" });
        const apply = contentEl.createEl("button", { text: "Apply previewed changes", cls: "mod-cta" });
        const undo = contentEl.createEl("button", { text: "Undo this operation" });
        apply.disabled = undo.disabled = true;
        preview.onclick = () => {
            if (busy) return;
            busy = true;
            options.disabled = true;
            void (async () => {
                try {
                    before = await this.app.vault.read(this.file);
                    const result = maintenancePreview(before, operation, from, to);
                    after = result.raw;
                    previewText.setText(
                        `${result.count} ${operation === "merge" ? "joins" : "marks"} will change in ${this.file.path}. Undo remains available here until this dialog closes, provided the note has not changed again.`
                    );
                    const oldLines = before.split("\n"),
                        newLines = after.split("\n");
                    const changed = oldLines.flatMap((line, i) =>
                        line === newLines[i] ? [] : [`Line ${i + 1}\n− ${line}\n+ ${newLines[i] ?? ""}`]
                    );
                    sourcePreview.setText(
                        changed.slice(0, 30).join("\n\n").slice(0, 12000) +
                            (changed.length > 30 ? "\n… Preview truncated; counts include all changes." : "")
                    );
                    apply.disabled = !result.count;
                    undo.disabled = true;
                } catch (e) {
                    new Notice(e instanceof Error ? e.message : String(e));
                    apply.disabled = true;
                } finally {
                    busy = false;
                    options.disabled = false;
                }
            })();
        };
        apply.onclick = () => {
            if (busy || before === null || after === null) return;
            busy = true;
            apply.disabled = true;
            options.disabled = true;
            void (async () => {
                try {
                    await this.app.vault.process(this.file, (current) => {
                        if (current !== before) throw new Error("The note changed. Preview again before applying.");
                        return after;
                    });
                    new Notice("Changes applied. Undo is available in this dialog.");
                    undo.disabled = false;
                    preview.disabled = true;
                    this.changed();
                } catch (e) {
                    options.disabled = false;
                    new Notice(e instanceof Error ? e.message : String(e));
                } finally {
                    busy = false;
                }
            })();
        };
        undo.onclick = () => {
            if (busy || before === null || after === null) return;
            busy = true;
            void (async () => {
                try {
                    await this.app.vault.process(this.file, (current) => {
                        if (current !== after)
                            throw new Error(
                                "The note changed after this operation. Undo stopped to protect newer edits."
                            );
                        return before;
                    });
                    undo.disabled = true;
                    preview.disabled = false;
                    options.disabled = false;
                    new Notice("Operation undone.");
                    this.changed();
                } catch (e) {
                    new Notice(e instanceof Error ? e.message : String(e));
                } finally {
                    busy = false;
                }
            })();
        };
        contentEl.createEl("button", { text: "Close" }).onclick = () => this.close();
    }
    onClose() {
        this.contentEl.empty();
    }
}
