import { Setting } from "obsidian";
import { normalizeCanvasDefaults, type CanvasDefaults } from "../utils/canvas";

export function canvasSettingsItems(
    value: CanvasDefaults,
    save: () => Promise<void>,
    layoutOnly = false
): { name: string; desc: string; render: (setting: Setting) => void }[] {
    const items: { name: string; desc: string; render: (setting: Setting) => void }[] = [];
    if (!layoutOnly) {
        items.push({
            name: "Canvas location",
            desc: "For the sidebar Canvas button. Existing associated canvases keep their location.",
            render: (s: Setting) => {
                s.controlEl.empty();
                s.addDropdown((d) =>
                    d
                        .addOptions({
                            adjacent: "Beside the note",
                            subfolder: "Subfolder beside the note",
                            folder: "Specified vault folder",
                        })
                        .setValue(value.location)
                        .onChange(async (v) => {
                            value.location = v as CanvasDefaults["location"];
                            await save();
                        })
                );
            },
        });
        for (const [key, name, desc] of [
            [
                "folder",
                "Canvas folder",
                "Used for subfolder or specified-folder placement. Vault-relative; leave empty for the vault root.",
            ],
            [
                "prefix",
                "Canvas filename prefix",
                "Followed by the note name. Used only when creating a new associated canvas.",
            ],
        ] as const) {
            items.push({
                name,
                desc,
                render: (s: Setting) => {
                    s.controlEl.empty();
                    s.addText((t) =>
                        t.setValue(value[key]).onChange(async (v) => {
                            value[key] = v;
                            await save();
                        })
                    );
                },
            });
        }
    }
    items.push({
        name: "Card layout",
        desc: "Applies only to newly appended cards.",
        render: (s: Setting) => {
            s.controlEl.empty();
            s.addDropdown((d) =>
                d
                    .addOptions({ grid: "Three-column grid", column: "Single column" })
                    .setValue(value.layout)
                    .onChange(async (v) => {
                        value.layout = v === "column" ? "column" : "grid";
                        await save();
                    })
            );
        },
    });
    items.push({
        name: "Connect new cards to their source",
        desc: "Off by default. Existing arrows are never removed or changed.",
        render: (s: Setting) => {
            s.controlEl.empty();
            s.addToggle((t) =>
                t.setValue(value.connect).onChange(async (v) => {
                    value.connect = v;
                    await save();
                })
            );
        },
    });
    for (const key of ["width", "height"] as const) {
        items.push({
            name: `Card ${key}`,
            desc: `Pixels. ${key === "width" ? "200" : "100"}–1,000; keyboard arrows adjust the value.`,
            render: (s: Setting) => {
                s.controlEl.empty();
                s.addText((t) => {
                    t.inputEl.type = "number";
                    t.inputEl.min = key === "width" ? "200" : "100";
                    t.inputEl.max = "1000";
                    t.inputEl.step = "10";
                    t.setValue(String(value[key])).onChange(async (v) => {
                        if (!v.trim() || !Number.isFinite(Number(v))) return;
                        value[key] = normalizeCanvasDefaults({ ...value, [key]: Number(v) })[key];
                        await save();
                    });
                });
            },
        });
    }
    return items;
}
export function renderCanvasSettings(
    container: HTMLElement,
    value: CanvasDefaults,
    save: () => Promise<void>,
    layoutOnly = false
) {
    for (const item of canvasSettingsItems(value, save, layoutOnly)) {
        if ("render" in item && item.render)
            item.render(new Setting(container).setName(item.name).setDesc(item.desc ?? ""));
    }
}
