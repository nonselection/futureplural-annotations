import { describe, expect, it, vi } from "vitest";
import ReadingHighlighterPlugin, { ReadingHighlighterSettingTab } from "../src/main";
import { createObsidianWindow } from "./dom-helpers.js";

describe("gesture opacity settings", () => {
    it("renders a slider as a control rather than adding one on every row click", async () => {
        const plugin = new ReadingHighlighterPlugin({}, { id: "futureplural-annotations", version: "0" });
        await plugin.loadSettings();
        plugin.saveSettings = vi.fn(async () => {});
        const tab = new ReadingHighlighterSettingTab({}, plugin);
        const group = tab.getSettingDefinitions().find((item) => item.heading === "Highlight appearance");
        expect(group.items).toHaveLength(6);

        const { document, Event } = createObsidianWindow();
        for (const item of group.items) {
            expect(item).toHaveProperty("render");
            expect(item).not.toHaveProperty("action");
            const row = document.createElement("div");
            const setting = {
                addSlider(configure) {
                    const input = document.createElement("input");
                    input.type = "range";
                    const slider = {
                        setLimits(min, max, step) {
                            input.min = String(min);
                            input.max = String(max);
                            input.step = String(step);
                            return slider;
                        },
                        setValue(value) {
                            input.value = String(value);
                            return slider;
                        },
                        onChange(handler) {
                            input.addEventListener("input", () => void handler(Number(input.value)));
                            return slider;
                        },
                    };
                    configure(slider);
                    row.appendChild(input);
                },
            };
            item.render(setting);
            const input = row.querySelector("input");
            expect(row.querySelectorAll("input")).toHaveLength(1);
            expect(input.min).toBe("20");
            expect(input.max).toBe("100");
            expect(input.step).toBe("5");
            row.dispatchEvent(new Event("click", { bubbles: true }));
            input.dispatchEvent(new Event("click", { bubbles: true }));
            expect(row.querySelectorAll("input")).toHaveLength(1);
        }

        const highlight = group.items[0];
        const row = document.createElement("div");
        highlight.render({
            addSlider(configure) {
                const slider = {
                    setLimits: () => slider,
                    setValue: () => slider,
                    onChange: (handler) => {
                        row.addEventListener("input", () => void handler(75));
                        return slider;
                    },
                };
                configure(slider);
            },
        });
        row.dispatchEvent(new Event("input"));
        expect(plugin.settings.notationOpacity.highlight).toBe(0.75);
        expect(plugin.saveSettings).toHaveBeenCalledOnce();
    });
});
