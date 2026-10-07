/**
 * Finite, provider-neutral grammar for S2 physical discovery.
 * Unknown nodes never grant traversal. Version 1 fixes structural edges/depth;
 * successor S2 also meters sibling work with finite invocation budgets.
 */

export const DISCOVERY_GRAMMAR_VERSION = 1 as const;

/** Maximum directory edges from the vault root through a MigrationId child. */
export const MAX_DISCOVERY_DIRECTORY_DEPTH = 6;

/** The first listing is a page size, not a candidate-count limit. */
export const INITIAL_DISCOVERY_LIST_LIMIT = 64;

export type DiscoveryStructuralLevel =
    | "vault-root"
    | "representation-root"
    | "stores-collection"
    | "store-subtree"
    | "records-collection"
    | "record-kind-collection"
    | "recovery-collection"
    | "recovery-kind-collection"
    | "meta-collection"
    | "protocol-collection"
    | "representation-states-collection"
    | "migrations-collection"
    | "migration-subtree";

export interface DiscoveryGrammarRule {
    readonly mayEnumerateSiblingAlternatives: boolean;
    readonly nominalChildNames: readonly string[];
    readonly candidateProbe: string;
    readonly validatedChildren: readonly DiscoveryStructuralLevel[];
}

/**
 * Candidate probes are bounded lookahead only. These structural edges do not
 * require namespace/declaration presence; successor attribution is a later S2
 * stage. Nominal names and descriptive probe text are non-authoritative hints.
 */
export const DISCOVERY_GRAMMAR: Readonly<Record<DiscoveryStructuralLevel, DiscoveryGrammarRule>> = Object.freeze({
    "vault-root": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: [".finders-keepers", "Finders Keepers"],
        candidateProbe:
            "For each immediate directory, inspect only immediate JSON files for namespace content; always retain the namespace.json locator result.",
        validatedChildren: ["representation-root"],
    },
    "representation-root": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: ["stores"],
        candidateProbe:
            "For non-marker child directories, inspect only the next store-subtree edge for a valid store-bound artifact.",
        validatedChildren: ["stores-collection"],
    },
    "stores-collection": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: [],
        candidateProbe: "Inspect immediate candidate store subtrees for valid store-bound S1 artifacts.",
        validatedChildren: ["store-subtree"],
    },
    "store-subtree": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: ["records", "recovery", "meta"],
        candidateProbe: "Read only immediate store-bound artifacts and enumerate allow-listed child collections.",
        validatedChildren: ["records-collection", "recovery-collection", "meta-collection"],
    },
    "records-collection": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: ["sources", "annotations", "palette-slots", "codes", "sets", "memos"],
        candidateProbe: "Enumerate immediate record-kind candidates; recognize files by validated envelope content.",
        validatedChildren: ["record-kind-collection"],
    },
    "record-kind-collection": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: [],
        candidateProbe: "Read immediate files only; recognized record codecs determine logical identity.",
        validatedChildren: [],
    },
    "recovery-collection": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: ["mutations", "outcomes"],
        candidateProbe: "Observe immediate entries as opaque until later recovery codecs validate them.",
        validatedChildren: ["recovery-kind-collection"],
    },
    "recovery-kind-collection": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: [],
        candidateProbe: "Read immediate files as raw opaque observations; do not infer logical identity.",
        validatedChildren: [],
    },
    "meta-collection": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: ["protocol", "representation-states", "migrations"],
        candidateProbe: "Enumerate only protocol, representation-state, and migration candidates.",
        validatedChildren: ["protocol-collection", "representation-states-collection", "migrations-collection"],
    },
    "protocol-collection": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: [],
        candidateProbe: "Read immediate authority-marker files; validate known content and preserve unknown evidence.",
        validatedChildren: [],
    },
    "representation-states-collection": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: [],
        candidateProbe: "Read immediate representation-state artifacts and validate their own store binding.",
        validatedChildren: [],
    },
    "migrations-collection": {
        mayEnumerateSiblingAlternatives: true,
        nominalChildNames: [],
        candidateProbe: "Observe immediate migration child directories without treating their names as MigrationIds.",
        validatedChildren: ["migration-subtree"],
    },
    "migration-subtree": {
        mayEnumerateSiblingAlternatives: false,
        nominalChildNames: [],
        candidateProbe: "Read immediate phase-like files as opaque raw observations until S5 codecs exist.",
        validatedChildren: [],
    },
});

export const DISCOVERY_NOMINAL_DIRECTORY_NAMES = Object.freeze({
    stores: "stores",
    storeManifest: "store.json",
    records: "records",
    recovery: "recovery",
    mutations: "mutations",
    outcomes: "outcomes",
    meta: "meta",
    protocol: "protocol",
    representationStates: "representation-states",
    migrations: "migrations",
} as const);

/** Return whether a structural edge is part of the finite grammar. */
export function allowsValidatedChild(parent: DiscoveryStructuralLevel, child: DiscoveryStructuralLevel): boolean {
    return DISCOVERY_GRAMMAR[parent].validatedChildren.includes(child);
}
