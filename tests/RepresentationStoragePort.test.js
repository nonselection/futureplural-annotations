import { expect, it } from "vitest";
import { addRepresentationStoragePortConformance } from "./helpers/representationStoragePortConformance";
import { InMemoryRepresentationStorage } from "../src/storage/InMemoryRepresentationStorage";
import { storageFailure } from "../src/storage/RepresentationStoragePort";

addRepresentationStoragePortConformance(
    "In-memory fixture",
    (testCase) => new InMemoryRepresentationStorage(`fixture-${testCase}`)
);

it("returns typed UNSUPPORTED from an actual test-only port operation", async () => {
    const delegate = new InMemoryRepresentationStorage("fixture-unsupported-operation");
    const portStub = {
        rootIdentity: delegate.rootIdentity,
        localGuarantees: delegate.localGuarantees,
        listChildren: async () => storageFailure("UNSUPPORTED", "Listing is unsupported by this test fixture."),
        readBytes: (...args) => delegate.readBytes(...args),
        createImmutable: (...args) => delegate.createImmutable(...args),
        writeSnapshot: (...args) => delegate.writeSnapshot(...args),
        rename: (...args) => delegate.rename(...args),
        delete: (...args) => delegate.delete(...args),
    };

    expect(await portStub.listChildren("", 10)).toMatchObject({
        ok: false,
        failure: { code: "UNSUPPORTED" },
    });
});
