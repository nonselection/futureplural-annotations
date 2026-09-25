import { normalizeNotationType, normalizeOpacity, type NotationSpec } from "../models/notations";
import { createAnnotationId, isAnnotationId, type IdentityMode, type Integrity } from "../models/annotation";

export type HighlightType = "markdown" | "html";
export type FootnotePlacement = "after" | "inside";

export interface Highlight extends NotationSpec {
    id: string;
    text: string;
    line: number;
    type: HighlightType;
    color: string | null;
    start: number;
    end: number;
    innerStart: number;
    innerEnd: number;
    openTagStart: number;
    openTagEnd: number;
    closeTagStart: number;
    closeTagEnd: number;
    openTag?: string;
    annotationId: string | null;
    partId: string | null;
    partIndex: number | null;
    partTotal: number | null;
    identityMode: IdentityMode;
    integrity: Integrity;
    /** Source-safe marks comprising one passage; present only on logical entries. */
    members?: Highlight[];
    tagsText: string;
    tagsStart: number | null;
    tagsEnd: number | null;
    footnoteId: string | null;
    footnoteStart: number | null;
    footnoteEnd: number | null;
    footnotePlacement: FootnotePlacement | null;
    annotation: string;
}

export interface Footnote {
    id: string;
    text: string;
    line: number;
    start: number;
    end: number;
}

export interface ParsedHighlights {
    highlights: Highlight[];
    footnotes: Map<string, Footnote>;
}

interface StyleAttr {
    quote: string;
    value: string;
    index: number;
    length: number;
}

interface TagsRange {
    tagsText: string;
    tagsStart: number | null;
    tagsEnd: number | null;
}

interface FootnoteInfo {
    id: string;
    start: number;
    end: number;
    placement: FootnotePlacement;
}

interface Deletion {
    start: number;
    end: number;
}

function escapeRegex(text: string): string {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectNewline(raw: string): string {
    return raw.includes("\r\n") ? "\r\n" : "\n";
}

function extractStyleAttribute(openTag: string): StyleAttr | null {
    const styleMatch = openTag.match(/\sstyle=(["'])([\s\S]*?)\1/i);
    if (!styleMatch) return null;
    return {
        quote: styleMatch[1],
        value: styleMatch[2],
        index: styleMatch.index ?? -1,
        length: styleMatch[0].length,
    };
}

function extractBackgroundFromStyle(styleValue: string | null | undefined): string | null {
    if (!styleValue) return null;
    const parts = styleValue
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
    for (const part of parts) {
        const colon = part.indexOf(":");
        if (colon === -1) continue;
        const key = part.slice(0, colon).trim().toLowerCase();
        const value = part.slice(colon + 1).trim();
        if (key === "background" || key === "background-color") {
            return value || null;
        }
    }
    return null;
}

function extractAttribute(openTag: string, attributeName: string): string | null {
    const pattern = new RegExp(`\\s${escapeRegex(attributeName)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i");
    const match = openTag.match(pattern);
    const value = match?.[2]?.trim();
    return value || null;
}

/** Read identity attributes at tag level, never from text inside another attribute. */
function identityAttribute(openTag: string, attributeName: string): { value: string | null; duplicate: boolean } {
    const attributes = new Map<string, string[]>();
    let index = /^<mark\b/i.exec(openTag)?.[0].length ?? 0;
    while (index < openTag.length) {
        while (/\s/.test(openTag[index] ?? "")) index++;
        if (openTag[index] === ">" || openTag[index] === "/" || index >= openTag.length) break;
        const name = /^[^\s=/>]+/.exec(openTag.slice(index))?.[0];
        if (!name) {
            index++;
            continue;
        }
        index += name.length;
        while (/\s/.test(openTag[index] ?? "")) index++;
        if (openTag[index] !== "=") continue;
        index++;
        while (/\s/.test(openTag[index] ?? "")) index++;
        const quote = openTag[index];
        if (quote !== '"' && quote !== "'") {
            while (index < openTag.length && !/[\s>]/.test(openTag[index])) index++;
            continue;
        }
        const start = ++index;
        while (index < openTag.length && openTag[index] !== quote) index++;
        const value = openTag.slice(start, index).trim();
        if (index < openTag.length) index++;
        const key = name.toLowerCase();
        attributes.set(key, [...(attributes.get(key) ?? []), value]);
    }
    const values = attributes.get(attributeName.toLowerCase()) ?? [];
    return { value: values[0] || null, duplicate: values.length > 1 };
}

function normalizeTagsText(tagsText: string): string {
    const tokens = String(tagsText || "")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
    const cleaned = tokens
        .map((token) => token.replace(/^#/, ""))
        .filter(Boolean)
        .map((token) => `#${token}`);
    return cleaned.join(" ");
}

/** Hide Markdown code and comments without moving any source offsets. */
export function visibleSource(raw: string): string {
    // UTF-16 units match JavaScript string offsets, including after emoji.
    const hidden = raw.split("");
    const hide = (start: number, end: number) => {
        for (let i = start; i < end; i++) if (raw[i] !== "\n" && raw[i] !== "\r") hidden[i] = " ";
    };
    const lines = raw.split(/\n/);
    let offset = 0;
    let fence: { marker: string; length: number } | null = null;
    let previousBlank = true;
    let indentedCode = false;
    for (const line of lines) {
        const content = line.replace(/\r$/, "");
        const prefix = content.match(/^(?: {0,3}> ?)* {0,3}(?:[-+*] |\d+[.)] )?/u)?.[0] ?? "";
        const rest = content.slice(prefix.length);
        const opening = rest.match(/^(`{3,}|~{3,})(.*)$/);
        if (fence) {
            hide(offset, offset + content.length);
            if (new RegExp(`^${fence.marker}{${fence.length},}\\s*$`).test(rest)) fence = null;
        } else if (opening && (opening[1][0] === "~" || !opening[2].includes("`"))) {
            fence = { marker: opening[1][0], length: opening[1].length };
            hide(offset, offset + content.length);
        } else if (
            (previousBlank || indentedCode) &&
            /^(?: {4,}|\t)\S/.test(content) &&
            !/^\s*(?:[-+*] |\d+[.)] )/.test(content)
        ) {
            hide(offset, offset + content.length);
            indentedCode = true;
        } else if (content.trim()) {
            indentedCode = false;
        }
        previousBlank = !content.trim();
        offset += line.length + 1;
    }

    // Mask comments, escaped syntax and HTML code blocks first.
    const codeOpen = /<(pre|code)\b(?:[^>"']|"[^"]*"|'[^']*')*>/giy;
    for (let i = 0; i < raw.length; i++) {
        if (hidden[i] === " " && raw[i] !== " ") continue;
        if (raw[i] === "\\") {
            if (i + 1 < raw.length && /[\\`<>=[]/.test(raw[i + 1])) hide(i, i + 2);
            i++;
            continue;
        }
        if (raw.startsWith("<!--", i)) {
            const end = raw.indexOf("-->", i + 4);
            hide(i, end < 0 ? raw.length : end + 3);
            i = end < 0 ? raw.length : end + 2;
            continue;
        }
        if (raw[i] === "<") codeOpen.lastIndex = i;
        const codeTag = raw[i] === "<" ? codeOpen.exec(raw) : null;
        if (codeTag) {
            const closer = new RegExp(`</${codeTag[1]}\\s*>`, "ig");
            closer.lastIndex = i + codeTag[0].length;
            const end = closer.exec(raw)?.[0].length;
            const closeAt = closer.lastIndex;
            hide(i, end ? closeAt : raw.length);
            i = (end ? closeAt : raw.length) - 1;
            continue;
        }
    }

    // Index runs once. Repeated unmatched backticks must not cause repeated
    // scans of the rest of a long note.
    const runs = Array.from(raw.matchAll(/`+/g)).filter((match) => hidden[match.index] === "`");
    const byLength = new Map<number, number[]>();
    for (const run of runs) {
        const length = run[0].length;
        const positions = byLength.get(length) ?? [];
        positions.push(run.index);
        byLength.set(length, positions);
    }
    for (const run of runs) {
        if (hidden[run.index] !== "`") continue;
        const positions = byLength.get(run[0].length) ?? [];
        let low = 0;
        let high = positions.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (positions[mid] <= run.index) low = mid + 1;
            else high = mid;
        }
        if (low < positions.length) hide(run.index, positions[low] + run[0].length);
    }
    return hidden.join("");
}

function sourceLineAt(lineStarts: number[], offset: number): number {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
        const middle = (low + high) >>> 1;
        if (lineStarts[middle] <= offset) low = middle;
        else high = middle;
    }
    return low;
}

export function parseFootnotes(raw: string): Map<string, Footnote> {
    const newline = detectNewline(raw);
    const lines = raw.split(/\r?\n/);
    const visibleLines = visibleSource(raw).split(/\r?\n/);
    const results = new Map<string, Footnote>();
    let offset = 0;
    let active: Footnote | null = null;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        const match = visibleLines[lineIdx].match(/^\s{0,3}\[\^([^\]]+)\]:\s*/);
        if (match) {
            if (results.has(match[1])) {
                active = null;
            } else {
                active = {
                    id: match[1],
                    text: line.slice(match[0].length),
                    line: lineIdx,
                    start: offset,
                    end: offset + line.length,
                };
                results.set(match[1], active);
            }
        } else if (active && /^(?: {4}|\t)\S/.test(line)) {
            active.text += `\n${line.replace(/^(?: {4}|\t)/, "")}`;
            active.end = offset + line.length;
        } else {
            active = null;
        }
        offset += line.length + (lineIdx < lines.length - 1 ? newline.length : 0);
    }

    return results;
}

export function parseHighlights(raw: string): ParsedHighlights {
    const newline = detectNewline(raw);
    const footnotes = parseFootnotes(raw);
    const highlights: Highlight[] = [];
    const visible = visibleSource(raw);
    const htmlTags = /<\/?[A-Za-z][\w:-]*(?:[^>"']|"[^"]*"|'[^']*')*>/g;
    const withoutOtherTags = visible.replace(htmlTags, (tag) =>
        /^<\/?mark\b/i.test(tag) ? tag : tag.replace(/[^\r\n]/g, " ")
    );
    const markdownSource = withoutOtherTags.replace(htmlTags, (tag) => tag.replace(/[^\r\n]/g, " "));

    const lines = raw.split(/\r?\n/);
    const visibleLines = markdownSource.split(/\r?\n/);
    const lineStarts: number[] = [];
    let lineOffset = 0;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        lineStarts.push(lineOffset);

        // An opener must touch content; a dangling closer from an escaped
        // example must not consume a later real highlight on the same line.
        const markdownPattern = /==(?=\S)(.*?)==/g;

        let match: RegExpExecArray | null;
        while ((match = markdownPattern.exec(visibleLines[lineIdx])) !== null) {
            const start = lineOffset + match.index;
            const end = start + match[0].length;
            const innerStart = start + 2;
            const innerEnd = end - 2;
            const innerText = raw.slice(innerStart, innerEnd);

            const { tagsText, tagsStart, tagsEnd } = extractLeadingTagsRange(line, lineOffset, match.index);
            const footnote = detectFootnoteForHighlight({
                line,
                lineOffset,
                wrapperEndInLine: match.index + match[0].length,
                innerText,
                innerStart,
            });

            highlights.push({
                id: `legacy:markdown:${start}`,
                text: innerText.trim(),
                line: lineIdx,
                type: "markdown",
                notationType: "highlight",
                opacity: null,
                color: null,
                annotationId: null,
                partId: null,
                partIndex: null,
                partTotal: null,
                identityMode: "tracked-legacy",
                integrity: "resolved",
                start,
                end,
                innerStart,
                innerEnd,
                openTagStart: start,
                openTagEnd: innerStart,
                closeTagStart: innerEnd,
                closeTagEnd: end,
                tagsText,
                tagsStart,
                tagsEnd,
                footnoteId: footnote?.id ?? null,
                footnoteStart: footnote?.start ?? null,
                footnoteEnd: footnote?.end ?? null,
                footnotePlacement: footnote?.placement ?? null,
                annotation: footnote?.id ? (footnotes.get(footnote.id)?.text ?? "") : "",
            });
        }

        lineOffset += line.length + (lineIdx < lines.length - 1 ? newline.length : 0);
    }

    // HTML marks can cross source lines. Match tag boundaries in the masked
    // source, retaining exact offsets and original content for safe edits.
    const tagPattern = /<\/?mark\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    let opening: { start: number; end: number; nested: boolean } | null = null;
    let depth = 0;
    let tag: RegExpExecArray | null;
    while ((tag = tagPattern.exec(withoutOtherTags)) !== null) {
        const closing = /^<\//.test(tag[0]);
        if (!closing) {
            if (depth === 0) opening = { start: tag.index, end: tagPattern.lastIndex, nested: false };
            else if (opening) opening.nested = true;
            depth++;
            continue;
        }
        if (depth === 0) continue;
        depth--;
        if (depth !== 0 || !opening) continue;
        const { start, end: openTagEnd, nested } = opening;
        opening = null;
        if (nested) continue; // Nested marks are invalid HTML; never rewrite them speculatively.

        const end = tagPattern.lastIndex;
        const innerStart = openTagEnd;
        const innerEnd = tag.index;
        const innerText = raw.slice(innerStart, innerEnd);
        const openTag = raw.slice(start, openTagEnd);
        const lineIdx = sourceLineAt(lineStarts, start);
        const line = lines[lineIdx];
        const lineOffset = lineStarts[lineIdx];
        const closingLineIdx = sourceLineAt(lineStarts, end);
        const closingLine = lines[closingLineIdx];
        const styleAttr = extractStyleAttribute(openTag);
        const styleColor = styleAttr ? extractBackgroundFromStyle(styleAttr.value) : null;
        const color = extractAttribute(openTag, "data-fp-color") ?? styleColor;
        const { tagsText, tagsStart, tagsEnd } = extractLeadingTagsRange(line, lineOffset, start - lineOffset);
        const footnote = detectFootnoteForHighlight({
            line: closingLine,
            lineOffset: lineStarts[closingLineIdx],
            wrapperEndInLine: end - lineStarts[closingLineIdx],
            innerText,
            innerStart,
        });
        const idAttribute = identityAttribute(openTag, "data-fp-id");
        const partAttribute = identityAttribute(openTag, "data-fp-part");
        const rawId = idAttribute.value;
        const metadataConflict = idAttribute.duplicate || partAttribute.duplicate;
        const annotationId = !idAttribute.duplicate && rawId && isAnnotationId(rawId) ? rawId : null;
        const partId = partAttribute.value;
        const part = partId?.match(/^([1-9]\d*)\/([1-9]\d*)$/);
        const partIndex = part ? Number(part[1]) : null;
        const partTotal = part ? Number(part[2]) : null;
        const validPart = partIndex !== null && partTotal !== null && partIndex <= partTotal;
        highlights.push({
            id: annotationId ?? `legacy:html:${start}`,
            text: innerText.trim(),
            line: lineIdx,
            type: "html",
            notationType: normalizeNotationType(extractAttribute(openTag, "data-fp-notation")),
            opacity: normalizeOpacity(extractAttribute(openTag, "data-fp-opacity")),
            color: color ? color.trim() : null,
            annotationId,
            partId,
            partIndex: validPart ? partIndex : null,
            partTotal: validPart ? partTotal : null,
            identityMode: annotationId ? "managed" : "tracked-legacy",
            integrity: metadataConflict
                ? "ambiguous"
                : annotationId
                  ? validPart
                      ? "resolved"
                      : "degraded"
                  : rawId || partId
                    ? "degraded"
                    : "resolved",
            start,
            end,
            innerStart,
            innerEnd,
            openTagStart: start,
            openTagEnd,
            closeTagStart: innerEnd,
            closeTagEnd: end,
            openTag,
            tagsText,
            tagsStart,
            tagsEnd,
            footnoteId: footnote?.id ?? null,
            footnoteStart: footnote?.start ?? null,
            footnoteEnd: footnote?.end ?? null,
            footnotePlacement: footnote?.placement ?? null,
            annotation: footnote?.id ? (footnotes.get(footnote.id)?.text ?? "") : "",
        });
    }

    highlights.sort((a, b) => a.start - b.start);
    return { highlights, footnotes };
}

function extractLeadingTagsRange(line: string, lineOffset: number, wrapperStartInLine: number): TagsRange {
    if (wrapperStartInLine <= 0) return { tagsText: "", tagsStart: null, tagsEnd: null };
    const before = line.slice(0, wrapperStartInLine);

    const tagsRegex = /(?:^|\s)(#[^\s#]+(?:\s+#[^\s#]+)*)\s*$/u;
    const match = tagsRegex.exec(before);
    if (!match) return { tagsText: "", tagsStart: null, tagsEnd: null };

    const fullMatch = match[0];
    const group = match[1];
    if (!group) return { tagsText: "", tagsStart: null, tagsEnd: null };

    const groupOffsetInFull = fullMatch.lastIndexOf(group);
    if (groupOffsetInFull < 0) return { tagsText: "", tagsStart: null, tagsEnd: null };

    const groupStartInBefore = (match.index ?? 0) + groupOffsetInFull;
    const groupEndInBefore = groupStartInBefore + group.length;

    const trailingWhitespace = before.slice(groupEndInBefore);
    const endsWithSpace = /\s/.test(trailingWhitespace.slice(-1) || "");
    const tagsEndInLine = endsWithSpace ? before.length : groupEndInBefore;

    return {
        tagsText: group.trim(),
        tagsStart: lineOffset + groupStartInBefore,
        tagsEnd: lineOffset + tagsEndInLine,
    };
}

function detectFootnoteForHighlight({
    line,
    lineOffset,
    wrapperEndInLine,
    innerText,
    innerStart,
}: {
    line: string;
    lineOffset: number;
    wrapperEndInLine: number;
    innerText: string;
    innerStart: number;
}): FootnoteInfo | null {
    const after = line.slice(wrapperEndInLine);
    const afterMatch = after.match(/^\[\^([^\]]+)\]/);
    if (afterMatch) {
        return {
            id: afterMatch[1],
            start: lineOffset + wrapperEndInLine,
            end: lineOffset + wrapperEndInLine + afterMatch[0].length,
            placement: "after",
        };
    }

    const innerMatch = String(innerText ?? "").match(/\[\^([^\]]+)\]\s*$/);
    if (!innerMatch) return null;

    const id = innerMatch[1];
    const needle = `[^${id}]`;
    const idx = String(innerText ?? "").lastIndexOf(needle);
    if (idx === -1) return null;

    return {
        id,
        start: innerStart + idx,
        end: innerStart + idx + needle.length,
        placement: "inside",
    };
}

export function findHighlightById(parsed: ParsedHighlights, id: string): Highlight | null {
    return logicalHighlights(parsed.highlights).find((h) => h.id === id) || null;
}

/** The Markdown adapter projects physical wrappers into logical annotations. */
export function logicalHighlights(highlights: Highlight[]): Highlight[] {
    const byId = new Map<string, Highlight[]>();
    for (const mark of highlights) {
        if (!mark.annotationId) continue;
        const parts = byId.get(mark.annotationId) ?? [];
        parts.push(mark);
        byId.set(mark.annotationId, parts);
    }
    const seen = new Set<string>();
    return highlights.flatMap((mark) => {
        if (!mark.annotationId) return [mark];
        if (seen.has(mark.annotationId)) return [];
        seen.add(mark.annotationId);
        const members = (byId.get(mark.annotationId) ?? [mark]).sort(
            (a, b) =>
                (a.partIndex ?? Number.MAX_SAFE_INTEGER) - (b.partIndex ?? Number.MAX_SAFE_INTEGER) || a.start - b.start
        );
        const totals = new Set(members.map((part) => part.partTotal));
        const ordinals = members.map((part) => part.partIndex);
        const duplicate =
            ordinals.some((ordinal, index) => ordinal !== null && ordinals.indexOf(ordinal) !== index) ||
            (members.length > 1 && ordinals.some((ordinal) => ordinal === null));
        const total = members[0].partTotal;
        const missing = total !== null && members.length < total;
        const integrity: Integrity =
            duplicate ||
            totals.size > 1 ||
            members.length > (total ?? Infinity) ||
            members.some((part) => part.integrity === "ambiguous")
                ? "ambiguous"
                : missing || members.some((part) => part.integrity === "degraded")
                  ? "degraded"
                  : "resolved";
        const attachedFootnote = members.find((part) => part.footnoteId);
        return [
            {
                ...members[0],
                text: members.map((part) => part.text).join("\n"),
                color: members.every((part) => part.color === members[0].color) ? members[0].color : null,
                end: Math.max(...members.map((part) => part.end)),
                integrity,
                footnoteId: attachedFootnote?.footnoteId ?? null,
                footnoteStart: attachedFootnote?.footnoteStart ?? null,
                footnoteEnd: attachedFootnote?.footnoteEnd ?? null,
                footnotePlacement: attachedFootnote?.footnotePlacement ?? null,
                annotation: attachedFootnote?.annotation ?? "",
                members,
            },
        ];
    });
}

/** Unwrap every physical fragment of one logical annotation. */
export function removeLogicalHighlightFromRaw(raw: string, highlight: Highlight | null): string {
    if (!highlight) return raw;
    if (highlight.integrity === "ambiguous") throw new Error("Annotation identity is ambiguous; no source changed.");
    const members = highlight.annotationId
        ? parseHighlights(raw).highlights.filter((member) => member.annotationId === highlight.annotationId)
        : [highlight];
    return members
        .sort((a, b) => b.start - a.start)
        .reduce((content, member) => {
            return removeHighlightFromRaw(content, member);
        }, raw);
}

export function removeHighlightFromRaw(raw: string, highlight: Highlight | null): string {
    if (!highlight) return raw;
    const before = raw.slice(0, highlight.openTagStart);
    const inner = raw.slice(highlight.innerStart, highlight.innerEnd);
    const after = raw.slice(highlight.closeTagEnd);
    return before + inner + after;
}

export function updateHighlightTagsInRaw(raw: string, highlight: Highlight | null, newTagsText: string): string {
    if (!highlight) return raw;
    const normalized = normalizeTagsText(newTagsText);
    const replacement = normalized ? `${normalized} ` : "";

    if (highlight.tagsStart !== null && highlight.tagsEnd !== null) {
        return raw.slice(0, highlight.tagsStart) + replacement + raw.slice(highlight.tagsEnd);
    }

    // No existing tags: insert before wrapper start.
    if (!replacement) return raw;
    return raw.slice(0, highlight.openTagStart) + replacement + raw.slice(highlight.openTagStart);
}

function buildUpdatedOpenTag(openTag: string, newColor: string): string {
    const styleAttr = extractStyleAttribute(openTag);
    if (!styleAttr) {
        return openTag.replace(/^<mark\b/i, `<mark style="background: ${newColor}; color: black;"`);
    }

    const styleValue = styleAttr.value;
    const decls = styleValue
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean);
    const updated: string[] = [];
    let replaced = false;

    for (const decl of decls) {
        const colon = decl.indexOf(":");
        if (colon === -1) {
            updated.push(decl);
            continue;
        }
        const key = decl.slice(0, colon).trim();
        const value = decl.slice(colon + 1).trim();
        const keyLc = key.toLowerCase();
        if (keyLc === "background" || keyLc === "background-color") {
            updated.push(`${key}: ${newColor}`);
            replaced = true;
        } else {
            updated.push(`${key}: ${value}`);
        }
    }

    if (!replaced) {
        updated.unshift(`background: ${newColor}`);
    }

    const newStyleValue = updated.join("; ") + (updated.length ? ";" : "");
    const quoted = `${styleAttr.quote}${newStyleValue}${styleAttr.quote}`;

    return openTag.replace(/\sstyle=(["'])([\s\S]*?)\1/i, ` style=${quoted}`);
}

export function updateHighlightColorInRaw(raw: string, highlight: Highlight | null, newColor: string): string {
    if (!highlight) return raw;
    if (!newColor) return raw;

    if (highlight.type === "html") {
        const openTag = raw.slice(highlight.openTagStart, highlight.openTagEnd);
        const updatedOpenTag = /\sdata-fp-color\s*=/i.test(openTag)
            ? openTag.replace(
                  /(\sdata-fp-color\s*=\s*["'])[^"']*(["'])/i,
                  (_match, before: string, after: string) =>
                      `${before}${newColor.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}${after}`
              )
            : buildUpdatedOpenTag(openTag, newColor);
        const finalOpenTag = /\sstyle\s*=/i.test(updatedOpenTag)
            ? buildUpdatedOpenTag(updatedOpenTag, newColor)
            : updatedOpenTag;
        return raw.slice(0, highlight.openTagStart) + finalOpenTag + raw.slice(highlight.openTagEnd);
    }

    // Markdown highlight -> convert to HTML mark
    const inner = raw.slice(highlight.innerStart, highlight.innerEnd);
    const replacement = `<mark style="background: ${newColor}; color: black;">${inner}</mark>`;
    return raw.slice(0, highlight.openTagStart) + replacement + raw.slice(highlight.closeTagEnd);
}

function nextManagedFootnoteId(raw: string): string {
    let id = createAnnotationId();
    while (raw.includes(`[^${id}]`)) id = createAnnotationId();
    return id;
}

function countFootnoteRefs(raw: string, footnoteId: string): number {
    const re = new RegExp(`\\[\\^${escapeRegex(footnoteId)}\\](?!:)`, "g");
    const matches = visibleSource(raw).match(re);
    return matches ? matches.length : 0;
}

function countFootnoteDefinitions(raw: string, footnoteId: string): number {
    return visibleSource(raw)
        .split(/\r?\n/)
        .filter((line) => new RegExp(`^\\s{0,3}\\[\\^${escapeRegex(footnoteId)}\\]:`).test(line)).length;
}

function formatFootnoteDefinition(id: string, annotation: string, newline: string): string {
    return `[^${id}]: ${annotation.replace(/\r?\n/g, `${newline}    `)}`;
}

export function updateHighlightAnnotationInRaw(
    raw: string,
    highlight: Highlight | null,
    newAnnotationText: string
): string {
    if (!highlight) return raw;
    const annotation = String(newAnnotationText ?? "").trim();
    const newline = detectNewline(raw);
    const parsed = parseFootnotes(raw);

    const existingId = highlight.footnoteId;
    if (existingId && countFootnoteDefinitions(raw, existingId) > 1) {
        throw new Error("Duplicate footnote definitions; no source changed.");
    }
    const existingRefStart = highlight.footnoteStart;
    const existingRefEnd = highlight.footnoteEnd;

    if (!annotation) {
        // Remove annotation reference, and remove its definition if orphaned.
        let updatedRaw = raw;
        if (existingId && existingRefStart !== null && existingRefEnd !== null) {
            updatedRaw = updatedRaw.slice(0, existingRefStart) + updatedRaw.slice(existingRefEnd);
        }
        if (existingId) {
            const refCount = countFootnoteRefs(updatedRaw, existingId);
            if (refCount === 0) {
                const def = parsed.get(existingId);
                if (def) {
                    let defStart = def.start;
                    let defEnd = def.end;
                    // Remove a single trailing newline if present.
                    if (updatedRaw.slice(defEnd, defEnd + newline.length) === newline) {
                        defEnd += newline.length;
                    }
                    // If there is an extra blank line before definition, remove one.
                    if (
                        defStart >= newline.length * 2 &&
                        updatedRaw.slice(defStart - newline.length * 2, defStart) === newline + newline
                    ) {
                        defStart -= newline.length;
                    }
                    updatedRaw = updatedRaw.slice(0, defStart) + updatedRaw.slice(defEnd);
                }
            }
        }
        return updatedRaw;
    }

    // Ensure reference exists.
    let updatedRaw = raw;
    let footnoteId = existingId;
    void existingRefStart;
    void existingRefEnd;

    if (!footnoteId) {
        footnoteId = nextManagedFootnoteId(updatedRaw);
        const footnoteRef = `[^${footnoteId}]`;

        // Insert at end of the highlighted range (inside the wrapper, to match current behavior).
        const insertAt = highlight.innerEnd;
        updatedRaw = updatedRaw.slice(0, insertAt) + footnoteRef + updatedRaw.slice(insertAt);
    }

    // Update or insert definition
    const def = parsed.get(footnoteId);
    if (def) {
        const newLine = formatFootnoteDefinition(footnoteId, annotation, newline);
        updatedRaw = updatedRaw.slice(0, def.start) + newLine + updatedRaw.slice(def.end);
        return updatedRaw;
    }

    // Append definition to end, preserving existing trim behavior.
    const defText = `${newline}${newline}${formatFootnoteDefinition(footnoteId, annotation, newline)}${newline}`;
    updatedRaw = updatedRaw.trimEnd() + defText;
    return updatedRaw;
}

/**
 * Remove a footnote-style annotation entirely: every inline reference `[^id]`
 * in the body plus its `[^id]: ...` definition line. This is the counterpart to
 * removing a highlight, but for standalone annotations that are not attached to
 * a `==`/`<mark>` wrapper (those created via "Add annotation to selection").
 */
export function removeFootnoteFromRaw(raw: string, footnoteId: string): { raw: string; changed: boolean } {
    let updated = String(raw ?? "");
    const id = String(footnoteId ?? "").trim();
    if (!id) return { raw: updated, changed: false };
    if (countFootnoteDefinitions(updated, id) > 1) {
        throw new Error("Duplicate footnote definitions; no source changed.");
    }

    const newline = detectNewline(updated);
    let changed = false;

    // 1. Remove inline references `[^id]` (but never the definition's `[^id]:` token).
    const refRe = new RegExp(`\\[\\^${escapeRegex(id)}\\](?!:)`, "g");
    const refs = [...visibleSource(updated).matchAll(refRe)].map((match) => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
    if (refs.length) {
        updated = applyDeletions(updated, refs);
        changed = true;
    }

    // 2. Remove the definition line `[^id]: ...` (re-parse: ref removal shifted offsets).
    const def = parseFootnotes(updated).get(id);
    if (def) {
        let defStart = def.start;
        let defEnd = def.end;
        // Consume the definition's trailing newline.
        if (updated.slice(defEnd, defEnd + newline.length) === newline) {
            defEnd += newline.length;
        }
        // Collapse a preceding blank line if one was separating the definition.
        if (
            defStart >= newline.length * 2 &&
            updated.slice(defStart - newline.length * 2, defStart) === newline + newline
        ) {
            defStart -= newline.length;
        }
        updated = updated.slice(0, defStart) + updated.slice(defEnd);
        changed = true;
    }

    return { raw: updated, changed };
}

/**
 * Remove every footnote annotation in the note (references + definitions).
 * Returns the rewritten raw text and how many distinct footnotes were removed.
 */
export function removeAllFootnotesFromRaw(raw: string): { raw: string; removedCount: number } {
    let updated = String(raw ?? "");
    const ids = [...parseFootnotes(updated).keys()];
    let removedCount = 0;

    for (const id of ids) {
        const result = removeFootnoteFromRaw(updated, id);
        if (result.changed) {
            removedCount++;
            updated = result.raw;
        }
    }

    return { raw: updated, removedCount };
}

function applyDeletions(raw: string, deletions: Deletion[]): string {
    const ranges = (deletions || [])
        .filter((r) => r && Number.isInteger(r.start) && Number.isInteger(r.end) && r.end > r.start)
        .sort((a, b) => b.start - a.start);

    let updated = raw;
    for (const range of ranges) {
        updated = updated.slice(0, range.start) + updated.slice(range.end);
    }
    return updated;
}

export function mergeAdjacentHighlightsInRaw(raw: string): { raw: string; mergedCount: number } {
    let updated = String(raw ?? "");
    let mergedCount = 0;
    let passes = 0;

    while (passes < 250) {
        passes++;
        const parsed = parseHighlights(updated);
        const highlights = parsed.highlights;
        const deletions: Deletion[] = [];
        let mergedThisPass = 0;

        for (let i = 0; i < highlights.length - 1; i++) {
            const a = highlights[i];
            const b = highlights[i + 1];

            if (a.line !== b.line) continue;
            if (a.type !== b.type) continue;
            if (a.annotationId || b.annotationId) continue;
            if ((a.tagsText || "").trim() || (b.tagsText || "").trim()) continue;
            if (a.footnoteId || b.footnoteId) continue;

            const between = updated.slice(a.closeTagEnd, b.openTagStart);
            if (!/^\s*$/.test(between)) continue;

            if (a.type === "html") {
                const aOpen = updated.slice(a.openTagStart, a.openTagEnd);
                const bOpen = updated.slice(b.openTagStart, b.openTagEnd);
                if (aOpen !== bOpen) continue;
            }

            deletions.push({ start: a.closeTagStart, end: a.closeTagEnd });
            deletions.push({ start: b.openTagStart, end: b.openTagEnd });
            mergedThisPass++;
            i++; // skip b - it is merged into a
        }

        if (mergedThisPass === 0) break;
        updated = applyDeletions(updated, deletions);
        mergedCount += mergedThisPass;
    }

    return { raw: updated, mergedCount };
}

export function recolorMarkHighlightsInRaw(
    raw: string,
    { fromColor = "", toColor = "" }: { fromColor?: string; toColor?: string } = {}
): { raw: string; changedCount: number } {
    let updated = String(raw ?? "");
    const targetColor = String(toColor || "").trim();
    if (!targetColor) {
        return { raw: updated, changedCount: 0 };
    }

    const from = String(fromColor || "")
        .trim()
        .toLowerCase();
    const parsed = parseHighlights(updated);
    const candidates = parsed.highlights
        .filter((h) => h.type === "html")
        .filter((h) => {
            if (!from) return true;
            return (
                String(h.color || "")
                    .trim()
                    .toLowerCase() === from
            );
        })
        .sort((a, b) => b.openTagStart - a.openTagStart);

    let changedCount = 0;
    for (const highlight of candidates) {
        const before = updated;
        updated = updateHighlightColorInRaw(updated, highlight, targetColor);
        if (updated !== before) changedCount++;
    }

    return { raw: updated, changedCount };
}

export function migrateSpanHighlightsInRaw(raw: string): { raw: string; changedCount: number } {
    const visible = visibleSource(raw);
    // Consume complete tags so examples embedded in attributes cannot become targets.
    const tags = /<\/?[a-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi;
    const stack: { start: number; end: number; nested: boolean }[] = [];
    const edits: { start: number; end: number; text: string }[] = [];
    let tag: RegExpExecArray | null;
    while ((tag = tags.exec(visible))) {
        if (!/^<\/?span\b/i.test(tag[0])) continue;
        if (!/^<\//.test(tag[0])) {
            for (const entry of stack) entry.nested = true;
            stack.push({ start: tag.index, end: tags.lastIndex, nested: stack.length > 0 });
        } else {
            const opening = stack.pop();
            if (!opening || opening.nested) continue;
            const original = raw.slice(opening.start, opening.end);
            const style = extractStyleAttribute(original);
            if (!style || !extractBackgroundFromStyle(style.value)) continue;
            edits.push({ start: opening.start, end: opening.end, text: original.replace(/^<span/i, "<mark") });
            edits.push({
                start: tag.index,
                end: tags.lastIndex,
                text: raw.slice(tag.index, tags.lastIndex).replace(/^<\/span/i, "</mark"),
            });
        }
    }
    let updated = raw;
    for (const edit of edits.sort((a, b) => b.start - a.start))
        updated = updated.slice(0, edit.start) + edit.text + updated.slice(edit.end);
    return { raw: updated, changedCount: edits.length / 2 };
}
