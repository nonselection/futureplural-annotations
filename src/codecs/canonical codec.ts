import { isAnnotationId, type AnnotationId, type Integrity, type SourceRecordId } from "../models/annotation";
import {
    isPaletteSlotId,
    isSemanticConceptId,
    isSourceRecordId,
    type AnnotationEvidence,
    type AnnotationRegistryRecord,
    type AnnotationRegistryV1,
    type AnnotationSnapshot,
    type LastKnownAnnotation,
    type PaletteCatalogueV1,
    type PaletteSlot,
    type SemanticConcept,
    type SourceCatalogueV1,
    type SourceRecord,
} from "../models/canonical";
import { isNotationType } from "../models/notations";

/** Decode failures are surfaced to the eventual store; callers must retain the original bytes. */
export class CanonicalSchemaError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "CanonicalSchemaError";
    }
}

const MAX_DOCUMENT_CHARS = 32 * 1024 * 1024;
const MAX_ENTRIES = 100_000;

function fail(path: string, message: string): never {
    throw new CanonicalSchemaError(`${path}: ${message}`);
}

function object(value: unknown, path: string, fields: readonly string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) if (!fields.includes(key)) fail(`${path}.${key}`, "unknown field");
    for (const key of fields) if (!(key in record)) fail(`${path}.${key}`, "missing field");
    return record;
}

function string(value: unknown, path: string, max: number, allowEmpty = false): string {
    if (typeof value !== "string" || (!allowEmpty && !value.trim()) || value.length > max || value.includes("\0")) {
        fail(path, `expected ${allowEmpty ? "a" : "a nonempty"} string of at most ${max} characters`);
    }
    return value;
}

function nullableString(value: unknown, path: string, max: number): string | null {
    return value === null ? null : string(value, path, max);
}

function array(value: unknown, path: string): unknown[] {
    if (!Array.isArray(value) || value.length > MAX_ENTRIES) fail(path, "expected a bounded array");
    return value;
}

function unique<T>(items: T[], key: (item: T) => string, path: string): void {
    const seen = new Set<string>();
    for (const item of items) {
        const value = key(item);
        if (seen.has(value)) fail(path, `duplicate ID ${value}`);
        seen.add(value);
    }
}

function timestamp(value: unknown, path: string): string {
    const text = string(value, path, 40);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(text) || Number.isNaN(Date.parse(text))) {
        fail(path, "expected a UTC ISO timestamp");
    }
    return text;
}

function vaultPath(value: unknown, path: string): string {
    const text = string(value, path, 4096);
    if (text.startsWith("/") || text.split("/").some((part) => !part || part === ".." || part === ".")) {
        fail(path, "expected a relative vault locator");
    }
    return text;
}

function id<T extends string>(value: unknown, path: string, guard: (candidate: unknown) => candidate is T): T {
    if (!guard(value)) fail(path, "invalid opaque ID");
    return value;
}

function sourceRecord(value: unknown, path: string): SourceRecord {
    const row = object(value, path, ["id", "sourceType", "currentPath", "lastKnownPath", "title", "observedAt"]);
    if (row.sourceType !== "markdown") fail(`${path}.sourceType`, "unsupported source type");
    return {
        id: id(row.id, `${path}.id`, isSourceRecordId),
        sourceType: "markdown",
        currentPath: row.currentPath === null ? null : vaultPath(row.currentPath, `${path}.currentPath`),
        lastKnownPath: vaultPath(row.lastKnownPath, `${path}.lastKnownPath`),
        title: string(row.title, `${path}.title`, 256),
        observedAt: timestamp(row.observedAt, `${path}.observedAt`),
    };
}

function paletteSlot(value: unknown, path: string): PaletteSlot {
    const row = object(value, path, ["id", "color", "semanticConceptId"]);
    return {
        id: id(row.id, `${path}.id`, isPaletteSlotId),
        color: string(row.color, `${path}.color`, 128),
        semanticConceptId:
            row.semanticConceptId === null
                ? null
                : id(row.semanticConceptId, `${path}.semanticConceptId`, isSemanticConceptId),
    };
}

function semanticConcept(value: unknown, path: string): SemanticConcept {
    const row = object(value, path, ["id", "name"]);
    return { id: id(row.id, `${path}.id`, isSemanticConceptId), name: string(row.name, `${path}.name`, 256) };
}

function annotationEvidence(value: unknown, path: string): AnnotationEvidence {
    const row = object(value, path, ["quote", "quoteTruncated", "before", "after"]);
    if (typeof row.quoteTruncated !== "boolean") fail(`${path}.quoteTruncated`, "expected a boolean");
    return {
        quote: string(row.quote, `${path}.quote`, 8192, true),
        quoteTruncated: row.quoteTruncated,
        before: string(row.before, `${path}.before`, 128, true),
        after: string(row.after, `${path}.after`, 128, true),
    };
}

function lastKnown(value: unknown, path: string): LastKnownAnnotation {
    const row = object(value, path, ["excerpt", "sourceTitle", "sourcePath", "context", "observedAt"]);
    return {
        excerpt: string(row.excerpt, `${path}.excerpt`, 240, true),
        sourceTitle: string(row.sourceTitle, `${path}.sourceTitle`, 256),
        sourcePath: vaultPath(row.sourcePath, `${path}.sourcePath`),
        context: string(row.context, `${path}.context`, 256, true),
        observedAt: timestamp(row.observedAt, `${path}.observedAt`),
    };
}

function annotationSnapshot(value: unknown, path: string): AnnotationSnapshot | null {
    if (value === null) return null;
    const row = object(value, path, [
        "paletteSlotId",
        "displayColor",
        "semanticConceptId",
        "semanticLabel",
        "notationType",
        "opacity",
    ]);
    if (!isNotationType(row.notationType as string)) fail(`${path}.notationType`, "unknown notation type");
    if (row.opacity !== null && (typeof row.opacity !== "number" || row.opacity < 0 || row.opacity > 1)) {
        fail(`${path}.opacity`, "expected a number from 0 to 1 or null");
    }
    return {
        paletteSlotId:
            row.paletteSlotId === null ? null : id(row.paletteSlotId, `${path}.paletteSlotId`, isPaletteSlotId),
        displayColor: nullableString(row.displayColor, `${path}.displayColor`, 128),
        semanticConceptId:
            row.semanticConceptId === null
                ? null
                : id(row.semanticConceptId, `${path}.semanticConceptId`, isSemanticConceptId),
        semanticLabel: nullableString(row.semanticLabel, `${path}.semanticLabel`, 256),
        notationType: row.notationType as AnnotationSnapshot["notationType"],
        opacity: row.opacity as number | null,
    };
}

function annotationRecord(value: unknown, path: string): AnnotationRegistryRecord {
    const row = object(value, path, [
        "id",
        "sourceRecordId",
        "kind",
        "identityMode",
        "integrity",
        "anchor",
        "evidence",
        "lastKnown",
        "snapshot",
    ]);
    if (row.kind !== "mark" && row.kind !== "footnote") fail(`${path}.kind`, "unknown annotation kind");
    if (row.identityMode !== "managed" && row.identityMode !== "tracked-legacy") {
        fail(`${path}.identityMode`, "unknown identity mode");
    }
    if (!["resolved", "degraded", "ambiguous", "missing"].includes(row.integrity as string)) {
        fail(`${path}.integrity`, "unknown integrity value");
    }
    const anchor = object(row.anchor, `${path}.anchor`, ["sourceType", "parts"]);
    if (anchor.sourceType !== "markdown") fail(`${path}.anchor.sourceType`, "unsupported source anchor");
    const parts = array(anchor.parts, `${path}.anchor.parts`).map((part, index) => {
        const location = `${path}.anchor.parts[${index}]`;
        const item = object(part, location, ["partId", "order", "start", "end"]);
        for (const field of ["order", "start", "end"] as const) {
            if (!Number.isSafeInteger(item[field]) || (item[field] as number) < (field === "order" ? 1 : 0)) {
                fail(`${location}.${field}`, "expected a nonnegative safe integer");
            }
        }
        if ((item.end as number) < (item.start as number)) fail(location, "part end precedes start");
        return {
            partId: string(item.partId, `${location}.partId`, 128),
            order: item.order as number,
            start: item.start as number,
            end: item.end as number,
        };
    });
    const integrity = row.integrity as Integrity;
    if (integrity === "resolved" && new Set(parts.map((part) => part.order)).size !== parts.length) {
        fail(`${path}.anchor.parts`, "duplicate part order requires non-resolved integrity");
    }
    return {
        id: id(
            row.id,
            `${path}.id`,
            (value): value is AnnotationId => typeof value === "string" && isAnnotationId(value)
        ),
        sourceRecordId: id(row.sourceRecordId, `${path}.sourceRecordId`, isSourceRecordId),
        kind: row.kind,
        identityMode: row.identityMode,
        integrity,
        anchor: { sourceType: "markdown", parts },
        evidence: annotationEvidence(row.evidence, `${path}.evidence`),
        lastKnown: lastKnown(row.lastKnown, `${path}.lastKnown`),
        snapshot: annotationSnapshot(row.snapshot, `${path}.snapshot`),
    };
}

function parseJson(raw: string): unknown {
    if (typeof raw !== "string" || raw.length > MAX_DOCUMENT_CHARS) {
        fail("document", "expected JSON text within the supported size limit");
    }
    try {
        return JSON.parse(raw) as unknown;
    } catch {
        return fail("document", "invalid or truncated JSON");
    }
}

function serializeForValidation(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
        if (
            item === undefined ||
            typeof item === "function" ||
            typeof item === "symbol" ||
            typeof item === "bigint" ||
            (typeof item === "number" && !Number.isFinite(item))
        ) {
            fail("document", "contains a value that JSON would silently discard or change");
        }
        return item;
    });
}

function envelope(value: unknown, schema: string, listFields: readonly string[]): Record<string, unknown> {
    const row = object(value, "document", ["schema", "version", ...listFields]);
    if (row.schema !== schema) fail("document.schema", `expected ${schema}`);
    if (row.version !== 1) fail("document.version", "unsupported schema version");
    return row;
}

export function decodeSourceCatalogue(raw: string): SourceCatalogueV1 {
    const row = envelope(parseJson(raw), "futureplural.sources", ["records"]);
    const records = array(row.records, "document.records").map((item, index) =>
        sourceRecord(item, `document.records[${index}]`)
    );
    unique(records, (item) => item.id, "document.records");
    const activePaths = records.filter((item) => item.currentPath !== null);
    unique(activePaths, (item) => item.currentPath, "document.records.currentPath");
    return { schema: "futureplural.sources", version: 1, records };
}

export function decodePaletteCatalogue(raw: string): PaletteCatalogueV1 {
    const row = envelope(parseJson(raw), "futureplural.palette", ["slots", "concepts"]);
    const slots = array(row.slots, "document.slots").map((item, index) =>
        paletteSlot(item, `document.slots[${index}]`)
    );
    const concepts = array(row.concepts, "document.concepts").map((item, index) =>
        semanticConcept(item, `document.concepts[${index}]`)
    );
    unique(slots, (item) => item.id, "document.slots");
    unique(concepts, (item) => item.id, "document.concepts");
    const knownConcepts = new Set(concepts.map((item) => item.id));
    for (const slot of slots) {
        if (slot.semanticConceptId !== null && !knownConcepts.has(slot.semanticConceptId)) {
            fail(`document.slots.${slot.id}`, "references an unknown semantic concept");
        }
    }
    return { schema: "futureplural.palette", version: 1, slots, concepts };
}

export function decodeAnnotationRegistry(raw: string): AnnotationRegistryV1 {
    const row = envelope(parseJson(raw), "futureplural.annotations", ["records"]);
    const records = array(row.records, "document.records").map((item, index) =>
        annotationRecord(item, `document.records[${index}]`)
    );
    unique(records, (item) => item.id, "document.records");
    return { schema: "futureplural.annotations", version: 1, records };
}

export function validateRegistrySources(registry: AnnotationRegistryV1, sources: SourceCatalogueV1): void {
    const known = new Set<SourceRecordId>(sources.records.map((record) => record.id));
    for (const record of registry.records) {
        if (!known.has(record.sourceRecordId)) {
            fail(`annotation ${record.id}`, `unknown SourceRecordId ${record.sourceRecordId}`);
        }
    }
}

export function encodeSourceCatalogue(document: SourceCatalogueV1): string {
    return JSON.stringify(decodeSourceCatalogue(serializeForValidation(document)), null, 2);
}

export function encodePaletteCatalogue(document: PaletteCatalogueV1): string {
    return JSON.stringify(decodePaletteCatalogue(serializeForValidation(document)), null, 2);
}

export function encodeAnnotationRegistry(document: AnnotationRegistryV1): string {
    return JSON.stringify(decodeAnnotationRegistry(serializeForValidation(document)), null, 2);
}
