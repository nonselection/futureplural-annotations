import { describe, expect, it } from "vitest";
import { addRepresentationStoragePortConformance } from "./helpers/representationStoragePortConformance";
import { createInMemoryPublicationFixture } from "../src/storage/InMemoryRepresentationStorage";
import { canonicalSerialize } from "../src/storage/canonicalEncoding";
import { canonicalRevisionDigest, decodeCanonicalRevisionEnvelope } from "../src/storage/envelopes";
import { classifyRecordRevisions } from "../src/storage/repositorySemantics";

addRepresentationStoragePortConformance("Intentionally nonexclusive in-memory reference", (name) =>
    createInMemoryPublicationFixture({ rootIdentity: name })
);

const bytes = (...values) => new Uint8Array(values);
async function allocation(f) {
    const directory = f.port.directoryHandle("records").value;
    const collection = f.port.bindPublicationCollection(directory, "canonical-revision").value;
    const result = await f.port.allocatePublication(collection);
    expect(result.status).toBe("ALLOCATED");
    return { allocation: result.allocation, collection };
}
describe("S1 E reference-specific collision and model controls", () => {
    it("the deliberately nonexclusive reference actually displaces arrival-after-preflight bytes", async () => {
        const f = createInMemoryPublicationFixture();
        const a = (await allocation(f)).allocation;
        const external = bytes(7, 7),
            ours = bytes(1, 2);
        f.controls.scheduleNext({ kind: "arrival-after-preflight", bytes: external });
        const effect = await f.port.publishFresh(a, ours);
        expect(effect.physicalEffect).toBe("DISPATCH_REPORTED_SUCCESS");
        expect((await f.port.readBytes(f.port.fileHandle(a.locator).value)).value).toEqual(ours);
        const events = f.controls.events().filter((event) => event.locator === a.locator);
        expect(events.map((event) => event.kind)).toEqual(["preflight-absent", "external-write", "dispatch", "apply"]);
        expect(events[1].bytes).toEqual(external);
        expect(events[3].bytes).toEqual(ours);
        expect(effect).not.toHaveProperty("exclusive");
    });

    it("injected ID collision refuses without reservation and a later new allocation succeeds", async () => {
        const outputs = [1, 1, 2];
        const f = createInMemoryPublicationFixture({
            secureBytes: (length) => new Uint8Array(length).fill(outputs.shift()),
        });
        const first = await allocation(f);
        f.port.retirePublication(first.allocation);
        expect(await f.port.allocatePublication(first.collection)).toMatchObject({
            status: "REFUSED",
            reason: "PUBLICATION_ID_COLLISION",
        });
        const next = await allocation(f);
        expect(next.allocation.publicationId).not.toBe(first.allocation.publicationId);
        expect(f.controls.stats().dispatches).toBe(0);
        expect((await f.port.publishFresh(next.allocation, bytes(1))).physicalEffect).toBe("DISPATCH_REPORTED_SUCCESS");
    });
    it("allocation secure-source failure and invalid binary invocation do not dispatch", async () => {
        const bad = createInMemoryPublicationFixture({
            secureBytes: () => {
                throw new Error("secure failed");
            },
        });
        const collection = bad.port.bindPublicationCollection(bad.port.directoryHandle("").value, "namespace").value;
        expect(await bad.port.allocatePublication(collection)).toMatchObject({
            status: "REFUSED",
            reason: "SECURE_RANDOM_UNAVAILABLE",
        });
        const f = createInMemoryPublicationFixture();
        const a = (await allocation(f)).allocation;
        expect((await f.port.publishFresh(a, [])).physicalEffect).toBe("NO_MUTATION_DISPATCHED");
        expect((await f.port.publishFresh(a, bytes(1))).reason).toBe("RETIRED_ALLOCATION");
        expect(f.controls.stats().dispatches).toBe(0);
    });
    it("shape race at an ancestor after preflight is UNKNOWN after dispatch entry, not definite refusal", async () => {
        const f = createInMemoryPublicationFixture();
        const a = (await allocation(f)).allocation;
        const gate = f.controls.pauseNextDispatch();
        const task = f.port.publishFresh(a, bytes(1));
        await gate.entered;
        f.controls.externalWrite(f.port.publicationRoot, "records", bytes(9));
        gate.release();
        expect((await task).physicalEffect).toBe("DISPATCH_OUTCOME_UNKNOWN");
        expect(f.controls.stats().dispatches).toBe(1);
        expect(f.controls.peekBytes(f.port.publicationRoot, a.locator)).toBeUndefined();
    });
    it("context invalidation after preflight forbids entering a new dispatch boundary", async () => {
        const f = createInMemoryPublicationFixture();
        const a = (await allocation(f)).allocation;
        const gate = f.controls.pauseNextDispatch();
        const task = f.port.publishFresh(a, bytes(1));
        await gate.entered;
        f.controls.invalidateContext();
        gate.release();
        expect(await task).toMatchObject({ physicalEffect: "NO_MUTATION_DISPATCHED", reason: "CONFINEMENT" });
        expect(f.controls.stats().dispatches).toBe(0);
        expect(f.controls.peekBytes(f.port.publicationRoot, a.locator)).toBeUndefined();
    });
    it("control snapshots/events do not share mutable arrays with internal state", async () => {
        const f = createInMemoryPublicationFixture();
        const a = (await allocation(f)).allocation;
        await f.port.publishFresh(a, bytes(1, 2));
        const snapshot = f.controls.peekBytes(f.port.publicationRoot, a.locator);
        snapshot.fill(9);
        const events = f.controls.events();
        events.find((event) => event.kind === "apply").bytes.fill(8);
        expect((await f.port.readBytes(f.port.fileHandle(a.locator).value)).value).toEqual(bytes(1, 2));
        expect(f.controls.events().find((event) => event.kind === "apply").bytes).toEqual(bytes(1, 2));
    });
    it("physical copies of an exact canonical revision collapse only in separate pure semantics", async () => {
        const f = createInMemoryPublicationFixture();
        const a = (await allocation(f)).allocation,
            b = (await allocation(f)).allocation;
        const envelope = {
            storageEnvelopeVersion: 1,
            schemaVersion: 1,
            storeId: "fk-store-00000000-0000-4000-8000-000000000001",
            recordKind: "test",
            recordId: "one",
            revisionId: "fk-revision-00000000-0000-4000-8000-000000000001",
            parentRevisionId: null,
            resolvedRevisionIds: [],
            state: "active",
            payload: { value: "same" },
        };
        const content = new TextEncoder().encode(canonicalSerialize(envelope));
        await f.port.publishFresh(a, content);
        await f.port.publishFresh(b, content);
        const codec = {
            recordKind: "test",
            schemaVersion: 1,
            isRecordId: (v) => v === "one",
            validatePayload: (v) => v,
        };
        const observations = [];
        for (const allocated of [a, b]) {
            const raw = (await f.port.readBytes(f.port.fileHandle(allocated.locator).value)).value;
            const decoded = decodeCanonicalRevisionEnvelope(new TextDecoder().decode(raw), [codec]);
            observations.push({ envelope: decoded, digest: await canonicalRevisionDigest(decoded) });
        }
        expect(classifyRecordRevisions(observations).state).toBe("EQUIVALENT_DUPLICATE");
        expect(f.controls.stats().dispatches).toBe(2);
    });
});
