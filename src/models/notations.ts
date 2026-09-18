export const NOTATION_TYPES = ["highlight", "underline", "box", "circle", "strike-through", "crossed-off"] as const;

export type NotationType = (typeof NOTATION_TYPES)[number];

export interface NotationSpec {
    notationType: NotationType;
    color: string | null;
}

export const DEFAULT_NOTATION_TYPE: NotationType = "highlight";

export function isNotationType(value: string): value is NotationType {
    return (NOTATION_TYPES as readonly string[]).includes(value);
}

export function normalizeNotationType(value: string | null | undefined): NotationType {
    const normalized = String(value ?? "")
        .trim()
        .toLowerCase();

    return isNotationType(normalized) ? normalized : DEFAULT_NOTATION_TYPE;
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function createNotationOpenTag(spec: NotationSpec, groupId: string | null = null): string {
    const attributes = [`data-fp-notation="${spec.notationType}"`];

    const color = spec.color?.trim();
    const group = groupId?.trim();

    if (color) {
        attributes.push(`data-fp-color="${escapeAttribute(color)}"`);
    }

    if (group) {
        attributes.push(`data-fp-group="${escapeAttribute(group)}"`);
    }

    return `<mark ${attributes.join(" ")}>`;
}
