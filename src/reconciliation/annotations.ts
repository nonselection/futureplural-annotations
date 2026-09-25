import { isAnnotationId, type AnnotationId } from "../models/annotation";
import type {
    AnnotationObservation,
    AnnotationRegistryRecord,
    AnnotationRegistryV1,
    AnnotationSnapshot,
    SourceRecord,
} from "../models/canonical";

export type ReconciliationReason =
    | "new-legacy"
    | "ambiguous-evidence"
    | "observation-conflict"
    | "managed-id-collision"
    | "competing-managed-id";

export interface UnassignedObservation {
    observationKey: string;
    reason: ReconciliationReason;
    candidateIds: AnnotationId[];
}

export interface ReconciliationResult {
    /** A proposed registry value, never persisted by this function. */
    registry: AnnotationRegistryV1;
    matches: {
        observationKey: string;
        annotationId: AnnotationId;
        reason: "managed-carrier" | "legacy-evidence" | "new-managed";
    }[];
    unassigned: UnassignedObservation[];
}

function lastKnown(source: SourceRecord, observation: AnnotationObservation, observedAt: string) {
    return {
        excerpt: observation.evidence.quote.slice(0, 240),
        sourceTitle: source.title,
        sourcePath: source.currentPath ?? source.lastKnownPath,
        context: `${observation.evidence.before}${observation.evidence.after}`.slice(0, 256),
        observedAt,
    };
}

/** Allocate a globally unused ID outside the reconciler for newly discovered legacy material. */
export function registerObservedAnnotation(
    source: SourceRecord,
    id: AnnotationId,
    observation: AnnotationObservation,
    observedAt: string,
    snapshot: AnnotationSnapshot | null = null
): AnnotationRegistryRecord {
    if (!isAnnotationId(id)) throw new Error("Invalid AnnotationId.");
    if (!source.currentPath) throw new Error("Cannot register an observation for a missing source.");
    if (observation.integrity === "ambiguous") throw new Error("Ambiguous observation requires review.");
    if (observation.managedId && observation.managedId !== id)
        throw new Error("Managed carrier conflicts with AnnotationId.");
    return {
        id,
        sourceRecordId: source.id,
        kind: observation.kind,
        identityMode: observation.managedId ? "managed" : "tracked-legacy",
        integrity: observation.integrity,
        anchor: observation.anchor,
        evidence: observation.evidence,
        lastKnown: lastKnown(source, observation, observedAt),
        snapshot,
    };
}

function observedRecord(
    record: AnnotationRegistryRecord,
    source: SourceRecord,
    observation: AnnotationObservation,
    observedAt: string,
    identityMode: AnnotationRegistryRecord["identityMode"]
): AnnotationRegistryRecord {
    const complete = observation.integrity === "resolved";
    return {
        ...record,
        identityMode,
        integrity: observation.integrity,
        anchor: observation.anchor,
        // A damaged fragment or missing definition must not erase fuller recovery context.
        evidence: complete ? observation.evidence : record.evidence,
        lastKnown: complete ? lastKnown(source, observation, observedAt) : record.lastKnown,
    };
}

/** Only exact, distinctive adapter evidence can establish legacy continuity. */
function strongEvidence(record: AnnotationRegistryRecord, observation: AnnotationObservation): boolean {
    if (record.kind !== observation.kind || observation.integrity !== "resolved") {
        return false;
    }
    const previous = record.evidence;
    const current = observation.evidence;
    if (!previous.quote || !current.quote || previous.quoteTruncated || current.quoteTruncated) return false;

    // A renamed label leaves the body and reference context intact. Uniqueness is checked by the caller.
    if (record.kind === "footnote") {
        return (
            previous.quote === current.quote &&
            current.quote.length >= 12 &&
            previous.before === current.before &&
            previous.after === current.after &&
            current.before.length + current.after.length >= 4
        );
    }

    const sameContext = previous.before === current.before && previous.after === current.after;
    const contextLength = current.before.length + current.after.length;
    if (!sameContext) return false;
    if (previous.quote === current.quote) return contextLength >= 8 && contextLength + current.quote.length >= 24;
    // An edited mark can retain two substantial exact boundaries. Similar text and position do not count.
    return current.before.length >= 12 && current.after.length >= 12 && contextLength >= 32;
}

/** Reconcile one source only. The full registry is supplied to detect known cross-source ID collisions. */
export function reconcileSourceAnnotations(
    source: SourceRecord,
    registry: AnnotationRegistryV1,
    observations: readonly AnnotationObservation[] | null,
    observedAt: string
): ReconciliationResult {
    if (source.currentPath === null && observations !== null) {
        throw new Error("A missing source cannot supply current observations.");
    }
    const byId = new Map(registry.records.map((record) => [record.id, record]));
    if (byId.size !== registry.records.length) throw new Error("Duplicate AnnotationId in registry.");
    const matches: ReconciliationResult["matches"] = [];
    const unassigned: UnassignedObservation[] = [];
    const updated = new Map<AnnotationId, AnnotationRegistryRecord>();
    const matched = new Set<AnnotationId>();
    const ambiguous = new Set<AnnotationId>();
    const current = observations ?? [];
    const observationKeys = new Set(current.map((item) => item.observationKey));
    if (observationKeys.size !== current.length) throw new Error("Duplicate transient observation key.");

    if (observations === null) {
        return {
            registry: {
                ...registry,
                records: registry.records.map((record) =>
                    // Source absence cannot settle an existing identity conflict.
                    record.sourceRecordId === source.id && record.integrity !== "ambiguous"
                        ? { ...record, integrity: "missing" }
                        : record
                ),
            },
            matches,
            unassigned,
        };
    }

    const claims = new Map<AnnotationId, number>();
    for (const observation of current) {
        if (observation.managedId) claims.set(observation.managedId, (claims.get(observation.managedId) ?? 0) + 1);
    }
    const sourceRecords = registry.records.filter((record) => record.sourceRecordId === source.id);

    const markUnassigned = (
        observation: AnnotationObservation,
        reason: ReconciliationReason,
        candidateIds: AnnotationId[] = []
    ) => unassigned.push({ observationKey: observation.observationKey, reason, candidateIds });

    // A valid surviving managed carrier wins only within its existing source and kind.
    for (const observation of current.filter((item) => item.managedId !== null)) {
        const id = observation.managedId;
        const previous = byId.get(id);
        if (observation.integrity === "ambiguous" || (claims.get(id) ?? 0) > 1) {
            markUnassigned(observation, "observation-conflict", previous ? [id] : []);
            if (previous?.sourceRecordId === source.id) ambiguous.add(id);
            continue;
        }
        if (previous && (previous.sourceRecordId !== source.id || previous.kind !== observation.kind)) {
            markUnassigned(observation, "managed-id-collision", [id]);
            if (previous.sourceRecordId === source.id) ambiguous.add(id);
            continue;
        }
        if (previous) {
            updated.set(id, observedRecord(previous, source, observation, observedAt, "managed"));
            matched.add(id);
            matches.push({ observationKey: observation.observationKey, annotationId: id, reason: "managed-carrier" });
        }
    }

    // Unknown managed IDs may be genuine new marks or replacement carriers for old work.
    for (const observation of current.filter((item) => item.managedId !== null && !byId.has(item.managedId))) {
        const id = observation.managedId;
        if (observation.integrity === "ambiguous" || (claims.get(id) ?? 0) > 1) continue;
        const candidates = sourceRecords.filter(
            (record) => !matched.has(record.id) && strongEvidence(record, observation)
        );
        if (candidates.length) {
            const ids = candidates.map((record) => record.id);
            ids.forEach((candidate) => ambiguous.add(candidate));
            markUnassigned(observation, "competing-managed-id", ids);
            continue;
        }
        updated.set(id, registerObservedAnnotation(source, id, observation, observedAt));
        matched.add(id);
        matches.push({ observationKey: observation.observationKey, annotationId: id, reason: "new-managed" });
    }

    const legacy = current.filter((item) => item.managedId === null);
    const candidatesByObservation = new Map<string, AnnotationId[]>();
    const claimsByRecord = new Map<AnnotationId, number>();
    for (const observation of legacy) {
        const candidates = sourceRecords
            .filter((record) => !matched.has(record.id) && strongEvidence(record, observation))
            .map((record) => record.id);
        candidatesByObservation.set(observation.observationKey, candidates);
        for (const id of candidates) claimsByRecord.set(id, (claimsByRecord.get(id) ?? 0) + 1);
    }
    for (const observation of legacy) {
        const candidates = candidatesByObservation.get(observation.observationKey) ?? [];
        if (observation.integrity === "ambiguous") {
            candidates.forEach((id) => ambiguous.add(id));
            markUnassigned(observation, "observation-conflict", candidates);
        } else if (
            candidates.length === 1 &&
            claimsByRecord.get(candidates[0]) === 1 &&
            !ambiguous.has(candidates[0]) &&
            byId.get(candidates[0])?.integrity !== "ambiguous"
        ) {
            const id = candidates[0];
            updated.set(id, observedRecord(byId.get(id), source, observation, observedAt, "tracked-legacy"));
            matched.add(id);
            matches.push({ observationKey: observation.observationKey, annotationId: id, reason: "legacy-evidence" });
        } else if (candidates.length) {
            candidates.forEach((id) => ambiguous.add(id));
            markUnassigned(observation, "ambiguous-evidence", candidates);
        } else {
            markUnassigned(observation, "new-legacy");
        }
    }

    const records = registry.records.map((record) => {
        if (record.sourceRecordId !== source.id) return record;
        if (ambiguous.has(record.id)) return { ...record, integrity: "ambiguous" as const };
        // Legacy ambiguity needs explicit resolution; losing its evidence is not proof of disappearance.
        return (
            updated.get(record.id) ??
            (record.integrity === "ambiguous" ? record : { ...record, integrity: "missing" as const })
        );
    });
    for (const [id, record] of updated) if (!byId.has(id)) records.push(record);
    return { registry: { ...registry, records }, matches, unassigned };
}
