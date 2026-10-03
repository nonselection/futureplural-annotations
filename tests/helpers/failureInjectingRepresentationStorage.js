import { storageFailure } from "../../src/storage/RepresentationStoragePort";

/** Ordinary port results only. Fault effects are fixture knowledge, never repository guarantees. */
export function failureInjectingRepresentationStorage(base, options = {}) {
    const events = [];
    const blockedReads = new Set();
    const once = new Set();
    function faultFor(method, locator) {
        if (method === "writeSnapshot") return options.snapshot;
        if (method === "createImmutable") {
            if (locator.includes("/recovery/mutations/")) return options.intent;
            if (locator.includes("/recovery/outcomes/")) return options.outcome;
        }
    }
    const port = {
        rootIdentity: base.rootIdentity,
        localGuarantees: base.localGuarantees,
        async listChildren(...args) {
            events.push({ method: "listChildren", locator: args[0] });
            if (options.listUnavailable?.()) return storageFailure("UNAVAILABLE", "injected listing failure");
            return base.listChildren(...args);
        },
        async readBytes(locator) {
            events.push({ method: "readBytes", locator });
            if (blockedReads.has(locator)) return storageFailure("UNAVAILABLE", "injected observation uncertainty");
            return base.readBytes(locator);
        },
        async createImmutable(locator, bytes) {
            events.push({ method: "createImmutable", locator, bytes });
            const fault = faultFor("createImmutable", locator);
            if (fault && !once.has(locator)) {
                once.add(locator);
                if (fault === "applied-error") await base.createImmutable(locator, bytes);
                if (fault === "conflict")
                    await base.createImmutable(locator, new TextEncoder().encode('{"conflict":true}'));
                if (fault === "unavailable") blockedReads.add(locator);
                if (options.duringCreate) await options.duringCreate(locator, base);
                return storageFailure("IO_ERROR", "injected immutable-create uncertainty");
            }
            if (options.duringCreate) await options.duringCreate(locator, base);
            return base.createImmutable(locator, bytes);
        },
        async writeSnapshot(locator, bytes, expectedCurrentDigest) {
            events.push({ method: "writeSnapshot", locator, bytes, expectedCurrentDigest });
            if (options.beforeSnapshot) await options.beforeSnapshot(locator, base);
            const fault = faultFor("writeSnapshot", locator);
            if (fault === "absent-error") return storageFailure("IO_ERROR", "definitely not applied in fixture");
            if (fault === "unavailable") {
                blockedReads.add(locator);
                return storageFailure("IO_ERROR", "application unknown");
            }
            const result = await base.writeSnapshot(locator, bytes, expectedCurrentDigest);
            if (options.afterSnapshot) await options.afterSnapshot(locator, base, bytes);
            if (fault === "applied-error") return storageFailure("IO_ERROR", "applied before reported failure");
            if (fault === "success-unverifiable") blockedReads.add(locator);
            return result;
        },
        rename: (...args) => base.rename(...args),
        delete: (...args) => base.delete(...args),
    };
    const onBoundary = async (name) => {
        events.push({ method: "boundary", name });
        if (options.boundary) await options.boundary(name, base);
        if (options.crashAt === name) throw new Error(`fixture crash: ${name}`);
    };
    return { port, events, onBoundary, blockedReads };
}
