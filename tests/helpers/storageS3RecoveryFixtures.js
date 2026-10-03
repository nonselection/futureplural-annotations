import { fixture, revision, codec, ids } from "./storageS3BootstrapFixtures";
import { canonicalRevisionDigest, encodeCanonicalRevisionEnvelope } from "../../src/storage/envelopes";
import { sha256Bytes } from "../../src/storage/canonicalEncoding";
import { encodeMutationIntent, encodeMutationOutcome, mutationIntentDigest } from "../../src/storage/recoveryArtifacts";
import { createMutationId } from "../../src/storage/identity";
import { failureInjectingRepresentationStorage } from "./failureInjectingRepresentationStorage";
import { discoverPhysicalStorageTree } from "../../src/storage/discoveryTraversal";
import { aggregateStructuralDiscovery } from "../../src/storage/discoverySemantics";
export { fixture, revision, codec, ids };
export const encoder = new TextEncoder();
export async function recoveryMutation(before, after, status) {
    const intent = {
        recoveryFormatVersion: 1,
        storeId: after.storeId,
        mutationId: createMutationId(),
        recordKind: after.recordKind,
        recordId: after.recordId,
        before,
        baseRevisionId: before?.revisionId ?? null,
        baseDigest: before ? await canonicalRevisionDigest(before) : null,
        after,
        candidateRevisionId: after.revisionId,
        candidateDigest: await canonicalRevisionDigest(after),
    };
    const outcome = status
        ? {
              recoveryFormatVersion: 1,
              storeId: after.storeId,
              mutationId: intent.mutationId,
              intentDigest: await mutationIntentDigest(intent),
              recordKind: after.recordKind,
              recordId: after.recordId,
              candidateRevisionId: after.revisionId,
              candidateDigest: intent.candidateDigest,
              status,
          }
        : undefined;
    return { intent, outcome };
}
export async function seedRecovery(f, mutation, suffix = "provider-copy") {
    const { intent, outcome } = mutation;
    await f.base.createImmutable(
        `${f.target.storeCandidateLocator}/recovery/mutations/${suffix}-${intent.mutationId}.json`,
        encoder.encode(await encodeMutationIntent(intent, [codec]))
    );
    if (outcome)
        await f.base.createImmutable(
            `${f.target.storeCandidateLocator}/recovery/outcomes/${suffix}-${intent.mutationId}.json`,
            encoder.encode(encodeMutationOutcome(outcome))
        );
}
export async function overwrite(base, locator, envelope) {
    const old = await base.readBytes(locator);
    const result = await base.writeSnapshot(
        locator,
        encoder.encode(encodeCanonicalRevisionEnvelope(envelope, [codec])),
        old.ok ? await sha256Bytes(old.value) : null
    );
    if (!result.ok) throw new Error("Invalid test overwrite");
}
export async function transitionFixture(records = [revision()], faults = {}) {
    const f = await fixture({ records });
    const fault = failureInjectingRepresentationStorage(f.base, faults);
    const request = {
        port: fault.port,
        storeId: ids.storeA,
        branchLocator: f.target.storeCandidateLocator,
        snapshotLocator: `${f.target.storeCandidateLocator}/records/sources/record-0.json`,
        recordKind: codec.recordKind,
        recordId: revision().recordId,
        payload: { value: "user selected" },
        codecs: [codec],
        supportedProtocolVersion: 1,
        onBoundary: fault.onBoundary,
    };
    return {
        f,
        fault,
        request,
        async discover() {
            return aggregateStructuralDiscovery(await discoverPhysicalStorageTree(fault.port, [codec]), 1);
        },
    };
}
