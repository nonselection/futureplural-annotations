/**
 * DOM and Scroll Utilities
 */
import { MarkdownView } from "obsidian";

export interface ScrollPosition {
    x: number;
    y: number;
}

export function getScroll(view: MarkdownView): ScrollPosition {
    const preview = view.previewMode;
    return typeof preview?.getScroll === "function" ? { x: 0, y: preview.getScroll() } : getFallbackScroll(view);
}

export function applyScroll(view: MarkdownView, pos: ScrollPosition): void {
    const preview = view.previewMode;
    if (typeof preview?.applyScroll === "function") {
        preview.applyScroll(pos.y);
    } else {
        setFallbackScroll(view, pos);
    }
}

function getFallbackScroll(view: MarkdownView): ScrollPosition {
    const el =
        view.containerEl.querySelector<HTMLElement>(".markdown-reading-view") ??
        view.containerEl.querySelector<HTMLElement>(".markdown-preview-view");
    return { x: 0, y: el?.scrollTop ?? 0 };
}

function setFallbackScroll(view: MarkdownView, { y }: ScrollPosition): void {
    const el =
        view.containerEl.querySelector<HTMLElement>(".markdown-reading-view") ??
        view.containerEl.querySelector<HTMLElement>(".markdown-preview-view");
    if (el) el.scrollTop = y;
}
