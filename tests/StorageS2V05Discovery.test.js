import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { DiscoveryBudgetLedger, DISCOVERY_BUDGET_AXES } from "../src/storage/discoveryBudget";
import { DiscoveryInvocationV05, discoverReadFoundationV05 } from "../src/storage/discoveryV05";
import { fixture, limits, unwrap } from "./helpers/storageS2V05Fixtures";

const failure = (code) => ({ ok: false, failure: { code, message: "synthetic" } });

it("successor resolved source graph uses only normative read contracts and pure foundation owners", () => {
    const allowed = new Set([
        "discoveryV05.ts",
        "discoveryTraversalV05.ts",
        "discoveryBudget.ts",
        "discoveryGrammar.ts",
        "representationLocators.ts",
        "namespace.ts",
        "discoveryArtifactsV05.ts",
    ]);
    const pending = ["discoveryV05.ts"];
    const seen = new Set();
    const forbidden =
        /\b(createImmutable|writeSnapshot|rename|delete|localGuarantees|RepresentationStoragePort|StoreArtifactV1|recoverySemantics|obsidian)\b/;
    while (pending.length) {
        const name = pending.pop();
        if (seen.has(name)) continue;
        seen.add(name);
        expect(allowed.has(name), name).toBe(true);
        const source = ts.createSourceFile(
            name,
            fs.readFileSync(path.join("src/storage", name), "utf8"),
            ts.ScriptTarget.Latest,
            true
        );
        // Comments do not participate in dependency/call auditing.
        const printed = ts.createPrinter({ removeComments: true }).printFile(source);
        expect(
            printed.replaceAll('"./RepresentationStoragePort"', '"normative-read-contract-owner"'),
            name
        ).not.toMatch(forbidden);
        for (const statement of source.statements) {
            if (!ts.isImportDeclaration(statement)) continue;
            const module = statement.moduleSpecifier.text;
            const s1 = {
                "./authorityArtifacts": new Set([
                    "AuthorityArtifactError",
                    "decodeNamespaceArtifact",
                    "decodeStoreDeclaration",
                    "assessStoreDeclarationSupport",
                    "storeDeclarationDigest",
                    "compareStoreDeclarations",
                    "NamespaceArtifactV1",
                    "decodeProtocolFenceArtifact",
                    "decodeRepresentationStateArtifact",
                    "representationStateArtifactDigest",
                    "ProtocolFenceArtifactV1",
                    "RepresentationStateArtifactV1",
                    "StoreDeclarationV2",
                ]),
                "./canonicalEncoding": new Set([
                    "ArtifactDigest",
                    "CanonicalDigest",
                    "canonicalSerialize",
                    "sha256Bytes",
                    "CanonicalEncodingError",
                ]),
                "./envelopes": new Set([
                    "decodeCanonicalRevisionEnvelope",
                    "canonicalRevisionDigest",
                    "CanonicalEnvelopeError",
                    "CanonicalRecordCodec",
                    "CanonicalRevisionEnvelope",
                ]),
                "./recoveryArtifacts": new Set([
                    "recognizeRecoveryV2ArtifactBytes",
                    "RecoveryPreparationV2",
                    "RecoveryReceiptV2",
                ]),
                "./identity": new Set(["StoreId"]),
            };
            if (s1[module]) {
                for (const specifier of statement.importClause.namedBindings.elements)
                    expect(s1[module].has(specifier.propertyName?.text ?? specifier.name.text)).toBe(true);
            } else if (module === "./RepresentationStoragePort") {
                expect(statement.importClause.isTypeOnly).toBe(true);
                const normative = new Set([
                    "RepresentationReadPort",
                    "RepresentationDirectoryHandle",
                    "RepresentationFileHandle",
                    "RepresentationHandleEntry",
                    "RepresentationReadFailureCode",
                ]);
                for (const specifier of statement.importClause.namedBindings.elements)
                    expect(normative.has(specifier.propertyName?.text ?? specifier.name.text)).toBe(true);
            } else {
                expect(module.startsWith("./")).toBe(true);
                pending.push(`${module.slice(2)}.ts`);
            }
        }
    }
    expect([...seen].sort()).toEqual([...allowed].sort());
});

describe("explicit scope manifest and ownership", () => {
    it("rejects empty/missing scopes and wrong entry roles", () => {
        expect(() => new DiscoveryInvocationV05({ scopes: [], limits: limits() })).toThrow(/Nonempty/);
        expect(() => new DiscoveryInvocationV05({ limits: limits() })).toThrow(/Nonempty/);
        const f = fixture();
        expect(
            () => new DiscoveryInvocationV05({ scopes: [{ ...f.scope, entryRole: "store-subtree" }], limits: limits() })
        ).toThrow(/manifest/);
    });
    it.each(DISCOVERY_BUDGET_AXES)("requires finite safe nonnegative %s", (axis) => {
        const f = fixture();
        for (const value of [undefined, NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
            expect(() => f.invocation(limits({ [axis]: value }))).toThrow(/finite/);
        const omitted = limits();
        delete omitted[axis];
        expect(() => f.invocation(omitted)).toThrow(/finite/);
    });
    it("rejects omitted limits and zero read-scope capacity", () => {
        const f = fixture();
        expect(() => new DiscoveryInvocationV05({ scopes: [f.scope] })).toThrow(/finite/);
        expect(() => f.invocation(limits({ readScopes: 0 }))).toThrow(/budget/);
    });
    it("snapshots scope array, scope descriptors and limits synchronously across await", async () => {
        const a = fixture(2),
            b = fixture(3);
        let release;
        let entered;
        const started = new Promise((resolve) => {
            entered = resolve;
        });
        const wait = new Promise((resolve) => {
            release = resolve;
        });
        const original = a.port.listChildren;
        a.port.listChildren = async (...args) => {
            entered();
            await wait;
            return original(...args);
        };
        const scopes = [{ ...a.scope }, { ...b.scope }];
        const profile = limits();
        const promise = discoverReadFoundationV05({ scopes, limits: profile });
        await started;
        scopes[1].port = a.port;
        scopes[1].directory = a.scope.directory;
        scopes[1].entryRole = "store-subtree";
        scopes.reverse();
        scopes.length = 0;
        for (const axis of DISCOVERY_BUDGET_AXES) profile[axis] = 0;
        release();
        const result = await promise;
        expect(result.status).toBe("COMPLETE");
        expect(result.observations.map((o) => o.listing.entries.length)).toEqual([2, 3]);
        expect(result.manifest[1].directory).toBe(b.scope.directory);
        expect(result.budget.limits.listCalls).toBe(20);
        expect(Object.isFrozen(result.observations)).toBe(true);
        expect(Object.isFrozen(result.manifest[0])).toBe(true);
    });
    it("keeps equal rootIdentity strings across distinct issuers separate in either order", async () => {
        const a = fixture(1),
            b = fixture(2);
        expect(a.port.rootIdentity).toBe(b.port.rootIdentity);
        expect(a.port.context).not.toBe(b.port.context);
        for (const scopes of [
            [a.scope, b.scope],
            [b.scope, a.scope],
        ]) {
            const result = await discoverReadFoundationV05({ scopes, limits: limits() });
            expect(result.status).toBe("COMPLETE");
            expect(result.observations.map((o) => o.listing.entries.length).sort()).toEqual([1, 2]);
            expect(result).not.toHaveProperty("heads");
            expect(result).not.toHaveProperty("mayMutate");
            expect(result).not.toHaveProperty("health");
        }
    });
    it("supports representation-root entry without descending", async () => {
        const f = fixture();
        f.controls.seedFile(f.port.directoryHandle("").value.root, "candidate/arbitrary", new Uint8Array([7]));
        const scope = {
            port: f.port,
            directory: unwrap(f.port.directoryHandle("candidate")),
            entryRole: "representation-root",
        };
        const result = await discoverReadFoundationV05({ scopes: [scope], limits: limits() });
        expect(result.status).toBe("COMPLETE");
        expect(result.observations[0].listing.entries[0].name).toBe("arbitrary");
        expect(f.requests).toHaveLength(1);
        expect(f.reads).toHaveLength(0);
    });
    it("deterministically rejects exact duplicate scope/boundary", () => {
        const f = fixture();
        for (const scopes of [
            [f.scope, f.scope],
            [f.scope, { ...f.scope }],
            [f.scope, { ...f.scope, port: { ...f.port } }],
        ])
            expect(() => new DiscoveryInvocationV05({ scopes, limits: limits() })).toThrow(/Duplicate/);
        expect(f.requests).toHaveLength(0);
    });
    it("rejects foreign directories before dispatch and copied/forged directories through S1", async () => {
        const a = fixture(1),
            b = fixture(1);
        expect(
            () =>
                new DiscoveryInvocationV05({ scopes: [{ ...a.scope, directory: b.scope.directory }], limits: limits() })
        ).toThrow(/manifest/);
        const inv = a.invocation();
        expect((await inv.reader(0).listImmediate(b.scope.directory)).finding.code).toBe("CONFINEMENT");
        await inv.reader(0).listImmediate();
        for (const handle of [{ ...a.scope.directory }, Object.freeze({ ...a.scope.directory })]) {
            const result = await inv.reader(0).listImmediate(handle);
            expect(result.status).toBe("INCOMPLETE");
            expect(result.finding.code).toBe("CONFINEMENT");
        }
        expect(a.requests).toHaveLength(3); // copied handles never hit the legitimate cache
    });
    it("memoizes exact issued handles within invocation only, including failures", async () => {
        const f = fixture(1);
        const inv = f.invocation();
        const [one, two] = await Promise.all([inv.reader(0).listImmediate(), inv.reader(0).listImmediate()]);
        expect(one).toBe(two);
        const file = one.entries[0].handle;
        const reads = await Promise.all([inv.reader(0).readRaw(file), inv.reader(0).readRaw(file)]);
        expect(reads[0]).toBe(reads[1]);
        expect(f.requests).toHaveLength(1);
        expect(f.reads).toHaveLength(1);
        await f.invocation().reader(0).listImmediate();
        expect(f.requests).toHaveLength(2);
        f.controls.setListCondition(f.scope.directory.root, "", "UNAVAILABLE");
        const failed = f.invocation();
        const first = await failed.reader(0).listImmediate();
        f.controls.setListCondition(f.scope.directory.root, "");
        expect(await failed.reader(0).listImmediate()).toBe(first);
        expect((await f.invocation().reader(0).listImmediate()).status).toBe("COMPLETE");
    });
});

describe("bounded complete immediate enumeration", () => {
    it.each([0, 1, 63, 64])("completes %i entries with initial 64 request", async (count) => {
        const f = fixture(count);
        const result = await f.invocation().reader(0).listImmediate();
        expect(result.status).toBe("COMPLETE");
        expect(result.entries).toHaveLength(count);
        expect(f.requests.map((r) => r.limit)).toEqual([64]);
    });
    it("grows deterministically beyond64 and charges repeats, including physical duplicates", async () => {
        const f = fixture(129);
        const inv = f.invocation();
        const result = await inv.reader(0).listImmediate();
        expect(result.status).toBe("COMPLETE");
        expect(f.requests.map((r) => r.limit)).toEqual([64, 128, 256]);
        expect(inv.budget().consumed.listedEntryWork).toBe(64 + 128 + 129);
        expect(inv.budget().consumed.physicalFiles).toBe(129);
        expect(result.entries).toHaveLength(129);
    });
    it("exact work budget succeeds with lowered final request; one less remains incomplete", async () => {
        for (const [budget, status, requested] of [
            [129, "COMPLETE", [64, 65]],
            [128, "INCOMPLETE", [64]],
        ]) {
            const f = fixture(65);
            const inv = f.invocation(limits({ listedEntryWork: budget }));
            const result = await inv.reader(0).listImmediate();
            expect(result.status).toBe(status);
            expect(f.requests.map((r) => r.limit)).toEqual(requested);
            if (status === "INCOMPLETE") {
                expect(result.finding.pressure.axis).toBe("listedEntryWork");
                expect(result.entries).toHaveLength(64);
            }
        }
    });
    it.each([
        [0, "INCOMPLETE", 0],
        [1, "INCOMPLETE", 1],
        [2, "COMPLETE", 2],
    ])("list-call boundary %i", async (limit, status, calls) => {
        const f = fixture(65);
        const inv = f.invocation(limits({ listCalls: limit }));
        const result = await inv.reader(0).listImmediate();
        expect(result.status).toBe(status);
        expect(result.calls).toBe(calls);
        expect(inv.budget().consumed.listCalls).toBe(calls);
        if (status === "INCOMPLETE") expect(result.finding.pressure.axis).toBe("listCalls");
    });
    it.each(["listedEntryWork", "structuralNodes"])("zero %s refuses before work", async (axis) => {
        const f = fixture(1);
        const result = await f
            .invocation(limits({ [axis]: 0 }))
            .reader(0)
            .listImmediate();
        expect(result.status).toBe("INCOMPLETE");
        expect(result.finding.pressure.axis).toBe(axis);
        expect(f.requests).toHaveLength(0);
    });
    it("charges physical-file admission before a prefix can become complete", async () => {
        const f = fixture(2);
        const inv = f.invocation(limits({ physicalFiles: 1 }));
        const result = await inv.reader(0).listImmediate();
        expect(result.status).toBe("INCOMPLETE");
        expect(result.finding.pressure).toMatchObject({ axis: "physicalFiles", limit: 1, current: 1, attempted: 2 });
    });
    it.each(["UNAVAILABLE", "UNSUPPORTED", "NOT_FOUND", "INVALID_INPUT", "CONFINEMENT", "unknown"])(
        "preserves listing failure %s without absence",
        async (code) => {
            const f = fixture();
            f.port.listChildren = async () => failure(code);
            const result = await f.invocation().observeImmediateBoundaries();
            expect(result.status).toBe("INCOMPLETE");
            expect(result.observations[0].listing.finding.code).toBe(code === "unknown" ? "UNAVAILABLE" : code);
        }
    );
    it("thrown listing errors are unavailable", async () => {
        const f = fixture();
        f.port.listChildren = async () => {
            throw new Error("unknown");
        };
        expect((await f.invocation().reader(0).listImmediate()).finding.code).toBe("UNAVAILABLE");
    });
    it.each([0, 1, 64])("stalled/no-progress truncated prefix of %i refuses finitely", async (count) => {
        const f = fixture(65);
        const original = f.port.listChildren;
        f.port.listChildren = async (handle, _limit) => {
            const result = await original(handle, 64);
            return { ok: true, value: { entries: result.value.entries.slice(0, count), truncated: true } };
        };
        const result = await f.invocation().reader(0).listImmediate();
        expect(result.status).toBe("INCOMPLETE");
        expect(result.finding.code).toBe("INCONSISTENT_LISTING");
        expect(f.requests.length).toBeLessThanOrEqual(2);
    });
    it.each(["disappear", "kind", "name", "foreign", "locator", "duplicate", "oversize"])(
        "rejects listing contradiction: %s",
        async (kind) => {
            const f = fixture(65),
                foreign = fixture(1);
            const original = f.port.listChildren;
            let calls = 0;
            f.port.listChildren = async (handle, limit) => {
                const result = await original(handle, limit);
                if (++calls === 1) return result;
                const entries = [...result.value.entries];
                const first = entries[0];
                if (kind === "disappear") entries.shift();
                if (kind === "kind") entries[0] = { ...first, kind: "directory" };
                if (kind === "name") entries[0] = { ...first, name: "nested/file" };
                if (kind === "foreign") entries[0] = { ...first, handle: unwrap(foreign.port.fileHandle(first.name)) };
                if (kind === "locator") entries[0] = { ...first, handle: unwrap(f.port.fileHandle("elsewhere")) };
                if (kind === "duplicate") entries.push(first);
                if (kind === "oversize") while (entries.length <= limit) entries.push(first);
                return { ok: true, value: { entries, truncated: false } };
            };
            const result = await f.invocation().reader(0).listImmediate();
            expect(result.status).toBe("INCOMPLETE");
            expect(result.finding.code).toBe("INCONSISTENT_LISTING");
            expect(result.entries).toHaveLength(64);
        }
    );
    it("provider ordering changes do not alter normalized result", async () => {
        const f = fixture(65);
        const original = f.port.listChildren;
        f.port.listChildren = async (...args) => {
            const r = await original(...args);
            return { ok: true, value: { ...r.value, entries: [...r.value.entries].reverse() } };
        };
        const result = await f.invocation().reader(0).listImmediate();
        expect(result.status).toBe("COMPLETE");
        expect(result.entries.map((e) => e.name)).toEqual([...result.entries.map((e) => e.name)].sort());
    });
});

describe("raw read foundation", () => {
    it("reads arbitrary complete binary bytes and provides defensive access", async () => {
        const f = fixture();
        const bytes = new Uint8Array([0, 255, 195, 0, 128]);
        f.controls.seedFile(f.scope.directory.root, "raw", bytes);
        const file = unwrap(f.port.fileHandle("raw"));
        const inv = f.invocation();
        const observation = await inv.reader(0).readRaw(file);
        expect(observation.status).toBe("COMPLETE");
        expect(observation.byteLength).toBe(5);
        const exposed = observation.copyBytes();
        exposed.fill(9);
        bytes.fill(8);
        expect((await inv.reader(0).readRaw(file)).copyBytes()).toEqual(new Uint8Array([0, 255, 195, 0, 128]));
        expect(inv.budget().consumed.rawBytesRead).toBe(5);
        expect(inv.budget().consumed.physicalBytes).toBe(5);
    });
    it.each(["NOT_FOUND", "UNAVAILABLE", "UNSUPPORTED", "INVALID_INPUT", "INVALID_LOCATOR", "CONFINEMENT", "unknown"])(
        "preserves read failure %s",
        async (code) => {
            const f = fixture();
            f.port.readBytes = async () => failure(code);
            const result = await f
                .invocation()
                .reader(0)
                .readRaw(unwrap(f.port.fileHandle("raw")));
            expect(result.status).toBe("INCOMPLETE");
            expect(result.finding.code).toBe(code === "unknown" ? "UNAVAILABLE" : code);
        }
    );
    it("S1 real missing/unavailable/unsupported/partial reference controls remain truthful", async () => {
        const f = fixture(1);
        expect(
            (
                await f
                    .invocation()
                    .reader(0)
                    .readRaw(unwrap(f.port.fileHandle("missing")))
            ).finding.code
        ).toBe("NOT_FOUND");
        for (const condition of ["UNAVAILABLE", "UNSUPPORTED", "PARTIAL"]) {
            f.controls.setReadCondition(f.scope.directory.root, "f0000", condition);
            expect(
                (
                    await f
                        .invocation()
                        .reader(0)
                        .readRaw(unwrap(f.port.fileHandle("f0000")))
                ).finding.code
            ).toBe(condition === "PARTIAL" ? "UNAVAILABLE" : condition);
        }
    });
    it("unknown thrown read and nonbinary success remain unavailable", async () => {
        const f = fixture();
        const file = unwrap(f.port.fileHandle("raw"));
        f.port.readBytes = async () => {
            throw new Error("unclassified");
        };
        expect((await f.invocation().reader(0).readRaw(file)).finding.code).toBe("UNAVAILABLE");
        f.port.readBytes = async () => ({ ok: true, value: "clipped" });
        expect((await f.invocation().reader(0).readRaw(file)).finding.code).toBe("UNAVAILABLE");
    });
    it("foreign/copied/forged files never acquire cached authority from matching diagnostic fields", async () => {
        const a = fixture(1),
            b = fixture(1);
        const inv = a.invocation();
        const file = unwrap(a.port.fileHandle("f0000"));
        expect((await inv.reader(0).readRaw(file)).status).toBe("COMPLETE");
        const forged = { kind: file.kind, root: file.root, context: file.context, locator: file.locator };
        for (const handle of [unwrap(b.port.fileHandle("f0000")), { ...file }, forged]) {
            const result = await inv.reader(0).readRaw(handle);
            expect(result.status).toBe("INCOMPLETE");
            expect(result.finding.code).toBe("CONFINEMENT");
        }
        expect(a.reads).toHaveLength(3);
    });
    it("supplied representation boundary cannot read a sibling in the same root", async () => {
        const f = fixture();
        f.controls.seedDirectory(f.scope.directory.root, "inside");
        const inv = new DiscoveryInvocationV05({
            scopes: [
                { ...f.scope, directory: unwrap(f.port.directoryHandle("inside")), entryRole: "representation-root" },
            ],
            limits: limits(),
        });
        expect((await inv.reader(0).readRaw(unwrap(f.port.fileHandle("outside")))).finding.code).toBe("CONFINEMENT");
        expect(f.reads).toHaveLength(0);
    });
    it.each(["rawBytesRead", "physicalBytes", "artifactBytes"])(
        "exact %s admission succeeds; one over refuses",
        async (axis) => {
            const f = fixture();
            f.controls.seedFile(f.scope.directory.root, "raw", new Uint8Array(3));
            const file = unwrap(f.port.fileHandle("raw"));
            expect(
                (
                    await f
                        .invocation(limits({ [axis]: 3 }))
                        .reader(0)
                        .readRaw(file)
                ).status
            ).toBe("COMPLETE");
            const result = await f
                .invocation(limits({ [axis]: 2 }))
                .reader(0)
                .readRaw(file);
            expect(result.status).toBe("INCOMPLETE");
            expect(result.finding.pressure).toMatchObject({ axis, limit: 2, current: 0, attempted: 3 });
        }
    );
    it("read-call refusal prevents dispatch; listed files count once when read", async () => {
        const f = fixture(1);
        const inv = f.invocation(limits({ readCalls: 0 }));
        const listing = await inv.reader(0).listImmediate();
        expect((await inv.reader(0).readRaw(listing.entries[0].handle)).finding.pressure.axis).toBe("readCalls");
        expect(f.reads).toHaveLength(0);
        const second = f.invocation();
        const listed = await second.reader(0).listImmediate();
        await second.reader(0).readRaw(listed.entries[0].handle);
        expect(second.budget().consumed.physicalFiles).toBe(1);
    });
});

it("completed listings cannot hide an already requested raw failure or exhausted ledger", async () => {
    const f = fixture(1);
    const inv = f.invocation(limits({ rawBytesRead: 0 }));
    const listing = await inv.reader(0).listImmediate();
    expect(listing.status).toBe("COMPLETE");
    expect((await inv.reader(0).readRaw(listing.entries[0].handle)).status).toBe("INCOMPLETE");
    const result = await inv.observeImmediateBoundaries();
    expect(result.status).toBe("INCOMPLETE");
    expect(result.observations[0].rawReads[0].finding.pressure.axis).toBe("rawBytesRead");
    const unavailable = f.invocation();
    f.controls.setReadCondition(f.scope.directory.root, "f0000", "UNAVAILABLE");
    await unavailable.reader(0).readRaw(unwrap(f.port.fileHandle("f0000")));
    expect((await unavailable.observeImmediateBoundaries()).status).toBe("INCOMPLETE");
});
it("failed required scope keeps the invocation incomplete beside a complete independent scope", async () => {
    const a = fixture(1),
        b = fixture(1);
    b.controls.setListCondition(b.scope.directory.root, "", "UNSUPPORTED");
    const result = await discoverReadFoundationV05({ scopes: [a.scope, b.scope], limits: limits() });
    expect(result.status).toBe("INCOMPLETE");
    expect(result.observations.map((o) => o.listing.status)).toEqual(["COMPLETE", "INCOMPLETE"]);
});

describe("one finite ledger", () => {
    it("exact-limit success, sticky scoped refusal and detached snapshots", () => {
        const ledger = new DiscoveryBudgetLedger(limits({ listCalls: 2 }));
        const before = ledger.snapshot();
        expect(ledger.charge("listCalls", 2, 7)).toBe(true);
        expect(ledger.charge("listCalls", 1, 7)).toBe(false);
        expect(ledger.snapshot().refusal).toEqual({
            axis: "listCalls",
            limit: 2,
            current: 2,
            attempted: 3,
            scopeId: 7,
            reason: "LIMIT",
        });
        expect(ledger.charge("readCalls", 1, 8)).toBe(false);
        expect(before.consumed.listCalls).toBe(0);
        expect(Object.isFrozen(ledger.snapshot().consumed)).toBe(true);
    });
    it("refuses safe-integer overflow rather than wrapping", () => {
        const ledger = new DiscoveryBudgetLedger(limits({ rawBytesRead: Number.MAX_SAFE_INTEGER }));
        expect(ledger.charge("rawBytesRead", Number.MAX_SAFE_INTEGER, 0)).toBe(true);
        expect(ledger.charge("rawBytesRead", 1, 0)).toBe(false);
        expect(ledger.snapshot().refusal.reason).toBe("OVERFLOW");
        expect(ledger.snapshot().consumed.rawBytesRead).toBe(Number.MAX_SAFE_INTEGER);
    });
    it.each([-1, NaN, Infinity, 0.5])("refuses invalid charge %s", (amount) => {
        const ledger = new DiscoveryBudgetLedger(limits());
        expect(ledger.charge("readCalls", amount, 0)).toBe(false);
        expect(ledger.snapshot().refusal.reason).toBe("INVALID_AMOUNT");
    });
    it("zero byte profile admits empty raw bytes and refuses nonempty bytes", async () => {
        const f = fixture();
        f.controls.seedFile(f.scope.directory.root, "empty", new Uint8Array());
        f.controls.seedFile(f.scope.directory.root, "one", new Uint8Array([1]));
        const inv = f.invocation(limits({ rawBytesRead: 0, physicalBytes: 0, artifactBytes: 0 }));
        expect((await inv.reader(0).readRaw(unwrap(f.port.fileHandle("empty")))).status).toBe("COMPLETE");
        expect((await inv.reader(0).readRaw(unwrap(f.port.fileHandle("one")))).finding.pressure.axis).toBe(
            "rawBytesRead"
        );
    });
});

import { discoverPhysicalStorageTreeV05 } from "../src/storage/discoveryV05";
import {
    traversalFixture,
    traversalLimits,
    namespaceText,
    declarationText,
    declaration,
    testId,
    canonicalText,
    recoveryTexts,
    fenceText,
    stateText,
    rawBytes,
} from "./helpers/storageS2V05Fixtures";
import { DISCOVERY_TRAVERSAL_WORK_AXES } from "../src/storage/discoveryBudget";
import { DISPOSABLE_STORAGE_DIAGNOSTIC_ROOTS } from "../src/storage/namespace";
import {
    DISCOVERY_GRAMMAR,
    MAX_DISCOVERY_DIRECTORY_DEPTH,
    allowsValidatedChild,
} from "../src/storage/discoveryGrammar";

const rootPath = ".finders-keepers";
const branchPath = `${rootPath}/stores/physical-branch`;
const terminalFiles = (result, role, locator) =>
    result.rawFiles.filter((file) => file.chain.at(-1).role === role && (!locator || file.file.locator === locator));
const logicalFacts = (result) => ({
    status: result.status,
    storeIds: result.storeIds,
    multiple: result.multipleStoreIds,
    groups: result.declarationGroups.map((g) => [
        g.storeId,
        g.state,
        g.plans.map((p) => [p.digest, p.supported, p.copies.length]),
    ]),
    mixed: result.branches
        .filter((b) => b.mixedStore)
        .map((b) => b.storeIds)
        .sort(),
    absence: Boolean(result.storeBoundAbsence),
});

describe("Batch 2 namespace, declaration and negative coverage", () => {
    it("complete empty boundary issues a manifest-bound local absence witness", async () => {
        const result = await traversalFixture().traverse();
        expect(result.status).toBe("COMPLETE");
        expect(result.storeBoundAbsence.kind).toBe("QUALIFIED_STORE_BOUND_ABSENCE");
        expect(result.storeBoundAbsence.manifest).toBe(result.manifest);
        expect(result).not.toHaveProperty("mayBootstrap");
    });
    it("valid empty namespace is present without selecting a store and permits qualified negative probe", async () => {
        const f = traversalFixture({ [`${rootPath}/fresh.json`]: namespaceText() }, [`${rootPath}/stores`]);
        const result = await f.traverse();
        expect(result.status).toBe("COMPLETE");
        expect(result.storeBoundAbsence).toBeDefined();
        expect(result.storeIds).toEqual([]);
        expect(result.roots[0].state).toBe("NAMESPACE_PRESENT");
        expect(f.requests.some((r) => r.handle.locator === `${rootPath}/stores`)).toBe(true);
        expect(result.roots[0].namespaceCandidates[0].recognition.value).not.toHaveProperty("storeId");
    });
    it("missing-marker genuinely empty nominal view gets absence only after stores probe", async () => {
        const f = traversalFixture({}, [rootPath, `${rootPath}/stores`]);
        const result = await f.traverse();
        expect(result.status).toBe("COMPLETE");
        expect(result.storeBoundAbsence).toBeDefined();
        expect(f.requests.map((r) => r.handle.locator)).toContain(`${rootPath}/stores`);
        expect(result.findings.some((f) => f.code === "MISSING_NAMESPACE")).toBe(true);
    });
    it.each(["{bad", JSON.stringify({ schema: "finders-keepers.namespace", version: 2 })])(
        "malformed/unsupported namespace remains blocking: %s",
        async (text) => {
            const result = await traversalFixture({ [`${rootPath}/namespace.json`]: text }).traverse();
            expect(result.status).toBe("COMPLETE");
            expect(result.storeBoundAbsence).toBeUndefined();
            expect(result.roots[0].namespaceCandidates).toHaveLength(1);
        }
    );
    it("valid marker and malformed fresh sibling coexist without absence", async () => {
        const result = await traversalFixture({
            [`${rootPath}/good.json`]: namespaceText(),
            [`${rootPath}/bad.json`]: "{bad",
        }).traverse();
        expect(result.rawFiles.filter((f) => f.chain.at(-1).role === "representation-root")).toHaveLength(2);
        expect(result.storeBoundAbsence).toBeUndefined();
        expect(result.findings.some((f) => f.code === "UNRESOLVED_FILE")).toBe(true);
    });
    it("marker never gates Store2 discovery nor assigns identity", async () => {
        const result = await traversalFixture({ [`${branchPath}/fresh.json`]: declarationText() }).traverse();
        expect(result.status).toBe("COMPLETE");
        expect(result.storeIds).toEqual([testId("store")]);
        expect(result.declarationGroups[0].plans[0].supported).toBe(true);
        expect(result.findings.some((f) => f.code === "MISSING_NAMESPACE")).toBe(true);
        expect(result.storeBoundAbsence).toBeUndefined();
    });
    it("retains complete Store2 plan, raw bytes and all support bindings", async () => {
        const result = await traversalFixture({ [`${branchPath}/random-leaf.json`]: declarationText() }).traverse();
        const plan = result.declarationGroups[0].plans[0];
        expect(plan.declaration).toEqual(declaration());
        expect(plan.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(plan.copies[0].raw.copyBytes()).toEqual(rawBytes(declarationText()));
        expect(Object.isFrozen(plan.declaration)).toBe(true);
        expect(Object.isFrozen(plan.copies)).toBe(true);
        expect(plan).not.toHaveProperty("healthy");
    });
    it("equivalent declarations retain every physical copy", async () => {
        const result = await traversalFixture({
            [`${branchPath}/one.json`]: declarationText(),
            [`${branchPath}/two.json`]: declarationText(),
        }).traverse();
        expect(result.declarationGroups).toHaveLength(1);
        expect(result.declarationGroups[0].state).toBe("EQUIVALENT");
        expect(result.declarationGroups[0].plans[0].copies).toHaveLength(2);
        expect(result.budget.consumed.physicalFiles).toBe(2);
    });
    it.each([
        { bootstrapId: testId("bootstrap", 2) },
        { initialRepresentation: "visible" },
        { genesisRepresentationStateId: testId("representation-state", 2) },
        { requiredProtocolVersion: 3 },
    ])("same StoreId incompatible plan remains conflict: %j", async (change) => {
        const result = await traversalFixture({
            [`${branchPath}/one.json`]: declarationText(),
            [`${branchPath}/two.json`]: declarationText(change),
        }).traverse();
        expect(result.declarationGroups[0].state).toBe("CONFLICTING_PLAN");
        expect(result.declarationGroups[0].plans).toHaveLength(2);
        expect(result.storeBoundAbsence).toBeUndefined();
    });
    it("mixed branch plus coherent distinct store preserves exhaustive three-ID union", async () => {
        const result = await traversalFixture({
            [`${branchPath}/one.json`]: declarationText(),
            [`${branchPath}/two.json`]: declarationText({ storeId: testId("store", 2) }),
            [`${rootPath}/stores/other/three.json`]: declarationText({ storeId: testId("store", 3) }),
        }).traverse();
        expect(result.storeIds).toEqual([1, 2, 3].map((n) => testId("store", n)));
        expect(result.multipleStoreIds).toBe(true);
        expect(result.findings.some((finding) => finding.code === "MIXED_STORE_INVALID")).toBe(true);
        expect(result.branches.find((b) => b.directory.locator === branchPath)).toMatchObject({
            mixedStore: true,
            storeIds: [testId("store"), testId("store", 2)],
        });
    });
    it("protocol3 is structurally valid complete bound evidence with supported=false", async () => {
        const result = await traversalFixture({
            [`${branchPath}/newer.json`]: declarationText({ requiredProtocolVersion: 3 }),
        }).traverse();
        expect(result.status).toBe("COMPLETE");
        expect(result.storeIds).toEqual([testId("store")]);
        const plan = result.declarationGroups[0].plans[0];
        expect(plan.supported).toBe(false);
        expect(plan.declaration.requiredProtocolVersion).toBe(3);
        expect(plan.copies[0].recognition.status).toBe("VALID");
        expect(result.storeBoundAbsence).toBeUndefined();
    });
    it.each([1, 3])("Store format %i is unsupported without legacy adoption", async (version) => {
        const result = await traversalFixture({
            [`${branchPath}/old.json`]: JSON.stringify({
                schema: "finders-keepers.store",
                version,
                storeId: testId("store"),
            }),
        }).traverse();
        expect(result.storeIds).toEqual([]);
        expect(result.declarationGroups).toEqual([]);
        expect(result.branches[0].declarations[0].recognition.status).toBe("UNSUPPORTED");
        expect(result.storeBoundAbsence).toBeUndefined();
    });
    it.each(["{bad", JSON.stringify({ ...declaration(), bootstrapId: "invalid" })])(
        "malformed Store2 remains reached without identity authority",
        async (text) => {
            const result = await traversalFixture({ [`${branchPath}/store.json`]: text }).traverse();
            expect(result.storeIds).toEqual([]);
            expect(result.storeBoundAbsence).toBeUndefined();
            expect(result.rawFiles.some((f) => f.file.locator === `${branchPath}/store.json`)).toBe(true);
        }
    );
    it("good declaration does not hide unreadable fresh candidate", async () => {
        const locator = `${branchPath}/unavailable.json`;
        const f = traversalFixture({ [`${branchPath}/good.json`]: declarationText(), [locator]: declarationText() });
        f.controls.setReadCondition(f.scope.directory.root, locator, "UNAVAILABLE");
        const result = await f.traverse();
        expect(result.status).toBe("INCOMPLETE");
        expect(result.storeIds).toEqual([testId("store")]);
        expect(result.rawFiles.find((f) => f.file.locator === locator).raw.finding.code).toBe("UNAVAILABLE");
        expect(result.storeBoundAbsence).toBeUndefined();
        expect(result.roots[0].state).toBe("INCOMPLETE");
    });
    it("empty nominal root does not hide populated provider root/alternate collection", async () => {
        const result = await traversalFixture(
            { "provider-root/conflicted-collection/opaque-branch/random.json": declarationText() },
            [rootPath]
        ).traverse();
        expect(result.storeIds).toEqual([testId("store")]);
        expect(result.declarationGroups[0].plans[0].copies[0].file.locator).toBe(
            "provider-root/conflicted-collection/opaque-branch/random.json"
        );
        expect(result.storeBoundAbsence).toBeUndefined();
    });
    it("ordinary unrelated folder is NON_FK only after complete finite probes", async () => {
        const f = traversalFixture({
            "ordinary/notes.json": '{"title":"not FK"}',
            "ordinary/level-one/level-two/note.txt": "ordinary",
        });
        const result = await f.traverse();
        expect(result.roots[0].state).toBe("NON_FK");
        expect(result.branches).toEqual([]);
        expect(result.storeBoundAbsence).toBeDefined();
        expect(f.requests.some((r) => r.handle.locator === "ordinary/level-one/level-two")).toBe(true);
    });
    it("failed alternative probe is incomplete, never NON_FK or qualified absence", async () => {
        const f = traversalFixture({}, ["ordinary/collection/branch"]);
        f.controls.setListCondition(f.scope.directory.root, "ordinary/collection/branch", "UNSUPPORTED");
        const result = await f.traverse();
        expect(result.status).toBe("INCOMPLETE");
        expect(result.roots[0].state).toBe("INCOMPLETE");
        expect(result.findings.some((f) => f.code === "READ_INCOMPLETE")).toBe(true);
        expect(result.storeBoundAbsence).toBeUndefined();
    });
    it("representation-only input retains narrower coverage without outside enumeration", async () => {
        const f = traversalFixture({ [`${rootPath}/namespace.json`]: namespaceText() });
        const scope = {
            ...f.scope,
            directory: unwrap(f.port.directoryHandle(rootPath)),
            entryRole: "representation-root",
        };
        const result = await f.traverse(traversalLimits(), [scope]);
        expect(result.status).toBe("COMPLETE");
        expect(result.coverage).toBe("SUPPLIED_ROOTS_ONLY");
        expect(result.storeBoundAbsence).toBeUndefined();
        expect(f.requests.some((r) => r.handle.locator === "")).toBe(false);
    });
    it("diagnostic roots are excluded exactly, without suffix broadening", async () => {
        const files = Object.fromEntries(
            DISPOSABLE_STORAGE_DIAGNOSTIC_ROOTS.map((root) => [
                `${root}/stores/b/decl.json`,
                declarationText({ storeId: testId("store", 99) }),
            ])
        );
        files[`${DISPOSABLE_STORAGE_DIAGNOSTIC_ROOTS[0]}-copy/stores/b/decl.json`] = declarationText();
        const result = await traversalFixture(files).traverse();
        expect(result.storeIds).toEqual([testId("store")]);
        expect(result.roots).toHaveLength(1);
    });
});

describe("Batch 2 P1 declaration-independent raw visibility", () => {
    it("canonical bytes remain visible with missing marker/declaration, without admission", async () => {
        const locator = `${branchPath}/records/arbitrary-kind/arbitrary-leaf`;
        const result = await traversalFixture({ [locator]: canonicalText() }).traverse();
        const observations = terminalFiles(result, "record-kind-collection", locator);
        expect(observations.length).toBeGreaterThan(0);
        expect(observations[0].raw.copyBytes()).toEqual(rawBytes(canonicalText()));
        expect(observations[0].recognition.hint).toBe("canonical");
        expect(result.storeIds).toEqual([]);
        expect(result.findings.map((f) => f.code)).toContain("MISSING_NAMESPACE");
        expect(result.findings.map((f) => f.code)).toContain("MISSING_DECLARATION");
        expect(result.storeBoundAbsence).toBeUndefined();
        expect(observations[0]).not.toHaveProperty("qualifiedRevision");
        expect(result).not.toHaveProperty("heads");
    });
    it("provider-renamed record collections qualify only existing roles through finite family lookahead", async () => {
        const locator = "renamed-root/alt-stores/opaque-branch/alt-records/alt-kind/fresh-leaf";
        const f = traversalFixture({ [locator]: canonicalText() });
        const result = await f.traverse();
        const observation = terminalFiles(result, "record-kind-collection", locator)[0];
        expect(observation.roleEvidence).toBe("CONTENT_LOOKAHEAD");
        expect(observation.raw.copyBytes()).toEqual(rawBytes(canonicalText()));
        expect(result.storeBoundAbsence).toBeUndefined();
        expect(f.reads.filter((handle) => handle.locator === locator)).toHaveLength(1);
    });
    it("valid v2 prep/receipt raw bytes remain visible without Recovery2 qualification", async () => {
        const text = await recoveryTexts();
        const f = traversalFixture({
            [`${branchPath}/recovery/mutations/prep`]: text.preparation,
            [`${branchPath}/recovery/outcomes/receipt`]: text.receipt,
        });
        const result = await f.traverse();
        for (const [leaf, value] of [
            ["prep", text.preparation],
            ["receipt", text.receipt],
        ]) {
            const observation = terminalFiles(result, "recovery-kind-collection").find((f) =>
                f.file.locator.endsWith(leaf)
            );
            expect(observation.raw.copyBytes()).toEqual(rawBytes(value));
            expect(observation.recognition.hint).toBe("recovery");
        }
        expect(result.storeBoundAbsence).toBeUndefined();
        expect(result).not.toHaveProperty("priorPublicationEvidence");
        expect(result).not.toHaveProperty("recoveryExecutions");
    });
    it.each([
        ["protocol", "protocol-collection", fenceText],
        ["representation-states", "representation-states-collection", stateText],
        ["migrations/migration-child", "migration-subtree", () => '{"phase":"opaque S5 evidence"}'],
    ])("declarationless %s terminal remains raw", async (collection, role, text) => {
        const locator = `${branchPath}/meta/${collection}/leaf`;
        const result = await traversalFixture({ [locator]: text() }).traverse();
        expect(terminalFiles(result, role, locator)[0].raw.copyBytes()).toEqual(rawBytes(text()));
        expect(result.storeBoundAbsence).toBeUndefined();
        expect(result).not.toHaveProperty("fenceAssessment");
        expect(result).not.toHaveProperty("stateLineage");
    });
    it.each([
        "records/kind",
        "recovery/mutations",
        "meta/protocol",
        "meta/representation-states",
        "meta/migrations/migration",
    ])("missing/malformed/unavailable declaration never gates %s", async (terminal) => {
        const locator = `${branchPath}/${terminal}/unknown`;
        for (const mode of ["missing", "malformed", "unavailable"]) {
            const files = { [locator]: "raw unknown evidence" };
            if (mode !== "missing")
                files[`${branchPath}/store.json`] = mode === "malformed" ? "{bad" : declarationText();
            const f = traversalFixture(files);
            if (mode === "unavailable")
                f.controls.setReadCondition(f.scope.directory.root, `${branchPath}/store.json`, "UNAVAILABLE");
            const result = await f.traverse();
            expect(
                result.rawFiles.some((file) => file.file.locator === locator && file.raw.status === "COMPLETE")
            ).toBe(true);
            expect(result.storeBoundAbsence).toBeUndefined();
        }
    });
    it("split provider declaration/content retains both branches without selecting a winner", async () => {
        const locator = "Provider B/collection/content-branch/records/kind/leaf";
        const result = await traversalFixture({
            "Provider A/collection/decl-branch/fresh.json": declarationText(),
            [locator]: canonicalText(),
        }).traverse();
        expect(result.declarationGroups[0].plans[0].copies[0].file.locator).toContain("Provider A");
        expect(terminalFiles(result, "record-kind-collection", locator)).not.toHaveLength(0);
        expect(result.branches.some((b) => b.directory.locator.includes("content-branch") && !b.storeIds.length)).toBe(
            true
        );
        expect(result).not.toHaveProperty("activeRepresentation");
        expect(result.storeBoundAbsence).toBeUndefined();
    });
    it("path-only structure cannot manufacture StoreId or authority", async () => {
        const result = await traversalFixture({
            [`${rootPath}/stores/${testId("store", 88)}/records/kind/leaf`]: "ordinary unrecognized bytes",
        }).traverse();
        expect(result.storeIds).toEqual([]);
        expect(result.declarationGroups).toEqual([]);
        expect(result.storeBoundAbsence).toBeUndefined();
        expect(result.findings.some((f) => f.blocksAbsence)).toBe(true);
    });
    it("unknown terminal child does not cause arbitrary recursion", async () => {
        const deep = `${branchPath}/records/kind/unknown-dir/deeper/file`;
        const f = traversalFixture({ [deep]: canonicalText() });
        const result = await f.traverse();
        expect(f.reads.some((h) => h.locator === deep)).toBe(false);
        expect(f.requests.some((r) => r.handle.locator === `${branchPath}/records/kind/unknown-dir`)).toBe(false);
        expect(result.storeBoundAbsence).toBeUndefined();
        for (const file of result.rawFiles) {
            expect(file.chain.length - 1).toBeLessThanOrEqual(MAX_DISCOVERY_DIRECTORY_DEPTH);
            for (let i = 1; i < file.chain.length; i++)
                expect(allowsValidatedChild(file.chain[i - 1].role, file.chain[i].role)).toBe(true);
        }
        expect(Object.keys(DISCOVERY_GRAMMAR)).toHaveLength(13);
    });
    it("consumer mutation cannot corrupt raw traversal evidence", async () => {
        const result = await traversalFixture({ [`${branchPath}/records/kind/leaf`]: canonicalText() }).traverse();
        const observation = terminalFiles(result, "record-kind-collection")[0];
        observation.raw.copyBytes().fill(0);
        expect(observation.raw.copyBytes()).toEqual(rawBytes(canonicalText()));
        expect(Object.isFrozen(observation.chain)).toBe(true);
        expect(observation.file).toBe(observation.file);
        expect(Object.isFrozen(result.rawFiles)).toBe(true);
    });
});

describe("Batch 2 order and work pressure", () => {
    it("scope/provider/declaration permutation does not choose authority", async () => {
        const a = traversalFixture({
            "provider/stores/a/one.json": declarationText(),
            "provider/stores/a/two.json": declarationText({ bootstrapId: testId("bootstrap", 2) }),
        });
        const b = traversalFixture({
            "provider/stores/b/three.json": declarationText({ storeId: testId("store", 2) }),
        });
        for (const f of [a, b]) {
            const original = f.port.listChildren;
            f.port.listChildren = async (...args) => {
                const r = await original(...args);
                return r.ok ? { ok: true, value: { ...r.value, entries: [...r.value.entries].reverse() } } : r;
            };
        }
        const one = await discoverPhysicalStorageTreeV05({ scopes: [a.scope, b.scope], limits: traversalLimits() });
        const two = await discoverPhysicalStorageTreeV05({ scopes: [b.scope, a.scope], limits: traversalLimits() });
        expect(logicalFacts(one)).toEqual(logicalFacts(two));
        expect(one.declarationGroups).toHaveLength(2);
        expect(one.declarationGroups[0].state).toBe("CONFLICTING_PLAN");
    });
    it.each(DISCOVERY_TRAVERSAL_WORK_AXES)(
        "requires explicit finite %s without changing Batch1 profiles",
        async (axis) => {
            const f = traversalFixture();
            for (const invalid of [undefined, Infinity, NaN, -1, Number.MAX_SAFE_INTEGER + 1])
                expect(() => f.traverse(traversalLimits({ [axis]: invalid }))).toThrow(/finite/);
            const omitted = traversalLimits();
            delete omitted[axis];
            expect(() => f.traverse(omitted)).toThrow(/finite/);
            expect(f.invocation().budget().limits).not.toHaveProperty(axis);
        }
    );
    it.each(["marker", "stores", "subtree", "declaration", "records", "recovery", "meta", "terminal"])(
        "exhaustion at %s retains exact pressure and prevents absence",
        async (stage) => {
            const files = {
                [`${rootPath}/namespace.json`]: namespaceText(),
                [`${branchPath}/store.json`]: declarationText(),
                [`${branchPath}/records/kind/leaf`]: canonicalText(),
                [`${branchPath}/recovery/mutations/leaf`]: '{"recoveryFormatVersion":2}',
                [`${branchPath}/meta/protocol/leaf`]: fenceText(),
            };
            const f = traversalFixture(files);
            const full = await f.traverse();
            const listIndex = (path) => f.requests.findIndex((r) => r.handle.locator === path);
            const readIndex = (path) => f.reads.findIndex((h) => h.locator === path);
            let profile;
            if (stage === "marker") profile = traversalLimits({ readCalls: readIndex(`${rootPath}/namespace.json`) });
            if (stage === "stores") profile = traversalLimits({ listCalls: listIndex(`${rootPath}/stores`) });
            if (stage === "subtree") profile = traversalLimits({ listCalls: listIndex(branchPath) });
            if (stage === "declaration")
                profile = traversalLimits({ readCalls: readIndex(`${branchPath}/store.json`) });
            if (stage === "records") profile = traversalLimits({ listCalls: listIndex(`${branchPath}/records`) });
            if (stage === "recovery") profile = traversalLimits({ listCalls: listIndex(`${branchPath}/recovery`) });
            if (stage === "meta") profile = traversalLimits({ listCalls: listIndex(`${branchPath}/meta`) });
            if (stage === "terminal")
                profile = traversalLimits({ rawBytesRead: full.budget.consumed.rawBytesRead - 1 });
            const result = await f.traverse(profile);
            expect(result.status).toBe("INCOMPLETE");
            expect(result.budget.refusal.axis).toBe(
                stage === "marker" || stage === "declaration"
                    ? "readCalls"
                    : stage === "terminal"
                      ? "rawBytesRead"
                      : "listCalls"
            );
            expect(result.storeBoundAbsence).toBeUndefined();
        }
    );
    it.each(["graphWork", "decodedBytes", "decodeHashByteWork"])(
        "exact %s work succeeds; one fewer refuses",
        async (axis) => {
            const f = traversalFixture({ [`${rootPath}/namespace.json`]: namespaceText() });
            const full = await f.traverse();
            const exact = full.budget.consumed[axis];
            expect((await f.traverse(traversalLimits({ [axis]: exact }))).status).toBe("COMPLETE");
            const result = await f.traverse(traversalLimits({ [axis]: exact - 1 }));
            expect(result.status).toBe("INCOMPLETE");
            expect(result.budget.refusal.axis).toBe(axis);
            expect(result.storeBoundAbsence).toBeUndefined();
        }
    );
    it("budget-refused empty namespace cannot emit qualified absence", async () => {
        const f = traversalFixture({ [`${rootPath}/namespace.json`]: namespaceText() }, [`${rootPath}/stores`]);
        const result = await f.traverse(traversalLimits({ listCalls: 1 }));
        expect(result.status).toBe("INCOMPLETE");
        expect(result.storeBoundAbsence).toBeUndefined();
    });
    it("truncated/inconsistent alternative listing never yields absence", async () => {
        const f = traversalFixture({}, [rootPath]);
        const original = f.port.listChildren;
        f.port.listChildren = async (handle, limit) => {
            const r = await original(handle, limit);
            return handle.locator === rootPath && r.ok ? { ok: true, value: { ...r.value, truncated: true } } : r;
        };
        const result = await f.traverse();
        expect(result.status).toBe("INCOMPLETE");
        expect(result.storeBoundAbsence).toBeUndefined();
    });
});

it("Batch 2 misplaced/future bound-looking root JSON blocks absence without StoreId adoption", async () => {
    for (const text of [declarationText(), JSON.stringify({ schema: "finders-keepers.future", version: 99 })]) {
        const result = await traversalFixture({ "provider-root/fresh.json": text }).traverse();
        expect(result.roots[0].state).not.toBe("NON_FK");
        expect(result.storeBoundAbsence).toBeUndefined();
        expect(result.rawFiles).not.toHaveLength(0);
        expect(result.storeIds).toEqual([]);
    }
});
it("Batch 2 interruption retains the already read physical prefix and declaration IDs", async () => {
    const f = traversalFixture({
        [`${branchPath}/a.json`]: declarationText(),
        [`${branchPath}/b.json`]: declarationText({ storeId: testId("store", 2) }),
    });
    const result = await f.traverse(traversalLimits({ readCalls: 1 }));
    expect(result.status).toBe("INCOMPLETE");
    expect(result.budget.refusal.axis).toBe("readCalls");
    expect(result.rawFiles.some((file) => file.raw.status === "COMPLETE")).toBe(true);
    expect(result.rawFiles.some((file) => file.raw.status === "INCOMPLETE")).toBe(true);
    expect(result.storeIds).toEqual([testId("store")]);
    expect(result.storeBoundAbsence).toBeUndefined();
});
it("Batch 2 extended limits and manifest are snapshotted before awaits", async () => {
    const f = traversalFixture({ [`${rootPath}/namespace.json`]: namespaceText() });
    let enter, release;
    const entered = new Promise((resolve) => {
        enter = resolve;
    });
    const wait = new Promise((resolve) => {
        release = resolve;
    });
    const list = f.port.listChildren;
    f.port.listChildren = async (...args) => {
        enter();
        await wait;
        return list(...args);
    };
    const profile = traversalLimits();
    const scopes = [f.scope];
    const pending = f.traverse(profile, scopes);
    await entered;
    scopes.length = 0;
    for (const axis of DISCOVERY_TRAVERSAL_WORK_AXES) profile[axis] = 0;
    release();
    const result = await pending;
    expect(result.status).toBe("COMPLETE");
    expect(result.storeBoundAbsence).toBeDefined();
    expect(result.budget.limits.graphWork).toBe(20000);
});
it("Batch 2 raw memoization cannot bypass a second required read view", async () => {
    const f = traversalFixture({ [`${rootPath}/namespace.json`]: namespaceText() });
    let sameListing;
    const list = f.port.listChildren;
    f.port.listChildren = async (handle, limit) => {
        if (handle.locator === rootPath && sameListing) return sameListing;
        const r = await list(handle, limit);
        if (handle.locator === rootPath) sameListing = r;
        return r;
    };
    const secondPort = { ...f.port, readBytes: async () => failure("UNSUPPORTED") };
    const secondScope = {
        port: secondPort,
        directory: unwrap(f.port.directoryHandle(rootPath)),
        entryRole: "representation-root",
    };
    const result = await f.traverse(traversalLimits(), [f.scope, secondScope]);
    expect(result.status).toBe("INCOMPLETE");
    expect(
        result.rawFiles.some(
            (file) =>
                file.scope.scopeId === 1 && file.raw.status === "INCOMPLETE" && file.raw.finding.code === "UNSUPPORTED"
        )
    ).toBe(true);
    expect(result.storeBoundAbsence).toBeUndefined();
});
it("Batch 2 renamed meta preserves nominal opaque migration after finite fence lookahead", async () => {
    const locator = `${branchPath}/renamed-meta/migrations/migration/opaque`;
    const result = await traversalFixture({
        [`${branchPath}/renamed-meta/renamed-protocol/fence`]: fenceText(),
        [locator]: "opaque",
    }).traverse();
    expect(terminalFiles(result, "protocol-collection")).not.toHaveLength(0);
    expect(terminalFiles(result, "migration-subtree", locator)).not.toHaveLength(0);
    expect(result.storeBoundAbsence).toBeUndefined();
});

import { aggregateFixture, aggregateLimits } from "./helpers/storageS2V05Fixtures";
import { DISCOVERY_AGGREGATE_AXES } from "../src/storage/discoveryBudget";
const aggregateBoundary = (result) => {
    for (const field of [
        "heads",
        "currentHeads",
        "current",
        "recordClassification",
        "qualifiedRepository",
        "activeRepresentation",
        "migrationCommit",
        "mayMutate",
        "mayBootstrap",
    ])
        expect(result).not.toHaveProperty(field);
};
const aggregateStore = (extra = {}) => ({
    [`${rootPath}/marker.json`]: namespaceText(),
    [`${branchPath}/decl.json`]: declarationText(),
    ...extra,
});
describe("Batch4 scoped completeness and absence", () => {
    it("complete empty boundary carries only an admitted manifest-bound local witness", async () => {
        const r = await aggregateFixture().aggregate();
        expect(r.outcome).toBe("COMPLETE_ADMITTED");
        expect(r.observation.status).toBe("COMPLETE");
        expect(r.admission.status).toBe("ADMITTED");
        expect(r.storeBoundAbsence.manifest).toBe(r.manifest);
        aggregateBoundary(r);
    });
    it.each([true, false])("empty namespace marker=%s needs completed negative probes", async (marker) => {
        const f = aggregateFixture(marker ? { [`${rootPath}/namespace.json`]: namespaceText() } : {}, [
            `${rootPath}/stores`,
        ]);
        const r = await f.aggregate();
        expect(r.outcome).toBe("COMPLETE_ADMITTED");
        expect(r.storeBoundAbsence).toBeDefined();
        expect(f.requests.some((q) => q.handle.locator === `${rootPath}/stores`)).toBe(true);
    });
    it("failed required scope cannot be replaced by equivalent good issuer/store evidence", async () => {
        const a = aggregateFixture(aggregateStore()),
            b = aggregateFixture(aggregateStore());
        b.controls.setListCondition(b.scope.directory.root, "", "UNAVAILABLE");
        const r = await a.aggregate(aggregateLimits(), undefined, [a.scope, b.scope]);
        expect(r.outcome).toBe("INCOMPLETE");
        expect(r.observation.scopes.map((s) => s.physical)).toEqual(["COMPLETE", "INCOMPLETE"]);
        expect(r.storeBoundAbsence).toBeUndefined();
        aggregateBoundary(r);
    });
    it("representation-only scope stays narrower and cannot issue namespace-wide absence", async () => {
        const f = aggregateFixture({ [`${rootPath}/namespace.json`]: namespaceText() });
        const scope = {
            ...f.scope,
            directory: unwrap(f.port.directoryHandle(rootPath)),
            entryRole: "representation-root",
        };
        const r = await f.aggregate(aggregateLimits(), undefined, [scope]);
        expect(r.outcome).toBe("COMPLETE_ADMITTED");
        expect(r.observation.coverage).toBe("SUPPLIED_ROOTS_ONLY");
        expect(r.storeBoundAbsence).toBeUndefined();
    });
    it("malformed artifact is complete observation with blocked health, not unrun traversal", async () => {
        const r = await aggregateFixture(
            aggregateStore({ [`${branchPath}/records/kind/invalid`]: "{bad" })
        ).aggregate();
        expect(r.outcome).toBe("COMPLETE_ADMITTED");
        expect(r.observation.status).toBe("COMPLETE");
        expect(r.findings).toContain("ARTIFACT_INVALID");
        expect(r.storeBoundAbsence).toBeUndefined();
    });
    it.each(["NOT_FOUND", "UNAVAILABLE", "UNSUPPORTED", "unknown"])(
        "listed child failure %s is incomplete and size unknown",
        async (code) => {
            const path = `${branchPath}/records/kind/unreadable`;
            const f = aggregateFixture(aggregateStore({ [path]: canonicalText() }));
            const read = f.port.readBytes;
            f.port.readBytes = async (handle) => (handle.locator === path ? failure(code) : read(handle));
            const r = await f.aggregate();
            expect(r.outcome).toBe("INCOMPLETE");
            expect(r.accounting.unknownSizedFiles).toBeGreaterThan(0);
            expect(r.accounting.byteAccountingComplete).toBe(false);
            expect(r.accounting).not.toHaveProperty("knownRemainingPhysicalBytes");
            expect(r.storeBoundAbsence).toBeUndefined();
        }
    );
    it("truncated scope cannot be successful aggregate", async () => {
        const f = aggregateFixture({}, [rootPath]);
        const list = f.port.listChildren;
        f.port.listChildren = async (...args) => {
            const r = await list(...args);
            return r.ok ? { ok: true, value: { ...r.value, truncated: true } } : r;
        };
        const r = await f.aggregate();
        expect(r.outcome).toBe("INCOMPLETE");
        expect(r.storeBoundAbsence).toBeUndefined();
    });
    it("valid namespace copy cannot hide malformed/missing-marker sibling or declarationless evidence", async () => {
        const r = await aggregateFixture({
            [`${rootPath}/good.json`]: namespaceText(),
            [`${rootPath}/bad.json`]: "{bad",
            "alternative/stores/b/records/kind/canonical": canonicalText(),
        }).aggregate();
        expect(r.observation.status).toBe("COMPLETE");
        expect(r.findings).toContain("NAMESPACE_INVALID_OR_UNSUPPORTED");
        expect(r.findings).toContain("MISSING_NAMESPACE");
        expect(r.evidence.identityClaims).toHaveLength(1);
        expect(r.storeBoundAbsence).toBeUndefined();
    });
    it.each(["canonical", "recovery", "fence", "state"])(
        "declarationless %s evidence remains counted and blocks witness",
        async (family) => {
            const e = await recoveryTexts();
            const path =
                family === "canonical"
                    ? `${branchPath}/records/kind/leaf`
                    : family === "recovery"
                      ? `${branchPath}/recovery/mutations/leaf`
                      : `${branchPath}/meta/${family === "fence" ? "protocol" : "representation-states"}/leaf`;
            const text =
                family === "canonical"
                    ? canonicalText()
                    : family === "recovery"
                      ? e.preparation
                      : family === "fence"
                        ? fenceText()
                        : stateText();
            const r = await aggregateFixture({ [path]: text }).aggregate();
            expect(r.storeIds).toEqual([testId("store")]);
            expect(r.accounting.observedPhysicalFiles).toBe(1);
            expect(r.storeBoundAbsence).toBeUndefined();
        }
    );
    it("empty nominal root and NO_STORE cannot hide populated alternative/unresolved structure", async () => {
        const r = await aggregateFixture(
            { "provider/collection/branch/records/kind/unknown": "ordinary unrecognized" },
            [rootPath, `${rootPath}/stores/empty/records`]
        ).aggregate();
        expect(r.storeInventory).toBe("NO_STORE");
        expect(r.storeBoundAbsence).toBeUndefined();
        aggregateBoundary(r);
    });
    it.each(DISCOVERY_AGGREGATE_AXES)(
        "full profile requires finite explicit %s including later-stage fields",
        (axis) => {
            const f = aggregateFixture();
            for (const bad of [undefined, NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])
                expect(() => f.aggregate(aggregateLimits({ [axis]: bad }))).toThrow(/finite/);
            const omitted = aggregateLimits();
            delete omitted[axis];
            expect(() => f.aggregate(omitted)).toThrow(/finite/);
        }
    );
    it("head/resolution limits validated but unconsumed at Batch4", async () => {
        const r = await aggregateFixture(
            aggregateStore({ [`${branchPath}/records/kind/leaf`]: canonicalText() })
        ).aggregate(aggregateLimits({ ordinaryHeads: 0, resolutionWork: 0 }));
        expect(r.outcome).toBe("COMPLETE_ADMITTED");
        expect(r.budget.consumed.ordinaryHeads).toBe(0);
        expect(r.budget.consumed.resolutionWork).toBe(0);
        aggregateBoundary(r);
    });
});
