/**
 * Obsidian numbers a repeated footnote reference as [2-1], [2-2], and so on.
 * Only its visible label changes here; occurrence IDs, hrefs, and backlinks
 * remain Obsidian-owned. Side Notes elements are outside this selector.
 */
export function setRepeatedFootnoteDisplay(root: ParentNode, normalize: boolean): void {
    for (const anchor of root.querySelectorAll<HTMLAnchorElement>("sup.footnote-ref > a.footnote-link[data-footref]")) {
        const nativeLabel = anchor.dataset.fpNativeRepeatedLabel ?? anchor.textContent ?? "";
        const repeated = /^\[(\d+)-[1-9]\d*\]$/.exec(nativeLabel.trim());
        if (!repeated) continue;
        if (normalize) {
            anchor.dataset.fpNativeRepeatedLabel = nativeLabel;
            anchor.textContent = `[${repeated[1]}]`;
        } else if (anchor.dataset.fpNativeRepeatedLabel) {
            anchor.textContent = nativeLabel;
            delete anchor.dataset.fpNativeRepeatedLabel;
        }
    }
}
