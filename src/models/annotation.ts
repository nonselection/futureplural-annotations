/** Shared identities are opaque; source locators are deliberately separate. */
export type AnnotationId = string & { readonly __annotationId: unique symbol };
export type SourceRecordId = string & { readonly __sourceRecordId: unique symbol };
export type IdentityMode = "managed" | "tracked-legacy";
export type Integrity = "resolved" | "degraded" | "ambiguous" | "missing";

export interface SourceReference {
    sourceRecordId: SourceRecordId;
    locator: { path: string };
}

export interface MarkdownPartAnchor {
    partId: string;
    order: number;
    start: number;
    end: number;
}

export interface MarkdownAnchor {
    sourceType: "markdown";
    parts: MarkdownPartAnchor[];
}

/** A future PDF adapter can preserve page order without changing AnnotationId. */
export interface PdfAnchor {
    sourceType: "pdf";
    segments: { page: number; order: number; locator: string }[];
}

export type SourceAnchor = MarkdownAnchor | PdfAnchor;

/** Materialized only after a canonical source registry supplies SourceRecordId. */
export interface LogicalAnnotation {
    id: AnnotationId;
    source: SourceReference;
    anchor: SourceAnchor;
    kind: "mark" | "footnote";
    identityMode: IdentityMode;
    integrity: Integrity;
    notationType?: string;
    displayColor?: string | null;
}

export interface SourceObservation<TAnchor extends SourceAnchor = SourceAnchor> {
    /** Present only when source markup itself carries validated durable identity. */
    managedId: AnnotationId | null;
    /** Temporary read-session locator, never a canonical AnnotationId. */
    observationKey: string;
    identityMode: IdentityMode;
    integrity: Integrity;
    anchor: TAnchor;
}

export interface SourceAdapter<TAnchor extends SourceAnchor, TObservation extends SourceObservation<TAnchor>> {
    readonly sourceType: TAnchor["sourceType"];
    observe(raw: string): TObservation[];
}

export function createAnnotationId(): AnnotationId {
    return `fp-${crypto.randomUUID()}` as AnnotationId;
}

export function isAnnotationId(value: string): value is AnnotationId {
    return /^fp-[A-Za-z0-9-]{8,124}$/.test(value);
}
