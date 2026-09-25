import { describe, expect, it } from "vitest";
import { markdownSourceAdapter } from "../src/adapters/MarkdownSourceAdapter";
import {
    newAnnotationRegistry,
    withMissingSource,
    withVerifiedSourceLocator,
    newSourceCatalogue,
} from "../src/models/canonical";
import { reconcileSourceAnnotations, registerObservedAnnotation } from "../src/reconciliation/annotations";

const uuidA = "12345678-abcd-4abc-8abc-123456789abc";
const uuidB = "87654321-abcd-4abc-8abc-123456789abc";
const uuidC = "aaaaaaaa-abcd-4abc-8abc-123456789abc";
const sourceId = `fpsrc-${uuidA}`;
const otherSourceId = `fpsrc-${uuidB}`;
const annotationId = `fp-${uuidA}`;
const secondAnnotationId = `fp-${uuidB}`;
const copiedAnnotationId = `fp-${uuidC}`;
const observedAt = "2026-09-25T05:00:00Z";
const nextObservation = "2026-09-25T05:01:00Z";
const source = (id = sourceId, path = "Notes/First.md") => ({
    id,
    sourceType: "markdown",
    currentPath: path,
    lastKnownPath: path,
    title: "First",
    observedAt,
});
const registry = (...records) => ({ ...newAnnotationRegistry(), records });
const observed = (raw) => markdownSourceAdapter.observeForReconciliation(raw);
const initial = (raw, id = annotationId, src = source()) =>
    registerObservedAnnotation(src, id, observed(raw)[0], observedAt);
const managed = (id, text, part = "1/1") => `<mark data-fp-id="${id}" data-fp-part="${part}">${text}</mark>`;

describe("pure Markdown annotation reconciliation", () => {
    it("registers external legacy with a durable registry ID without changing its source", () => {
        const raw = "Before sentence. ==selected passage== After sentence.";
        const observation = observed(raw)[0];
        const result = reconcileSourceAnnotations(source(), newAnnotationRegistry(), [observation], observedAt);
        expect(result.unassigned).toMatchObject([{ reason: "new-legacy", candidateIds: [] }]);
        const record = registerObservedAnnotation(source(), annotationId, observation, observedAt);
        expect(record).toMatchObject({
            id: annotationId,
            sourceRecordId: sourceId,
            identityMode: "tracked-legacy",
            integrity: "resolved",
        });
        expect(raw).toBe("Before sentence. ==selected passage== After sentence.");
        const later = reconcileSourceAnnotations(source(), registry(record), observed(raw), nextObservation);
        expect(later.matches).toMatchObject([{ annotationId, reason: "legacy-evidence" }]);
    });

    it("preserves one ID through evidenced tracked-legacy → managed → tracked-legacy transitions", () => {
        const before = "Before sentence. <mark>selected passage</mark> After sentence.";
        const original = initial(before);
        const strengthened = `Before sentence. ${managed(annotationId, "selected passage")} After sentence.`;
        const managedResult = reconcileSourceAnnotations(
            source(),
            registry(original),
            observed(strengthened),
            nextObservation
        );
        expect(managedResult.matches).toMatchObject([{ annotationId, reason: "managed-carrier" }]);
        expect(managedResult.registry.records[0]).toMatchObject({
            id: annotationId,
            identityMode: "managed",
            integrity: "resolved",
        });
        const reversed = reconcileSourceAnnotations(
            source(),
            managedResult.registry,
            observed(before),
            "2026-09-25T05:02:00Z"
        );
        expect(reversed.matches).toMatchObject([{ annotationId, reason: "legacy-evidence" }]);
        expect(reversed.registry.records[0]).toMatchObject({
            id: annotationId,
            identityMode: "tracked-legacy",
            integrity: "resolved",
        });
        expect(original.identityMode).toBe("tracked-legacy");
    });

    it("uses an explicit source record through rename while supporting many annotations", () => {
        const src = source();
        const raw = `Before sentence. ${managed(annotationId, "first passage")} Between sentence. ${managed(secondAnnotationId, "second passage")} After sentence.`;
        const records = observed(raw).map((observation) =>
            registerObservedAnnotation(src, observation.managedId, observation, observedAt)
        );
        const catalogue = { ...newSourceCatalogue(), records: [src] };
        const moved = withVerifiedSourceLocator(catalogue, sourceId, "Renamed/Second.md", "Second", nextObservation);
        const result = reconcileSourceAnnotations(
            moved.records[0],
            registry(...records),
            observed(raw),
            nextObservation
        );
        expect(result.matches).toHaveLength(2);
        expect(result.registry.records.map((record) => record.sourceRecordId)).toEqual([sourceId, sourceId]);
        expect(result.registry.records.map((record) => record.lastKnown.sourcePath)).toEqual([
            "Renamed/Second.md",
            "Renamed/Second.md",
        ]);
    });

    it("never treats a reused path as the original SourceRecordId", () => {
        const raw = "Before sentence. <mark>selected passage</mark> After sentence.";
        const old = initial(raw);
        const differentSource = source(otherSourceId, "Notes/First.md");
        const result = reconcileSourceAnnotations(differentSource, registry(old), observed(raw), nextObservation);
        expect(result.matches).toEqual([]);
        expect(result.unassigned).toMatchObject([{ reason: "new-legacy" }]);
        expect(result.registry.records).toEqual([old]);
    });

    it("uses exact source evidence across relocation and recolor without treating position or color as identity", () => {
        const stablePrefix = `${"x".repeat(80)}\n`;
        const before = `${stablePrefix}Before sentence. <mark style="background: red">selected passage</mark> After sentence.`;
        const old = initial(before);
        const after = `${"Other content. ".repeat(10)}${stablePrefix}Before sentence. <mark style="background: blue">selected passage</mark> After sentence.`;
        const next = observed(after)[0];
        expect(next.anchor.parts[0].start).not.toBe(old.anchor.parts[0].start);
        const result = reconcileSourceAnnotations(source(), registry(old), [next], nextObservation);
        expect(result.matches).toMatchObject([{ annotationId, reason: "legacy-evidence" }]);
        expect(result.registry.records[0].id).toBe(annotationId);
    });

    it("keeps managed mode after partial fragment identity loss and exposes the loose fragment", () => {
        const full = `Before sentence. ${managed(annotationId, "first passage", "1/2")} Between sentence. ${managed(annotationId, "second passage", "2/2")} After sentence.`;
        const original = initial(full);
        const partial = `Before sentence. ${managed(annotationId, "first passage", "1/2")} Between sentence. <mark data-fp-part="2/2">second passage</mark> After sentence.`;
        const result = reconcileSourceAnnotations(source(), registry(original), observed(partial), nextObservation);
        expect(result.registry.records[0]).toMatchObject({
            id: annotationId,
            identityMode: "managed",
            integrity: "degraded",
        });
        expect(result.matches).toMatchObject([{ annotationId, reason: "managed-carrier" }]);
        expect(result.unassigned).toMatchObject([{ reason: "new-legacy" }]);
        expect(result.registry.records[0].lastKnown.excerpt).toBe("first passage\nsecond passage");
    });

    it("preserves managed mode and bounded context when a source disappears", () => {
        const src = source();
        const raw = `Before sentence. ${managed(annotationId, "selected passage")} After sentence.`;
        const old = initial(raw);
        const missingSource = withMissingSource({ ...newSourceCatalogue(), records: [src] }, sourceId).records[0];
        const result = reconcileSourceAnnotations(missingSource, registry(old), null, nextObservation);
        expect(result.registry.records[0]).toMatchObject({
            id: annotationId,
            identityMode: "managed",
            integrity: "missing",
            lastKnown: { sourcePath: "Notes/First.md", excerpt: "selected passage", observedAt },
        });
        expect(result.matches).toEqual([]);
    });

    it("does not attach a copied managed ID to a different source or kind", () => {
        const raw = `Before sentence. ${managed(annotationId, "selected passage")} After sentence.`;
        const original = initial(raw);
        const copySource = source(otherSourceId, "Notes/Copy.md");
        const result = reconcileSourceAnnotations(copySource, registry(original), observed(raw), nextObservation);
        expect(result.matches).toEqual([]);
        expect(result.unassigned).toMatchObject([{ reason: "managed-id-collision", candidateIds: [annotationId] }]);
        expect(result.registry.records).toEqual([original]);

        const conflictingFootnote = `Text[^${annotationId}].\n\n[^${annotationId}]: A portable definition`;
        const sameSource = reconcileSourceAnnotations(
            source(),
            registry(original),
            observed(conflictingFootnote),
            nextObservation
        );
        expect(sameSource.matches).toEqual([]);
        expect(sameSource.unassigned).toMatchObject([{ reason: "managed-id-collision" }]);
        expect(sameSource.registry.records[0]).toMatchObject({
            id: annotationId,
            kind: "mark",
            integrity: "ambiguous",
        });
    });

    it("quarantines duplicate managed parts and duplicate footnote definitions", () => {
        const original = initial(`Before sentence. ${managed(annotationId, "selected passage")} After sentence.`);
        const duplicate = `${managed(annotationId, "selected passage")} ${managed(annotationId, "copied passage")}`;
        const result = reconcileSourceAnnotations(source(), registry(original), observed(duplicate), nextObservation);
        expect(result.matches).toEqual([]);
        expect(result.registry.records[0]).toMatchObject({ id: annotationId, integrity: "ambiguous" });
        expect(result.unassigned).toMatchObject([{ reason: "observation-conflict" }]);

        const footnote = `Text[^${annotationId}].\n\n[^${annotationId}]: A portable definition`;
        const footnoteRecord = initial(footnote);
        const duplicateDefinition = `${footnote}\n[^${annotationId}]: Another definition`;
        const footnoteResult = reconcileSourceAnnotations(
            source(),
            registry(footnoteRecord),
            observed(duplicateDefinition),
            nextObservation
        );
        expect(footnoteResult.registry.records[0].integrity).toBe("ambiguous");
        expect(footnoteResult.matches).toEqual([]);
    });

    it("preserves a managed footnote ID after a confident external label replacement", () => {
        const before = `Text[^${annotationId}].\n\n[^${annotationId}]: A portable definition with enough text`;
        const old = initial(before);
        const after = "Text[^my-note].\n\n[^my-note]: A portable definition with enough text";
        const result = reconcileSourceAnnotations(source(), registry(old), observed(after), nextObservation);
        expect(result.matches).toMatchObject([{ annotationId, reason: "legacy-evidence" }]);
        expect(result.registry.records[0]).toMatchObject({
            id: annotationId,
            kind: "footnote",
            identityMode: "tracked-legacy",
            integrity: "resolved",
        });
        expect(after).toContain("[^my-note]");
    });

    it("retains the last known managed footnote definition when only a dangling reference survives", () => {
        const before = `Text[^${annotationId}].\n\n[^${annotationId}]: A portable definition with enough text`;
        const old = initial(before);
        const after = `Text[^${annotationId}].`;
        const result = reconcileSourceAnnotations(source(), registry(old), observed(after), nextObservation);
        expect(result.registry.records[0]).toMatchObject({
            id: annotationId,
            identityMode: "managed",
            integrity: "missing",
            lastKnown: { excerpt: "A portable definition with enough text" },
        });
    });

    it("preserves a tracked legacy ID when edited text retains two substantial exact boundaries", () => {
        const before = "This begins the passage. <mark>selected passage</mark> And follows the passage.";
        const old = initial(before);
        const edited = "This begins the passage. <mark>revised passage</mark> And follows the passage.";
        const result = reconcileSourceAnnotations(source(), registry(old), observed(edited), nextObservation);
        expect(result.matches).toMatchObject([{ annotationId, reason: "legacy-evidence" }]);
        expect(result.registry.records[0]).toMatchObject({
            id: annotationId,
            identityMode: "tracked-legacy",
            integrity: "resolved",
            evidence: { quote: "revised passage" },
        });
    });

    it("does not use a truncated long quote to prove legacy continuity, but keeps a bounded excerpt", () => {
        const raw = `Before sentence. <mark>${"x".repeat(9000)}</mark> After sentence.`;
        const old = initial(raw);
        expect(old.evidence).toMatchObject({ quoteTruncated: true });
        expect(old.lastKnown.excerpt).toHaveLength(240);
        const result = reconcileSourceAnnotations(source(), registry(old), observed(raw), nextObservation);
        expect(result.matches).toEqual([]);
        expect(result.registry.records[0].integrity).toBe("missing");
    });

    it("does not attach one prior footnote ID to two identical replacement definitions", () => {
        const before = `Text[^${annotationId}].\n\n[^${annotationId}]: A portable definition with enough text`;
        const old = initial(before);
        const after =
            "Text[^one].\nText[^two].\n\n[^one]: A portable definition with enough text\n[^two]: A portable definition with enough text";
        const result = reconcileSourceAnnotations(source(), registry(old), observed(after), nextObservation);
        expect(result.matches).toEqual([]);
        expect(result.unassigned).toHaveLength(2);
        expect(result.unassigned.every((item) => item.reason === "ambiguous-evidence")).toBe(true);
        expect(result.registry.records[0].integrity).toBe("ambiguous");
    });

    it("keeps two legacy observations competing for one prior ID ambiguous across repeated reconciliation", () => {
        const raw = "Before sentence. <mark>selected passage</mark> After sentence.";
        const old = initial(raw);
        const firstObservation = observed(raw)[0];
        const observations = [
            firstObservation,
            {
                ...firstObservation,
                observationKey: "second-copy",
                anchor: {
                    ...firstObservation.anchor,
                    parts: [{ ...firstObservation.anchor.parts[0], start: 100, end: 116 }],
                },
            },
        ];
        const first = reconcileSourceAnnotations(source(), registry(old), observations, nextObservation);
        const second = reconcileSourceAnnotations(source(), first.registry, observations, nextObservation);
        const third = reconcileSourceAnnotations(source(), second.registry, observations, nextObservation);
        for (const result of [first, second, third]) {
            expect(result.matches).toEqual([]);
            expect(result.unassigned).toMatchObject([
                { reason: "ambiguous-evidence", candidateIds: [annotationId] },
                { reason: "ambiguous-evidence", candidateIds: [annotationId] },
            ]);
            expect(result.registry.records[0]).toMatchObject({ id: annotationId, integrity: "ambiguous" });
        }
        expect(second).toEqual(first);
        expect(third).toEqual(first);
    });

    it("keeps one legacy observation competing for two prior IDs ambiguous across repeated reconciliation", () => {
        const raw = "Before sentence. <mark>selected passage</mark> After sentence.";
        const firstRecord = initial(raw);
        const secondRecord = { ...firstRecord, id: secondAnnotationId };
        const observations = observed(raw);
        const first = reconcileSourceAnnotations(
            source(),
            registry(firstRecord, secondRecord),
            observations,
            nextObservation
        );
        const second = reconcileSourceAnnotations(source(), first.registry, observations, nextObservation);
        for (const result of [first, second]) {
            expect(result.matches).toEqual([]);
            expect(result.unassigned).toMatchObject([
                { reason: "ambiguous-evidence", candidateIds: [annotationId, secondAnnotationId] },
            ]);
            expect(result.registry.records.map((record) => record.integrity)).toEqual(["ambiguous", "ambiguous"]);
        }
        expect(second).toEqual(first);
    });

    it("does not attach an ambiguous legacy ID after source unavailability and unchanged evidence returns", () => {
        const src = source();
        const raw = "Before sentence. <mark>selected passage</mark> After sentence.";
        const old = initial(raw);
        const observation = observed(raw)[0];
        const competing = [observation, { ...observation, observationKey: "second-copy" }];
        const ambiguous = reconcileSourceAnnotations(src, registry(old), competing, nextObservation);
        const unavailable = withMissingSource({ ...newSourceCatalogue(), records: [src] }, sourceId).records[0];
        const missing = reconcileSourceAnnotations(unavailable, ambiguous.registry, null, nextObservation);
        expect(missing.registry.records[0]).toMatchObject({ id: annotationId, integrity: "ambiguous" });
        const returned = reconcileSourceAnnotations(src, missing.registry, [observation], nextObservation);
        expect(returned.matches).toEqual([]);
        expect(returned.unassigned).toMatchObject([{ reason: "ambiguous-evidence", candidateIds: [annotationId] }]);
        expect(returned.registry.records[0]).toMatchObject({ id: annotationId, integrity: "ambiguous" });
    });

    it("keeps weak or competing evidence unresolved instead of borrowing analytical identity", () => {
        const src = source();
        const first = initial("Before sentence. <mark>selected passage</mark> After sentence.");
        const weak = observed("<mark>selected passage</mark>");
        const noMatch = reconcileSourceAnnotations(src, registry(first), weak, nextObservation);
        expect(noMatch.matches).toEqual([]);
        expect(noMatch.unassigned).toMatchObject([{ reason: "new-legacy" }]);
        expect(noMatch.registry.records[0].integrity).toBe("missing");

        const second = { ...first, id: secondAnnotationId };
        const competing = reconcileSourceAnnotations(
            src,
            registry(first, second),
            observed("Before sentence. <mark>selected passage</mark> After sentence."),
            nextObservation
        );
        expect(competing.matches).toEqual([]);
        expect(competing.unassigned).toMatchObject([
            { reason: "ambiguous-evidence", candidateIds: [annotationId, secondAnnotationId] },
        ]);
        expect(competing.registry.records.map((record) => record.integrity)).toEqual(["ambiguous", "ambiguous"]);
    });

    it("does not treat a changed managed ID as automatic strengthening of an older record", () => {
        const before = "Before sentence. <mark>selected passage</mark> After sentence.";
        const old = initial(before);
        const changed = `Before sentence. ${managed(copiedAnnotationId, "selected passage")} After sentence.`;
        const result = reconcileSourceAnnotations(source(), registry(old), observed(changed), nextObservation);
        expect(result.matches).toEqual([]);
        expect(result.unassigned).toMatchObject([{ reason: "competing-managed-id", candidateIds: [annotationId] }]);
        expect(result.registry.records).toMatchObject([{ id: annotationId, integrity: "ambiguous" }]);
    });

    it("keeps malformed identity metadata and external footnotes discoverable without rewriting", () => {
        const raw =
            'Before sentence. <mark data-fp-id="bad" data-fp-part="oops">selected passage</mark> After sentence.\n\n[^user]: Ordinary footnote';
        const observations = observed(raw);
        expect(observations.map((item) => [item.kind, item.managedId, item.integrity])).toEqual([
            ["mark", null, "degraded"],
            ["footnote", null, "resolved"],
        ]);
        const result = reconcileSourceAnnotations(source(), newAnnotationRegistry(), observations, observedAt);
        expect(result.matches).toEqual([]);
        expect(result.unassigned).toHaveLength(2);
        expect(raw).toContain("[^user]: Ordinary footnote");
    });
});
