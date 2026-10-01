import { CanonicalEncodingError, canonicalDigest } from "./canonicalEncoding";
import { recognizeDiscoveryArtifact } from "./discoveryArtifacts";
import {
    DISCOVERY_NOMINAL_DIRECTORY_NAMES,
    INITIAL_DISCOVERY_LIST_LIMIT,
    MAX_DISCOVERY_DIRECTORY_DEPTH,
    allowsValidatedChild,
} from "./discoveryGrammar";
import { PRODUCTION_NAMESPACE_MARKER_LOCATOR, PRODUCTION_REPRESENTATION_ROOT_BASENAMES } from "./namespace";
import type {
    BoundedRepresentationListing,
    RepresentationEntry,
    RepresentationStorageFailure,
    RepresentationStoragePort,
    RepresentationStorageResult,
} from "./RepresentationStoragePort";

export type DiscoveryReadPort = Pick<RepresentationStoragePort, "rootIdentity" | "listChildren" | "readBytes">;

export type DiscoveryReadStatus = "READ" | "NOT_FOUND" | "UNAVAILABLE";

export interface DiscoveryPageObservation {
    readonly requestedLimit: number;
    readonly entries: readonly RepresentationEntry[];
    readonly truncated: boolean;
}

export interface DiscoveryListingObservation {
    readonly locator: string;
    readonly status: "COMPLETE" | "UNAVAILABLE" | "INCONSISTENT";
    readonly entries: readonly RepresentationEntry[];
    readonly pages: readonly DiscoveryPageObservation[];
    readonly failure?: RepresentationStorageFailure;
}

export interface DiscoveryFileObservation {
    readonly locator: string;
    readonly context: "root-marker-probe" | "namespace-marker";
    readonly readStatus: DiscoveryReadStatus;
    readonly bytes?: Uint8Array;
    readonly failure?: RepresentationStorageFailure;
    readonly namespaceValidation: "VALID" | "INVALID" | "UNSUPPORTED" | "UNRECOGNIZED" | "NOT_APPLICABLE";
}

export type RepresentationRootCandidateState = "VALID" | "NON_FK" | "INVALID" | "UNAVAILABLE" | "ABSENT";

export interface RepresentationRootCandidate {
    readonly locator: string;
    readonly nominal: boolean;
    readonly state: RepresentationRootCandidateState;
    readonly markers: readonly DiscoveryFileObservation[];
    readonly listing?: DiscoveryListingObservation;
}

export interface RepresentationRootDiscovery {
    readonly rootIdentity: string;
    readonly state: "COMPLETE" | "UNAVAILABLE";
    readonly rootListing: DiscoveryListingObservation;
    readonly candidates: readonly RepresentationRootCandidate[];
    readonly fingerprint?: string;
    readonly failure?: string;
}

export interface CompleteListingResult {
    readonly ok: boolean;
    readonly listing: DiscoveryListingObservation;
}

function compareStrings(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function compareEntries(left: RepresentationEntry, right: RepresentationEntry): number {
    return compareStrings(left.name, right.name) || compareStrings(left.kind, right.kind);
}

function deduplicateEntries(entries: readonly RepresentationEntry[]): RepresentationEntry[] {
    const unique = new Map<string, RepresentationEntry>();
    for (const entry of entries) unique.set(`${entry.kind}\0${entry.name}`, entry);
    return [...unique.values()].sort(compareEntries);
}

function isSubset(left: readonly RepresentationEntry[], right: readonly RepresentationEntry[]): boolean {
    const rightKeys = new Set(right.map((entry) => `${entry.kind}\0${entry.name}`));
    return left.every((entry) => rightKeys.has(`${entry.kind}\0${entry.name}`));
}

function nextListingLimit(limit: number): number | null {
    if (limit >= Number.MAX_SAFE_INTEGER) return null;
    return Math.min(Number.MAX_SAFE_INTEGER, limit * 2);
}

/**
 * Complete a listing by increasing page size. This has no sibling-count cap;
 * a non-monotonic expansion is returned as INCONSISTENT instead of trusted.
 */
export async function listAllDiscoveryChildren(
    port: DiscoveryReadPort,
    locator: string,
    initialLimit = INITIAL_DISCOVERY_LIST_LIMIT
): Promise<CompleteListingResult> {
    let limit = initialLimit;
    let previous: RepresentationEntry[] = [];
    const pages: DiscoveryPageObservation[] = [];
    if (!Number.isSafeInteger(limit) || limit < 1) {
        return {
            ok: false,
            listing: {
                locator,
                status: "INCONSISTENT",
                entries: [],
                pages,
                failure: { code: "INVALID_LIMIT", message: "Initial listing limit must be a positive safe integer." },
            },
        };
    }

    while (true) {
        let result: RepresentationStorageResult<BoundedRepresentationListing>;
        try {
            result = await port.listChildren(locator, limit);
        } catch (error) {
            return {
                ok: false,
                listing: {
                    locator,
                    status: "UNAVAILABLE",
                    entries: previous,
                    pages,
                    failure: {
                        code: "UNAVAILABLE",
                        message: error instanceof Error ? error.message : "Listing failed.",
                    },
                },
            };
        }
        if (result.ok === false) {
            return {
                ok: false,
                listing: { locator, status: "UNAVAILABLE", entries: previous, pages, failure: result.failure },
            };
        }

        const entries = deduplicateEntries(result.value.entries);
        pages.push({ requestedLimit: limit, entries, truncated: result.value.truncated });
        if (!isSubset(previous, entries)) {
            const observedUnion = deduplicateEntries([...previous, ...entries]);
            return {
                ok: false,
                listing: {
                    locator,
                    status: "INCONSISTENT",
                    entries: observedUnion,
                    pages,
                    failure: {
                        code: "UNAVAILABLE",
                        message: "Directory entries changed incompatibly while completing the listing.",
                    },
                },
            };
        }
        const noObservableProgress =
            result.value.truncated && (pages.length === 1 ? entries.length === 0 : entries.length === previous.length);
        if (noObservableProgress) {
            return {
                ok: false,
                listing: {
                    locator,
                    status: "UNAVAILABLE",
                    entries,
                    pages,
                    failure: {
                        code: "UNAVAILABLE",
                        message: "Adapter kept the listing truncated without exposing additional child entries.",
                    },
                },
            };
        }
        previous = entries;
        if (!result.value.truncated) {
            return { ok: true, listing: { locator, status: "COMPLETE", entries, pages } };
        }
        const next = nextListingLimit(limit);
        if (next === null) {
            return {
                ok: false,
                listing: {
                    locator,
                    status: "UNAVAILABLE",
                    entries: previous,
                    pages,
                    failure: {
                        code: "UNAVAILABLE",
                        message: "Adapter reports a truncated listing at the maximum safe request size.",
                    },
                },
            };
        }
        limit = next;
    }
}

function isJsonCandidate(name: string): boolean {
    return name.toLowerCase().endsWith(".json");
}

function isNominalRoot(locator: string): boolean {
    return PRODUCTION_REPRESENTATION_ROOT_BASENAMES.includes(
        locator as (typeof PRODUCTION_REPRESENTATION_ROOT_BASENAMES)[number]
    );
}

async function readMarkerCandidate(port: DiscoveryReadPort, locator: string): Promise<DiscoveryFileObservation> {
    let result: RepresentationStorageResult<Uint8Array>;
    try {
        result = await port.readBytes(locator);
    } catch (error) {
        return {
            locator,
            context: locator.endsWith(`/${PRODUCTION_NAMESPACE_MARKER_LOCATOR}`)
                ? "namespace-marker"
                : "root-marker-probe",
            readStatus: "UNAVAILABLE",
            failure: { code: "UNAVAILABLE", message: error instanceof Error ? error.message : "Read failed." },
            namespaceValidation: "NOT_APPLICABLE",
        };
    }
    if (result.ok === false) {
        return {
            locator,
            context: locator.endsWith(`/${PRODUCTION_NAMESPACE_MARKER_LOCATOR}`)
                ? "namespace-marker"
                : "root-marker-probe",
            readStatus: result.failure.code === "NOT_FOUND" ? "NOT_FOUND" : "UNAVAILABLE",
            failure: result.failure,
            namespaceValidation: "NOT_APPLICABLE",
        };
    }

    const bytes = Uint8Array.from(result.value);
    const recognition = await recognizeDiscoveryArtifact({
        locator,
        context: "namespace-probe",
        readStatus: "READ",
        bytes,
    });
    const namespaceValidation =
        recognition.status === "VALID" && recognition.kind === "namespace"
            ? "VALID"
            : recognition.status === "INVALID"
              ? "INVALID"
              : recognition.status === "UNSUPPORTED"
                ? "UNSUPPORTED"
                : recognition.status === "UNRECOGNIZED"
                  ? "UNRECOGNIZED"
                  : "NOT_APPLICABLE";
    return {
        locator,
        context: locator.endsWith(`/${PRODUCTION_NAMESPACE_MARKER_LOCATOR}`) ? "namespace-marker" : "root-marker-probe",
        readStatus: "READ",
        bytes,
        namespaceValidation,
    };
}

function rootCandidateState(
    markers: readonly DiscoveryFileObservation[],
    listing: DiscoveryListingObservation
): RepresentationRootCandidateState {
    if (listing.status !== "COMPLETE") return "UNAVAILABLE";
    if (markers.some((marker) => marker.readStatus !== "READ")) return "UNAVAILABLE";
    if (markers.some((marker) => marker.namespaceValidation === "VALID")) return "VALID";
    const expectedInvalid = markers.some(
        (marker) =>
            marker.readStatus === "READ" &&
            (marker.context === "namespace-marker" ||
                marker.namespaceValidation === "INVALID" ||
                marker.namespaceValidation === "UNSUPPORTED") &&
            marker.namespaceValidation !== "VALID" &&
            marker.namespaceValidation !== "UNRECOGNIZED"
    );
    if (expectedInvalid) return "INVALID";
    if (
        markers.some(
            (marker) =>
                marker.readStatus === "UNAVAILABLE" &&
                (marker.context === "namespace-marker" || marker.namespaceValidation === "NOT_APPLICABLE")
        )
    ) {
        return "UNAVAILABLE";
    }
    return "NON_FK";
}

function fingerprintInput(result: Omit<RepresentationRootDiscovery, "fingerprint">): unknown {
    return {
        rootIdentity: result.rootIdentity,
        state: result.state,
        candidates: result.candidates.map((candidate) => ({
            locator: candidate.locator,
            nominal: candidate.nominal,
            state: candidate.state,
            markers: candidate.markers.map((marker) => ({
                locator: marker.locator,
                readStatus: marker.readStatus,
                namespaceValidation: marker.namespaceValidation,
                bytes: marker.bytes ? Array.from(marker.bytes) : null,
                failure: marker.failure ? { code: marker.failure.code, message: marker.failure.message } : null,
            })),
            listingStatus: candidate.listing?.status ?? null,
            listingEntries: candidate.listing?.entries ?? [],
        })),
    };
}

/**
 * Shallow, content-based representation-root discovery. An arbitrary vault-root
 * directory with no FK namespace evidence is retained as NON_FK and ignored.
 */
export async function discoverRepresentationRoots(port: DiscoveryReadPort): Promise<RepresentationRootDiscovery> {
    if (!allowsValidatedChild("vault-root", "representation-root")) {
        throw new Error("Discovery grammar does not allow a representation-root candidate at the vault root.");
    }
    const rootListingResult = await listAllDiscoveryChildren(port, "");
    const rootListing = rootListingResult.listing;
    const rootDirectories = rootListing.entries
        .filter((entry) => entry.kind === "directory")
        .map((entry) => entry.name);
    const candidateNames = new Set(rootDirectories);
    const candidates: RepresentationRootCandidate[] = [];

    for (const nominalName of PRODUCTION_REPRESENTATION_ROOT_BASENAMES) {
        if (!candidateNames.has(nominalName)) {
            candidates.push({
                locator: nominalName,
                nominal: true,
                state: rootListing.status === "COMPLETE" ? "ABSENT" : "UNAVAILABLE",
                markers: [],
            });
        }
    }

    for (const name of [...candidateNames].sort(compareStrings)) {
        const nominal = isNominalRoot(name);
        const childListingResult = await listAllDiscoveryChildren(port, name);
        const childListing = childListingResult.listing;
        const markerEntries = childListing.entries.filter(
            (entry) =>
                entry.kind === "file" &&
                (isJsonCandidate(entry.name) || entry.name === PRODUCTION_NAMESPACE_MARKER_LOCATOR)
        );
        const markers: DiscoveryFileObservation[] = [];
        for (const entry of markerEntries) {
            markers.push(await readMarkerCandidate(port, `${name}/${entry.name}`));
        }

        candidates.push({
            locator: name,
            nominal,
            state: rootCandidateState(markers, childListing),
            markers: markers.sort((left, right) => compareStrings(left.locator, right.locator)),
            listing: childListing,
        });
    }

    candidates.sort((left, right) => compareStrings(left.locator, right.locator));
    const state =
        rootListing.status === "COMPLETE" && candidates.every((candidate) => candidate.state !== "UNAVAILABLE")
            ? "COMPLETE"
            : "UNAVAILABLE";
    const withoutFingerprint = {
        rootIdentity: port.rootIdentity,
        state,
        rootListing,
        candidates,
        ...(state === "UNAVAILABLE" ? { failure: "One or more bounded root probes could not be completed." } : {}),
    } satisfies Omit<RepresentationRootDiscovery, "fingerprint">;

    let fingerprint: string | undefined;
    try {
        fingerprint = await canonicalDigest(fingerprintInput(withoutFingerprint));
    } catch (error) {
        if (!(error instanceof CanonicalEncodingError)) throw error;
    }
    return { ...withoutFingerprint, ...(fingerprint ? { fingerprint } : {}) };
}

/** Used by later discovery batches to keep paths within the S2 grammar. */
export function isWithinDiscoveryDepth(locator: string): boolean {
    return locator.split("/").length <= MAX_DISCOVERY_DIRECTORY_DEPTH;
}

/** Used by later batches to avoid copying protocol names into multiple modules. */
export const DISCOVERY_TREE_NAMES = DISCOVERY_NOMINAL_DIRECTORY_NAMES;
