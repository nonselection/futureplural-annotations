import { sanitizeHTMLToDom } from "obsidian";

/** Compact, non-editable text for Navigator rows. Source serialization stays in the note. */
export function navigatorPreviewText(source: string): string {
    if (!source) return "";
    const markdownText = source
        .replace(/<!--[^]*?-->/g, " ")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .replace(/\[\^[^\]]+\]/g, "")
        .replace(/<(https?:\/\/[^>]+)>/g, "$1")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/[*_~`]+/g, "");
    return (sanitizeHTMLToDom(markdownText).textContent ?? "").replace(/\s+/g, " ").trim();
}
