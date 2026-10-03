import type { CanonicalRecordCodec } from "./envelopes";
import { canonicalDigest } from "./canonicalEncoding";
import {
    discoverRepresentationRoots,
    isWithinDiscoveryDepth,
    listAllDiscoveryChildren,
    type DiscoveryListingObservation,
    type DiscoveryReadPort,
    type RepresentationRootDiscovery,
} from "./discovery";
import {
    recognizeDiscoveryArtifact,
    type DiscoveryArtifactContext,
    type DiscoveryArtifactRecognition,
    type DiscoveryRawFile,
} from "./discoveryArtifacts";
import { DISCOVERY_NOMINAL_DIRECTORY_NAMES, allowsValidatedChild } from "./discoveryGrammar";
import type { StoreId } from "./identity";
import type { RepresentationEntry, RepresentationStorageResult } from "./RepresentationStoragePort";

export interface StructuralProbeObservation {
    readonly locator: string;
    readonly grammarPosition: string;
    readonly result: "VALIDATED_DESCENT" | "NO_QUALIFYING_EVIDENCE" | "UNAVAILABLE" | "INVALID_EVIDENCE";
    readonly evidenceLocators: readonly string[];
}

export interface PhysicalArtifactObservation extends DiscoveryRawFile {
    readonly recognition: DiscoveryArtifactRecognition;
}

export interface UnknownStructuralNode {
    readonly locator: string;
    readonly parentLocator: string;
    readonly parentContext: string;
    readonly reason: string;
    readonly rawFileLocators: readonly string[];
}

export interface PhysicalStoreCandidate {
    /** Physical candidate label only; it is never a logical store identity. */
    readonly candidateLocator: string;
    readonly representationRootLocator: string;
    readonly storesCollectionLocator: string;
    readonly storeIds: readonly StoreId[];
    readonly hasStoreManifest: boolean;
    readonly artifactObservations: readonly PhysicalArtifactObservation[];
    readonly state: "VALID" | "PARTIAL" | "MIXED_STORE_INVALID" | "UNAVAILABLE";
}

export interface StructuralDiscoverySnapshot {
    readonly rootDiscovery: RepresentationRootDiscovery;
    readonly state: "COMPLETE" | "UNAVAILABLE";
    readonly listings: readonly DiscoveryListingObservation[];
    readonly probes: readonly StructuralProbeObservation[];
    readonly artifacts: readonly PhysicalArtifactObservation[];
    readonly storeCandidates: readonly PhysicalStoreCandidate[];
    readonly unknownNodes: readonly UnknownStructuralNode[];
    readonly fingerprint?: string;
}

interface ScanContext {
    readonly port: DiscoveryReadPort;
    readonly recordCodecs: readonly CanonicalRecordCodec[];
    readonly listings: Map<string, DiscoveryListingObservation>;
    readonly artifacts: Map<string, PhysicalArtifactObservation>;
    readonly probes: StructuralProbeObservation[];
    readonly unknownNodes: UnknownStructuralNode[];
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function join(parent: string, child: string): string {
    return parent ? `${parent}/${child}` : child;
}

function sortEntries(entries: readonly RepresentationEntry[]): RepresentationEntry[] {
    return [...entries].sort((left, right) => compareText(left.name, right.name) || compareText(left.kind, right.kind));
}

function uniquePhysicalObservations(
    observations: readonly PhysicalArtifactObservation[]
): PhysicalArtifactObservation[] {
    const unique = new Map<string, PhysicalArtifactObservation>();
    for (const observation of observations) unique.set(`${observation.context}\0${observation.locator}`, observation);
    return [...unique.values()].sort(
        (left, right) => compareText(left.locator, right.locator) || compareText(left.context, right.context)
    );
}

async function listAt(context: ScanContext, locator: string): Promise<DiscoveryListingObservation> {
    const existing = context.listings.get(locator);
    if (existing) return existing;
    const { listing } = await listAllDiscoveryChildren(context.port, locator);
    context.listings.set(locator, listing);
    return listing;
}

async function readAt(
    context: ScanContext,
    locator: string,
    artifactContext: DiscoveryArtifactContext
): Promise<PhysicalArtifactObservation> {
    const key = `${artifactContext}\0${locator}`;
    const existing = context.artifacts.get(key);
    if (existing) return existing;
    let result: RepresentationStorageResult<Uint8Array>;
    try {
        result = await context.port.readBytes(locator);
    } catch (error) {
        result = {
            ok: false,
            failure: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "Read failed." },
        };
    }
    let raw: DiscoveryRawFile;
    if (result.ok === false) {
        raw = {
            locator,
            context: artifactContext,
            readStatus: result.failure.code === "NOT_FOUND" ? "NOT_FOUND" : "UNAVAILABLE",
            failure: result.failure,
        };
    } else {
        raw = { locator, context: artifactContext, readStatus: "READ", bytes: Uint8Array.from(result.value) };
    }
    const observation: PhysicalArtifactObservation = {
        ...raw,
        recognition: await recognizeDiscoveryArtifact(raw, { recordCodecs: context.recordCodecs }),
    };
    context.artifacts.set(key, observation);
    return observation;
}

async function readFiles(
    context: ScanContext,
    directory: string,
    listing: DiscoveryListingObservation,
    artifactContext: DiscoveryArtifactContext
): Promise<PhysicalArtifactObservation[]> {
    const observations: PhysicalArtifactObservation[] = [];
    for (const entry of sortEntries(listing.entries)) {
        const child = join(directory, entry.name);
        if (entry.kind === "directory") {
            addUnknown(
                context,
                child,
                directory,
                artifactContext,
                "Unexpected directory in a terminal collection; retained without recursive descent."
            );
            continue;
        }
        observations.push(await readAt(context, child, artifactContext));
    }
    return observations;
}

async function readUnknownFiles(
    context: ScanContext,
    directory: string,
    listing: DiscoveryListingObservation
): Promise<PhysicalArtifactObservation[]> {
    const files = sortEntries(listing.entries).filter((entry) => entry.kind === "file");
    const observations: PhysicalArtifactObservation[] = [];
    for (const entry of files)
        observations.push(await readAt(context, join(directory, entry.name), "unknown-structural"));
    return observations;
}

function validKind(observation: PhysicalArtifactObservation, kind: string): boolean {
    return observation.recognition.status === "VALID" && observation.recognition.kind === kind;
}

function relevantAuthorityProbeEvidence(
    recognition: DiscoveryArtifactRecognition,
    expectedKind: "protocol-fence" | "representation-state"
): boolean {
    if (recognition.status === "VALID") return recognition.kind === expectedKind;
    // UNSUPPORTED is emitted only after the protocol decoder recognized its
    // ratified schema family. It is relevant fence evidence, never a valid fence.
    return expectedKind === "protocol-fence" && recognition.status === "UNSUPPORTED";
}

function artifactStoreId(observation: PhysicalArtifactObservation): StoreId | undefined {
    if (observation.recognition.status !== "VALID") return undefined;
    const value = observation.recognition.value;
    if ("storeId" in value) return value.storeId;
    return undefined;
}

function addUnknown(
    context: ScanContext,
    locator: string,
    parentLocator: string,
    parentContext: string,
    reason: string,
    rawFileLocators: readonly string[] = []
): void {
    context.unknownNodes.push({
        locator,
        parentLocator,
        parentContext,
        reason,
        rawFileLocators: [...rawFileLocators].sort(compareText),
    });
}

function requireGrammarEdge(
    parent: Parameters<typeof allowsValidatedChild>[0],
    child: Parameters<typeof allowsValidatedChild>[1]
): void {
    if (!allowsValidatedChild(parent, child)) {
        throw new Error(`S2 traversal attempted undeclared grammar edge ${parent} -> ${child}.`);
    }
}

async function probeRecordCollection(context: ScanContext, locator: string): Promise<boolean> {
    requireGrammarEdge("records-collection", "record-kind-collection");
    const listing = await listAt(context, locator);
    if (listing.status !== "COMPLETE") return false;
    let found = false;
    for (const entry of sortEntries(listing.entries)) {
        if (entry.kind !== "directory" || !isWithinDiscoveryDepth(join(locator, entry.name))) continue;
        const kindLocator = join(locator, entry.name);
        const kindListing = await listAt(context, kindLocator);
        if (kindListing.status !== "COMPLETE") continue;
        const rawObservations = await readUnknownFiles(context, kindLocator, kindListing);
        const recognized: DiscoveryArtifactRecognition[] = [];
        for (const raw of rawObservations) {
            recognized.push(
                await recognizeDiscoveryArtifact(
                    { ...raw, context: "record-envelope" },
                    { recordCodecs: context.recordCodecs }
                )
            );
        }
        if (recognized.some((item) => item.status === "VALID" && item.kind === "revision")) {
            rawObservations.forEach((raw, index) => {
                context.artifacts.delete(`unknown-structural\0${raw.locator}`);
                context.artifacts.set(`record-envelope\0${raw.locator}`, {
                    ...raw,
                    context: "record-envelope",
                    recognition: recognized[index],
                });
            });
            found = true;
        }
    }
    return found;
}

async function probeAuthorityCollection(
    context: ScanContext,
    locator: string,
    artifactContext: "protocol-namespace" | "representation-state-namespace",
    expectedKind: "protocol-fence" | "representation-state"
): Promise<boolean> {
    requireGrammarEdge(
        "meta-collection",
        artifactContext === "protocol-namespace" ? "protocol-collection" : "representation-states-collection"
    );
    const listing = await listAt(context, locator);
    if (listing.status !== "COMPLETE") return false;
    const files = sortEntries(listing.entries).filter((entry) => entry.kind === "file");
    const rawObservations: PhysicalArtifactObservation[] = [];
    const recognized: DiscoveryArtifactRecognition[] = [];
    for (const entry of files) {
        const raw = await readAt(context, join(locator, entry.name), "unknown-structural");
        rawObservations.push(raw);
        recognized.push(
            await recognizeDiscoveryArtifact(
                { ...raw, context: artifactContext },
                { recordCodecs: context.recordCodecs }
            )
        );
    }
    const relevantEvidence = recognized.some((item) => relevantAuthorityProbeEvidence(item, expectedKind));
    if (!relevantEvidence) return false;

    // The content probe validated this collection's role. Promote the exact same
    // bytes into that validated context so extra files become authority evidence
    // without rereading a potentially changing provider view.
    rawObservations.forEach((raw, index) => {
        context.artifacts.delete(`unknown-structural\0${raw.locator}`);
        context.artifacts.set(`${artifactContext}\0${raw.locator}`, {
            ...raw,
            context: artifactContext,
            recognition: recognized[index],
        });
    });
    return true;
}

function observationsBelow(context: ScanContext, parentLocator: string): PhysicalArtifactObservation[] {
    const prefix = `${parentLocator}/`;
    return [...context.artifacts.values()].filter((item) => item.locator.startsWith(prefix));
}

async function probeMetaCollection(context: ScanContext, locator: string): Promise<boolean> {
    requireGrammarEdge("store-subtree", "meta-collection");
    const listing = await listAt(context, locator);
    if (listing.status !== "COMPLETE") return false;
    for (const entry of sortEntries(listing.entries)) {
        if (entry.kind !== "directory") continue;
        const child = join(locator, entry.name);
        const protocolMatch = await probeAuthorityCollection(context, child, "protocol-namespace", "protocol-fence");
        if (protocolMatch) return true;
        const stateMatch = await probeAuthorityCollection(
            context,
            child,
            "representation-state-namespace",
            "representation-state"
        );
        if (stateMatch) return true;
    }
    return false;
}

async function probeStoreSubtree(
    context: ScanContext,
    locator: string
): Promise<{ storeIds: StoreId[]; observations: PhysicalArtifactObservation[]; complete: boolean }> {
    requireGrammarEdge("stores-collection", "store-subtree");
    if (!isWithinDiscoveryDepth(locator)) return { storeIds: [], observations: [], complete: false };
    const listing = await listAt(context, locator);
    if (listing.status !== "COMPLETE") return { storeIds: [], observations: [], complete: false };
    // This is a structural node, not a terminal collection. Directory edges
    // are validated/probed by scanStoreCandidate, which retains unknown edges;
    // do not preclassify them through the terminal-directory rule in readFiles.
    const ownFiles = await readFiles(
        context,
        locator,
        { ...listing, entries: listing.entries.filter((entry) => entry.kind === "file") },
        "store-subtree"
    );
    const observations = [...ownFiles];
    const validStoreIds = new Set<StoreId>(
        ownFiles.map(artifactStoreId).filter((value): value is StoreId => Boolean(value))
    );

    // A valid record or authority artifact is also enough to expose a partial store attempt.
    for (const entry of sortEntries(listing.entries)) {
        if (entry.kind !== "directory") continue;
        const child = join(locator, entry.name);
        if (!isWithinDiscoveryDepth(child)) continue;
        if (entry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.records) {
            requireGrammarEdge("store-subtree", "records-collection");
            const recordsListing = await listAt(context, child);
            if (recordsListing.status !== "COMPLETE") continue;
            for (const kindEntry of sortEntries(recordsListing.entries)) {
                if (kindEntry.kind !== "directory") continue;
                const kindLocator = join(child, kindEntry.name);
                const kindListing = await listAt(context, kindLocator);
                if (kindListing.status !== "COMPLETE") continue;
                const items = await readFiles(context, kindLocator, kindListing, "record-envelope");
                observations.push(...items);
                for (const item of items) {
                    const storeId = artifactStoreId(item);
                    if (storeId) validStoreIds.add(storeId);
                }
            }
        } else if (entry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.meta) {
            requireGrammarEdge("store-subtree", "meta-collection");
            const metaListing = await listAt(context, child);
            if (metaListing.status !== "COMPLETE") continue;
            for (const metaEntry of sortEntries(metaListing.entries)) {
                if (metaEntry.kind !== "directory") continue;
                const metaChild = join(child, metaEntry.name);
                const metaChildListing = await listAt(context, metaChild);
                if (metaChildListing.status !== "COMPLETE") continue;
                let items: PhysicalArtifactObservation[] = [];
                if (metaEntry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.protocol) {
                    items = await readFiles(context, metaChild, metaChildListing, "protocol-namespace");
                } else if (metaEntry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.representationStates) {
                    items = await readFiles(context, metaChild, metaChildListing, "representation-state-namespace");
                } else {
                    const protocolMatch = await probeAuthorityCollection(
                        context,
                        metaChild,
                        "protocol-namespace",
                        "protocol-fence"
                    );
                    if (protocolMatch) {
                        items.push(
                            ...observationsBelow(context, metaChild).filter(
                                (item) => item.context === "protocol-namespace"
                            )
                        );
                    } else if (
                        await probeAuthorityCollection(
                            context,
                            metaChild,
                            "representation-state-namespace",
                            "representation-state"
                        )
                    ) {
                        items.push(
                            ...observationsBelow(context, metaChild).filter(
                                (item) => item.context === "representation-state-namespace"
                            )
                        );
                    }
                }
                observations.push(...items);
                for (const item of items) {
                    const storeId = artifactStoreId(item);
                    if (storeId) validStoreIds.add(storeId);
                }
            }
        }
    }
    const complete =
        ![...context.artifacts.values()].some(
            (item) => (item.locator === locator || item.locator.startsWith(`${locator}/`)) && item.readStatus !== "READ"
        ) &&
        ![...context.listings.values()].some(
            (item) => (item.locator === locator || item.locator.startsWith(`${locator}/`)) && item.status !== "COMPLETE"
        );
    return { storeIds: [...validStoreIds].sort(compareText), observations, complete };
}

async function scanRecordCollection(context: ScanContext, locator: string): Promise<PhysicalArtifactObservation[]> {
    requireGrammarEdge("store-subtree", "records-collection");
    requireGrammarEdge("records-collection", "record-kind-collection");
    const collectionListing = await listAt(context, locator);
    if (collectionListing.status !== "COMPLETE") return [];
    const observations: PhysicalArtifactObservation[] = [];
    for (const entry of sortEntries(collectionListing.entries)) {
        if (entry.kind !== "directory") {
            const fileLocator = join(locator, entry.name);
            await readAt(context, fileLocator, "unknown-structural");
            addUnknown(
                context,
                fileLocator,
                locator,
                "records-collection",
                "Record collection contains a non-directory child.",
                [fileLocator]
            );
            continue;
        }
        const kindLocator = join(locator, entry.name);
        if (!isWithinDiscoveryDepth(kindLocator)) {
            addUnknown(context, kindLocator, locator, "records-collection", "Maximum structural depth reached.");
            continue;
        }
        const kindListing = await listAt(context, kindLocator);
        if (kindListing.status !== "COMPLETE") continue;
        const items = await readFiles(context, kindLocator, kindListing, "record-envelope");
        observations.push(...items);
        if (!items.some((item) => validKind(item, "revision"))) {
            addUnknown(
                context,
                kindLocator,
                locator,
                "records-collection",
                "No file validated as a canonical revision envelope.",
                items.map((item) => item.locator)
            );
        }
    }
    return observations;
}

async function scanRecoveryCollection(context: ScanContext, locator: string): Promise<PhysicalArtifactObservation[]> {
    requireGrammarEdge("store-subtree", "recovery-collection");
    requireGrammarEdge("recovery-collection", "recovery-kind-collection");
    const collectionListing = await listAt(context, locator);
    if (collectionListing.status !== "COMPLETE") return [];
    const observations: PhysicalArtifactObservation[] = [];
    for (const entry of sortEntries(collectionListing.entries)) {
        const child = join(locator, entry.name);
        if (entry.kind === "file") {
            observations.push(await readAt(context, child, "opaque-recovery"));
        } else if (isWithinDiscoveryDepth(child)) {
            const childListing = await listAt(context, child);
            if (childListing.status !== "COMPLETE") continue;
            observations.push(...(await readFiles(context, child, childListing, "opaque-recovery")));
        }
    }
    return observations;
}

async function scanMigrationsCollection(context: ScanContext, locator: string): Promise<PhysicalArtifactObservation[]> {
    requireGrammarEdge("meta-collection", "migrations-collection");
    requireGrammarEdge("migrations-collection", "migration-subtree");
    const collectionListing = await listAt(context, locator);
    if (collectionListing.status !== "COMPLETE") return [];
    const observations: PhysicalArtifactObservation[] = [];
    for (const entry of sortEntries(collectionListing.entries)) {
        const migrationLocator = join(locator, entry.name);
        if (entry.kind !== "directory" || !isWithinDiscoveryDepth(migrationLocator)) {
            if (entry.kind === "file") await readAt(context, migrationLocator, "unknown-structural");
            addUnknown(
                context,
                migrationLocator,
                locator,
                "migrations-collection",
                "Unexpected migration-collection child; its name is not interpreted.",
                entry.kind === "file" ? [migrationLocator] : []
            );
            continue;
        }
        const migrationListing = await listAt(context, migrationLocator);
        if (migrationListing.status !== "COMPLETE") continue;
        observations.push(...(await readFiles(context, migrationLocator, migrationListing, "opaque-migration")));
    }
    return observations;
}

async function scanMetaCollection(context: ScanContext, locator: string): Promise<PhysicalArtifactObservation[]> {
    requireGrammarEdge("store-subtree", "meta-collection");
    const metaListing = await listAt(context, locator);
    if (metaListing.status !== "COMPLETE") return [];
    const observations: PhysicalArtifactObservation[] = [];
    for (const entry of sortEntries(metaListing.entries)) {
        if (entry.kind !== "directory") {
            const fileLocator = join(locator, entry.name);
            await readAt(context, fileLocator, "unknown-structural");
            addUnknown(
                context,
                fileLocator,
                locator,
                "meta-collection",
                "Metadata collection contains a non-directory child.",
                [fileLocator]
            );
            continue;
        }
        const child = join(locator, entry.name);
        if (entry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.protocol) {
            requireGrammarEdge("meta-collection", "protocol-collection");
            const listing = await listAt(context, child);
            if (listing.status === "COMPLETE")
                observations.push(...(await readFiles(context, child, listing, "protocol-namespace")));
        } else if (entry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.representationStates) {
            requireGrammarEdge("meta-collection", "representation-states-collection");
            const listing = await listAt(context, child);
            if (listing.status === "COMPLETE") {
                observations.push(...(await readFiles(context, child, listing, "representation-state-namespace")));
            }
        } else if (entry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.migrations) {
            requireGrammarEdge("meta-collection", "migrations-collection");
            observations.push(...(await scanMigrationsCollection(context, child)));
        } else {
            const protocolMatch = await probeAuthorityCollection(
                context,
                child,
                "protocol-namespace",
                "protocol-fence"
            );
            const stateMatch = protocolMatch
                ? false
                : await probeAuthorityCollection(
                      context,
                      child,
                      "representation-state-namespace",
                      "representation-state"
                  );
            if (protocolMatch) {
                const listing = await listAt(context, child);
                if (listing.status === "COMPLETE")
                    observations.push(...(await readFiles(context, child, listing, "protocol-namespace")));
            } else if (stateMatch) {
                const listing = await listAt(context, child);
                if (listing.status === "COMPLETE") {
                    observations.push(...(await readFiles(context, child, listing, "representation-state-namespace")));
                }
            } else {
                const childListing = await listAt(context, child);
                const raw =
                    childListing.status === "COMPLETE" ? await readUnknownFiles(context, child, childListing) : [];
                addUnknown(
                    context,
                    child,
                    locator,
                    "meta-collection",
                    "Alternate metadata collection did not expose validated protocol or representation-state evidence.",
                    raw.map((item) => item.locator)
                );
            }
        }
    }
    return observations;
}

async function scanStoreCandidate(
    context: ScanContext,
    representationRootLocator: string,
    storesCollectionLocator: string,
    candidateLocator: string
): Promise<PhysicalStoreCandidate> {
    requireGrammarEdge("stores-collection", "store-subtree");
    const probe = await probeStoreSubtree(context, candidateLocator);
    const artifacts = probe.observations;
    const storeIds = new Set<StoreId>(probe.storeIds);
    const listing = await listAt(context, candidateLocator);
    if (listing.status !== "COMPLETE") {
        return {
            candidateLocator,
            representationRootLocator,
            storesCollectionLocator,
            storeIds: [...storeIds].sort(compareText),
            hasStoreManifest: artifacts.some((item) => validKind(item, "store")),
            artifactObservations: artifacts,
            state: "UNAVAILABLE",
        };
    }

    for (const entry of sortEntries(listing.entries)) {
        if (entry.kind !== "directory") {
            const item = artifacts.find((candidate) => candidate.locator === join(candidateLocator, entry.name));
            if (!item || item.recognition.status === "UNRECOGNIZED") {
                const fileLocator = join(candidateLocator, entry.name);
                if (!item) await readAt(context, fileLocator, "unknown-structural");
                addUnknown(
                    context,
                    fileLocator,
                    candidateLocator,
                    "store-subtree",
                    "Unrecognized immediate store-subtree file.",
                    [fileLocator]
                );
            }
            continue;
        }
        const child = join(candidateLocator, entry.name);
        if (!isWithinDiscoveryDepth(child)) {
            addUnknown(context, child, candidateLocator, "store-subtree", "Maximum structural depth reached.");
            continue;
        }
        if (entry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.records) {
            requireGrammarEdge("store-subtree", "records-collection");
            artifacts.push(...(await scanRecordCollection(context, child)));
        } else if (entry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.recovery) {
            requireGrammarEdge("store-subtree", "recovery-collection");
            artifacts.push(...(await scanRecoveryCollection(context, child)));
        } else if (entry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.meta) {
            requireGrammarEdge("store-subtree", "meta-collection");
            artifacts.push(...(await scanMetaCollection(context, child)));
        } else {
            const recordsMatch = await probeRecordCollection(context, child);
            if (recordsMatch) {
                artifacts.push(...(await scanRecordCollection(context, child)));
            } else {
                const metaMatch = await probeMetaCollection(context, child);
                if (metaMatch) {
                    artifacts.push(...(await scanMetaCollection(context, child)));
                } else
                    addUnknown(
                        context,
                        child,
                        candidateLocator,
                        "store-subtree",
                        "Unrecognized child directory; candidate probe stopped here."
                    );
            }
        }
    }

    const candidatePrefix = `${candidateLocator}/`;
    const candidateArtifacts = uniquePhysicalObservations([
        ...artifacts,
        ...[...context.artifacts.values()].filter(
            (item) => item.locator === candidateLocator || item.locator.startsWith(candidatePrefix)
        ),
    ]);
    for (const item of candidateArtifacts) {
        const storeId = artifactStoreId(item);
        if (storeId) storeIds.add(storeId);
    }
    const sortedIds = [...storeIds].sort(compareText);
    const complete =
        !candidateArtifacts.some((item) => item.readStatus !== "READ") &&
        ![...context.listings.values()].some(
            (item) =>
                (item.locator === candidateLocator || item.locator.startsWith(`${candidateLocator}/`)) &&
                item.status !== "COMPLETE"
        );
    const hasUnrecognizedArtifact = candidateArtifacts.some((item) => item.recognition.status !== "VALID");
    const hasStructuralUnknown = context.unknownNodes.some(
        (item) => item.locator === candidateLocator || item.locator.startsWith(`${candidateLocator}/`)
    );
    return {
        candidateLocator,
        representationRootLocator,
        storesCollectionLocator,
        storeIds: sortedIds,
        hasStoreManifest: artifacts.some((item) => validKind(item, "store")),
        artifactObservations: candidateArtifacts,
        state: !complete
            ? "UNAVAILABLE"
            : sortedIds.length > 1
              ? "MIXED_STORE_INVALID"
              : sortedIds.length === 1 &&
                  artifacts.some((item) => validKind(item, "store")) &&
                  !hasUnrecognizedArtifact &&
                  !hasStructuralUnknown
                ? "VALID"
                : "PARTIAL",
    };
}

async function scanStoresCollection(
    context: ScanContext,
    rootLocator: string,
    collectionLocator: string
): Promise<PhysicalStoreCandidate[]> {
    requireGrammarEdge("representation-root", "stores-collection");
    const listing = await listAt(context, collectionLocator);
    if (listing.status !== "COMPLETE") return [];
    const candidates: PhysicalStoreCandidate[] = [];
    for (const entry of sortEntries(listing.entries)) {
        const child = join(collectionLocator, entry.name);
        if (entry.kind !== "directory") {
            await readAt(context, child, "unknown-structural");
            addUnknown(
                context,
                child,
                collectionLocator,
                "stores-collection",
                "Store collection contains a non-directory child.",
                [child]
            );
            continue;
        }
        if (!isWithinDiscoveryDepth(child)) {
            addUnknown(context, child, collectionLocator, "stores-collection", "Maximum structural depth reached.");
            continue;
        }
        candidates.push(await scanStoreCandidate(context, rootLocator, collectionLocator, child));
    }
    return candidates;
}

async function probeAlternateStoresCollection(
    context: ScanContext,
    rootLocator: string,
    candidateLocator: string
): Promise<{ valid: boolean; candidates: PhysicalStoreCandidate[] }> {
    requireGrammarEdge("representation-root", "stores-collection");
    const listing = await listAt(context, candidateLocator);
    if (listing.status !== "COMPLETE") {
        context.probes.push({
            locator: candidateLocator,
            grammarPosition: "alternate stores collection",
            result: "UNAVAILABLE",
            evidenceLocators: [],
        });
        return { valid: false, candidates: [] };
    }
    const candidates: PhysicalStoreCandidate[] = [];
    for (const entry of sortEntries(listing.entries)) {
        const child = join(candidateLocator, entry.name);
        if (entry.kind !== "directory") {
            await readAt(context, child, "unknown-structural");
            addUnknown(
                context,
                child,
                candidateLocator,
                "alternate stores candidate probe",
                "Candidate collection contains a non-directory child.",
                [child]
            );
            continue;
        }
        if (!isWithinDiscoveryDepth(child)) {
            addUnknown(
                context,
                child,
                candidateLocator,
                "alternate stores candidate probe",
                "Maximum structural depth reached."
            );
            continue;
        }
        // Candidate probing may inspect the finite store subtree grammar to find
        // validated store-bound evidence, but it does not confer ownership. Only
        // candidates with decoded StoreIds enter the store inventory/descent.
        const probe = await probeStoreSubtree(context, child);
        if (!probe.complete) {
            context.probes.push({
                locator: child,
                grammarPosition: "alternate store-subtree candidate",
                result: "UNAVAILABLE",
                evidenceLocators: probe.observations.map((item) => item.locator).sort(compareText),
            });
            addUnknown(
                context,
                child,
                candidateLocator,
                "alternate stores candidate probe",
                "Candidate probe could not establish a complete listing/read.",
                probe.observations.map((item) => item.locator)
            );
            continue;
        }
        if (!probe.storeIds.length) {
            const rawLocators = probe.observations
                .filter((item) => item.readStatus === "READ")
                .map((item) => item.locator);
            const invalidEvidence = probe.observations.some(
                (item) => item.recognition.status === "INVALID" || item.recognition.status === "UNSUPPORTED"
            );
            context.probes.push({
                locator: child,
                grammarPosition: "alternate store-subtree candidate",
                result: invalidEvidence ? "INVALID_EVIDENCE" : "NO_QUALIFYING_EVIDENCE",
                evidenceLocators: rawLocators.sort(compareText),
            });
            addUnknown(
                context,
                child,
                candidateLocator,
                "alternate stores candidate probe",
                "No qualifying store-bound evidence; candidate probe stopped.",
                rawLocators
            );
            continue;
        }
        candidates.push(await scanStoreCandidate(context, rootLocator, candidateLocator, child));
    }
    const valid = candidates.length > 0;
    context.probes.push({
        locator: candidateLocator,
        grammarPosition: "alternate stores collection",
        result: valid ? "VALIDATED_DESCENT" : "NO_QUALIFYING_EVIDENCE",
        evidenceLocators: candidates
            .flatMap((candidate) =>
                candidate.artifactObservations.filter((item) => artifactStoreId(item)).map((item) => item.locator)
            )
            .sort(compareText),
    });
    return { valid, candidates };
}

function fingerprintProjection(snapshot: Omit<StructuralDiscoverySnapshot, "fingerprint">): unknown {
    return {
        rootFingerprint: snapshot.rootDiscovery.fingerprint ?? null,
        state: snapshot.state,
        listings: snapshot.listings.map((listing) => ({
            locator: listing.locator,
            status: listing.status,
            entries: sortEntries(listing.entries),
            failure: listing.failure ? { code: listing.failure.code, message: listing.failure.message } : null,
        })),
        probes: snapshot.probes,
        artifacts: snapshot.artifacts.map((item) => ({
            locator: item.locator,
            context: item.context,
            readStatus: item.readStatus,
            bytes: item.bytes ? Array.from(item.bytes) : null,
            recognition: item.recognition.status,
            recognitionKind:
                item.recognition.status === "VALID" || item.recognition.status === "OPAQUE"
                    ? item.recognition.kind
                    : null,
            failure: item.failure ? { code: item.failure.code, message: item.failure.message } : null,
        })),
        unknownNodes: snapshot.unknownNodes,
    };
}

/**
 * Discover bounded physical candidates under validated namespace markers.
 * This is read-only and takes no mutation methods in its public port type.
 */
export async function discoverPhysicalStorageTree(
    port: DiscoveryReadPort,
    recordCodecs: readonly CanonicalRecordCodec[] = []
): Promise<StructuralDiscoverySnapshot> {
    const rootDiscovery = await discoverRepresentationRoots(port);
    const context: ScanContext = {
        port,
        recordCodecs,
        listings: new Map(),
        artifacts: new Map(),
        probes: [],
        unknownNodes: [],
    };
    context.listings.set("", rootDiscovery.rootListing);
    for (const candidate of rootDiscovery.candidates) {
        if (candidate.listing) context.listings.set(candidate.locator, candidate.listing);
        for (const marker of candidate.markers) {
            if (marker.bytes && candidate.state !== "NON_FK" && marker.namespaceValidation !== "UNRECOGNIZED") {
                const recognition = await recognizeDiscoveryArtifact({
                    locator: marker.locator,
                    context: "namespace-probe",
                    readStatus: "READ",
                    bytes: marker.bytes,
                });
                context.artifacts.set(`namespace-probe\0${marker.locator}`, {
                    locator: marker.locator,
                    context: "namespace-probe",
                    readStatus: marker.readStatus,
                    bytes: marker.bytes,
                    failure: marker.failure,
                    recognition,
                });
            }
        }
    }

    const storeCandidates: PhysicalStoreCandidate[] = [];
    for (const root of rootDiscovery.candidates.filter((candidate) => candidate.state === "VALID")) {
        requireGrammarEdge("vault-root", "representation-root");
        const rootListing = root.listing ?? (await listAt(context, root.locator));
        if (rootListing.status !== "COMPLETE") continue;
        const storesCollections = new Set<string>();
        for (const entry of sortEntries(rootListing.entries)) {
            if (entry.kind !== "directory") {
                if (entry.name !== "namespace.json") {
                    const markerCopy = root.markers.some(
                        (marker) =>
                            marker.locator === join(root.locator, entry.name) && marker.namespaceValidation === "VALID"
                    );
                    if (!markerCopy) {
                        addUnknown(
                            context,
                            join(root.locator, entry.name),
                            root.locator,
                            "representation-root",
                            "Unexpected file at representation root."
                        );
                    }
                }
                continue;
            }
            const child = join(root.locator, entry.name);
            if (entry.name === DISCOVERY_NOMINAL_DIRECTORY_NAMES.stores) {
                storesCollections.add(child);
            } else {
                const probe = await probeAlternateStoresCollection(context, root.locator, child);
                if (probe.valid) storesCollections.add(child);
                else
                    addUnknown(
                        context,
                        child,
                        root.locator,
                        "representation-root",
                        "Unvalidated alternate stores candidate; traversal stopped after bounded probe."
                    );
                storeCandidates.push(...probe.candidates);
            }
        }
        for (const collection of [...storesCollections].sort(compareText)) {
            if (collection !== join(root.locator, DISCOVERY_NOMINAL_DIRECTORY_NAMES.stores)) {
                // Alternate candidates already produced their bounded store observations.
                continue;
            }
            storeCandidates.push(...(await scanStoresCollection(context, root.locator, collection)));
        }
    }

    const uniqueCandidates = new Map<string, PhysicalStoreCandidate>();
    for (const candidate of storeCandidates) uniqueCandidates.set(candidate.candidateLocator, candidate);
    const candidates = [...uniqueCandidates.values()].sort((left, right) =>
        compareText(left.candidateLocator, right.candidateLocator)
    );
    const allArtifacts = [...context.artifacts.values()].sort(
        (left, right) => compareText(left.locator, right.locator) || compareText(left.context, right.context)
    );
    const listings = [...context.listings.values()].sort((left, right) => compareText(left.locator, right.locator));
    const state =
        rootDiscovery.state === "COMPLETE" &&
        listings.every((listing) => listing.status === "COMPLETE") &&
        candidates.every((candidate) => candidate.state !== "UNAVAILABLE") &&
        !context.probes.some((probe) => probe.result === "UNAVAILABLE")
            ? "COMPLETE"
            : "UNAVAILABLE";
    const withoutFingerprint = {
        rootDiscovery,
        state,
        listings,
        probes: [...context.probes].sort((left, right) => compareText(left.locator, right.locator)),
        artifacts: allArtifacts,
        storeCandidates: candidates,
        unknownNodes: [...context.unknownNodes].sort((left, right) => compareText(left.locator, right.locator)),
    } satisfies Omit<StructuralDiscoverySnapshot, "fingerprint">;
    const fingerprint = await canonicalDigest(fingerprintProjection(withoutFingerprint));
    return { ...withoutFingerprint, fingerprint };
}
