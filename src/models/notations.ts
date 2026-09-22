// Block-level brackets are intentionally not another inline notation type.
// They need block-range storage, rendering and cleanup as one tested feature;
// see docs/PRODUCT_DECISIONS_AND_BACKLOG.md.
export const NOTATION_TYPES = ["highlight", "underline", "box", "circle", "strike-through", "crossed-off"] as const;

export type NotationType = (typeof NOTATION_TYPES)[number];

export interface NotationSpec {
    notationType: NotationType;
    color: string | null;
    opacity?: number | null;
}

export const DEFAULT_NOTATION_OPACITY: Record<NotationType, number> = {
    highlight: 0.6,
    underline: 0.8,
    box: 0.68,
    circle: 0.68,
    "strike-through": 0.76,
    "crossed-off": 0.72,
};

export function normalizeOpacity(value: unknown): number | null {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : null;
}

export const DEFAULT_NOTATION_TYPE: NotationType = "highlight";

export function createNotationGroupId(): string {
    return `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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

    if (color) attributes.push(`data-fp-color="${escapeAttribute(color)}"`);
    const opacity = normalizeOpacity(spec.opacity);
    if (opacity !== null) attributes.push(`data-fp-opacity="${opacity}"`);
    if (group) attributes.push(`data-fp-group="${escapeAttribute(group)}"`);

    return `<mark ${attributes.join(" ")}>`;
}
