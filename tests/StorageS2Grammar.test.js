import { describe, expect, it } from "vitest";
import {
    DISCOVERY_GRAMMAR,
    DISCOVERY_GRAMMAR_VERSION,
    DISCOVERY_NOMINAL_DIRECTORY_NAMES,
    INITIAL_DISCOVERY_LIST_LIMIT,
    MAX_DISCOVERY_DIRECTORY_DEPTH,
    allowsValidatedChild,
} from "../src/storage/discoveryGrammar";
import {
    DISPOSABLE_STORAGE_DIAGNOSTIC_ROOTS,
    HIDDEN_REPRESENTATION_ROOT_BASENAME,
    PRODUCTION_NAMESPACE_MARKER_IDENTITY,
    PRODUCTION_NAMESPACE_MARKER_LOCATOR,
    PRODUCTION_REPRESENTATION_ROOT_BASENAMES,
    VISIBLE_REPRESENTATION_ROOT_BASENAME,
} from "../src/storage/namespace";

describe("Storage S2 production namespace", () => {
    it("uses distinct production roots and marker identity outside disposable probe roots", () => {
        expect(HIDDEN_REPRESENTATION_ROOT_BASENAME).toBe(".finders-keepers");
        expect(VISIBLE_REPRESENTATION_ROOT_BASENAME).toBe("Finders Keepers");
        expect(new Set(PRODUCTION_REPRESENTATION_ROOT_BASENAMES).size).toBe(2);
        for (const root of PRODUCTION_REPRESENTATION_ROOT_BASENAMES) {
            expect(DISPOSABLE_STORAGE_DIAGNOSTIC_ROOTS).not.toContain(root);
            expect(root.startsWith(".fk-storage-matrix-")).toBe(false);
        }
        expect(PRODUCTION_NAMESPACE_MARKER_LOCATOR).toBe("namespace.json");
        expect(PRODUCTION_NAMESPACE_MARKER_IDENTITY).toEqual({
            schema: "finders-keepers.namespace",
            version: 1,
        });
        expect(PRODUCTION_NAMESPACE_MARKER_IDENTITY.schema).not.toMatch(/probe|matrix/i);
    });
});

describe("Storage S2 finite structural grammar", () => {
    it("freezes the production grammar and its depth/listing bounds", () => {
        expect(DISCOVERY_GRAMMAR_VERSION).toBe(1);
        expect(MAX_DISCOVERY_DIRECTORY_DEPTH).toBe(6);
        expect(INITIAL_DISCOVERY_LIST_LIMIT).toBeGreaterThan(0);
        expect(Object.keys(DISCOVERY_GRAMMAR)).toEqual([
            "vault-root",
            "representation-root",
            "stores-collection",
            "store-subtree",
            "records-collection",
            "record-kind-collection",
            "recovery-collection",
            "recovery-kind-collection",
            "meta-collection",
            "protocol-collection",
            "representation-states-collection",
            "migrations-collection",
            "migration-subtree",
        ]);
        expect(DISCOVERY_NOMINAL_DIRECTORY_NAMES).toMatchObject({
            stores: "stores",
            storeManifest: "store.json",
            records: "records",
            recovery: "recovery",
            meta: "meta",
            protocol: "protocol",
            representationStates: "representation-states",
            migrations: "migrations",
        });
    });

    it("allows only declared validated descent edges", () => {
        expect(allowsValidatedChild("vault-root", "representation-root")).toBe(true);
        expect(allowsValidatedChild("representation-root", "stores-collection")).toBe(true);
        expect(allowsValidatedChild("stores-collection", "store-subtree")).toBe(true);
        expect(allowsValidatedChild("store-subtree", "meta-collection")).toBe(true);
        expect(allowsValidatedChild("meta-collection", "migrations-collection")).toBe(true);
        expect(allowsValidatedChild("vault-root", "store-subtree")).toBe(false);
        expect(allowsValidatedChild("record-kind-collection", "vault-root")).toBe(false);
        expect(allowsValidatedChild("migration-subtree", "store-subtree")).toBe(false);
    });

    it("makes candidate probes explicit without granting arbitrary traversal", () => {
        expect(DISCOVERY_GRAMMAR["vault-root"].candidateProbe).toMatch(/immediate JSON files.*namespace\.json/);
        expect(DISCOVERY_GRAMMAR["representation-root"].candidateProbe).toMatch(/next store-subtree edge/);
        expect(DISCOVERY_GRAMMAR["migrations-collection"].candidateProbe).toMatch(/names as MigrationIds/);
        expect(DISCOVERY_GRAMMAR["migration-subtree"].candidateProbe).toMatch(/opaque raw observations/);
        for (const rule of Object.values(DISCOVERY_GRAMMAR)) {
            expect(rule.candidateProbe.length).toBeGreaterThan(0);
            expect(rule.validatedChildren.length).toBeLessThanOrEqual(Object.keys(DISCOVERY_GRAMMAR).length);
        }
    });
});
