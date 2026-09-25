import type { AnnotationId, IdentityMode, Integrity, MarkdownAnchor, SourceRecordId } from "./annotation";
import { isNotationType, type NotationType } from "./notations";

/** These IDs live in different domains even if their documents share storage later. */
export type PaletteSlotId = string & { readonly __paletteSlotId: unique symbol };
export type SemanticConceptId = string & { readonly __semanticConceptId: unique symbol };

export interface SourceRecord {
    id: SourceRecordId;
    sourceType: "markdown";
    /** A locator; null means the source is currently unavailable. */
    currentPath: string | null;
    lastKnownPath: string;
    title: string;
    observedAt: string;
}

export interface SourceCatalogueV1 {
    schema: "futureplural.sources";
    version: 1;
    records: SourceRecord[];
}

export interface PaletteSlot {
    id: PaletteSlotId;
    color: string;
    semanticConceptId: SemanticConceptId | null;
}

export interface SemanticConcept {
    id: SemanticConceptId;
    name: string;
}

export interface PaletteCatalogueV1 {
    schema: "futureplural.palette";
    version: 1;
    slots: PaletteSlot[];
    concepts: SemanticConcept[];
}

/** Immutable meaning captured for a new gesture; external/pre-B0 material may have no snapshot. */
export interface AnnotationSnapshot {
    paletteSlotId: PaletteSlotId | null;
    displayColor: string | null;
    semanticConceptId: SemanticConceptId | null;
    semanticLabel: string | null;
    notationType: NotationType;
    opacity: number | null;
}

/** Source-specific evidence supplied by an adapter. Neither offsets nor text are identity. */
export interface AnnotationEvidence {
    quote: string;
    /** A bounded quote remains useful context, but cannot prove legacy continuity when truncated. */
    quoteTruncated: boolean;
    before: string;
    after: string;
}

/** Transient adapter output. observationKey and offsets are locators, never identity. */
export interface AnnotationObservation {
    observationKey: string;
    managedId: AnnotationId | null;
    kind: "mark" | "footnote";
    integrity: Integrity;
    anchor: MarkdownAnchor;
    evidence: AnnotationEvidence;
}

export interface LastKnownAnnotation {
    excerpt: string;
    sourceTitle: string;
    sourcePath: string;
    context: string;
    observedAt: string;
}

export interface AnnotationRegistryRecord {
    id: AnnotationId;
    sourceRecordId: SourceRecordId;
    kind: "mark" | "footnote";
    identityMode: IdentityMode;
    integrity: Integrity;
    anchor: MarkdownAnchor;
    evidence: AnnotationEvidence;
    lastKnown: LastKnownAnnotation;
    snapshot: AnnotationSnapshot | null;
}

export interface AnnotationRegistryV1 {
    schema: "futureplural.annotations";
    version: 1;
    records: AnnotationRegistryRecord[];
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const SOURCE_ID = new RegExp(`^fpsrc-${UUID}$`, "i");
const SLOT_ID = new RegExp(`^fpslot-${UUID}$`, "i");
const CONCEPT_ID = new RegExp(`^fpsem-${UUID}$`, "i");

export function createSourceRecordId(): SourceRecordId {
    return `fpsrc-${crypto.randomUUID()}` as SourceRecordId;
}

export function createPaletteSlotId(): PaletteSlotId {
    return `fpslot-${crypto.randomUUID()}` as PaletteSlotId;
}

export function createSemanticConceptId(): SemanticConceptId {
    return `fpsem-${crypto.randomUUID()}` as SemanticConceptId;
}

export function isSourceRecordId(value: unknown): value is SourceRecordId {
    return typeof value === "string" && SOURCE_ID.test(value);
}

export function isPaletteSlotId(value: unknown): value is PaletteSlotId {
    return typeof value === "string" && SLOT_ID.test(value);
}

export function isSemanticConceptId(value: unknown): value is SemanticConceptId {
    return typeof value === "string" && CONCEPT_ID.test(value);
}

export function newSourceCatalogue(): SourceCatalogueV1 {
    return { schema: "futureplural.sources", version: 1, records: [] };
}

export function newAnnotationRegistry(): AnnotationRegistryV1 {
    return { schema: "futureplural.annotations", version: 1, records: [] };
}

export function newPaletteCatalogue(): PaletteCatalogueV1 {
    return { schema: "futureplural.palette", version: 1, slots: [], concepts: [] };
}

/** Only a caller with verified source continuity may request this ID-preserving move. */
export function withVerifiedSourceLocator(
    catalogue: SourceCatalogueV1,
    sourceRecordId: SourceRecordId,
    path: string,
    title: string,
    observedAt: string
): SourceCatalogueV1 {
    if (!catalogue.records.some((record) => record.id === sourceRecordId)) throw new Error("Unknown SourceRecordId.");
    if (catalogue.records.some((record) => record.id !== sourceRecordId && record.currentPath === path)) {
        throw new Error("Source locator is already claimed; review the conflict.");
    }
    return {
        ...catalogue,
        records: catalogue.records.map((record) =>
            record.id === sourceRecordId
                ? { ...record, currentPath: path, lastKnownPath: path, title, observedAt }
                : record
        ),
    };
}

export function withMissingSource(catalogue: SourceCatalogueV1, sourceRecordId: SourceRecordId): SourceCatalogueV1 {
    if (!catalogue.records.some((record) => record.id === sourceRecordId)) throw new Error("Unknown SourceRecordId.");
    return {
        ...catalogue,
        records: catalogue.records.map((record) =>
            record.id === sourceRecordId ? { ...record, currentPath: null } : record
        ),
    };
}

export function renameSemanticConcept(
    catalogue: PaletteCatalogueV1,
    conceptId: SemanticConceptId,
    name: string
): PaletteCatalogueV1 {
    if (!name.trim()) throw new Error("Semantic concept name is required.");
    if (!catalogue.concepts.some((concept) => concept.id === conceptId)) throw new Error("Unknown semantic concept.");
    return {
        ...catalogue,
        concepts: catalogue.concepts.map((concept) =>
            concept.id === conceptId ? { ...concept, name: name.trim() } : concept
        ),
    };
}

export function reassignPaletteSlot(
    catalogue: PaletteCatalogueV1,
    slotId: PaletteSlotId,
    conceptId: SemanticConceptId | null
): PaletteCatalogueV1 {
    if (!catalogue.slots.some((slot) => slot.id === slotId)) throw new Error("Unknown palette slot.");
    if (conceptId && !catalogue.concepts.some((concept) => concept.id === conceptId)) {
        throw new Error("Unknown semantic concept.");
    }
    return {
        ...catalogue,
        slots: catalogue.slots.map((slot) => (slot.id === slotId ? { ...slot, semanticConceptId: conceptId } : slot)),
    };
}

export function captureAnnotationSnapshot(
    catalogue: PaletteCatalogueV1,
    slotId: PaletteSlotId | null,
    displayColor: string | null,
    notationType: NotationType,
    opacity: number | null
): AnnotationSnapshot {
    if (!isNotationType(notationType)) throw new Error("Unknown notation type.");
    if (displayColor !== null && (!displayColor.trim() || displayColor.length > 128)) {
        throw new Error("Invalid display color snapshot.");
    }
    if (opacity !== null && (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)) {
        throw new Error("Invalid opacity snapshot.");
    }
    const slot = slotId === null ? null : catalogue.slots.find((candidate) => candidate.id === slotId);
    if (slotId !== null && !slot) throw new Error("Unknown palette slot.");
    const conceptId = slot?.semanticConceptId ?? null;
    const concept = conceptId ? catalogue.concepts.find((candidate) => candidate.id === conceptId) : null;
    if (conceptId && !concept) throw new Error("Palette slot references an unknown semantic concept.");
    return {
        paletteSlotId: slotId,
        displayColor,
        semanticConceptId: conceptId,
        semanticLabel: concept?.name ?? null,
        notationType,
        opacity,
    };
}

export function hasHistoricalSemantic(snapshot: AnnotationSnapshot | null, conceptId: SemanticConceptId): boolean {
    return snapshot?.semanticConceptId === conceptId;
}
