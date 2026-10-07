import { describe, expect, it } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import {
    inventoryFixture,
    evidenceLimits,
    inventoryCodecs,
    inventoryCodec,
    executionArtifacts,
    envelopeText,
    canonicalEnvelope,
    declarationText,
    namespaceText,
    fenceText,
    stateText,
    testId,
    rawBytes,
} from "./helpers/storageS2V05Fixtures";
import { DISCOVERY_EVIDENCE_AXES } from "../src/storage/discoveryBudget";
import { validateRevisionIdentityClaims } from "../src/storage/repositorySemantics";

const root = ".finders-keepers";
const branch = `${root}/stores/branch`;
const canonical = `${branch}/records/opaque-kind/canonical`;
const prepPath = `${branch}/recovery/outcomes/not-a-prep-name`;
const receiptPath = `${branch}/recovery/mutations/not-a-receipt-name`;
const withStore = (files = {}) => ({
    [`${root}/marker.json`]: namespaceText(),
    [`${branch}/store.json`]: declarationText(),
    ...files,
});
const direct = (result) => result.canonical.filter((fact) => fact.individualEvidence?.role === "DIRECT_CANONICAL");
const prior = (result) =>
    result.priorPublications.filter((fact) => fact.individualEvidence?.role === "QUALIFIED_PRIOR_PUBLICATION");
const assertBoundary = (r) => {
    for (const field of [
        "heads",
        "current",
        "currentHeads",
        "recordClassification",
        "repositoryClassification",
        "qualifiedRepository",
        "mayMutate",
        "mayBootstrap",
        "activeRepresentation",
        "migrationCommit",
        "fenceHealth",
        "storeBoundAbsence",
    ])
        expect(r).not.toHaveProperty(field);
};

it("Batch3 source graph consumes named normative S1 only and never repository/head/health executors", () => {
    const pending = ["discoverySemanticsV05"],
        seen = new Set();
    const owned = new Set([
        "discoverySemanticsV05",
        "discoveryArtifactsV05",
        "discoveryTraversalV05",
        "discoveryV05",
        "discoveryBudget",
        "discoveryGrammar",
        "namespace",
        "representationLocators",
    ]);
    const external = {
        authorityArtifacts: new Set([
            "AuthorityArtifactError",
            "decodeNamespaceArtifact",
            "decodeStoreDeclaration",
            "assessStoreDeclarationSupport",
            "storeDeclarationDigest",
            "compareStoreDeclarations",
            "NamespaceArtifactV1",
            "StoreDeclarationV2",
            "decodeProtocolFenceArtifact",
            "decodeRepresentationStateArtifact",
            "representationStateArtifactDigest",
            "ProtocolFenceArtifactV1",
            "RepresentationStateArtifactV1",
        ]),
        canonicalEncoding: new Set([
            "ArtifactDigest",
            "CanonicalDigest",
            "canonicalSerialize",
            "sha256Bytes",
            "CanonicalEncodingError",
        ]),
        identity: new Set(["StoreId", "RevisionId", "MutationId", "PublicationId"]),
        envelopes: new Set([
            "decodeCanonicalRevisionEnvelope",
            "canonicalRevisionDigest",
            "CanonicalEnvelopeError",
            "CanonicalRecordCodec",
            "CanonicalRevisionEnvelope",
        ]),
        recoveryArtifacts: new Set([
            "recognizeRecoveryV2ArtifactBytes",
            "RecoveryPreparationV2",
            "RecoveryReceiptV2",
            "compareRecoveryExecutionArtifacts",
            "compareLogicalMutationBindings",
            "projectLogicalMutationBinding",
            "validateReceiptAgainstPreparation",
            "validatePriorPublicationEvidence",
            "PriorPublicationValidation",
            "QualifiedRevisionEvidence",
            "LogicalMutationBinding",
        ]),
        RepresentationStoragePort: new Set([
            "RepresentationReadPort",
            "RepresentationDirectoryHandle",
            "RepresentationFileHandle",
            "RepresentationHandleEntry",
            "RepresentationReadFailureCode",
        ]),
    };
    while (pending.length) {
        const name = pending.pop();
        if (seen.has(name)) continue;
        seen.add(name);
        expect(owned.has(name)).toBe(true);
        const source = ts.createSourceFile(
            name,
            fs.readFileSync(`src/storage/${name}.ts`, "utf8"),
            ts.ScriptTarget.Latest,
            true
        );
        const body = ts
            .createPrinter({ removeComments: true })
            .printFile(source)
            .replaceAll('"./RepresentationStoragePort"', '"normative-read-types"');
        expect(body).not.toMatch(
            /\b(createImmutable|writeSnapshot|rename|delete|localGuarantees|publishFresh|RepresentationStoragePort|StoreArtifactV1|RecoveryIntentV1|obsidian|classifyRecordRevisions|indexQualifiedRevisionGraph|evaluateIndexedHeadRelations|assessProtocolWriteFence|validateRepresentationStateLineage)\b/
        );
        for (const statement of source.statements)
            if (ts.isImportDeclaration(statement)) {
                expect(statement.moduleSpecifier.text.startsWith("./")).toBe(true);
                const dependency = statement.moduleSpecifier.text.slice(2);
                if (external[dependency]) {
                    for (const element of statement.importClause.namedBindings.elements)
                        expect(external[dependency].has(element.propertyName?.text ?? element.name.text)).toBe(true);
                    if (dependency === "RepresentationStoragePort")
                        expect(statement.importClause.isTypeOnly).toBe(true);
                } else pending.push(dependency);
            }
    }
    expect(seen).toEqual(owned);
});

describe("P2 A–E and complete canonical claims", () => {
    it.each([
        ["A", true],
        ["B", false],
    ])("P2 %s direct canonical is receipt-independent and fence-independent", async (_name, hasFence) => {
        const files = withStore({ [canonical]: envelopeText() });
        if (hasFence) files[`${branch}/meta/protocol/fence`] = fenceText();
        const r = await inventoryFixture(files).evidence();
        expect(r.status).toBe("OBSERVATIONS_FINISHED");
        expect(r.canonical).toHaveLength(1);
        expect(r.canonical[0].physicallyCanonical).toBe(true);
        expect(direct(r)).toHaveLength(1);
        expect(r.identityClaims[0].envelope).toEqual(canonicalEnvelope());
        expect(r.priorPublications).toEqual([]);
        expect(r.findings.some((f) => f.code === "READ_ONLY_MISSING_FENCE")).toBe(!hasFence);
        assertBoundary(r);
    });
    it("P2 C declarationless canonical stays physical/complete/unqualified, never RECORD_ABSENT", async () => {
        const r = await inventoryFixture({ [canonical]: envelopeText() }).evidence();
        expect(r.canonical[0].physicallyCanonical).toBe(true);
        expect(direct(r)).toEqual([]);
        expect(r.identityClaims).toHaveLength(1);
        expect(r.identityClaims[0].envelope.storeId).toBe(testId("store"));
        expect(r.identityClaims[0].digest).toMatch(/^sha256:/);
        expect(r.canonical[0].declarationContext).toBe("UNQUALIFIED");
        expect(r.findings.some((f) => f.code === "DECLARATION_CONTEXT_UNQUALIFIED")).toBe(true);
        assertBoundary(r);
    });
    it("P2 D split-provider supported declaration qualifies matching content without local declaration", async () => {
        const file = "Provider B/stores/content/records/kind/leaf";
        const r = await inventoryFixture({
            "Provider A/stores/decl/fresh.json": declarationText(),
            [file]: envelopeText(),
        }).evidence();
        expect(direct(r)).toHaveLength(1);
        expect(direct(r)[0].source.file.locator).toBe(file);
        expect(direct(r)[0].declarationContext).toBe("SUPPORTED_COHERENT");
        assertBoundary(r);
    });
    it("split-provider differing content StoreId cannot cross-qualify", async () => {
        const r = await inventoryFixture({
            "Provider A/stores/decl/fresh.json": declarationText(),
            "Provider B/stores/content/records/kind/leaf": envelopeText({ storeId: testId("store", 2) }),
        }).evidence();
        expect(r.canonical[0].physicallyCanonical).toBe(true);
        expect(direct(r)).toEqual([]);
        expect(r.identityClaims[0].envelope.storeId).toBe(testId("store", 2));
    });
    it.each([
        "{bad",
        '{"unrecognized":"content"}',
        JSON.stringify({ ...canonicalEnvelope(), storageEnvelopeVersion: 9 }),
    ])("P2 E invalid/unknown/unsupported terminal keeps raw blocker: %s", async (text) => {
        const r = await inventoryFixture(withStore({ [canonical]: text })).evidence();
        expect(
            r.artifacts.some(
                (a) =>
                    a.source.file.locator === canonical &&
                    ["INVALID", "UNSUPPORTED", "UNRECOGNIZED"].includes(a.content.status)
            )
        ).toBe(true);
        expect(r.identityClaims).toEqual([]);
        expect(direct(r)).toEqual([]);
        assertBoundary(r);
    });
    it.each(["store-subtree", "recovery", "protocol", "state"])(
        "canonical content at wrong %s role retains claim without direct admission",
        async (role) => {
            const path =
                role === "store-subtree"
                    ? `${branch}/misplaced.json`
                    : role === "recovery"
                      ? `${branch}/recovery/mutations/misplaced`
                      : `${branch}/meta/${role === "state" ? "representation-states" : "protocol"}/misplaced`;
            const r = await inventoryFixture(withStore({ [path]: envelopeText() })).evidence();
            expect(r.identityClaims).toHaveLength(1);
            expect(r.canonical).toHaveLength(1);
            expect(r.canonical[0].physicallyCanonical).toBe(false);
            expect(direct(r)).toEqual([]);
            expect(r.findings.some((f) => f.code === "CANONICAL_ROLE_MISMATCH")).toBe(true);
        }
    );
    it("equivalent physical canonical copies retain all provenance and identity claims", async () => {
        const r = await inventoryFixture(
            withStore({ [canonical]: envelopeText(), [`${branch}/records/kind/twin`]: envelopeText() })
        ).evidence();
        expect(direct(r)).toHaveLength(2);
        expect(r.identityClaims).toHaveLength(2);
        expect(new Set(r.identityClaims.map((c) => c.digest)).size).toBe(1);
        expect(r.identityClaims[0].source.file).not.toBe(r.identityClaims[1].source.file);
    });
    it("same RevisionId/different digest claims survive authority filtering for later S1 identity rejection", async () => {
        const execution = await executionArtifacts({}, {}, { payload: { text: "conflicting nonauthority content" } });
        const r = await inventoryFixture(
            withStore({ [canonical]: envelopeText(), [prepPath]: execution.prepText })
        ).evidence();
        expect(r.identityClaims).toHaveLength(2);
        expect(new Set(r.identityClaims.map((c) => c.envelope.revisionId)).size).toBe(1);
        expect(new Set(r.identityClaims.map((c) => c.digest)).size).toBe(2);
        expect(validateRevisionIdentityClaims(r.identityClaims).classification.state).toBe("REVISION_IDENTITY_INVALID");
        expect(r.priorPublications).toEqual([]);
        assertBoundary(r);
    });
    it("F2 preserves own/parent/resolution references, stale nonauthority claims and excludes payload strings", async () => {
        const parent = testId("revision", 2),
            other = testId("revision", 3),
            payloadOnly = testId("revision", 99);
        const text = envelopeText({
            parentRevisionId: parent,
            resolvedRevisionIds: [parent, other],
            payload: { text: payloadOnly },
        });
        const r = await inventoryFixture({ [canonical]: text }).evidence();
        expect(r.identityClaims[0].referenceIds).toEqual([testId("revision"), parent, parent, other]);
        expect(r.identityClaims[0].referenceIds).not.toContain(payloadOnly);
        expect(r.identityClaims[0].envelope.resolvedRevisionIds).toEqual([parent, other]);
    });
    it("C1/C2 inputs retain cycles and missing boundaries without constructing heads/index", async () => {
        const a = testId("revision", 1),
            b = testId("revision", 2),
            missing = testId("revision", 88);
        const r = await inventoryFixture(
            withStore({
                [canonical]: envelopeText({ revisionId: a, parentRevisionId: b }),
                [`${branch}/records/kind/b`]: envelopeText({ revisionId: b, parentRevisionId: a }),
                [`${branch}/records/kind/c`]: envelopeText({
                    revisionId: testId("revision", 3),
                    parentRevisionId: missing,
                }),
            })
        ).evidence();
        expect(r.identityClaims).toHaveLength(3);
        expect(r.identityClaims.map((c) => c.envelope.parentRevisionId)).toEqual(
            expect.arrayContaining([a, b, missing])
        );
        assertBoundary(r);
    });
    it("broader unreadable canonical/fence evidence never erases an independently observed direct fact", async () => {
        const unknown = `${branch}/records/kind/unavailable`,
            fence = `${branch}/meta/protocol/unavailable`;
        const f = inventoryFixture(
            withStore({ [canonical]: envelopeText(), [unknown]: envelopeText(), [fence]: fenceText() })
        );
        f.controls.setReadCondition(f.scope.directory.root, unknown, "UNAVAILABLE");
        f.controls.setReadCondition(f.scope.directory.root, fence, "UNAVAILABLE");
        const r = await f.evidence();
        expect(r.status).toBe("INCOMPLETE");
        expect(
            r.canonical.some((c) => c.physicallyCanonical && c.individualEvidence?.role === "DIRECT_CANONICAL")
        ).toBe(true);
        expect(r.findings.some((f) => f.code === "FENCE_COVERAGE_UNKNOWN")).toBe(true);
        assertBoundary(r);
    });
    it("conflicting, malformed, unsupported or unreadable declarations are retained and cannot supply coherent context", async () => {
        for (const mode of ["conflict", "malformed", "unsupported", "unavailable"]) {
            const file = `${branch}/sibling.json`;
            const f = inventoryFixture(
                withStore({
                    [canonical]: envelopeText(),
                    [file]:
                        mode === "conflict"
                            ? declarationText({ bootstrapId: testId("bootstrap", 2) })
                            : mode === "malformed"
                              ? "{bad"
                              : declarationText({ requiredProtocolVersion: 3 }),
                })
            );
            if (mode === "unavailable") f.controls.setReadCondition(f.scope.directory.root, file, "UNAVAILABLE");
            const r = await f.evidence();
            expect(r.canonical[0].physicallyCanonical).toBe(true);
            expect(r.identityClaims).toHaveLength(1);
            expect(direct(r)).toEqual([]);
        }
    });
});

describe("Recovery2 execution and logical evidence", () => {
    it("preparation alone contributes full after claim and zero authority", async () => {
        const e = await executionArtifacts();
        const r = await inventoryFixture(withStore({ [prepPath]: e.prepText })).evidence();
        expect(r.identityClaims[0]).toMatchObject({
            origin: "PREPARATION_AFTER",
            envelope: e.prep.after,
            digest: e.prep.candidateDigest,
        });
        expect(r.executionArtifacts[0].artifactKind).toBe("preparation");
        expect(r.priorPublications).toEqual([]);
        expect(direct(r)).toEqual([]);
        assertBoundary(r);
    });
    it.each([
        ["DISPATCH_REPORTED_SUCCESS", "EXACT_CANDIDATE", true],
        ["DISPATCH_OUTCOME_UNKNOWN", "EXACT_CANDIDATE", true],
        ["DISPATCH_REPORTED_SUCCESS", "NOT_ESTABLISHED", false],
        ["DISPATCH_OUTCOME_UNKNOWN", "NOT_ESTABLISHED", false],
        ["NO_MUTATION_DISPATCHED", "NOT_ESTABLISHED", false],
    ])("receipt %s / %s uses S1 matrix unchanged", async (physicalEffect, canonicalObservation, qualified) => {
        const e = await executionArtifacts({}, { physicalEffect, canonicalObservation });
        const r = await inventoryFixture(
            withStore({ [prepPath]: e.prepText, [receiptPath]: e.receiptText })
        ).evidence();
        expect(r.priorPublications).toHaveLength(1);
        expect(r.priorPublications[0].binding).toBe("EXACT");
        expect(r.priorPublications[0].validation.status).toBe(
            qualified ? "QUALIFIED_PRIOR_PUBLICATION" : "NOT_QUALIFIED"
        );
        expect(prior(r)).toHaveLength(qualified ? 1 : 0);
        const receipt = r.executionArtifacts.find((g) => g.artifactKind === "receipt").variants[0].value;
        expect(receipt.physicalEffect).toBe(physicalEffect);
        expect(receipt.canonicalObservation).toBe(canonicalObservation);
        if (qualified) expect(prior(r)[0].validation.evidence.physicalEffect).toBe(physicalEffect);
        assertBoundary(r);
    });
    it("nondispatch+exact is invalid, not a forged qualifying receipt", async () => {
        const e = await executionArtifacts();
        const r = await inventoryFixture(
            withStore({
                [prepPath]: e.prepText,
                [receiptPath]: JSON.stringify({
                    ...e.receipt,
                    physicalEffect: "NO_MUTATION_DISPATCHED",
                    canonicalObservation: "EXACT_CANDIDATE",
                }),
            })
        ).evidence();
        expect(r.artifacts.find((a) => a.source.file.locator === receiptPath).content.status).toBe("INVALID");
        expect(prior(r)).toEqual([]);
        expect(r.identityClaims).toHaveLength(1);
    });
    it("artifactKind comes from bytes despite swapped mutations/outcomes and leaf hints", async () => {
        const e = await executionArtifacts();
        const r = await inventoryFixture(
            withStore({ [prepPath]: e.prepText, [receiptPath]: e.receiptText })
        ).evidence();
        expect(r.executionArtifacts.map((g) => g.artifactKind).sort()).toEqual(["preparation", "receipt"]);
        expect(prior(r)).toHaveLength(1);
    });
    it.each(["prep", "receipt"])(
        "F1 same execution key changing recordKind/recordId produces %s conflict",
        async (kind) => {
            const a = await executionArtifacts();
            const b = await executionArtifacts({}, {}, { recordKind: "other.record", recordId: "record-b" });
            const files = withStore({ [prepPath]: a.prepText, [receiptPath]: a.receiptText });
            files[`${branch}/recovery/${kind === "prep" ? "mutations" : "outcomes"}/conflicting`] =
                kind === "prep" ? b.prepText : b.receiptText;
            const r = await inventoryFixture(files).evidence();
            const group = r.executionArtifacts.find(
                (g) => g.artifactKind === (kind === "prep" ? "preparation" : "receipt")
            );
            expect(group.state).toBe("EXECUTION_ARTIFACT_CONFLICT");
            expect(group.variants).toHaveLength(2);
            expect(group.variants.map((v) => v.value.recordId)).toEqual(
                expect.arrayContaining(["record-a", "record-b"])
            );
            expect(prior(r)).toEqual([]);
            expect(
                r.priorPublications.some((p) => p.validation.status === "QUALIFIED_PRIOR_PUBLICATION" && !p.coherent)
            ).toBe(true);
        }
    );
    it("F1 equivalent copies collapse only exact complete content and retain physical observations", async () => {
        const e = await executionArtifacts();
        const r = await inventoryFixture(
            withStore({
                [prepPath]: e.prepText,
                [`${branch}/recovery/mutations/twin`]: e.prepText,
                [receiptPath]: e.receiptText,
            })
        ).evidence();
        const group = r.executionArtifacts.find((g) => g.artifactKind === "preparation");
        expect(group.state).toBe("EQUIVALENT");
        expect(group.variants).toHaveLength(1);
        expect(group.variants[0].observations).toHaveLength(2);
        expect(r.identityClaims).toHaveLength(2);
        expect(r.budget.consumed.recoveryExecutions).toBe(1);
    });
    it("F1 changed sealed receipt effects conflict instead of selecting a successful copy", async () => {
        const a = await executionArtifacts(),
            b = await executionArtifacts({}, { physicalEffect: "DISPATCH_OUTCOME_UNKNOWN" });
        const r = await inventoryFixture(
            withStore({
                [prepPath]: a.prepText,
                [receiptPath]: a.receiptText,
                [`${branch}/recovery/outcomes/unknown-twin`]: b.receiptText,
            })
        ).evidence();
        expect(r.executionArtifacts.find((g) => g.artifactKind === "receipt").state).toBe(
            "EXECUTION_ARTIFACT_CONFLICT"
        );
        expect(prior(r)).toEqual([]);
        expect(r.priorPublications.filter((p) => p.validation.status === "QUALIFIED_PRIOR_PUBLICATION")).toHaveLength(
            2
        );
    });
    it("same MutationId equivalent binding across PublicationId/purpose differs from whole preparation digest", async () => {
        const a = await executionArtifacts(),
            b = await executionArtifacts({
                canonicalPublicationId: testId("publication", 2),
                purpose: "exact-materialization",
            });
        const r = await inventoryFixture(
            withStore({
                [prepPath]: a.prepText,
                [receiptPath]: a.receiptText,
                [`${branch}/recovery/mutations/b`]: b.prepText,
                [`${branch}/recovery/outcomes/b`]: b.receiptText,
            })
        ).evidence();
        expect(r.logicalMutations).toHaveLength(1);
        expect(r.logicalMutations[0].state).toBe("EQUIVALENT_LOGICAL_MUTATION");
        expect(r.logicalMutations[0].bindings[0]).toEqual(r.logicalMutations[0].bindings[1]);
        expect(
            r.executionArtifacts.filter((g) => g.artifactKind === "preparation").map((g) => g.variants[0].digest)[0]
        ).not.toBe(
            r.executionArtifacts.filter((g) => g.artifactKind === "preparation").map((g) => g.variants[0].digest)[1]
        );
        expect(prior(r)).toHaveLength(2);
        expect(r.budget.consumed.recoveryExecutions).toBe(2);
    });
    it("same MutationId changed candidate binding conflicts; valid pair cannot hide other execution", async () => {
        const a = await executionArtifacts(),
            b = await executionArtifacts(
                { canonicalPublicationId: testId("publication", 2) },
                {},
                { revisionId: testId("revision", 2), payload: { text: "changed" } }
            );
        const r = await inventoryFixture(
            withStore({
                [prepPath]: a.prepText,
                [receiptPath]: a.receiptText,
                [`${branch}/recovery/mutations/b`]: b.prepText,
                [`${branch}/recovery/outcomes/b`]: b.receiptText,
            })
        ).evidence();
        expect(r.logicalMutations[0].state).toBe("MUTATION_IDENTITY_CONFLICT");
        expect(r.identityClaims).toHaveLength(2);
        expect(prior(r)).toEqual([]);
        expect(r.priorPublications.every((p) => !p.coherent)).toBe(true);
    });
    it("orphan receipt remains visible without fabricating prep/candidate claim", async () => {
        const e = await executionArtifacts();
        const r = await inventoryFixture(withStore({ [receiptPath]: e.receiptText })).evidence();
        expect(r.findings.some((f) => f.code === "ORPHAN_RECEIPT")).toBe(true);
        expect(r.priorPublications).toEqual([]);
        expect(r.identityClaims).toEqual([]);
    });
    it.each(["preparationDigest", "candidateDigest", "recordId", "canonicalPublicationId"])(
        "receipt mismatch %s cannot loosely join by MutationId/candidate",
        async (field) => {
            const changes =
                field === "recordId"
                    ? { recordId: "record-b" }
                    : field === "canonicalPublicationId"
                      ? { canonicalPublicationId: testId("publication", 2) }
                      : { [field]: `sha256:${"a".repeat(64)}` };
            const e = await executionArtifacts({}, changes);
            const r = await inventoryFixture(
                withStore({ [prepPath]: e.prepText, [receiptPath]: e.receiptText })
            ).evidence();
            expect(prior(r)).toEqual([]);
            expect(
                r.findings.some(
                    (f) => f.code === (field === "canonicalPublicationId" ? "ORPHAN_RECEIPT" : "MISBOUND_RECEIPT")
                )
            ).toBe(true);
        }
    );
    it("declarationless pure proof stays qualified as S1 fact without store-qualified authority", async () => {
        const e = await executionArtifacts({}, { physicalEffect: "DISPATCH_OUTCOME_UNKNOWN" });
        const r = await inventoryFixture({ [prepPath]: e.prepText, [receiptPath]: e.receiptText }).evidence();
        expect(r.identityClaims).toHaveLength(1);
        expect(r.priorPublications[0].validation.status).toBe("QUALIFIED_PRIOR_PUBLICATION");
        expect(r.priorPublications[0].validation.evidence.physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
        expect(r.priorPublications[0].declarationContext).toBe("UNQUALIFIED");
        expect(prior(r)).toEqual([]);
        assertBoundary(r);
    });
    it("split-provider declaration qualifies exact recovery proof without local plan/fence", async () => {
        const e = await executionArtifacts();
        const r = await inventoryFixture({
            "Provider A/stores/plan/decl.json": declarationText(),
            [prepPath]: e.prepText,
            [receiptPath]: e.receiptText,
        }).evidence();
        expect(prior(r)).toHaveLength(1);
        expect(prior(r)[0].declarationContext).toBe("SUPPORTED_COHERENT");
    });
    it("qualified proof with no canonical copy retains full candidate and scoped missing coverage", async () => {
        const e = await executionArtifacts({}, { physicalEffect: "DISPATCH_OUTCOME_UNKNOWN" });
        const r = await inventoryFixture(
            withStore({ [prepPath]: e.prepText, [receiptPath]: e.receiptText })
        ).evidence();
        expect(prior(r)).toHaveLength(1);
        expect(direct(r)).toEqual([]);
        expect(prior(r)[0].canonicalCopyCoverage).toBe("MISSING_IN_COMPLETE_SCOPED_INVENTORY");
        expect(prior(r)[0].validation.evidence.envelope).toEqual(e.prep.after);
        assertBoundary(r);
    });
    it("direct and prior for same revision retain both families for later logical collapse", async () => {
        const e = await executionArtifacts();
        const r = await inventoryFixture(
            withStore({ [canonical]: envelopeText(), [prepPath]: e.prepText, [receiptPath]: e.receiptText })
        ).evidence();
        expect(direct(r)).toHaveLength(1);
        expect(prior(r)).toHaveLength(1);
        expect(prior(r)[0].canonicalCopyCoverage).toBe("PRESENT");
        expect(new Set(r.identityClaims.map((c) => c.envelope.revisionId)).size).toBe(1);
        expect(r.identityClaims).toHaveLength(2);
    });
    it("canonical copy coverage is unknown with unreadable relevant inventory or representation-only input", async () => {
        const e = await executionArtifacts();
        const unknown = `${branch}/records/kind/unknown`;
        const f = inventoryFixture(
            withStore({ [prepPath]: e.prepText, [receiptPath]: e.receiptText, [unknown]: envelopeText() })
        );
        f.controls.setReadCondition(f.scope.directory.root, unknown, "UNAVAILABLE");
        const r = await f.evidence();
        expect(r.priorPublications[0].canonicalCopyCoverage).toBe("UNKNOWN");
        expect(prior(r)).toHaveLength(1);
        assertBoundary(r);
    });
    it.each([1, 3])("unsupported recovery version %i is raw evidence, not recovery1 adoption", async (version) => {
        const e = await executionArtifacts();
        const r = await inventoryFixture({
            [prepPath]: JSON.stringify({ ...e.prep, recoveryFormatVersion: version }),
        }).evidence();
        expect(r.artifacts[0].content.status).toBe("UNSUPPORTED");
        expect(r.identityClaims).toEqual([]);
        expect(r.executionArtifacts).toEqual([]);
    });
});

describe("declarationless factual metadata and ownership", () => {
    it("fence/state decode with bindings/digest but no health/active representation/migration commit", async () => {
        const r = await inventoryFixture({
            [`${branch}/meta/protocol/fence`]: fenceText(),
            [`${branch}/meta/representation-states/state`]: stateText(),
        }).evidence();
        expect(r.fences[0].value.storeId).toBe(testId("store"));
        expect(r.fences[0].protocolTerminal).toBe(true);
        expect(r.states[0].value.representationStateId).toBe(testId("representation-state"));
        expect(r.states[0].stateTerminal).toBe(true);
        expect(r.states[0].digest).toMatch(/^sha256:/);
        assertBoundary(r);
    });
    it("opaque migration retains raw fingerprint and never path-derived MigrationId/phase", async () => {
        const path = `${branch}/meta/migrations/${testId("migration")}/phase`;
        const r = await inventoryFixture({ [path]: "opaque phase bytes" }).evidence();
        expect(r.migrations[0].status).toBe("OPAQUE");
        expect(r.migrations[0].fingerprint).toMatch(/^sha256:/);
        expect(r.migrations[0].source.positions[0].raw.copyBytes()).toEqual(rawBytes("opaque phase bytes"));
        expect(r.migrations[0]).not.toHaveProperty("migrationId");
        expect(r.migrations[0]).not.toHaveProperty("phase");
        assertBoundary(r);
    });
    it("malformed/unsupported/unavailable P1 terminals stay explicit nonauthority", async () => {
        const e = await executionArtifacts();
        const path = `${branch}/meta/protocol/unavailable`;
        const f = inventoryFixture({
            [canonical]: "{bad",
            [prepPath]: JSON.stringify({ ...e.prep, requiredProtocolVersion: 3 }),
            [path]: fenceText(),
        });
        f.controls.setReadCondition(f.scope.directory.root, path, "UNAVAILABLE");
        const r = await f.evidence();
        expect(r.status).toBe("INCOMPLETE");
        expect(direct(r)).toEqual([]);
        expect(prior(r)).toEqual([]);
        expect(r.identityClaims).toEqual([]);
        expect(r.artifacts.map((a) => a.content.status)).toEqual(
            expect.arrayContaining(["INVALID", "UNSUPPORTED", "INCOMPLETE"])
        );
        assertBoundary(r);
    });
    it("path-only fixture cannot produce content StoreId/identity or RECORD_ABSENT", async () => {
        const r = await inventoryFixture({
            [`${root}/stores/${testId("store", 99)}/records/kind/leaf`]: '{"ordinary":true}',
        }).evidence();
        expect(r.canonical).toEqual([]);
        expect(r.identityClaims).toEqual([]);
        assertBoundary(r);
    });
    it("owned normalized envelopes/payloads and raw access resist consumer mutation", async () => {
        const r = await inventoryFixture(withStore({ [canonical]: envelopeText() })).evidence();
        const claim = r.identityClaims[0];
        expect(Object.isFrozen(claim.envelope.payload)).toBe(true);
        expect(Object.isFrozen(claim.referenceIds)).toBe(true);
        expect(() => {
            claim.envelope.payload.text = "unsafe";
        }).toThrow();
        claim.source.positions[0].raw.copyBytes().fill(0);
        expect(claim.envelope).toEqual(canonicalEnvelope());
        expect(claim.source.positions[0].raw.copyBytes()).toEqual(rawBytes(envelopeText()));
    });
    it("codec registry membership/descriptors/functions snapshot before physical await", async () => {
        const f = inventoryFixture(withStore({ [canonical]: envelopeText() }));
        let entered, release;
        const start = new Promise((r) => {
                entered = r;
            }),
            wait = new Promise((r) => {
                release = r;
            });
        const original = f.port.listChildren;
        f.port.listChildren = async (...args) => {
            entered();
            await wait;
            return original(...args);
        };
        const codec = { ...inventoryCodec },
            registry = [codec],
            profile = evidenceLimits();
        const pending = f.evidence(profile, registry);
        await start;
        registry.length = 0;
        codec.recordKind = "changed";
        codec.schemaVersion = 99;
        codec.validatePayload = () => {
            throw new Error("changed");
        };
        profile.completeClaims = 0;
        release();
        const r = await pending;
        expect(direct(r)).toHaveLength(1);
        expect(r.identityClaims).toHaveLength(1);
        expect(r.budget.limits.completeClaims).toBe(1000);
    });
});

describe("one evidence ledger and conservative boundary", () => {
    it.each(DISCOVERY_EVIDENCE_AXES)("requires explicit finite %s", (axis) => {
        const f = inventoryFixture();
        for (const bad of [undefined, Infinity, NaN, -1, Number.MAX_SAFE_INTEGER + 1])
            expect(() => f.evidence(evidenceLimits({ [axis]: bad }))).toThrow(/finite/);
        const omitted = evidenceLimits();
        delete omitted[axis];
        expect(() => f.evidence(omitted)).toThrow(/finite/);
    });
    it.each(["completeClaims", "identityReferences", "recordPayloadBytes"])(
        "%s refusal retains bounded observations with no new individual authority",
        async (axis) => {
            const r = await inventoryFixture(withStore({ [canonical]: envelopeText() })).evidence(
                evidenceLimits({ [axis]: 0 })
            );
            expect(r.status).toBe("INCOMPLETE");
            expect(r.budget.refusal.axis).toBe(axis);
            expect(direct(r)).toEqual([]);
            expect(r.findings.some((f) => f.code === "OBSERVATION_INCOMPLETE")).toBe(true);
            assertBoundary(r);
        }
    );
    it("recovery execution refusal cannot form a prior authority pair", async () => {
        const e = await executionArtifacts();
        const r = await inventoryFixture(withStore({ [prepPath]: e.prepText, [receiptPath]: e.receiptText })).evidence(
            evidenceLimits({ recoveryExecutions: 0 })
        );
        expect(r.status).toBe("INCOMPLETE");
        expect(r.budget.refusal.axis).toBe("recoveryExecutions");
        expect(prior(r)).toEqual([]);
        assertBoundary(r);
    });
    it.each([
        "decodedBytes",
        "decodeHashByteWork",
        "graphWork",
        "completeClaims",
        "identityReferences",
        "recordPayloadBytes",
        "recoveryExecutions",
    ])("exact %s success and one less refusal", async (axis) => {
        const e = await executionArtifacts();
        const f = inventoryFixture(
            withStore({ [canonical]: envelopeText(), [prepPath]: e.prepText, [receiptPath]: e.receiptText })
        );
        const full = await f.evidence();
        const used = full.budget.consumed[axis];
        expect(used).toBeGreaterThan(0);
        expect((await f.evidence(evidenceLimits({ [axis]: used }))).status).toBe("OBSERVATIONS_FINISHED");
        const refused = await f.evidence(evidenceLimits({ [axis]: used - 1 }));
        expect(refused.status).toBe("INCOMPLETE");
        expect(refused.budget.refusal.axis).toBe(axis);
        assertBoundary(refused);
    });
    it("physical decode budget cannot be re-created/reset for semantic work", async () => {
        const f = inventoryFixture(withStore({ [canonical]: envelopeText() }));
        const physical = await f.traverse();
        const r = await f.evidence(evidenceLimits({ decodeHashByteWork: physical.budget.consumed.decodeHashByteWork }));
        expect(r.status).toBe("INCOMPLETE");
        expect(r.budget.refusal.axis).toBe("decodeHashByteWork");
        expect(r.identityClaims).toEqual([]);
        assertBoundary(r);
    });
    it("declarationless unqualified evidence never gets empty-admitted-set absence", async () => {
        const e = await executionArtifacts();
        const r = await inventoryFixture({
            [canonical]: envelopeText(),
            [prepPath]: e.prepText,
            [receiptPath]: e.receiptText,
        }).evidence();
        expect(r.canonical[0].physicallyCanonical).toBe(true);
        expect(r.identityClaims).toHaveLength(2);
        expect(direct(r)).toEqual([]);
        expect(prior(r)).toEqual([]);
        assertBoundary(r);
    });
});

it("sealed UNKNOWN stays UNKNOWN beside a directly observed current candidate", async () => {
    const e = await executionArtifacts({}, { physicalEffect: "DISPATCH_OUTCOME_UNKNOWN" });
    const r = await inventoryFixture(
        withStore({ [canonical]: envelopeText(), [prepPath]: e.prepText, [receiptPath]: e.receiptText })
    ).evidence();
    expect(direct(r)).toHaveLength(1);
    expect(prior(r)).toHaveLength(1);
    expect(prior(r)[0].validation.evidence.physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
    expect(prior(r)[0].receipt.value.physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
});
it("purpose is sealed execution content while remaining outside logical mutation identity", async () => {
    const a = await executionArtifacts(),
        b = await executionArtifacts({ purpose: "exact-materialization" });
    const r = await inventoryFixture(
        withStore({
            [prepPath]: a.prepText,
            [`${branch}/recovery/mutations/purpose-twin`]: b.prepText,
            [receiptPath]: a.receiptText,
        })
    ).evidence();
    expect(r.executionArtifacts.find((g) => g.artifactKind === "preparation").state).toBe(
        "EXECUTION_ARTIFACT_CONFLICT"
    );
    expect(r.logicalMutations[0].state).toBe("EQUIVALENT_LOGICAL_MUTATION");
    expect(prior(r)).toEqual([]);
});
it.each(["storeId", "mutationId", "canonicalPublicationId"])(
    "F1 changed %s yields distinct execution artifacts",
    async (field) => {
        const a = await executionArtifacts();
        const b =
            field === "storeId"
                ? await executionArtifacts({}, {}, { storeId: testId("store", 2) })
                : await executionArtifacts({ [field]: testId(field === "mutationId" ? "mutation" : "publication", 2) });
        const r = await inventoryFixture(
            withStore({ [prepPath]: a.prepText, [`${branch}/recovery/mutations/distinct`]: b.prepText })
        ).evidence();
        const groups = r.executionArtifacts.filter((g) => g.artifactKind === "preparation");
        expect(groups).toHaveLength(2);
        expect(groups.every((g) => g.state === "EQUIVALENT")).toBe(true);
    }
);
it.each(["active", "deleted"])("complete canonical %s state/payload preserved", async (state) => {
    const r = await inventoryFixture(withStore({ [canonical]: envelopeText({ state }) })).evidence();
    expect(r.identityClaims[0].envelope.state).toBe(state);
    expect(r.identityClaims[0].envelope.payload).toEqual(canonicalEnvelope().payload);
    expect(direct(r)).toHaveLength(1);
});
it("higher fence is a factual observation and cannot demote supported-context direct canonical", async () => {
    const fence = JSON.stringify({
        schema: "finders-keepers.protocol-fence",
        version: 1,
        storeId: testId("store"),
        requiredProtocolVersion: 3,
    });
    const r = await inventoryFixture(
        withStore({ [canonical]: envelopeText(), [`${branch}/meta/protocol/fence`]: fence })
    ).evidence();
    expect(r.fences[0].value.requiredProtocolVersion).toBe(3);
    expect(direct(r)).toHaveLength(1);
    assertBoundary(r);
});
it("representation-only recovery proof never claims canonical-copy absence beyond its scope", async () => {
    const e = await executionArtifacts();
    const f = inventoryFixture(withStore({ [prepPath]: e.prepText, [receiptPath]: e.receiptText }));
    const directory = f.port.directoryHandle(root).value;
    const r = await f.evidence(evidenceLimits(), inventoryCodecs, [
        { ...f.scope, directory, entryRole: "representation-root" },
    ]);
    expect(prior(r)).toHaveLength(1);
    expect(prior(r)[0].canonicalCopyCoverage).toBe("UNKNOWN");
});

it.each([
    "canonical decode",
    "canonical digest",
    "preparation decode",
    "receipt decode",
    "fence decode",
    "state decode",
])("refusal at %s is pressure, never malformed or absence", async (stage) => {
    const e = await executionArtifacts();
    const file = stage.startsWith("canonical")
        ? canonical
        : stage === "preparation decode"
          ? prepPath
          : stage === "receipt decode"
            ? receiptPath
            : `${branch}/meta/${stage === "fence decode" ? "protocol" : "representation-states"}/fact`;
    const text = stage.startsWith("canonical")
        ? envelopeText()
        : stage === "preparation decode"
          ? e.prepText
          : stage === "receipt decode"
            ? e.receiptText
            : stage === "fence decode"
              ? fenceText()
              : stateText();
    const f = inventoryFixture(withStore({ [file]: text }));
    const physical = await f.traverse();
    const extra = stage === "canonical digest" ? rawBytes(text).byteLength * 256 - 1 : 0;
    const r = await f.evidence(
        evidenceLimits({ decodeHashByteWork: physical.budget.consumed.decodeHashByteWork + extra })
    );
    expect(r.status).toBe("INCOMPLETE");
    expect(r.budget.refusal.axis).toBe("decodeHashByteWork");
    expect(r.artifacts.find((a) => a.source.file.locator === file).content.status).toBe("INCOMPLETE");
    expect(r.findings.some((f) => f.stage === "RECOGNITION" && f.code === "OBSERVATION_INCOMPLETE")).toBe(true);
    assertBoundary(r);
});
it.each(["execution", "logical mutation", "prior inputs"])(
    "refusal during %s grouping/qualification retains claims",
    async (stage) => {
        const a = await executionArtifacts(),
            b = await executionArtifacts({ canonicalPublicationId: testId("publication", 2) });
        const first = `${branch}/recovery/mutations/a`,
            second = `${branch}/recovery/mutations/b`,
            receipt = `${branch}/recovery/outcomes/r`;
        const files = withStore({ [first]: a.prepText });
        if (stage === "execution") files[second] = a.prepText;
        if (stage === "logical mutation") files[second] = b.prepText;
        if (stage === "prior inputs") files[receipt] = a.receiptText;
        const f = inventoryFixture(files);
        const physical = await f.traverse();
        const p = rawBytes(a.prepText).byteLength,
            q = rawBytes(b.prepText).byteLength,
            rlen = rawBytes(a.receiptText).byteLength;
        const extra =
            stage === "execution"
                ? 384 * p + 256 * p + 256 * p - 1
                : stage === "logical mutation"
                  ? 384 * p + 256 * q + 128 * (p + q) - 1
                  : 384 * p + 256 * rlen + 256 * (p + rlen) - 1;
        const r = await f.evidence(
            evidenceLimits({ decodeHashByteWork: physical.budget.consumed.decodeHashByteWork + extra })
        );
        expect(r.status).toBe("INCOMPLETE");
        expect(r.budget.refusal.axis).toBe("decodeHashByteWork");
        expect(r.identityClaims.length).toBeGreaterThan(0);
        expect(
            r.findings.some(
                (f) =>
                    f.code === "OBSERVATION_INCOMPLETE" &&
                    f.stage ===
                        (stage === "execution"
                            ? "EXECUTION_GROUPING"
                            : stage === "logical mutation"
                              ? "MUTATION_GROUPING"
                              : "PRIOR_PUBLICATION")
            )
        ).toBe(true);
        expect(prior(r)).toEqual([]);
        assertBoundary(r);
    }
);

it("canonical kind-directory hint protocol cannot change a canonical role under broader incomplete observation", async () => {
    const file = `${branch}/records/protocol/canonical`,
        unavailable = `${branch}/records/other/unavailable`;
    const f = inventoryFixture(withStore({ [file]: envelopeText(), [unavailable]: envelopeText() }));
    f.controls.setReadCondition(f.scope.directory.root, unavailable, "UNAVAILABLE");
    const r = await f.evidence();
    expect(r.status).toBe("INCOMPLETE");
    expect(r.canonical.find((c) => c.source.file.locator === file).physicallyCanonical).toBe(true);
    expect(direct(r)).toHaveLength(1);
});

it.each(["DISPATCH_REPORTED_SUCCESS", "DISPATCH_OUTCOME_UNKNOWN"])(
    "current canonical presence cannot rewrite sealed NOT_ESTABLISHED / %s receipt",
    async (physicalEffect) => {
        const e = await executionArtifacts({}, { physicalEffect, canonicalObservation: "NOT_ESTABLISHED" });
        const r = await inventoryFixture(
            withStore({ [canonical]: envelopeText(), [prepPath]: e.prepText, [receiptPath]: e.receiptText })
        ).evidence();
        expect(direct(r)).toHaveLength(1);
        expect(prior(r)).toEqual([]);
        expect(r.priorPublications[0].validation.status).toBe("NOT_QUALIFIED");
        expect(r.priorPublications[0].canonicalCopyCoverage).toBe("PRESENT");
        expect(r.priorPublications[0].receipt.value.physicalEffect).toBe(physicalEffect);
        expect(r.priorPublications[0].receipt.value.canonicalObservation).toBe("NOT_ESTABLISHED");
    }
);

import { aggregateFixture, aggregateLimits, representationStateText } from "./helpers/storageS2V05Fixtures";
import { representationLineageChargeV05 } from "../src/storage/discoveryAggregateV05";
const aggDirect = (r) => direct(r.evidence);
const metadataFiles = (extra = {}) =>
    withStore({
        [`${branch}/meta/protocol/fence`]: fenceText(),
        [`${branch}/meta/representation-states/genesis`]: stateText(),
        ...extra,
    });
describe("Batch4 protocol and representation metadata", () => {
    it("supported declaration/fence/genesis yields factual assessments with no permission or active target", async () => {
        const r = await aggregateFixture(metadataFiles({ [canonical]: envelopeText() })).aggregate();
        expect(r.outcome).toBe("COMPLETE_ADMITTED");
        expect(r.protocols[0].fenceAssessment).toBe("WRITES_ALLOWED");
        expect(r.protocols[0].maximumKnownRequirement).toBe(2);
        expect(r.representations[0].genesis).toBe("PRESENT");
        expect(r.representations[0].lineage).toBe("REPRESENTATION_STATE_VALID");
        expect(aggDirect(r)).toHaveLength(1);
        assertBoundary(r);
    });
    it("missing fence is read-only fact and never removes direct canonical", async () => {
        const r = await aggregateFixture(withStore({ [canonical]: envelopeText() })).aggregate();
        expect(aggDirect(r)).toHaveLength(1);
        expect(r.protocols[0].fenceAssessment).toBe("READ_ONLY_MISSING_FENCE");
        expect(r.findings).toContain("READ_ONLY_MISSING_FENCE");
        expect(r.storeBoundAbsence).toBeUndefined();
        assertBoundary(r);
    });
    it("stronger alternate fence cannot lose to nominal weak fence", async () => {
        const stronger = JSON.stringify({
            schema: "finders-keepers.protocol-fence",
            version: 1,
            storeId: testId("store"),
            requiredProtocolVersion: 3,
        });
        const r = await aggregateFixture(
            metadataFiles({ [canonical]: envelopeText(), "alternate/stores/b/meta/protocol/newer": stronger })
        ).aggregate();
        expect(r.protocols[0].maximumKnownRequirement).toBe(3);
        expect(r.protocols[0].hasStrongerRequirement).toBe(true);
        expect(r.protocols[0].fenceAssessment).toBe("READ_ONLY_UNSUPPORTED_NEWER_PROTOCOL");
        expect(aggDirect(r)).toHaveLength(1);
        assertBoundary(r);
    });
    it("protocol3 declaration contributes unsupported requirement even without any fence", async () => {
        const r = await aggregateFixture({
            [`${branch}/decl.json`]: declarationText({ requiredProtocolVersion: 3 }),
        }).aggregate();
        expect(r.protocols[0].maximumKnownRequirement).toBe(3);
        expect(r.protocols[0].hasUnsupportedDeclaration).toBe(true);
        expect(r.findings).toContain("READ_ONLY_UNSUPPORTED_NEWER_PROTOCOL");
        expect(r.coherentSupportedDeclarationIds).toEqual([]);
        expect(r.storeBoundAbsence).toBeUndefined();
    });
    it.each(["unknown", "malformed", "unavailable"])("good fence cannot erase %s sibling", async (mode) => {
        const path = `${branch}/meta/protocol/sibling`;
        const f = aggregateFixture(
            metadataFiles({
                [canonical]: envelopeText(),
                [path]: mode === "malformed" ? "{bad" : mode === "unknown" ? '{"unknown":true}' : fenceText(),
            })
        );
        if (mode === "unavailable") f.controls.setReadCondition(f.scope.directory.root, path, "UNAVAILABLE");
        const r = await f.aggregate();
        expect(r.protocols[0].unknownFenceEvidence).toBeGreaterThan(0);
        expect(r.protocols[0].fenceAssessment).toBe("READ_ONLY_UNRECOGNIZED_FENCE");
        expect(aggDirect(r)).toHaveLength(1);
        expect(r.observation.status).toBe(mode === "unavailable" ? "INCOMPLETE" : "COMPLETE");
        expect(r.storeBoundAbsence).toBeUndefined();
    });
    it.each(["missing", "wrong representation", "wrong parent", "migration genesis"])(
        "planned genesis %s preserved distinctly",
        async (mode) => {
            const files = withStore();
            if (mode !== "missing")
                files[`${branch}/meta/representation-states/genesis`] = representationStateText(
                    mode === "wrong representation"
                        ? { representation: "visible" }
                        : mode === "wrong parent"
                          ? {
                                parentRepresentationStateId: testId("representation-state", 2),
                                establishedByMigrationId: testId("migration"),
                            }
                          : { establishedByMigrationId: testId("migration") }
                );
            const r = await aggregateFixture(files).aggregate();
            expect(r.representations[0].genesis).toBe(mode === "missing" ? "MISSING" : "CONFLICT");
            assertBoundary(r);
        }
    );
    it("split-provider parent/child is one supplied valid lineage, not active representation", async () => {
        const child = representationStateText({
            representationStateId: testId("representation-state", 2),
            parentRepresentationStateId: testId("representation-state"),
            representation: "visible",
            establishedByMigrationId: testId("migration"),
        });
        const r = await aggregateFixture(
            metadataFiles({ "alternate/stores/b/meta/representation-states/child": child })
        ).aggregate();
        expect(r.representations[0].identities).toHaveLength(2);
        expect(r.representations[0].lineage).toBe("REPRESENTATION_STATE_VALID");
        assertBoundary(r);
    });
    it.each(["missing parent", "competing children", "cycle", "identity conflict", "competing genesis"])(
        "S1 state %s semantics and every copy retained",
        async (mode) => {
            const files = metadataFiles();
            const a = testId("representation-state", 2),
                b = testId("representation-state", 3),
                g = testId("representation-state");
            files[`${branch}/meta/representation-states/a`] = representationStateText(
                mode === "missing parent"
                    ? {
                          representationStateId: a,
                          parentRepresentationStateId: testId("representation-state", 99),
                          establishedByMigrationId: testId("migration"),
                      }
                    : mode === "cycle"
                      ? {
                            representationStateId: a,
                            parentRepresentationStateId: b,
                            establishedByMigrationId: testId("migration"),
                        }
                      : mode === "identity conflict"
                        ? { representation: "visible" }
                        : mode === "competing genesis"
                          ? { representationStateId: a }
                          : {
                                representationStateId: a,
                                parentRepresentationStateId: g,
                                establishedByMigrationId: testId("migration"),
                            }
            );
            if (mode === "cycle" || mode === "competing children")
                files[`${branch}/meta/representation-states/b`] = representationStateText({
                    representationStateId: b,
                    parentRepresentationStateId: mode === "cycle" ? a : g,
                    establishedByMigrationId: testId("migration", 2),
                });
            const r = await aggregateFixture(files).aggregate();
            const expected =
                mode === "missing parent"
                    ? "LINEAGE_INDETERMINATE"
                    : mode === "cycle" || mode === "identity conflict"
                      ? "REPRESENTATION_STATE_INVALID"
                      : "REPRESENTATION_STATE_DIVERGENT";
            expect(r.representations[0].lineage).toBe(expected);
            if (mode === "identity conflict") expect(r.representations[0].identities[0].conflictingContent).toBe(true);
            if (mode === "competing genesis") expect(r.representations[0].competingGenesisIds).toHaveLength(1);
            assertBoundary(r);
        }
    );
    it("opaque migration blocks qualification, preserves direct/prior facts and never becomes commit", async () => {
        const e = await executionArtifacts({}, { physicalEffect: "DISPATCH_OUTCOME_UNKNOWN" });
        const path = `${branch}/meta/migrations/${testId("migration")}/phase`;
        const r = await aggregateFixture(
            metadataFiles({
                [canonical]: envelopeText(),
                [prepPath]: e.prepText,
                [receiptPath]: e.receiptText,
                [path]: "opaque migration",
            })
        ).aggregate();
        expect(r.unqualifiedMigrationEvidence).toBe(true);
        expect(r.findings).toContain("UNQUALIFIED_MIGRATION_EVIDENCE");
        expect(aggDirect(r)).toHaveLength(1);
        expect(prior(r.evidence)).toHaveLength(1);
        expect(prior(r.evidence)[0].validation.evidence.physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
        expect(r.storeBoundAbsence).toBeUndefined();
        assertBoundary(r);
    });
    it("namespace/state health failure preserves individual direct role", async () => {
        const r = await aggregateFixture({
            [`${branch}/decl.json`]: declarationText(),
            [canonical]: envelopeText(),
            [`${branch}/meta/representation-states/state`]: representationStateText({
                parentRepresentationStateId: testId("representation-state", 2),
                establishedByMigrationId: testId("migration"),
            }),
        }).aggregate();
        expect(aggDirect(r)).toHaveLength(1);
        expect(r.findings).toContain("MISSING_NAMESPACE");
        expect(r.representations[0].lineage).toBe("LINEAGE_INDETERMINATE");
        assertBoundary(r);
    });
    it("equivalent state physical copies count before identity collapse", async () => {
        const r = await aggregateFixture(
            metadataFiles({ [`${branch}/meta/representation-states/twin`]: stateText() })
        ).aggregate();
        expect(r.representations[0].identities).toHaveLength(1);
        expect(r.representations[0].identities[0].variants[0].copies).toHaveLength(2);
        expect(r.accounting.observedPhysicalFiles).toBe(5);
    });
    it("state-lineage precharge exact success, one-less refusal and checked overflow", async () => {
        const f = aggregateFixture(metadataFiles());
        const n = representationLineageChargeV05(1);
        expect((await f.aggregate(aggregateLimits({ representationLineageWork: n }))).representations[0].lineage).toBe(
            "REPRESENTATION_STATE_VALID"
        );
        const r = await f.aggregate(aggregateLimits({ representationLineageWork: n - 1 }));
        expect(r.outcome).toBe("INCOMPLETE");
        expect(r.representations[0].lineage).toBe("NOT_EVALUATED");
        expect(r.budget.refusal.axis).toBe("representationLineageWork");
        expect(representationLineageChargeV05(Number.MAX_SAFE_INTEGER)).toBe(Infinity);
        assertBoundary(r);
    });
});
describe("Batch4 finite admission and accounting", () => {
    it.each(["stores", "records", "distinctRevisions", "parentEdges", "representationStates"])(
        "exact %s admission and one-less refusal preserve complete observation",
        async (axis) => {
            const f = aggregateFixture(
                metadataFiles({ [canonical]: envelopeText({ parentRevisionId: testId("revision", 2) }) })
            );
            const full = await f.aggregate();
            const count = full.accounting.logicalCounts[axis];
            expect(count).toBeGreaterThan(0);
            expect((await f.aggregate(aggregateLimits({ [axis]: count }))).outcome).toBe("COMPLETE_ADMITTED");
            const r = await f.aggregate(aggregateLimits({ [axis]: count - 1 }));
            expect(r.outcome).toBe("COMPLETE_REFUSED");
            expect(r.observation.status).toBe("COMPLETE");
            expect(r.admission.status).toBe("REFUSED");
            expect(r.budget.refusal.axis).toBe(axis);
            expect(r.storeBoundAbsence).toBeUndefined();
            expect(r.evidence.identityClaims).toHaveLength(1);
            assertBoundary(r);
        }
    );
    it("processing refusal remains incomplete while post-observation admission refusal is distinct", async () => {
        const f = aggregateFixture(withStore({ [canonical]: envelopeText() }));
        const processing = await f.aggregate(aggregateLimits({ listCalls: 0 }));
        const admission = await f.aggregate(aggregateLimits({ records: 0 }));
        expect(processing.outcome).toBe("INCOMPLETE");
        expect(processing.observation.status).toBe("INCOMPLETE");
        expect(admission.outcome).toBe("COMPLETE_REFUSED");
        expect(admission.observation.status).toBe("COMPLETE");
        assertBoundary(processing);
        assertBoundary(admission);
    });
    it("capacity never prunes conflicting/nonauthoritative evidence to fit", async () => {
        const a = await executionArtifacts(),
            b = await executionArtifacts({}, {}, { payload: { text: "conflicting full claim" } });
        const r = await aggregateFixture(
            withStore({
                [canonical]: envelopeText(),
                [prepPath]: a.prepText,
                [`${branch}/recovery/mutations/conflict`]: b.prepText,
                [receiptPath]: a.receiptText,
            })
        ).aggregate(aggregateLimits({ records: 0 }));
        expect(r.outcome).toBe("COMPLETE_REFUSED");
        expect(r.evidence.identityClaims).toHaveLength(3);
        expect(r.evidence.executionArtifacts.some((g) => g.state === "EXECUTION_ARTIFACT_CONFLICT")).toBe(true);
        expect(r.storeBoundAbsence).toBeUndefined();
        assertBoundary(r);
    });
    it("duplicate physical files and bytes are charged despite equivalent logical content", async () => {
        const r = await aggregateFixture(
            withStore({ [canonical]: envelopeText(), [`${branch}/records/kind/twin`]: envelopeText() })
        ).aggregate();
        expect(r.accounting.logicalCounts.distinctRevisions).toBe(1);
        expect(r.accounting.observedPhysicalFiles).toBe(4);
        expect(r.evidence.identityClaims).toHaveLength(2);
        expect(r.accounting.knownPhysicalBytes).toBeGreaterThan(rawBytes(envelopeText()).byteLength * 2);
        assertBoundary(r);
    });
    it("metadata permutations preserve store/protocol/state logical facts", async () => {
        const a = aggregateFixture(metadataFiles()),
            b = aggregateFixture({
                "provider/stores/b/meta/protocol/fence": JSON.stringify({
                    schema: "finders-keepers.protocol-fence",
                    version: 1,
                    storeId: testId("store"),
                    requiredProtocolVersion: 3,
                }),
            });
        const one = await a.aggregate(aggregateLimits(), undefined, [a.scope, b.scope]),
            two = await a.aggregate(aggregateLimits(), undefined, [b.scope, a.scope]);
        const facts = (r) => ({
            ids: r.storeIds,
            protocol: r.protocols.map((p) => [
                p.storeId,
                p.maximumKnownRequirement,
                p.fenceAssessment,
                p.unknownFenceEvidence,
            ]),
            states: r.representations.map((s) => [
                s.storeId,
                s.lineage,
                s.genesis,
                s.identities.map((i) => i.representationStateId),
            ]),
            findings: r.findings,
        });
        expect(facts(one)).toEqual(facts(two));
    });
});

it("Batch4 aggregate imports only permitted metadata helpers, never record heads/S3/writers", () => {
    const source = ts.createSourceFile(
        "aggregate",
        fs.readFileSync("src/storage/discoveryAggregateV05.ts", "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const body = ts.createPrinter({ removeComments: true }).printFile(source);
    expect(body).not.toMatch(
        /\b(indexQualifiedRevisionGraph|classifyRecordRevisions|evaluateIndexedHeadRelations|publishFresh|createImmutable|writeSnapshot|localGuarantees|obsidian|RecoveryIntentV1|StoreArtifactV1)\b/
    );
    const allowed = new Set([
        "./discoverySemanticsV05",
        "./discoveryBudget",
        "./repositorySemantics",
        "./canonicalEncoding",
        "./protocol",
        "./identity",
        "./authorityArtifacts",
        "./discoveryTraversalV05",
    ]);
    for (const statement of source.statements)
        if (ts.isImportDeclaration(statement)) {
            expect(allowed.has(statement.moduleSpecifier.text)).toBe(true);
            if (statement.moduleSpecifier.text === "./repositorySemantics")
                for (const name of statement.importClause.namedBindings.elements)
                    expect(
                        new Set([
                            "assessProtocolWriteFence",
                            "classifyStoreInventory",
                            "validateRepresentationStateLineage",
                            "ProtocolFenceState",
                            "RepresentationLineageState",
                        ]).has(name.name.text)
                    ).toBe(true);
        }
});

it("Batch4 interrupted decoded evidence never becomes completed observation merely because bytes were read", async () => {
    const f = aggregateFixture(withStore({ [canonical]: envelopeText() }));
    const physical = await f.traverse();
    const r = await f.aggregate(aggregateLimits({ decodedBytes: physical.budget.consumed.decodedBytes }));
    expect(r.outcome).toBe("INCOMPLETE");
    expect(r.observation.physical).toBe("COMPLETE");
    expect(r.observation.status).toBe("INCOMPLETE");
    expect(r.admission.status).toBe("REFUSED");
    expect(r.storeBoundAbsence).toBeUndefined();
    assertBoundary(r);
});

import { repositoryFixture, unwrap } from "./helpers/storageS2V05Fixtures";
import {
    validateExplicitResolutionCoverageFromHeads,
    relateIndexedRevisions,
} from "../src/storage/repositorySemantics";
const rid = (n) => testId("revision", n);
const revision = (n, parent = null, resolved = [], changes = {}) => ({
    ...canonicalEnvelope(),
    revisionId: rid(n),
    parentRevisionId: parent === null ? null : rid(parent),
    resolvedRevisionIds: resolved.map(rid).sort(),
    ...changes,
});
const revisionFiles = (values) =>
    Object.fromEntries(values.map((v, i) => [`${branch}/records/k/copy-${i}`, envelopeText(v)]));
const repoWith = (values, extra = {}) => repositoryFixture(withStore({ ...revisionFiles(values), ...extra }));
const recordResult = (r) => {
    expect(r.outcome).toBe("COMPLETE");
    expect(r.records).toHaveLength(1);
    return r.records[0];
};
const noAuthority = (r) => {
    expect(r.outcome).toBe("NOT_INTERPRETED");
    expect(r).not.toHaveProperty("records");
    expect(r).not.toHaveProperty("index");
    expect(r).not.toHaveProperty("current");
    expect(r.diagnostics.every((d) => !("index" in d) && !("currentHeads" in d))).toBe(true);
};
const repoBoundary = (r) => {
    for (const value of [r, ...(r.records ?? [])]) {
        for (const field of [
            "mayMutate",
            "mayBootstrap",
            "mayResolve",
            "mayRetry",
            "mayRepair",
            "mayMaterialize",
            "publicationTarget",
            "activeRepresentation",
            "migrationCommit",
        ])
            expect(value).not.toHaveProperty(field);
    }
};
const permutations3 = (values) => [
    values,
    [values[0], values[2], values[1]],
    [values[1], values[0], values[2]],
    [values[1], values[2], values[0]],
    [values[2], values[0], values[1]],
    [...values].reverse(),
];

describe("Batch5 complete scoped record interpretation", () => {
    it("linear complete qualified inventory uses one graph, indexed children and current C", async () => {
        const r = await repoWith([revision(1), revision(2, 1), revision(3, 2)]).repository();
        const record = recordResult(r);
        expect(record.ordinaryMaximalHeads).toEqual([rid(3)]);
        expect(record.current.envelope.revisionId).toBe(rid(3));
        expect(record.state).toBe("LINEAR_DESCENDANT");
        expect(record.qualifiedRevisionIds).toEqual([rid(1), rid(2), rid(3)]);
        expect(record.identityClaims).toHaveLength(3);
        expect(r.work.indexBuilds).toBe(1);
        expect(r.work.maximaScanUnits).toBe(3);
        repoBoundary(r);
    });
    it("proven divergence retains both ordinary/current heads and subordinate competition", async () => {
        const record = recordResult(await repoWith([revision(1), revision(2, 1), revision(3, 1)]).repository());
        expect(record.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(record.ordinaryMaximalHeads).toEqual([rid(2), rid(3)]);
        expect(record.currentHeads.map((h) => h.envelope.revisionId)).toEqual([rid(2), rid(3)]);
        expect(record.pairRelations[0].relation).toBe("competing");
        expect(record).not.toHaveProperty("current");
    });
    it("disconnected missing boundaries stay unknown", async () => {
        const record = recordResult(await repoWith([revision(1, 90), revision(2, 91)]).repository());
        expect(record.state).toBe("LINEAGE_INDETERMINATE");
        expect(record.pairRelations[0].relation).toBe("unknown");
        expect([...record.missingBoundaryIds].sort()).toEqual([rid(90), rid(91)]);
        expect(record).not.toHaveProperty("current");
    });
    it.each(permutations3([revision(1, 2), revision(2, 1), revision(3, 1, [1, 2])]).map((v, i) => [i, v]))(
        "C1 permutation %s cannot resolve cycle",
        async (_i, values) => {
            const record = recordResult(await repoWith(values).repository());
            expect(record.state).toBe("LINEAGE_INDETERMINATE");
            expect(record.hasParentCycle).toBe(true);
            expect(record.ordinaryMaximalHeads).toBeUndefined();
            expect(record.qualifiedRevisionIds).toHaveLength(3);
            expect(record).not.toHaveProperty("current");
        }
    );
    it.each(permutations3([revision(1, 90), revision(2, 90), revision(3, 91)]).map((v, i) => [i, v]))(
        "C2 permutation %s keeps necessary unknown above proven competition",
        async (_i, values) => {
            const record = recordResult(await repoWith(values).repository());
            expect(record.state).toBe("LINEAGE_INDETERMINATE");
            expect(record.pairRelations.filter((p) => p.relation === "competing")).toHaveLength(1);
            expect(record.pairRelations.filter((p) => p.relation === "unknown")).toHaveLength(2);
            expect(record.ordinaryMaximalHeads).toEqual([rid(1), rid(2), rid(3)]);
        }
    );
    it("valid scoped resolution preserves ordinary maxima separately from current", async () => {
        const record = recordResult(
            await repoWith([revision(1), revision(2, 1), revision(3, 1), revision(4, 2, [2, 3])]).repository()
        );
        expect(record.ordinaryMaximalHeads).toEqual([rid(3), rid(4)]);
        expect(record.state).toBe("RESOLVED_LINEAGE");
        expect(record.currentHeads.map((h) => h.envelope.revisionId)).toEqual([rid(4)]);
        expect(record.historicalResolvedRevisionIds).toEqual([rid(3)]);
    });
    it("resolver descendant carries scope and exact old-head copy remains historical", async () => {
        const values = [
            revision(1),
            revision(2, 1),
            revision(3, 1),
            revision(4, 2, [2, 3]),
            revision(5, 4),
            revision(3, 1),
        ];
        const record = recordResult(await repoWith(values).repository());
        expect(record.ordinaryMaximalHeads).toEqual([rid(3), rid(5)]);
        expect(record.current.envelope.revisionId).toBe(rid(5));
        expect(record.state).toBe("RESOLVED_LINEAGE");
    });
    it("new descendant of old resolved head remains competition", async () => {
        const record = recordResult(
            await repoWith([
                revision(1),
                revision(2, 1),
                revision(3, 1),
                revision(4, 2, [2, 3]),
                revision(5, 3),
            ]).repository()
        );
        expect(record.ordinaryMaximalHeads).toEqual([rid(4), rid(5)]);
        expect(record.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(record.currentHeads).toHaveLength(2);
    });
    it("stale dominated resolver cannot suppress unrelated current competition", async () => {
        const record = recordResult(
            await repoWith([
                revision(1),
                revision(2, 1),
                revision(3, 1),
                revision(4, 2, [2, 3]),
                revision(5, 2),
                revision(6, 5, [4, 5]),
            ]).repository()
        );
        expect(record.ordinaryMaximalHeads).toEqual([rid(3), rid(4), rid(6)]);
        expect(record.state).toBe("DIVERGENT_VALID_REVISIONS");
        expect(record.currentHeads.map((h) => h.envelope.revisionId)).toEqual([rid(3), rid(6)]);
        expect(record.historicalResolvedRevisionIds).not.toContain(rid(3));
    });
    it("tombstone remains current logical deleted revision", async () => {
        const record = recordResult(
            await repoWith([
                revision(1),
                revision(2, 1, [], { state: "deleted", payload: { text: "deleted" } }),
            ]).repository()
        );
        expect(record.current.envelope.state).toBe("deleted");
        expect(record.ordinaryMaximalHeads).toEqual([rid(2)]);
    });
    it("equivalent copies retain physical provenance but one qualified node", async () => {
        const r = await repoWith([revision(1), revision(1), revision(1)]).repository();
        const record = recordResult(r);
        expect(record.direct).toHaveLength(3);
        expect(record.qualifiedRevisionIds).toEqual([rid(1)]);
        expect(record.ordinaryMaximalHeads).toEqual([rid(1)]);
        expect(r.aggregate.accounting.observedPhysicalFiles).toBeGreaterThanOrEqual(5);
    });
    it("direct and prior same revision retain both families, one head, no permission", async () => {
        const ex = await executionArtifacts();
        const r = await repoWith([canonicalEnvelope()], {
            [prepPath]: ex.prepText,
            [receiptPath]: ex.receiptText,
        }).repository();
        const record = recordResult(r);
        expect(record.direct).toHaveLength(1);
        expect(record.prior).toHaveLength(1);
        expect(record.qualifiedEvidence.map((e) => e.role).sort()).toEqual([
            "DIRECT_CANONICAL",
            "QUALIFIED_PRIOR_PUBLICATION",
        ]);
        expect(record.qualifiedRevisionIds).toEqual([rid(1)]);
        repoBoundary(r);
    });
    it("qualified prior-only graph node requires no canonical copy or repair permission", async () => {
        const ex = await executionArtifacts({}, { physicalEffect: "DISPATCH_OUTCOME_UNKNOWN" });
        const r = await repoWith([], { [prepPath]: ex.prepText, [receiptPath]: ex.receiptText }).repository();
        const record = recordResult(r);
        expect(record.current.envelope.revisionId).toBe(rid(1));
        expect(record.direct).toHaveLength(0);
        expect(record.prior[0].receipt.value.physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
        repoBoundary(r);
    });
    it.each(["canonical", "preparation", "misplaced"])(
        "unqualified %s claims never become absent or graph authority",
        async (family) => {
            const ex = await executionArtifacts();
            const files =
                family === "preparation"
                    ? { [prepPath]: ex.prepText }
                    : family === "misplaced"
                      ? { [prepPath]: envelopeText() }
                      : { [canonical]: envelopeText() };
            const r = await repositoryFixture(files).repository();
            const record = recordResult(r);
            expect(record.interpretation).toBe("UNQUALIFIED_EVIDENCE");
            expect(record.identityClaims).toHaveLength(1);
            expect(record).not.toHaveProperty("state");
            expect(record).not.toHaveProperty("ordinaryMaximalHeads");
        }
    );
    it.each(["direct-direct", "direct-prior", "direct-preparation", "prior-preparation", "unqualified-canonical"])(
        "complete identity collision %s precedes authority/head interpretation",
        async (family) => {
            const altered = { payload: { text: "incompatible" } };
            const ex = await executionArtifacts({}, {}, altered);
            let f;
            if (family === "direct-direct") f = repoWith([canonicalEnvelope(), { ...canonicalEnvelope(), ...altered }]);
            else if (family === "direct-prior")
                f = repoWith([canonicalEnvelope()], { [prepPath]: ex.prepText, [receiptPath]: ex.receiptText });
            else if (family === "direct-preparation") f = repoWith([canonicalEnvelope()], { [prepPath]: ex.prepText });
            else if (family === "prior-preparation") {
                const good = await executionArtifacts({
                    canonicalPublicationId: testId("publication", 2),
                    mutationId: testId("mutation", 2),
                });
                f = repoWith([], {
                    [prepPath]: ex.prepText,
                    [prepPath + "good"]: good.prepText,
                    [receiptPath + "good"]: good.receiptText,
                });
            } else f = repoWith([canonicalEnvelope()], { [prepPath]: envelopeText(altered) });
            const record = recordResult(await f.repository());
            expect(record.state).toBe("REVISION_IDENTITY_INVALID");
            expect(record.interpretation).toBe("IDENTITY_INVALID");
            expect(record.identityClaims).toHaveLength(2);
            expect(record).not.toHaveProperty("ordinaryMaximalHeads");
            expect(record).not.toHaveProperty("current");
        }
    );
    it.each(["parent", "target", "stale", "unqualified-parent", "unqualified-target", "payload"])(
        "F2 complete S2 index preserves %s freshness domain",
        async (mode) => {
            const m = 90,
                values = [revision(1), revision(2, 1), revision(3, 1)];
            let extra = {};
            if (mode === "parent") values[0] = revision(1, m);
            if (mode === "target") values[0] = revision(1, 89, [89, m]);
            if (mode === "stale") values[0] = revision(1, 89, [89, m]);
            if (mode === "payload") values[0] = revision(1, null, [], { payload: { text: rid(m) } });
            if (mode.startsWith("unqualified")) {
                const claim = mode === "unqualified-parent" ? revision(8, m) : revision(8, 89, [89, m]);
                const ex = await executionArtifacts(
                    mode === "unqualified-target"
                        ? {
                              purpose: "transition",
                              resolutionHeads: [89, m].map((id) => ({
                                  revisionId: rid(id),
                                  digest: `sha256:${"1".repeat(64)}`,
                              })),
                          }
                        : {},
                    { canonicalObservation: "NOT_ESTABLISHED" },
                    claim
                );
                extra = { [prepPath]: ex.prepText };
            }
            const record = recordResult(await repoWith(values, extra).repository());
            expect(record.state).toBe("DIVERGENT_VALID_REVISIONS");
            const bindings = record.currentHeads.map((h) => ({ revisionId: h.envelope.revisionId, digest: h.digest }));
            const check = (id) =>
                validateExplicitResolutionCoverageFromHeads(
                    revision(id, 2, [2, 3]),
                    record.index,
                    record.ordinaryMaximalHeads,
                    bindings
                );
            expect(check(99).validation.valid).toBe(true);
            expect(check(m).validation.valid).toBe(mode === "payload");
            if (mode.startsWith("unqualified")) expect(record.qualifiedRevisionIds).not.toContain(rid(8));
        }
    );
    it.each(["partial", "admission", "narrow"])("%s upstream gate produces no actual repository/head", async (mode) => {
        const f = repoWith([revision(1)]);
        let r;
        if (mode === "partial") {
            f.controls.setReadCondition(
                f.scope.directory.root,
                canonical.replace("opaque-kind/canonical", "k/copy-0"),
                "UNAVAILABLE"
            );
            r = await f.repository();
        } else if (mode === "admission") r = await f.repository(aggregateLimits({ records: 0 }));
        else {
            const directory = unwrap(f.port.directoryHandle(root));
            r = await f.repository(aggregateLimits(), inventoryCodecs, [
                { ...f.scope, directory, entryRole: "representation-root" },
            ]);
        }
        noAuthority(r);
        expect(r.work.indexBuilds).toBe(0);
    });
    it.each(["graphWork", "ordinaryHeads", "resolutionWork"])(
        "%s exact finite boundary passes; one below refuses without index/head",
        async (axis) => {
            const f = repoWith([revision(1), revision(2, 1), revision(3, 1)]);
            const good = await f.repository();
            const used = good.budget.consumed[axis];
            expect(used).toBeGreaterThan(0);
            expect((await f.repository(aggregateLimits({ [axis]: used }))).outcome).toBe("COMPLETE");
            const refused = await f.repository(aggregateLimits({ [axis]: used - 1 }));
            noAuthority(refused);
            expect(refused.budget.refusal.axis).toBe(axis);
        }
    );
    it.each(["completeClaims", "identityReferences", "parentEdges", "distinctRevisions", "records"])(
        "%s capacity refuses without dropping claims",
        async (axis) => {
            const f = repoWith([revision(1), revision(2, 1), revision(3, 1)]);
            const good = await f.repository();
            const used = good.budget.consumed[axis];
            const exact = await f.repository(aggregateLimits({ [axis]: used }));
            expect(exact.outcome).toBe("COMPLETE");
            const refused = await f.repository(aggregateLimits({ [axis]: used - 1 }));
            noAuthority(refused);
            expect(refused.budget.refusal.axis).toBe(axis);
        }
    );
    it("long linear index work grows linearly, one build, no historical pair walk", async () => {
        const run = async (n) =>
            repoWith(Array.from({ length: n }, (_, i) => revision(i + 1, i === 0 ? null : i))).repository();
        const a = await run(40),
            b = await run(80);
        for (const [r, n] of [
            [a, 40],
            [b, 80],
        ]) {
            expect(r.outcome).toBe("COMPLETE");
            expect(r.work.indexBuilds).toBe(1);
            expect(r.work.maximaScanUnits).toBe(n);
            expect(r.work.graphEvents["parent-edge"]).toBe(n - 1);
            expect(r.work.graphEvents["node"]).toBe(n);
            expect(r.work.graphEvents["cycle-visit"]).toBe(n);
            expect(r.work.graphEvents["interval-visit"]).toBe(2 * n);
            expect(r.work.resolutionEvents["ancestry-relation"] ?? 0).toBe(0);
        }
        const total = (r) => Object.values(r.work.graphEvents).reduce((a, b) => a + b, 0);
        expect(total(b)).toBeLessThanOrEqual(2 * total(a) + 1);
        const record = recordResult(b);
        let units = 0;
        for (let i = 0; i < 20; i++)
            expect(
                relateIndexedRevisions(record.index, rid(1), rid(80), () => {
                    units++;
                }).relation
            ).toBe("left-ancestor");
        expect(units).toBe(20);
        expect(b.work.indexBuilds).toBe(1);
    });
    it("finite wide forest uses head-pair work, never history rebuild", async () => {
        const r = await repoWith([
            revision(1),
            ...Array.from({ length: 8 }, (_, i) => revision(i + 2, 1)),
        ]).repository();
        const record = recordResult(r);
        expect(record.ordinaryMaximalHeads).toHaveLength(8);
        expect(r.work.indexBuilds).toBe(1);
        expect(r.work.resolutionEvents["ancestry-relation"]).toBe(28);
    });
    it("provider/copy permutations never choose winner or cross StoreId", async () => {
        for (const swapped of [false, true]) {
            const a = repoWith([revision(1), revision(2, 1)]),
                b = repoWith([revision(3, 1)]);
            const r = await a.repository(
                aggregateLimits(),
                inventoryCodecs,
                swapped ? [b.scope, a.scope] : [a.scope, b.scope]
            );
            const record = recordResult(r);
            expect(record.state).toBe("DIVERGENT_VALID_REVISIONS");
            expect(record.ordinaryMaximalHeads).toEqual([rid(2), rid(3)]);
        }
        const a = repoWith([revision(1)]),
            b = repositoryFixture(withStore({ [canonical]: envelopeText({ storeId: testId("store", 2) }) }));
        b.controls.seedFile(
            b.scope.directory.root,
            `${branch}/store.json`,
            rawBytes(declarationText({ storeId: testId("store", 2) }))
        );
        const r = await a.repository(aggregateLimits(), inventoryCodecs, [a.scope, b.scope]);
        expect(r.records).toHaveLength(2);
        expect(r.aggregate.storeInventory).toBe("MULTIPLE_STORE_IDS");
        expect(r.records.map((x) => x.storeId)).toEqual([testId("store"), testId("store", 2)]);
    });
    it("metadata blockers retain record interpretation and no permission", async () => {
        const r = await repoWith([revision(1)], {
            [`${branch}/meta/protocol/newer`]: JSON.stringify({
                ...JSON.parse(fenceText()),
                requiredProtocolVersion: 3,
            }),
            [`${branch}/meta/migrations/m/opaque`]: "opaque",
        }).repository();
        expect(recordResult(r).current.envelope.revisionId).toBe(rid(1));
        expect(r.aggregate.findings).toContain("READ_ONLY_UNSUPPORTED_NEWER_PROTOCOL");
        repoBoundary(r);
    });
});

it("Batch5 strict imports use only accepted S1 indexed graph/head APIs and no writer", () => {
    const text = fs.readFileSync("src/storage/discoveryRepositoryV05.ts", "utf8");
    const parsed = ts.createSourceFile("repo.ts", text, ts.ScriptTarget.Latest, true);
    const names = [];
    for (const item of parsed.statements)
        if (ts.isImportDeclaration(item)) {
            const target = item.moduleSpecifier.text;
            expect(target).toMatch(
                /^\.\/(discoveryAggregateV05|repositorySemantics|recoveryArtifacts|identity|discoverySemanticsV05|discoveryBudget|canonicalEncoding)$/
            );
            if (target === "./repositorySemantics")
                names.push(
                    ...item.importClause.namedBindings.elements.filter((e) => !e.isTypeOnly).map((e) => e.name.text)
                );
        }
    expect(names.sort()).toEqual(["evaluateIndexedHeadRelations", "indexQualifiedRevisionGraph"]);
    for (const forbidden of [
        "mayMutate",
        "mayBootstrap",
        "mayResolve",
        "mayRetry",
        "mayRepair",
        "mayMaterialize",
        "publishFresh",
        "writeSnapshot",
        "createImmutable",
        "Obsidian",
        "writeGate:",
    ])
        expect(text).not.toContain(forbidden);
});
it("Batch5 returned claims and head arrays cannot mutate issued index or later result", async () => {
    const f = repoWith([revision(1), revision(2, 1)]),
        r = await f.repository(),
        record = recordResult(r);
    expect(() => record.ordinaryMaximalHeads.push(rid(8))).toThrow();
    expect(() => record.identityClaims[0].envelope.resolvedRevisionIds.push(rid(8))).toThrow();
    expect(() => r.records.push(record)).toThrow();
    expect(record.index.revisionIds).toEqual([rid(1), rid(2)]);
    expect(recordResult(await f.repository()).current.envelope.revisionId).toBe(rid(2));
});
it("Batch5 zero head/resolution profiles refuse, no branch pruning or authority prefix", async () => {
    for (const axis of ["ordinaryHeads", "resolutionWork"]) {
        const r = await repoWith([revision(1)]).repository(aggregateLimits({ [axis]: 0 }));
        noAuthority(r);
        expect(r.budget.refusal.axis).toBe(axis);
        expect(r.budget.refusal.current).toBe(0);
    }
});
it("Batch5 true empty completed namespace exposes empty records plus scoped absence, never permissions", async () => {
    const r = await repositoryFixture().repository();
    expect(r.outcome).toBe("COMPLETE");
    expect(r.records).toEqual([]);
    expect(r.aggregate.storeBoundAbsence).toBeDefined();
    repoBoundary(r);
});
it("Batch5 good scope cannot hide failed scope despite same rootIdentity", async () => {
    const a = repoWith([revision(1)]),
        b = repoWith([revision(2)]);
    b.controls.setReadCondition(b.scope.directory.root, `${branch}/records/k/copy-0`, "UNAVAILABLE");
    const r = await a.repository(aggregateLimits(), inventoryCodecs, [a.scope, b.scope]);
    noAuthority(r);
    expect(r.work.indexBuilds).toBe(0);
});
it("Batch5 supported declaration on A qualifies canonical on B through content, missing fence independent", async () => {
    const a = repoWith([]),
        b = repositoryFixture(revisionFiles([revision(1)]));
    const r = await a.repository(aggregateLimits(), inventoryCodecs, [b.scope, a.scope]);
    expect(recordResult(r).current.envelope.revisionId).toBe(rid(1));
    expect(r.aggregate.findings).toContain("READ_ONLY_MISSING_FENCE");
});

it("Batch5 physically canonical unqualified collisions are identity invalid before empty-authority absence", async () => {
    const f = repositoryFixture(
        revisionFiles([revision(1), revision(1, null, [], { payload: { text: "different" } })])
    );
    const r = await f.repository(),
        record = recordResult(r);
    expect(record.direct.every((f) => f.physicallyCanonical && !f.individualEvidence)).toBe(true);
    expect(record.state).toBe("REVISION_IDENTITY_INVALID");
    expect(record.identityClaims).toHaveLength(2);
    expect(record).not.toHaveProperty("ordinaryMaximalHeads");
    expect(r.aggregate.storeBoundAbsence).toBeUndefined();
});

// Independent-review D1/D2: state lineage and commit requirements are factual, not authority.
const stateId = (n = 1) => testId("representation-state", n);
const migrationId = (n = 1) => testId("migration", n);
const rootState = (changes = {}) => representationStateText(changes);
const childState = (n = 2, parent = 1, migration = 1, changes = {}) =>
    representationStateText({
        representationStateId: stateId(n),
        parentRepresentationStateId: stateId(parent),
        establishedByMigrationId: migrationId(migration),
        ...changes,
    });
const stateFiles = (texts) =>
    Object.fromEntries(texts.map((text, i) => [`${branch}/meta/representation-states/s${i}`, text]));
const stateView = (texts, declared = false, extra = {}) =>
    aggregateFixture({
        ...(declared ? withStore({ [`${branch}/meta/protocol/fence`]: fenceText() }) : {}),
        ...stateFiles(texts),
        ...extra,
    });
const assertStateFactsOnly = (r) => {
    assertBoundary(r);
    for (const value of [r, ...r.representations])
        for (const field of [
            "mayMigrate",
            "mayCommit",
            "mayActivateRepresentation",
            "migrationCommitValid",
            "writeTarget",
            "activeRepresentation",
        ])
            expect(value).not.toHaveProperty(field);
};
describe("D1 pure representation lineage independent of declaration", () => {
    it.each([
        ["linear", [rootState(), childState()], "REPRESENTATION_STATE_VALID"],
        ["missing parent", [childState()], "LINEAGE_INDETERMINATE"],
        ["competing children", [rootState(), childState(), childState(3, 1, 2)], "REPRESENTATION_STATE_DIVERGENT"],
        ["cycle", [childState(1, 2), childState(2, 1, 2)], "REPRESENTATION_STATE_INVALID"],
    ])("paired %s has identical pure lineage WITH/WITHOUT declaration", async (_name, texts, expected) => {
        const a = await stateView(texts, true).aggregate(),
            b = await stateView(texts).aggregate();
        for (const r of [a, b]) {
            expect(r.outcome).toBe("COMPLETE_ADMITTED");
            expect(r.representations[0].evidenceComplete).toBe(true);
            expect(r.representations[0].lineage).toBe(expected);
            expect(r.storeBoundAbsence).toBeUndefined();
            assertStateFactsOnly(r);
        }
        expect(b.representations[0].genesis).toBe("UNQUALIFIED_CONTEXT");
        expect(b.representations[0].plannedGenesisId).toBeUndefined();
        expect(b.coherentSupportedDeclarationIds).toEqual([]);
        expect(b.findings).toContain("GENESIS_UNQUALIFIED_CONTEXT");
        expect(b.findings).toContain("MISSING_NAMESPACE");
        expect(a.representations[0].identities.map((i) => i.variants.map((v) => v.digest))).toEqual(
            b.representations[0].identities.map((i) => i.variants.map((v) => v.digest))
        );
    });
    it("declarationless equivalent copies retain provenance but one state identity/requirement", async () => {
        const r = await stateView([rootState(), rootState(), childState(), childState()]).aggregate();
        expect(r.representations[0].lineage).toBe("REPRESENTATION_STATE_VALID");
        expect(r.representations[0].identities).toHaveLength(2);
        expect(r.representations[0].identities.every((i) => i.variants[0].copies.length === 2)).toBe(true);
        expect(r.representations[0].migrationCommitRequirements).toHaveLength(1);
        assertStateFactsOnly(r);
    });
    it("declarationless same-state-ID different complete content is invalid", async () => {
        const r = await stateView([
            rootState(),
            childState(),
            childState(2, 1, 1, { representation: "visible" }),
        ]).aggregate();
        expect(r.representations[0].lineage).toBe("REPRESENTATION_STATE_INVALID");
        expect(r.representations[0].identities[1].conflictingContent).toBe(true);
        const req = r.representations[0].migrationCommitRequirements;
        expect(req).toHaveLength(2);
        expect(req[0].stateDigest).not.toBe(req[1].stateDigest);
        expect(r.findings).toContain("REPRESENTATION_STATE_IDENTITY_CONFLICT");
        assertStateFactsOnly(r);
    });
    it("split-provider declarationless parent/child unions by content StoreId in both orders", async () => {
        const a = stateView([rootState()]),
            b = stateView([childState()]);
        for (const scopes of [
            [a.scope, b.scope],
            [b.scope, a.scope],
        ]) {
            const r = await a.aggregate(aggregateLimits(), inventoryCodecs, scopes);
            expect(r.representations[0].lineage).toBe("REPRESENTATION_STATE_VALID");
            expect(r.representations[0].genesis).toBe("UNQUALIFIED_CONTEXT");
            expect(r.representations[0].migrationCommitRequirements).toHaveLength(1);
            assertStateFactsOnly(r);
        }
    });
    it("declarationless distinct content StoreIds never merge lineage", async () => {
        const r = await stateView([rootState(), childState(2, 1, 1, { storeId: testId("store", 2) })]).aggregate();
        expect(r.representations).toHaveLength(2);
        expect(r.representations.map((s) => s.lineage)).toEqual([
            "REPRESENTATION_STATE_VALID",
            "LINEAGE_INDETERMINATE",
        ]);
        expect(r.representations[1].migrationCommitRequirements[0].parentRepresentationStateId).toBe(stateId());
        assertStateFactsOnly(r);
    });
    it("declarationless lineage precharge exact succeeds; one below refuses before S1", async () => {
        const f = stateView([rootState(), childState()]),
            cost = representationLineageChargeV05(2);
        const a = await f.aggregate(aggregateLimits({ representationLineageWork: cost }));
        expect(a.representations[0].lineage).toBe("REPRESENTATION_STATE_VALID");
        expect(a.budget.consumed.representationLineageWork).toBe(cost);
        const b = await f.aggregate(aggregateLimits({ representationLineageWork: cost - 1 }));
        expect(b.outcome).toBe("INCOMPLETE");
        expect(b.representations[0].lineage).toBe("NOT_EVALUATED");
        expect(b.budget.refusal.axis).toBe("representationLineageWork");
        expect(b.storeBoundAbsence).toBeUndefined();
    });
    it.each(["unavailable", "malformed", "state capacity"])(
        "%s state view cannot become an evaluated prefix WITH/WITHOUT declaration",
        async (mode) => {
            for (const declared of [true, false]) {
                const f = stateView([rootState(), childState()], declared);
                if (mode === "unavailable")
                    f.controls.setReadCondition(
                        f.scope.directory.root,
                        `${branch}/meta/representation-states/s1`,
                        "UNAVAILABLE"
                    );
                if (mode === "malformed")
                    f.controls.seedFile(
                        f.scope.directory.root,
                        `${branch}/meta/representation-states/s1`,
                        rawBytes("{bad")
                    );
                const r = await f.aggregate(
                    aggregateLimits(mode === "state capacity" ? { representationStates: 1 } : {})
                );
                expect(r.representations[0].lineage).toBe("NOT_EVALUATED");
                expect(r.storeBoundAbsence).toBeUndefined();
                if (mode === "state capacity") {
                    expect(r.admission.status).toBe("REFUSED");
                    expect(r.budget.refusal.axis).toBe("representationStates");
                }
                if (mode === "unavailable") expect(r.observation.status).toBe("INCOMPLETE");
                assertStateFactsOnly(r);
            }
        }
    );
});
describe("D2 explicit child migration commit qualification requirement", () => {
    it("child with NO opaque artifact retains explicit unqualified commit, lineage and planned genesis", async () => {
        const r = await stateView([rootState(), childState()], true).aggregate(),
            s = r.representations[0];
        expect(r.outcome).toBe("COMPLETE_ADMITTED");
        expect(s.lineage).toBe("REPRESENTATION_STATE_VALID");
        expect(s.genesis).toBe("PRESENT");
        expect(r.evidence.migrations).toEqual([]);
        expect(r.unqualifiedMigrationEvidence).toBe(false);
        expect(r.findings).toContain("UNQUALIFIED_MIGRATION_COMMIT");
        expect(s.migrationCommitRequirements).toEqual([
            expect.objectContaining({
                qualification: "UNQUALIFIED_MIGRATION_COMMIT",
                representationStateId: stateId(2),
                parentRepresentationStateId: stateId(1),
                migrationId: migrationId(1),
                stateDigest: expect.any(String),
            }),
        ]);
        assertStateFactsOnly(r);
    });
    it("opaque artifact named matching migration commit cannot clear requirement or qualify phase", async () => {
        const path = `${branch}/meta/migrations/${migrationId()}/commit.json`;
        const r = await stateView([rootState(), childState()], true, {
            [path]: '{"phase":"commit","migrationId":"' + migrationId() + '"}',
        }).aggregate();
        expect(r.evidence.migrations.length).toBeGreaterThan(0);
        expect(r.unqualifiedMigrationEvidence).toBe(true);
        expect(r.findings).toContain("UNQUALIFIED_MIGRATION_EVIDENCE");
        expect(r.findings).toContain("UNQUALIFIED_MIGRATION_COMMIT");
        expect(r.representations[0].migrationCommitRequirements[0].qualification).toBe("UNQUALIFIED_MIGRATION_COMMIT");
        assertStateFactsOnly(r);
    });
    it("D1xD2 declarationless linear child keeps lineage, unqualified context and unqualified commit", async () => {
        const r = await stateView([rootState(), childState()]).aggregate(),
            s = r.representations[0];
        expect(s.lineage).toBe("REPRESENTATION_STATE_VALID");
        expect(s.genesis).toBe("UNQUALIFIED_CONTEXT");
        expect(s.plannedGenesisId).toBeUndefined();
        expect(s.migrationCommitRequirements).toHaveLength(1);
        expect(s.migrationCommitRequirements[0].qualification).toBe("UNQUALIFIED_MIGRATION_COMMIT");
        expect(r.findings).toContain("UNQUALIFIED_MIGRATION_COMMIT");
        expect(r.storeBoundAbsence).toBeUndefined();
        assertStateFactsOnly(r);
    });
    it("content genesis/root never receives a child commit requirement", async () => {
        for (const declared of [true, false]) {
            const r = await stateView([rootState()], declared).aggregate();
            expect(r.representations[0].lineage).toBe("REPRESENTATION_STATE_VALID");
            expect(r.representations[0].migrationCommitRequirements).toEqual([]);
            expect(r.findings).not.toContain("UNQUALIFIED_MIGRATION_COMMIT");
            assertStateFactsOnly(r);
        }
    });
    it("same and different MigrationIds preserve distinct child requirements, physical copies deduplicate", async () => {
        const r = await stateView([
            rootState(),
            childState(2, 1, 1),
            childState(3, 1, 1),
            childState(4, 1, 2),
            childState(2, 1, 1),
        ]).aggregate();
        const req = r.representations[0].migrationCommitRequirements;
        expect(req).toHaveLength(3);
        expect(req.map((x) => x.representationStateId)).toEqual([stateId(2), stateId(3), stateId(4)]);
        expect(req.map((x) => x.migrationId)).toEqual([migrationId(1), migrationId(1), migrationId(2)]);
        expect(r.representations[0].lineage).toBe("REPRESENTATION_STATE_DIVERGENT");
        assertStateFactsOnly(r);
    });
    it("requirements debit existing graph work before retention; refusal cannot bypass bounded metadata", async () => {
        const f = stateView([rootState(), childState()], true),
            full = await f.aggregate(),
            cost = full.budget.consumed.graphWork;
        expect((await f.aggregate(aggregateLimits({ graphWork: cost }))).outcome).toBe("COMPLETE_ADMITTED");
        const rootsOnly = await stateView(
            [rootState(), rootState({ representationStateId: stateId(2) })],
            true
        ).aggregate();
        expect(cost - rootsOnly.budget.consumed.graphWork).toBe(1);
        const refused = await f.aggregate(aggregateLimits({ graphWork: cost - 1 }));
        expect(refused.outcome).toBe("INCOMPLETE");
        expect(refused.budget.refusal.axis).toBe("graphWork");
        expect(refused.representations[0].migrationCommitRequirements).toEqual([]);
        expect(refused.representations[0].lineage).toBe("NOT_EVALUATED");
        expect(refused.storeBoundAbsence).toBeUndefined();
        expect(() => full.representations[0].migrationCommitRequirements.push({})).toThrow();
    });
});
