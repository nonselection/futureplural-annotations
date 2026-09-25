import {
    createAnnotationId,
    isAnnotationId,
    type AnnotationId,
    type MarkdownAnchor,
    type SourceAdapter,
    type SourceObservation,
} from "../models/annotation";
import { logicalHighlights, parseHighlights, visibleSource, type Highlight } from "../utils/highlights";
import { createNotationOpenTag, type NotationSpec, type NotationType } from "../models/notations";
import { RoughNotationRenderer } from "../core/RoughNotationRenderer";
import type { AnnotationEvidence, AnnotationObservation } from "../models/canonical";

export interface MarkdownRewriteSettings {
    defaultTagPrefix: string;
    enableColorHighlighting: boolean;
    highlightColor: string;
    notationOpacity: Record<NotationType, number>;
}

export interface MarkdownMarkObservation extends SourceObservation<MarkdownAnchor> {
    highlight: Highlight;
}

export interface MarkdownFootnoteObservation extends SourceObservation<MarkdownAnchor> {
    label: string;
    text: string;
    definitions: { line: number; start: number; end: number }[];
    references: { line: number; start: number; end: number }[];
}

/** Read-only source observations; the Slice 2A registry assigns SourceRecordId. */
export class MarkdownSourceAdapter implements SourceAdapter<MarkdownAnchor, MarkdownMarkObservation> {
    readonly sourceType = "markdown" as const;
    readonly capabilities = { marking: true, footnotes: true, readingNavigation: true, sourceEditing: true } as const;

    openMark(spec: NotationSpec, id: AnnotationId, ordinal: number, total: number): string {
        if (ordinal < 1 || total < ordinal) throw new Error("Invalid managed mark part order.");
        return createNotationOpenTag(spec, id, `${ordinal}/${total}`);
    }

    private unusedId(raw: string, occupied: ReadonlySet<string> = new Set()): AnnotationId {
        for (let attempt = 0; attempt < 32; attempt++) {
            const id = createAnnotationId();
            if (!occupied.has(id) && !raw.includes(id)) return id;
        }
        throw new Error("Could not allocate a unique annotation ID; no source changed.");
    }

    navigationLine(highlight: Highlight): number {
        return (highlight.members ?? [highlight])[0].line;
    }

    findRenderedFootnoteReference(root: HTMLElement, displayNumber: number | null): HTMLAnchorElement | null {
        const anchors = root.querySelectorAll<HTMLAnchorElement>(
            "sup.footnote-ref a, a.footnote-ref, sup[id^='fnref'] a"
        );
        if (displayNumber !== null) {
            for (const anchor of Array.from(anchors)) {
                if ((anchor.textContent || "").replace(/\D/g, "") === String(displayNumber)) return anchor;
            }
        }
        return anchors.length ? anchors[0] : null;
    }

    renderChild(
        element: HTMLElement,
        sourcePath: string,
        onRendered: () => void,
        opacityByType: Record<NotationType, number>
    ): RoughNotationRenderer {
        return new RoughNotationRenderer(element, undefined, onRendered, sourcePath, opacityByType);
    }

    splitMarkdownLine(line: string) {
        const indentMatch = line.match(/^\s*/);
        const indent = indentMatch ? indentMatch[0] : "";
        let remainder = line.substring(indent.length);
        let prefix = "";
        const prefixPatterns = [
            /^>\s*/,
            /^#{1,6}\s+/,
            /^-\s\[[ xX]\]\s+/,
            /^[-*+]\s+/,
            /^\d{1,3}[.)]\s+/,
            /^\[\^[^\]]+\]:\s*/,
            /^\[![^\]]+\]\s*/,
        ];
        let matched = true;
        while (matched && remainder) {
            matched = false;
            for (const pattern of prefixPatterns) {
                const match = remainder.match(pattern);
                if (match) {
                    prefix += match[0];
                    remainder = remainder.substring(match[0].length);
                    matched = true;
                    break;
                }
            }
        }
        return { indent, prefix, content: remainder };
    }

    getLineStart(raw: string, offset: number) {
        const lineBreak = raw.lastIndexOf("\n", Math.max(0, offset - 1));
        return lineBreak === -1 ? 0 : lineBreak + 1;
    }

    getLineEnd(raw: string, offset: number) {
        const lineBreak = raw.indexOf("\n", offset);
        return lineBreak === -1 ? raw.length : lineBreak;
    }

    /** The full line of `raw` containing `offset`. */
    lineContaining(raw: string, offset: number): string {
        return raw.substring(this.getLineStart(raw, offset), this.getLineEnd(raw, offset));
    }

    /**
     * Cell ranges of a table row, split on unescaped pipes only.
     *
     * `\|` is an escaped pipe: it is content, not a column boundary. Splitting
     * on it tears wiki links (`[[Note\|Alias]]`) and code spans (`` `a \| b` ``)
     * in half and writes a marker into the middle of them.
     */
    splitTableCells(line: string): { start: number; end: number }[] {
        const cells: { start: number; end: number }[] = [];
        let cursor = 0;
        for (let i = 0; i < line.length; i++) {
            if (line[i] === "\\") {
                i++;
                continue;
            }
            if (line[i] === "|") {
                cells.push({ start: cursor, end: i });
                cursor = i + 1;
            }
        }
        cells.push({ start: cursor, end: line.length });
        return cells;
    }

    /**
     * Rewrite one table row, wrapping only the cells the selection covers.
     *
     * Highlighting a row cannot be done by wrapping the selected span: a `==`
     * pair spanning a `|` swallows the column boundary and the table stops
     * rendering as a table. Each covered cell gets its own pair instead.
     */
    applyToTableRow(
        line: string,
        lineStart: number,
        selectionStart: number,
        selectionEnd: number,
        mode: string,
        wrapManaged: ((text: string) => string) | null = null
    ): string {
        const cells = this.splitTableCells(line);
        const pieces: string[] = [];

        cells.forEach((cell, index) => {
            const text = line.substring(cell.start, cell.end);
            const stripped = text
                .replace(/<mark[^>]*>/g, "")
                .replace(/<\/mark>/g, "")
                .split("==")
                .join("");
            const trimmed = stripped.trim();

            // The fragments outside the outer pipes are not cells.
            const isEdge = index === 0 || index === cells.length - 1;
            // Coverage is measured against the cell's *content*, not its padding.
            // A match can run a little past a cell boundary — the flexible
            // matcher treats spaces and `|` as skippable — and counting the
            // padding would drag the neighbouring cell in with it.
            let contentStart = cell.start;
            let contentEnd = cell.end;
            while (contentStart < contentEnd && /\s/.test(line[contentStart])) contentStart++;
            while (contentEnd > contentStart && /\s/.test(line[contentEnd - 1])) contentEnd--;
            const covered = lineStart + contentEnd > selectionStart && lineStart + contentStart < selectionEnd;

            if (isEdge || !trimmed || !covered || mode === "remove") {
                pieces.push(mode === "remove" ? stripped : covered && !isEdge ? stripped : text);
                return;
            }

            const leadWS = stripped.match(/^(\s*)/)?.[1] ?? "";
            const trailWS = stripped.match(/(\s*)$/)?.[1] ?? "";
            const wrapped = wrapManaged ? wrapManaged(trimmed) : trimmed;
            pieces.push(`${leadWS}${wrapped}${trailWS}`);
        });

        return pieces.join("|");
    }

    isTableAlignmentRow(line: string) {
        return /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line);
    }

    isTableDataRow(line: string) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("|")) return false;
        if (this.isTableAlignmentRow(line)) return false;
        return (trimmed.match(/\|/g) || []).length >= 2;
    }

    rewriteSelection(
        raw: string,
        start: number,
        end: number,
        mode: string,
        payload: string,
        autoTag: string,
        notationType: NotationType,
        settings: MarkdownRewriteSettings
    ): string {
        if (
            (mode === "highlight" || mode === "color") &&
            parseHighlights(raw).highlights.some((mark) => mark.start <= start && mark.end >= end)
        ) {
            return raw;
        }
        let expandedStart = start;
        let expandedEnd = end;
        let bodyStart = 0;
        if (raw.startsWith("---")) {
            const secondDash = raw.indexOf("---", 3);
            if (secondDash !== -1) {
                bodyStart = secondDash + 3;
            }
        }
        let expanded = true;
        while (expanded) {
            expanded = false;
            const preceding = raw.substring(0, expandedStart);
            const matchBack = preceding.match(/(<mark[^>]*>|\*\*|==|~~|\*|_|\[\[|\[\^[^\]]+\]:?\s?|[([{"'«“‘‹])$/);
            if (matchBack && expandedStart > bodyStart) {
                const newStart = expandedStart - matchBack[0].length;
                if (newStart >= bodyStart) {
                    expandedStart = newStart;
                    expanded = true;
                }
            }
            const following = raw.substring(expandedEnd);
            // Expanded to include balanced punctuation, quotes (including « »), and footnotes
            const matchForward = following.match(
                /^(<\/mark>|\*\*|==|~~|\*|_|\]\]|\]\([^)]+\)|\[\^[^\]]+\]|[.?!,;:]["']?|[)\]}"'»”’›.?!,;:](\s|$)?)/
            );
            if (matchForward) {
                expandedEnd += matchForward[0].length;
                expanded = true;
            }
        }
        // Merge with any highlight the selection overlaps.
        //
        // Extending a highlight — selecting from inside it out past its end —
        // otherwise consumes the existing closing marker (the wrap step strips
        // every `==` inside the selected span) and leaves the original opening
        // marker unpaired, so one highlight becomes two broken fragments. Widen
        // the range to the union of the selection and every highlight it touches;
        // the interior markers are then stripped as usual and a single pair is
        // written around the whole span.
        if (mode === "highlight" || mode === "color" || mode === "tag" || mode === "remove") {
            for (const existing of parseHighlights(raw).highlights) {
                const overlaps = existing.openTagStart < expandedEnd && existing.closeTagEnd > expandedStart;
                if (!overlaps) continue;
                if ((mode === "highlight" || mode === "color") && existing.annotationId) {
                    throw new Error("This selection overlaps a managed annotation. No source changed.");
                }
                expandedStart = Math.min(expandedStart, existing.openTagStart);
                expandedEnd = Math.max(expandedEnd, existing.closeTagEnd);
            }
        }

        const initiallySelectedText = raw.substring(expandedStart, expandedEnd);
        if (/\r?\n/.test(initiallySelectedText)) {
            expandedStart = this.getLineStart(raw, expandedStart);
            expandedEnd = this.getLineEnd(raw, expandedEnd);
        }
        // A table row must be rewritten as whole cells, so the range is widened
        // to full lines — but the caller's own range is kept, because only the
        // cells it actually covers should be highlighted.
        const selectionStart = expandedStart;
        const selectionEnd = expandedEnd;
        if (
            this.isTableDataRow(this.lineContaining(raw, expandedStart)) ||
            this.isTableDataRow(this.lineContaining(raw, expandedEnd))
        ) {
            expandedStart = this.getLineStart(raw, expandedStart);
            expandedEnd = this.getLineEnd(raw, expandedEnd);
        }

        const selectedText = raw.substring(expandedStart, expandedEnd);
        const newline = raw.includes("\r\n") ? "\r\n" : "\n";
        const lines = selectedText.split(/\r?\n/);
        // Absolute offset of each line, so a table row can work out which of its
        // cells the selection covers.
        const lineOffsets: number[] = [];
        let runningOffset = expandedStart;
        for (const line of lines) {
            lineOffsets.push(runningOffset);
            runningOffset += line.length + newline.length;
        }
        let fullTag = "";
        const sanitizeTag = (t: string) => t.trim().replace(/^#/, "").replace(/\s+/g, "_");
        if (mode === "tag" && payload) {
            const prefix = settings.defaultTagPrefix ? sanitizeTag(settings.defaultTagPrefix) : "";
            const cleanPayload = payload
                .split(/\s+/)
                .map(sanitizeTag)
                .filter((t) => t)
                .map((t) => `#${t}`)
                .join(" ");
            if (prefix) {
                fullTag = `#${sanitizeTag(prefix)} ${cleanPayload}`;
            } else {
                fullTag = cleanPayload;
            }
        } else if ((mode === "highlight" || mode === "color") && settings.defaultTagPrefix) {
            const autoTagSetting = sanitizeTag(settings.defaultTagPrefix);
            if (autoTagSetting) {
                fullTag = `#${autoTagSetting}`;
            }
        }
        if (autoTag) {
            const cleanAutoTag = sanitizeTag(autoTag);
            fullTag = fullTag ? `${fullTag} #${cleanAutoTag}` : `#${cleanAutoTag}`;
        }
        const managedMode = mode === "highlight" || mode === "color";
        const annotationId = managedMode ? this.unusedId(raw) : null;
        const partTokens: string[] = [];
        const wrapManaged = (text: string): string => {
            const token = `\uE000fp-part-${partTokens.length}\uE001`;
            partTokens.push(token);
            return `${token}${text}</mark>`;
        };
        const processedLines = lines.map((line, lineIndex) => {
            let cleanLine = line.replace(/<mark[^>]*>/g, "").replace(/<\/mark>/g, "");
            if (this.isTableAlignmentRow(line)) return line;
            if (this.isTableDataRow(line)) {
                return this.applyToTableRow(
                    line,
                    lineOffsets[lineIndex],
                    selectionStart,
                    selectionEnd,
                    mode,
                    managedMode ? wrapManaged : null
                );
            }
            if (mode === "highlight" || mode === "color" || mode === "tag" || mode === "remove") {
                cleanLine = cleanLine.split("==").join("");
            } else if (mode === "bold") {
                cleanLine = cleanLine.split("**").join("");
            } else if (mode === "italic") {
                cleanLine = cleanLine.split("*").join("");
            }
            if (mode === "remove") return cleanLine;
            const { indent, prefix, content } = this.splitMarkdownLine(cleanLine);
            if (!content.trim()) return line;

            // Extract leading and trailing whitespace to preserve it outside the highlight
            const leadWS = content.match(/^(\s*)/)?.[1] || "";
            const trailWS = content.match(/(\s*)$/)?.[1] || "";
            const actualContent = content.substring(leadWS.length, content.length - trailWS.length);

            if (!actualContent) return line;

            const tagStr = fullTag ? `${fullTag} ` : "";
            let wrappedContent = actualContent;

            if (managedMode) {
                wrappedContent = wrapManaged(actualContent);
            } else if (mode === "bold") {
                wrappedContent = `**${actualContent}**`;
            } else if (mode === "italic") {
                wrappedContent = `*${actualContent}*`;
            }

            return `${indent}${prefix}${leadWS}${tagStr}${wrappedContent}${trailWS}`;
        });
        let replaceBlock = processedLines.join(newline);
        if (annotationId) {
            const color =
                mode === "color" ? payload : settings.enableColorHighlighting ? settings.highlightColor : null;
            const spec = { notationType, color, opacity: settings.notationOpacity[notationType] };
            partTokens.forEach((token, index) => {
                replaceBlock = replaceBlock.replace(
                    token,
                    this.openMark(spec, annotationId, index + 1, partTokens.length)
                );
            });
        }
        const result = raw.substring(0, expandedStart) + replaceBlock + raw.substring(expandedEnd);
        if (annotationId) {
            const matching = this.observe(result).filter((observation) => observation.managedId === annotationId);
            if (
                matching.length !== 1 ||
                matching[0].integrity !== "resolved" ||
                matching[0].anchor.parts.length !== partTokens.length
            ) {
                throw new Error("Managed annotation failed source verification; no write made.");
            }
        }
        return result;
    }

    observe(raw: string): MarkdownMarkObservation[] {
        return logicalHighlights(parseHighlights(raw).highlights).map((highlight) => ({
            managedId: highlight.annotationId as AnnotationId | null,
            observationKey: highlight.id,
            identityMode: highlight.identityMode,
            integrity: highlight.integrity,
            anchor: {
                sourceType: "markdown",
                parts: (highlight.members ?? [highlight]).map((part, index) => ({
                    partId: part.partId ?? `observed-${index + 1}`,
                    order: part.partIndex ?? index + 1,
                    start: part.start,
                    end: part.end,
                })),
            },
            highlight,
        }));
    }

    /** Normalized evidence for pure reconciliation; no registry identity is assigned here. */
    observeForReconciliation(raw: string): AnnotationObservation[] {
        const marks = this.observe(raw).map((observation) => {
            const parts = observation.highlight.members ?? [observation.highlight];
            const start = Math.min(...parts.map((part) => part.start));
            const end = Math.max(...parts.map((part) => part.end));
            return {
                observationKey: `mark:${observation.observationKey}`,
                managedId: observation.managedId,
                kind: "mark" as const,
                integrity: observation.integrity,
                anchor: observation.anchor,
                evidence: this.reconciliationEvidence(raw, start, end, observation.highlight.text),
            };
        });
        const footnotes = this.observeFootnotes(raw).map((observation) => {
            const span = observation.references[0] ?? observation.definitions[0];
            return {
                observationKey: observation.observationKey,
                managedId: observation.managedId,
                kind: "footnote" as const,
                integrity: observation.integrity,
                anchor: observation.anchor,
                evidence: this.footnoteReconciliationEvidence(raw, span.start, span.end, observation.text),
            };
        });
        return [...marks, ...footnotes];
    }

    private reconciliationEvidence(raw: string, start: number, end: number, quote: string): AnnotationEvidence {
        return {
            quote: quote.slice(0, 8192),
            quoteTruncated: quote.length > 8192,
            before: raw.slice(Math.max(0, start - 64), start),
            after: raw.slice(end, end + 64),
        };
    }

    private footnoteReconciliationEvidence(raw: string, start: number, end: number, quote: string): AnnotationEvidence {
        // Reference context excludes the changeable label and stays within its line.
        const lineStart = this.getLineStart(raw, start);
        const lineEnd = this.getLineEnd(raw, end);
        return {
            quote: quote.slice(0, 8192),
            quoteTruncated: quote.length > 8192,
            before: raw.slice(Math.max(lineStart, start - 64), start),
            after: raw.slice(end, Math.min(lineEnd, end + 64)),
        };
    }

    observeFootnotes(raw: string): MarkdownFootnoteObservation[] {
        const records = new Map<string, MarkdownFootnoteObservation>();
        const lines = raw.split(/\r?\n/);
        const visibleLines = visibleSource(raw).split(/\r?\n/);
        const newlineLength = raw.includes("\r\n") ? 2 : 1;
        let offset = 0;
        let active: {
            record: MarkdownFootnoteObservation;
            definition: MarkdownFootnoteObservation["definitions"][number];
        } | null = null;
        for (let line = 0; line < lines.length; line++) {
            const text = lines[line];
            const definition = visibleLines[line].match(/^\s{0,3}\[\^([^\]]+)\]:/);
            if (definition) {
                const record = this.footnoteRecord(records, definition[1]);
                const span = { line, start: offset, end: offset + text.length };
                record.definitions.push(span);
                if (record.definitions.length === 1) record.text = text.slice(definition[0].length).trim();
                active = record.definitions.length === 1 ? { record, definition: span } : null;
            } else if (active && /^(?: {4}|\t)\S/.test(text)) {
                active.definition.end = offset + text.length;
                active.record.text += `\n${text.replace(/^(?: {4}|\t)/, "")}`;
            } else {
                active = null;
            }
            const refs = /\[\^([^\]]+)\](?!:)/g;
            let match: RegExpExecArray | null;
            while ((match = refs.exec(visibleLines[line]))) {
                const record = this.footnoteRecord(records, match[1]);
                record.references.push({
                    line,
                    start: offset + match.index,
                    end: offset + match.index + match[0].length,
                });
            }
            offset += text.length + (line < lines.length - 1 ? newlineLength : 0);
        }
        for (const record of records.values()) {
            record.integrity =
                record.definitions.length > 1 ? "ambiguous" : record.definitions.length === 0 ? "missing" : "resolved";
            record.anchor.parts = (record.references.length ? record.references : record.definitions).map(
                (part, i) => ({
                    partId: String(i + 1),
                    order: i + 1,
                    start: part.start,
                    end: part.end,
                })
            );
        }
        return [...records.values()];
    }

    private footnoteRecord(records: Map<string, MarkdownFootnoteObservation>, label: string) {
        let record = records.get(label);
        if (!record) {
            const managed = isAnnotationId(label);
            record = {
                managedId: managed ? label : null,
                observationKey: `footnote:${label}`,
                identityMode: managed ? "managed" : "tracked-legacy",
                integrity: "missing",
                anchor: { sourceType: "markdown", parts: [] },
                label,
                text: "",
                definitions: [],
                references: [],
            };
            records.set(label, record);
        }
        return record;
    }

    createFootnote(raw: string, end: number, comment: string): { raw: string; id: AnnotationId; label: string } {
        if (end < 0 || end > raw.length) throw new Error("Invalid footnote insertion point.");
        // Check every definition AND reference, including dangling references.
        const used = new Set(this.observeFootnotes(raw).map((record) => record.label));
        const id = this.unusedId(raw, used);
        const newline = raw.includes("\r\n") ? "\r\n" : "\n";
        const reference = `[^${id}]`;
        const inserted = raw.slice(0, end) + reference + raw.slice(end);
        const definitionText = comment.replace(/\r?\n/g, `${newline}    `);
        const result = inserted.trimEnd() + `${newline}${newline}[^${id}]: ${definitionText}${newline}`;
        const observed = this.observeFootnotes(result).find((item) => item.label === id);
        if (!observed || observed.definitions.length !== 1 || observed.references.length !== 1) {
            throw new Error("Managed footnote failed source verification; no write made.");
        }
        return { raw: result, id, label: id };
    }
}

export const markdownSourceAdapter = new MarkdownSourceAdapter();
