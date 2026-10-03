import { sha256Bytes, type CanonicalDigest } from "./canonicalEncoding";
import { createMutationId, createRevisionId, type StoreId, type RevisionId } from "./identity";
import {
    canonicalRevisionDigest,
    decodeCanonicalRevisionEnvelope,
    encodeCanonicalRevisionEnvelope,
    type CanonicalRecordCodec,
    type CanonicalRevisionEnvelope,
} from "./envelopes";
import {
    decodeMutationIntent,
    decodeMutationOutcome,
    encodeMutationIntent,
    encodeMutationOutcome,
    mutationIntentDigest,
    validateOutcomeAgainstIntent,
    type MutationIntentV1,
    type MutationOutcomeV1,
    type MutationOutcomeStatus,
} from "./recoveryArtifacts";
import { discoverPhysicalStorageTree } from "./discoveryTraversal";
import { aggregateStructuralDiscovery, type StructuralDiscoverySemantics } from "./discoverySemantics";
import { validateExplicitResolutionCoverage } from "./repositorySemantics";
import { authorizeWrite, type WriteAuthorization } from "./writeAuthorization";
import {
    isSafeRepresentationLocator,
    storageFailure,
    type RepresentationStoragePort,
    type RepresentationStorageResult,
} from "./RepresentationStoragePort";

export type MutationBoundary =
    | "before-intent"
    | "after-intent-create"
    | "after-intent-verification"
    | "precondition-rejected"
    | "after-snapshot-write"
    | "after-snapshot-reread"
    | "before-outcome"
    | "after-outcome-create"
    | "after-outcome-persistence";
export interface CanonicalMutationRequest {
    readonly port: RepresentationStoragePort;
    readonly storeId: StoreId;
    readonly branchLocator: string;
    readonly snapshotLocator: string;
    readonly recordKind: string;
    readonly recordId: string;
    readonly action: "create" | "update";
    readonly payload: unknown;
    readonly codecs: readonly CanonicalRecordCodec[];
    readonly supportedProtocolVersion: number;
    /** Test stop points. Throwing models abrupt interruption; no recovery is executed here. */
    readonly onBoundary?: (boundary: MutationBoundary) => void | Promise<void>;
}
export interface CanonicalBaseObservation {
    readonly storeId: StoreId;
    readonly recordKind: string;
    readonly recordId: string;
    readonly locator: string;
    readonly envelope: CanonicalRevisionEnvelope | null;
    /** Resolution's logical parent may differ from the qualified local head protected by the raw guard. */
    readonly localSnapshotEnvelope?: CanonicalRevisionEnvelope;
    readonly canonicalDigest: CanonicalDigest | null;
    readonly bytes: Uint8Array | null;
    readonly rawByteDigest: CanonicalDigest | null;
}
export type ImmutablePersistence = "VERIFIED" | "ABSENT" | "UNAVAILABLE" | "CONFLICTING";
export interface CanonicalMutationResult {
    readonly state: "REFUSED" | "INTENT_NOT_ESTABLISHED" | "ATTEMPTED";
    readonly authorization: WriteAuthorization;
    readonly aggregate: StructuralDiscoverySemantics;
    readonly currentAuthorization: WriteAuthorization;
    readonly reason?: string;
    readonly base?: CanonicalBaseObservation;
    readonly intent?: MutationIntentV1;
    readonly intentPersistence?: ImmutablePersistence;
    readonly localAttempt?: MutationOutcomeStatus;
    readonly outcome?: MutationOutcomeV1;
    readonly outcomePersistence?: ImmutablePersistence;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
function exact(a: Uint8Array, b: Uint8Array): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}
async function read(
    port: RepresentationStoragePort,
    locator: string
): Promise<RepresentationStorageResult<Uint8Array>> {
    try {
        return await port.readBytes(locator);
    } catch {
        return storageFailure("UNAVAILABLE", "Read threw; observation is unavailable.");
    }
}
async function create(port: RepresentationStoragePort, locator: string, bytes: Uint8Array): Promise<void> {
    try {
        await port.createImmutable(locator, bytes);
    } catch {
        /* Maybe applied. Only exact reread can establish immutable persistence. */
    }
}
function persistence(observed: RepresentationStorageResult<Uint8Array>, intended: Uint8Array): ImmutablePersistence {
    if (observed.ok === false) return observed.failure.code === "NOT_FOUND" ? "ABSENT" : "UNAVAILABLE";
    return exact(observed.value, intended) ? "VERIFIED" : "CONFLICTING";
}

export type CanonicalLifecycleRequest = Omit<CanonicalMutationRequest, "action">;
export interface CanonicalResolutionRequest extends CanonicalLifecycleRequest {
    readonly parentRevisionId: RevisionId;
    readonly resolvedRevisionIds: readonly RevisionId[];
    readonly state: "active" | "deleted";
}
type TransitionRequest =
    | CanonicalMutationRequest
    | (CanonicalLifecycleRequest & {
          readonly action: "tombstone" | "reactivate";
      })
    | (CanonicalResolutionRequest & { readonly action: "resolve" });

/** Ordinary active creation/update retains the accepted Batch-3 scope. */
export function mutateCanonicalRecord(request: CanonicalMutationRequest): Promise<CanonicalMutationResult> {
    if (request.action !== "create" && request.action !== "update")
        throw new TypeError("Ordinary mutation accepts active create/update only.");
    return transitionCanonicalRecord(request);
}
export function tombstoneCanonicalRecord(request: CanonicalLifecycleRequest): Promise<CanonicalMutationResult> {
    return transitionCanonicalRecord({ ...request, action: "tombstone" });
}
export function reactivateCanonicalRecord(request: CanonicalLifecycleRequest): Promise<CanonicalMutationResult> {
    return transitionCanonicalRecord({ ...request, action: "reactivate" });
}
export function resolveCanonicalRecord(request: CanonicalResolutionRequest): Promise<CanonicalMutationResult> {
    return transitionCanonicalRecord({ ...request, action: "resolve" });
}

/** One shared intent-first, guarded-local-attempt protocol for all explicit transitions. */
async function transitionCanonicalRecord(request: TransitionRequest): Promise<CanonicalMutationResult> {
    const { port, storeId, recordKind, recordId, codecs, branchLocator, snapshotLocator } = request;
    const discover = async () =>
        aggregateStructuralDiscovery(await discoverPhysicalStorageTree(port, codecs), request.supportedProtocolVersion);
    let aggregate = await discover();
    let resolutionCandidate: CanonicalRevisionEnvelope | undefined;
    if (request.action === "resolve") {
        const codec = codecs.find((item) => item.recordKind === recordKind);
        if (codec) {
            try {
                resolutionCandidate = decodeCanonicalRevisionEnvelope(
                    encodeCanonicalRevisionEnvelope(
                        {
                            storageEnvelopeVersion: 1,
                            schemaVersion: codec.schemaVersion,
                            storeId,
                            recordKind,
                            recordId,
                            revisionId: createRevisionId(),
                            parentRevisionId: request.parentRevisionId,
                            resolvedRevisionIds: [...request.resolvedRevisionIds].sort(),
                            state: request.state,
                            payload: request.payload,
                        },
                        codecs
                    ),
                    codecs
                );
            } catch {
                /* Missing/invalid candidate cannot bypass divergence authorization. */
            }
        }
    }
    const operation = {
        mode: "ordinary",
        storeId,
        record: { recordKind, recordId, action: request.action, resolutionCandidate },
    } as const;
    const authorization = await authorizeWrite(aggregate, operation, port, codecs);
    const refuse = (reason: string): CanonicalMutationResult => ({
        state: "REFUSED",
        authorization,
        currentAuthorization: authorization,
        aggregate,
        reason,
    });
    if (!authorization.authorized) return refuse("Composed authorization denied mutation.");
    const branch = aggregate.physicalCandidates.find((item) => item.candidateLocator === branchLocator);
    if (
        !branch ||
        branch.storeIds.length !== 1 ||
        branch.storeIds[0] !== storeId ||
        !isSafeRepresentationLocator(snapshotLocator) ||
        !snapshotLocator.startsWith(`${branchLocator}/`)
    )
        return refuse("Snapshot target does not correlate to a discovered store branch.");
    const record = authorization.qualifiedLineage?.records.find(
        (item) => item.recordKind === recordKind && item.recordId === recordId
    );
    const observed = await read(port, snapshotLocator);
    let before: CanonicalRevisionEnvelope | null = null;
    let baseDigest: CanonicalDigest | null = null;
    let rawBytes: Uint8Array | null = null;
    let localSnapshotEnvelope: CanonicalRevisionEnvelope | undefined;
    if (request.action === "create") {
        const relative = snapshotLocator.slice(branchLocator.length + 1).split("/");
        if (
            relative.length !== 3 ||
            relative[0] !== "records" ||
            observed.ok === true ||
            observed.failure.code !== "NOT_FOUND"
        )
            return refuse(
                "Creation requires a locally absent record-collection target plus aggregate-confirmed absence."
            );
    } else {
        if (observed.ok === false) return refuse("Local base bytes are unavailable.");
        const physical = branch.artifactObservations.find(
            (item) => item.locator === snapshotLocator && item.context === "record-envelope"
        );
        const authorizedBase =
            request.action === "resolve"
                ? record?.classification.currentHeads?.find(
                      (head) => head.envelope.revisionId === request.parentRevisionId
                  )
                : record?.classification.current;
        if (!physical || !authorizedBase) return refuse("Target is not a discovered current record observation.");
        try {
            before = decodeCanonicalRevisionEnvelope(decoder.decode(observed.value), codecs);
        } catch {
            return refuse("Local base envelope is invalid or unsupported.");
        }
        baseDigest = await canonicalRevisionDigest(before);
        const localHead =
            request.action === "resolve"
                ? record?.classification.currentHeads?.find(
                      (head) => head.envelope.revisionId === before?.revisionId && head.digest === baseDigest
                  )
                : authorizedBase;
        if (
            before.storeId !== storeId ||
            before.recordKind !== recordKind ||
            before.recordId !== recordId ||
            !localHead ||
            before.revisionId !== localHead.envelope.revisionId ||
            baseDigest !== localHead.digest
        )
            return refuse("Local base no longer matches the authorized aggregate observation.");
        if (request.action === "resolve") {
            // The caller selects the logical parent by qualified identity/digest. The
            // raw-byte guard separately protects the exact locally observed head at
            // the supplied snapshot locator; no pathname chooses the logical parent.
            localSnapshotEnvelope = before;
            before = authorizedBase.envelope;
            baseDigest = authorizedBase.digest;
        }
        if (request.action === "update" && before.state === "deleted")
            return refuse("Ordinary Batch-3 update cannot reactivate a deleted base.");
        if (request.action === "tombstone" && before.state !== "active")
            return refuse("Deletion requires a current active base.");
        if (request.action === "reactivate" && before.state !== "deleted")
            return refuse("Explicit reactivation requires a current tombstone.");
        rawBytes = Uint8Array.from(observed.value);
    }
    const base: CanonicalBaseObservation = {
        storeId,
        recordKind,
        recordId,
        locator: snapshotLocator,
        envelope: before,
        localSnapshotEnvelope,
        canonicalDigest: baseDigest,
        bytes: rawBytes,
        rawByteDigest: rawBytes ? await sha256Bytes(rawBytes) : null,
    };
    const codec = codecs.find((item) => item.recordKind === recordKind);
    if (!codec) return refuse("No domain codec is registered.");
    // Encode/decode validates and detaches caller payload before any persistence.
    let after: CanonicalRevisionEnvelope;
    let candidateBytes: Uint8Array;
    try {
        candidateBytes = encoder.encode(
            encodeCanonicalRevisionEnvelope(
                resolutionCandidate ?? {
                    storageEnvelopeVersion: 1,
                    schemaVersion: codec.schemaVersion,
                    storeId,
                    recordKind,
                    recordId,
                    revisionId: createRevisionId(),
                    parentRevisionId: before?.revisionId ?? null,
                    resolvedRevisionIds: [],
                    state: request.action === "tombstone" ? "deleted" : "active",
                    payload: request.payload,
                },
                codecs
            )
        );
        after = decodeCanonicalRevisionEnvelope(decoder.decode(candidateBytes), codecs);
    } catch {
        return refuse("Candidate fails the domain/envelope codec.");
    }
    if (request.action === "resolve") {
        const observations = record?.observations ?? [];
        if (!validateExplicitResolutionCoverage(after, observations).valid)
            return refuse("Resolution must cover the complete proven divergent-head set.");
    }
    const intent: MutationIntentV1 = {
        recoveryFormatVersion: 1,
        storeId,
        mutationId: createMutationId(),
        recordKind,
        recordId,
        baseRevisionId: before?.revisionId ?? null,
        baseDigest,
        before,
        candidateRevisionId: after.revisionId,
        candidateDigest: await canonicalRevisionDigest(after),
        after,
    };
    const intentBytes = encoder.encode(await encodeMutationIntent(intent, codecs, storeId));
    const intentLocator = `${branchLocator}/recovery/mutations/${intent.mutationId}.json`;
    const outcomeLocator = `${branchLocator}/recovery/outcomes/${intent.mutationId}.json`;
    const boundary = async (name: MutationBoundary) => request.onBoundary?.(name);
    await boundary("before-intent");
    await create(port, intentLocator, intentBytes);
    await boundary("after-intent-create");
    const intentRead = await read(port, intentLocator);
    let intentPersistence = persistence(intentRead, intentBytes);
    if (intentPersistence === "VERIFIED" && intentRead.ok) {
        try {
            await decodeMutationIntent(decoder.decode(intentRead.value), codecs, storeId);
        } catch {
            intentPersistence = "CONFLICTING";
        }
    }
    if (intentPersistence !== "VERIFIED") {
        aggregate = await discover();
        return {
            state: "INTENT_NOT_ESTABLISHED",
            authorization,
            aggregate,
            currentAuthorization: await authorizeWrite(aggregate, operation, port, codecs),
            base,
            intent,
            intentPersistence,
        };
    }
    await boundary("after-intent-verification");
    let write: RepresentationStorageResult<void>;
    try {
        write = await port.writeSnapshot(snapshotLocator, candidateBytes, base.rawByteDigest);
    } catch {
        write = storageFailure("IO_ERROR", "Snapshot operation threw; application is unknown.");
    }
    await boundary("after-snapshot-write");
    let localAttempt: MutationOutcomeStatus = "IO_FAILED";
    if (write.ok === false && ["DIGEST_MISMATCH", "ALREADY_EXISTS", "NOT_FOUND"].includes(write.failure.code)) {
        localAttempt = "PRECONDITION_REJECTED";
        await boundary("precondition-rejected");
    } else if (write.ok) {
        const snapshotRead = await read(port, snapshotLocator);
        if (snapshotRead.ok) {
            try {
                const candidate = decodeCanonicalRevisionEnvelope(decoder.decode(snapshotRead.value), codecs);
                if (
                    candidate.revisionId === after.revisionId &&
                    (await canonicalRevisionDigest(candidate)) === intent.candidateDigest
                )
                    localAttempt = "VERIFIED_APPLIED";
            } catch {
                /* Exact application is unproven, retain IO_FAILED. */
            }
        }
        await boundary("after-snapshot-reread");
    }
    const outcome: MutationOutcomeV1 = {
        recoveryFormatVersion: 1,
        storeId,
        mutationId: intent.mutationId,
        intentDigest: await mutationIntentDigest(intent),
        recordKind,
        recordId,
        candidateRevisionId: after.revisionId,
        candidateDigest: intent.candidateDigest,
        status: localAttempt,
    };
    const outcomeBytes = encoder.encode(encodeMutationOutcome(outcome, storeId));
    await boundary("before-outcome");
    await create(port, outcomeLocator, outcomeBytes);
    await boundary("after-outcome-create");
    const outcomeRead = await read(port, outcomeLocator);
    let outcomePersistence = persistence(outcomeRead, outcomeBytes);
    if (outcomePersistence === "VERIFIED" && outcomeRead.ok) {
        try {
            if (
                !(await validateOutcomeAgainstIntent(
                    decodeMutationOutcome(decoder.decode(outcomeRead.value), storeId),
                    intent
                ))
            )
                outcomePersistence = "CONFLICTING";
        } catch {
            outcomePersistence = "CONFLICTING";
        }
    }
    await boundary("after-outcome-persistence");
    aggregate = await discover();
    return {
        state: "ATTEMPTED",
        authorization,
        aggregate,
        currentAuthorization: await authorizeWrite(
            aggregate,
            { ...operation, record: { recordKind, recordId, action: "update" } },
            port,
            codecs
        ),
        base,
        intent,
        intentPersistence,
        localAttempt,
        outcome,
        outcomePersistence,
    };
}
