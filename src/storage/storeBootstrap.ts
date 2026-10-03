import {
    createNamespaceArtifact,
    encodeNamespaceArtifact,
    encodeStoreArtifact,
    encodeProtocolFenceArtifact,
    encodeRepresentationStateArtifact,
} from "./authorityArtifacts";
import type { CanonicalRecordCodec } from "./envelopes";
import { discoverPhysicalStorageTree } from "./discoveryTraversal";
import { aggregateStructuralDiscovery, type StructuralDiscoverySemantics } from "./discoverySemantics";
import { createStoreId, createRepresentationStateId, type StoreId } from "./identity";
import { authorizeWrite, type BootstrapRepresentationTarget, type WriteAuthorization } from "./writeAuthorization";
import { storageFailure, type RepresentationStorageResult } from "./RepresentationStoragePort";

export interface StoreBootstrapRequest {
    readonly mode: "fresh-bootstrap" | "bootstrap-resume";
    readonly target: BootstrapRepresentationTarget;
    readonly storeId?: StoreId;
    readonly supportedProtocolVersion: number;
    readonly recordCodecs?: readonly CanonicalRecordCodec[];
}

export interface StoreBootstrapResult {
    readonly state: "COMPLETE" | "REFUSED" | "INCOMPLETE";
    readonly storeId?: StoreId;
    readonly branchLocator?: string;
    readonly aggregate: StructuralDiscoverySemantics;
    readonly authorization: WriteAuthorization;
    readonly reason?: string;
    /** Observations of create results are diagnostics; reread decides whether exact bytes exist. */
    readonly immutableAttempts: readonly {
        readonly locator: string;
        readonly create: RepresentationStorageResult<void>;
        readonly verified: boolean;
    }[];
}

const encoder = new TextEncoder();
function exact(left: Uint8Array, right: Uint8Array): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

/** Test/fixture port bootstrap only. No representation selection, cleanup, or runtime wiring. */
export async function bootstrapStore(request: StoreBootstrapRequest): Promise<StoreBootstrapResult> {
    let target = request.target;
    const codecs = request.recordCodecs ?? [];
    const discover = async () =>
        aggregateStructuralDiscovery(
            await discoverPhysicalStorageTree(target.port, codecs),
            request.supportedProtocolVersion
        );
    let aggregate = await discover();
    const attempts: { locator: string; create: RepresentationStorageResult<void>; verified: boolean }[] = [];
    const operation =
        request.mode === "fresh-bootstrap"
            ? ({ mode: request.mode, target } as const)
            : ({ mode: request.mode, target, storeId: request.storeId ?? aggregate.inventory.storeIds[0] } as const);
    // No identity allocation or write precedes full aggregate authorization.
    const authorization = await authorizeWrite(aggregate, operation, target.port, codecs);
    if (!authorization.authorized) return { state: "REFUSED", aggregate, authorization, immutableAttempts: attempts };
    const storeId = operation.mode === "bootstrap-resume" ? operation.storeId : createStoreId();
    if (operation.mode === "fresh-bootstrap")
        target = { ...target, storeCandidateLocator: `${target.representationRootLocator}/stores/${storeId}` };
    const branchLocator = target.storeCandidateLocator;
    // Attempt identity/target never change. Once store-bound evidence is established,
    // even a fresh attempt must retain attribution; its disappearance is not absence.
    let identityEstablished = operation.mode === "bootstrap-resume";
    const attemptedKinds = new Set<string>();
    while (true) {
        aggregate = await discover();
        const current = aggregate.physicalCandidates.find((item) => item.candidateLocator === branchLocator);
        if (current) identityEstablished = true;
        const observations = current?.artifactObservations ?? [];
        const has = (kind: string) =>
            observations.some((item) => item.recognition.status === "VALID" && item.recognition.kind === kind);
        const namespace = aggregate.namespaceCandidates.find(
            (item) => item.locator === target.representationRootLocator
        );
        const satisfied = has("store") && has("representation-state") && has("protocol-fence");
        const continuation = identityEstablished
            ? ({ mode: "bootstrap-resume", target, storeId } as const)
            : ({ mode: "fresh-bootstrap", target: { ...target, storeCandidateLocator: undefined } } as const);
        const gate = await authorizeWrite(aggregate, continuation, target.port, codecs);
        // The resume boundary intentionally refuses an already-complete bootstrap.
        // Only that completion finding can end this loop; every other blocker stops.
        const completed =
            satisfied &&
            gate.authorized === false &&
            gate.blockers.every(
                (blocker) =>
                    blocker.scope === "store" &&
                    blocker.reason === "This branch is already established, not a partial bootstrap."
            );
        if (!gate.authorized && !completed)
            return {
                state: "INCOMPLETE",
                storeId,
                branchLocator,
                aggregate,
                authorization: gate,
                reason: "Bootstrap authority changed before create.",
                immutableAttempts: attempts,
            };
        if (completed) break;

        // Recompute the next missing requirement from this validated observation,
        // including artifacts that appeared/disappeared at provider-renamed locators.
        let kind: string;
        let artifact: { locator: string; bytes: Uint8Array };
        if (namespace?.state === "ABSENT") {
            kind = "namespace";
            artifact = {
                locator: `${target.representationRootLocator}/namespace.json`,
                bytes: encoder.encode(encodeNamespaceArtifact(createNamespaceArtifact())),
            };
        } else if (!has("store")) {
            kind = "store";
            artifact = {
                locator: `${branchLocator}/store.json`,
                bytes: encoder.encode(encodeStoreArtifact({ schema: "finders-keepers.store", version: 1, storeId })),
            };
        } else if (!has("representation-state")) {
            kind = "representation-state";
            artifact = {
                locator: `${branchLocator}/meta/representation-states/genesis.json`,
                bytes: encoder.encode(
                    encodeRepresentationStateArtifact({
                        schema: "finders-keepers.representation-state",
                        version: 1,
                        storeId,
                        representationStateId: createRepresentationStateId(),
                        parentRepresentationStateId: null,
                        establishedByMigrationId: null,
                        representation: target.representation,
                    })
                ),
            };
        } else {
            kind = "protocol-fence";
            artifact = {
                locator: `${branchLocator}/meta/protocol/fence.json`,
                bytes: encoder.encode(
                    encodeProtocolFenceArtifact({
                        schema: "finders-keepers.protocol-fence",
                        version: 1,
                        storeId,
                        requiredProtocolVersion: request.supportedProtocolVersion,
                    })
                ),
            };
        }
        if (attemptedKinds.has(kind))
            return {
                state: "INCOMPLETE",
                storeId,
                branchLocator,
                aggregate,
                authorization: gate,
                reason: "Previously verified bootstrap authority disappeared; stop rather than retry indefinitely.",
                immutableAttempts: attempts,
            };
        attemptedKinds.add(kind);
        let created: RepresentationStorageResult<void>;
        try {
            created = await target.port.createImmutable(artifact.locator, artifact.bytes);
        } catch (error) {
            created = storageFailure("IO_ERROR", error instanceof Error ? error.message : "Immutable create threw.");
        }
        let read: RepresentationStorageResult<Uint8Array>;
        try {
            read = await target.port.readBytes(artifact.locator);
        } catch (error) {
            read = storageFailure("UNAVAILABLE", error instanceof Error ? error.message : "Verification read threw.");
        }
        const verified = read.ok && exact(read.value, artifact.bytes);
        attempts.push({ locator: artifact.locator, create: created, verified });
        // Exact codec-produced bytes imply exact validated artifact content. Never
        // overwrite/retry a conflicting create or allocate a replacement StoreId.
        if (!verified) {
            aggregate = await discover();
            return {
                state: "INCOMPLETE",
                storeId,
                branchLocator,
                aggregate,
                authorization,
                reason:
                    read.ok === false
                        ? `Immutable verification failed: ${read.failure.code}.`
                        : "Immutable artifact conflicts with intended exact bytes.",
                immutableAttempts: attempts,
            };
        }
        aggregate = await discover();
        if (aggregate.traversal.state !== "COMPLETE")
            return {
                state: "INCOMPLETE",
                storeId,
                branchLocator,
                aggregate,
                authorization,
                reason: "Discovery became unavailable after immutable create.",
                immutableAttempts: attempts,
            };
    }
    aggregate = await discover();
    const ordinary = await authorizeWrite(aggregate, { mode: "ordinary", storeId }, target.port, codecs);
    return {
        state: ordinary.authorized ? "COMPLETE" : "INCOMPLETE",
        storeId,
        branchLocator,
        aggregate,
        authorization: ordinary,
        immutableAttempts: attempts,
        reason: ordinary.authorized ? undefined : "Completed authority is not writable after rediscovery.",
    };
}
