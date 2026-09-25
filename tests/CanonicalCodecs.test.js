import { describe, expect, it } from "vitest";
import {
    decodeAnnotationRegistry,
    decodePaletteCatalogue,
    decodeSourceCatalogue,
    encodeAnnotationRegistry,
    encodePaletteCatalogue,
    encodeSourceCatalogue,
    validateRegistryPalette,
    validateRegistrySources,
} from "../src/codecs/canonical";
import {
    captureAnnotationSnapshot,
    hasHistoricalSemantic,
    newAnnotationRegistry,
    newPaletteCatalogue,
    newSourceCatalogue,
    reassignPaletteSlot,
    renameSemanticConcept,
    withMissingSource,
    withVerifiedSourceLocator,
} from "../src/models/canonical";

const uuidA = "12345678-abcd-4abc-8abc-123456789abc";
const uuidB = "87654321-abcd-4abc-8abc-123456789abc";
const sourceId = `fpsrc-${uuidA}`;
const slotId = `fpslot-${uuidA}`;
const conceptId = `fpsem-${uuidA}`;
const otherConceptId = `fpsem-${uuidB}`;
const annotationId = `fp-${uuidA}`;
const observedAt = "2026-09-25T05:00:00Z";

const source = () => ({
    id: sourceId,
    sourceType: "markdown",
    currentPath: "Notes/First.md",
    lastKnownPath: "Notes/First.md",
    title: "First",
    observedAt,
});

const annotation = (overrides = {}) => ({
    id: annotationId,
    sourceRecordId: sourceId,
    kind: "mark",
    identityMode: "managed",
    integrity: "resolved",
    anchor: { sourceType: "markdown", parts: [{ partId: "1/1", order: 1, start: 10, end: 30 }] },
    evidence: {
        quote: "selected passage",
        quoteTruncated: false,
        before: "Before sentence. ",
        after: " Next sentence.",
    },
    lastKnown: {
        excerpt: "selected passage",
        sourceTitle: "First",
        sourcePath: "Notes/First.md",
        context: "Before sentence.  Next sentence.",
        observedAt,
    },
    snapshot: {
        paletteSlotId: slotId,
        displayColor: "#ABCDEF",
        semanticConceptId: conceptId,
        semanticLabel: "Important",
        notationType: "underline",
        opacity: 0.8,
    },
    ...overrides,
});

describe("canonical source, annotation, and palette codecs", () => {
    it("round-trips three separate versioned documents and validates source references", () => {
        const sources = { ...newSourceCatalogue(), records: [source()] };
        const palette = {
            ...newPaletteCatalogue(),
            slots: [{ id: slotId, color: "#abc", semanticConceptId: conceptId }],
            concepts: [{ id: conceptId, name: "Important" }],
        };
        const registry = { ...newAnnotationRegistry(), records: [annotation()] };
        expect(decodeSourceCatalogue(encodeSourceCatalogue(sources))).toEqual(sources);
        expect(decodePaletteCatalogue(encodePaletteCatalogue(palette))).toEqual(palette);
        expect(decodeAnnotationRegistry(encodeAnnotationRegistry(registry))).toEqual(registry);
        expect(() => validateRegistrySources(registry, sources)).not.toThrow();
        expect(() => validateRegistrySources(registry, newSourceCatalogue())).toThrow(/unknown SourceRecordId/);
    });

    it("keeps source identity across a verified locator change and missing source", () => {
        const sources = { ...newSourceCatalogue(), records: [source()] };
        const moved = withVerifiedSourceLocator(sources, sourceId, "Renamed/Second.md", "Second", observedAt);
        expect(moved.records[0]).toMatchObject({ id: sourceId, currentPath: "Renamed/Second.md" });
        expect(sources.records[0].currentPath).toBe("Notes/First.md");
        const missing = withMissingSource(moved, sourceId);
        expect(decodeSourceCatalogue(encodeSourceCatalogue(missing)).records[0]).toMatchObject({
            id: sourceId,
            currentPath: null,
            lastKnownPath: "Renamed/Second.md",
        });
        const contested = {
            ...sources,
            records: [...sources.records, { ...source(), id: `fpsrc-${uuidB}`, currentPath: "Other.md" }],
        };
        expect(() => withVerifiedSourceLocator(contested, sourceId, "Other.md", "Other", observedAt)).toThrow(
            /claimed/
        );
    });

    it("separates Rename from Reassign and retains creation-time meaning and actual display color", () => {
        const initial = {
            ...newPaletteCatalogue(),
            slots: [{ id: slotId, color: "#abc", semanticConceptId: conceptId }],
            concepts: [
                { id: conceptId, name: "Important" },
                { id: otherConceptId, name: "Question" },
            ],
        };
        const historic = captureAnnotationSnapshot(initial, slotId, "#ABCDEF", "underline", 0.8);
        const renamed = renameSemanticConcept(initial, conceptId, "Key point");
        const reassigned = reassignPaletteSlot(renamed, slotId, otherConceptId);
        const future = captureAnnotationSnapshot(reassigned, slotId, "#ABCDEF", "circle", 0.68);
        expect(historic).toMatchObject({
            paletteSlotId: slotId,
            displayColor: "#ABCDEF",
            semanticConceptId: conceptId,
            semanticLabel: "Important",
            notationType: "underline",
            opacity: 0.8,
        });
        expect(future).toMatchObject({ semanticConceptId: otherConceptId, semanticLabel: "Question" });
        expect(hasHistoricalSemantic(historic, conceptId)).toBe(true);
        expect(hasHistoricalSemantic(historic, otherConceptId)).toBe(false);
        expect(hasHistoricalSemantic(null, conceptId)).toBe(false);
        expect(initial.concepts[0].name).toBe("Important");
        expect(decodePaletteCatalogue(encodePaletteCatalogue(reassigned))).toEqual(reassigned);
        expect(() => captureAnnotationSnapshot(initial, slotId, "#ABCDEF", "underline", 2)).toThrow(/opacity/);
    });

    it("validates retained snapshot references without reclassifying a historical Reassign", () => {
        const initial = {
            ...newPaletteCatalogue(),
            slots: [{ id: slotId, color: "#abc", semanticConceptId: conceptId }],
            concepts: [
                { id: conceptId, name: "Important" },
                { id: otherConceptId, name: "Question" },
            ],
        };
        const historic = { ...newAnnotationRegistry(), records: [annotation()] };
        const reassigned = reassignPaletteSlot(initial, slotId, otherConceptId);
        expect(() => validateRegistryPalette(historic, reassigned)).not.toThrow();
        expect(() => validateRegistryPalette(historic, { ...reassigned, slots: [] })).toThrow(/unknown PaletteSlotId/);
        expect(() =>
            validateRegistryPalette(historic, {
                ...reassigned,
                slots: [{ ...reassigned.slots[0], semanticConceptId: otherConceptId }],
                concepts: reassigned.concepts.filter((concept) => concept.id !== conceptId),
            })
        ).toThrow(/unknown SemanticConceptId/);
        const noAssociations = {
            ...newAnnotationRegistry(),
            records: [
                annotation({
                    snapshot: { ...annotation().snapshot, paletteSlotId: null, semanticConceptId: null },
                }),
            ],
        };
        expect(() => validateRegistryPalette(noAssociations, newPaletteCatalogue())).not.toThrow();
    });

    it("requires resolved Markdown anchors to have complete ordered parts", () => {
        const parts = [
            { partId: "1/2", order: 1, start: 10, end: 20 },
            { partId: "2/2", order: 2, start: 30, end: 40 },
        ];
        const withParts = (anchorParts, integrity = "resolved") => ({
            ...newAnnotationRegistry(),
            records: [annotation({ integrity, anchor: { sourceType: "markdown", parts: anchorParts } })],
        });
        expect(() => encodeAnnotationRegistry(withParts([...parts].reverse()))).not.toThrow();
        expect(() => encodeAnnotationRegistry(withParts([]))).toThrow(/contiguous part order 1\.\.N/);
        expect(() => encodeAnnotationRegistry(withParts([{ ...parts[1] }]))).toThrow(/contiguous part order 1\.\.N/);
        expect(() => encodeAnnotationRegistry(withParts([parts[0], { ...parts[1], order: 1 }]))).toThrow(
            /contiguous part order 1\.\.N/
        );
        for (const integrity of ["degraded", "ambiguous"]) {
            expect(() => encodeAnnotationRegistry(withParts([], integrity))).not.toThrow();
            expect(() =>
                encodeAnnotationRegistry(withParts([parts[0], { ...parts[1], order: 1 }], integrity))
            ).not.toThrow();
        }
    });

    it("preserves independent identity mode and all four exact integrity values", () => {
        for (const identityMode of ["managed", "tracked-legacy"]) {
            for (const integrity of ["resolved", "degraded", "ambiguous", "missing"]) {
                const registry = { ...newAnnotationRegistry(), records: [annotation({ identityMode, integrity })] };
                expect(decodeAnnotationRegistry(encodeAnnotationRegistry(registry)).records[0]).toMatchObject({
                    identityMode,
                    integrity,
                });
            }
        }
        expect(() =>
            encodeAnnotationRegistry({
                ...newAnnotationRegistry(),
                records: [annotation({ integrity: "problematic" })],
            })
        ).toThrow(/integrity/);
    });

    it("rejects malformed, unsupported, incomplete, duplicate, and conflicting data", () => {
        expect(() => decodeSourceCatalogue('{"schema":')).toThrow(/invalid or truncated JSON/);
        expect(() => decodeSourceCatalogue(JSON.stringify({ ...newSourceCatalogue(), version: 2 }))).toThrow(
            /unsupported schema version/
        );
        expect(() => decodeSourceCatalogue(JSON.stringify({ ...newSourceCatalogue(), surprise: true }))).toThrow(
            /unknown field/
        );
        expect(() => decodeSourceCatalogue(JSON.stringify({ schema: "futureplural.sources", version: 1 }))).toThrow(
            /missing field/
        );
        expect(() => encodeSourceCatalogue({ ...newSourceCatalogue(), records: [source(), source()] })).toThrow(
            /duplicate ID/
        );
        expect(() =>
            encodeSourceCatalogue({
                ...newSourceCatalogue(),
                records: [source(), { ...source(), id: `fpsrc-${uuidB}` }],
            })
        ).toThrow(/duplicate ID/);
        expect(() =>
            encodeSourceCatalogue({ ...newSourceCatalogue(), records: [{ ...source(), currentPath: "/absolute.md" }] })
        ).toThrow(/relative vault locator/);
        expect(() =>
            encodePaletteCatalogue({
                ...newPaletteCatalogue(),
                slots: [{ id: slotId, color: "#abc", semanticConceptId: conceptId }],
                concepts: [],
            })
        ).toThrow(/unknown semantic concept/);
        expect(() =>
            encodeAnnotationRegistry({ ...newAnnotationRegistry(), records: [annotation(), annotation()] })
        ).toThrow(/duplicate ID/);
        expect(() =>
            encodeAnnotationRegistry({
                ...newAnnotationRegistry(),
                records: [annotation({ snapshot: { ...annotation().snapshot, opacity: Number.NaN } })],
            })
        ).toThrow(/silently discard or change/);
        expect(() =>
            encodeSourceCatalogue({ ...newSourceCatalogue(), records: [{ ...source(), extra: undefined }] })
        ).toThrow(/silently discard or change/);
        expect(() =>
            encodeAnnotationRegistry({
                ...newAnnotationRegistry(),
                records: [
                    annotation({
                        anchor: { sourceType: "markdown", parts: [{ partId: "bad", order: 1, start: 8, end: 3 }] },
                    }),
                ],
            })
        ).toThrow(/end precedes start/);
    });
});
