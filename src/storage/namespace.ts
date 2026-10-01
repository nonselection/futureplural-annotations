import type { NamespaceArtifactV1 } from "./authorityArtifacts";

/** Production representation locations. These are implementation locators, not store authority. */
export const HIDDEN_REPRESENTATION_ROOT_BASENAME = ".finders-keepers";
export const VISIBLE_REPRESENTATION_ROOT_BASENAME = "Finders Keepers";
export const PRODUCTION_REPRESENTATION_ROOT_BASENAMES = Object.freeze([
    HIDDEN_REPRESENTATION_ROOT_BASENAME,
    VISIBLE_REPRESENTATION_ROOT_BASENAME,
] as const);

/** The existing S1 namespace artifact discriminator is the production marker identity. */
export const PRODUCTION_NAMESPACE_MARKER_LOCATOR = "namespace.json";
export const PRODUCTION_NAMESPACE_MARKER_IDENTITY: Readonly<NamespaceArtifactV1> = Object.freeze({
    schema: "finders-keepers.namespace",
    version: 1,
});

/** Disposable diagnostic roots are explicitly outside the production namespace. */
export const DISPOSABLE_STORAGE_DIAGNOSTIC_ROOTS = Object.freeze([
    ".fk-storage-probe-b0",
    "FK-Storage-Probe-B0",
    ".fk-storage-probe-b0-hidden-independent",
] as const);
