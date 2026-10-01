import { sha256Bytes, type CanonicalDigest } from "./canonicalEncoding";
import {
    isSafeRepresentationLocator,
    storageFailure,
    storageSuccess,
    type BoundedRepresentationListing,
    type RepresentationStoragePort,
    type RepresentationStorageResult,
} from "./RepresentationStoragePort";

/** Deterministic fixture only; it is not a production or Obsidian-backed store. */
export class InMemoryRepresentationStorage implements RepresentationStoragePort {
    readonly localGuarantees = {
        immutableCreate: "refuses-existing",
        guardedSnapshotWrite: "checks-current-content-digest",
        guaranteeScope: "one-local-operation",
    } as const;

    private readonly files = new Map<string, Uint8Array>();
    private mutationQueue: Promise<void> = Promise.resolve();

    constructor(readonly rootIdentity: string) {
        if (!rootIdentity.trim()) throw new Error("Representation root identity is required.");
    }

    async listChildren(
        directory: string,
        limit: number
    ): Promise<RepresentationStorageResult<BoundedRepresentationListing>> {
        if (!isSafeRepresentationLocator(directory, true)) {
            return storageFailure("INVALID_LOCATOR", "Directory locator must be a safe root-relative path.");
        }
        if (!Number.isSafeInteger(limit) || limit < 1) {
            return storageFailure("INVALID_LIMIT", "Listing limit must be a positive safe integer.");
        }

        const prefix = directory ? `${directory}/` : "";
        const entries = new Map<string, "file" | "directory">();
        for (const locator of this.files.keys()) {
            if (directory && locator !== directory && !locator.startsWith(prefix)) continue;
            if (locator === directory) continue;
            const remainder = directory ? locator.slice(prefix.length) : locator;
            if (!remainder) continue;
            const separator = remainder.indexOf("/");
            const name = separator < 0 ? remainder : remainder.slice(0, separator);
            const kind = separator < 0 ? "file" : "directory";
            const existing = entries.get(name);
            if (existing === "directory" || kind === "directory") entries.set(name, "directory");
            else entries.set(name, "file");
        }

        const ordered = [...entries].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
        return storageSuccess<BoundedRepresentationListing>({
            entries: ordered.slice(0, limit).map(([name, kind]) => ({ name, kind })),
            truncated: ordered.length > limit,
        });
    }

    async readBytes(locator: string): Promise<RepresentationStorageResult<Uint8Array>> {
        if (!isSafeRepresentationLocator(locator)) {
            return storageFailure("INVALID_LOCATOR", "File locator must be a safe root-relative path.");
        }
        const bytes = this.files.get(locator);
        if (!bytes) return storageFailure("NOT_FOUND", `No file exists at ${locator}.`);
        return storageSuccess(Uint8Array.from(bytes));
    }

    createImmutable(locator: string, bytes: Uint8Array): Promise<RepresentationStorageResult<void>> {
        const content = Uint8Array.from(bytes);
        return this.serializeMutation(() => {
            if (!isSafeRepresentationLocator(locator)) {
                return storageFailure("INVALID_LOCATOR", "File locator must be a safe root-relative path.");
            }
            if (this.pathOccupied(locator)) return storageFailure("ALREADY_EXISTS", `Path ${locator} already exists.`);
            this.files.set(locator, content);
            return storageSuccess(undefined);
        });
    }

    writeSnapshot(
        locator: string,
        bytes: Uint8Array,
        expectedCurrentDigest: CanonicalDigest | null
    ): Promise<RepresentationStorageResult<void>> {
        const content = Uint8Array.from(bytes);
        return this.serializeMutation(async () => {
            if (!isSafeRepresentationLocator(locator)) {
                return storageFailure("INVALID_LOCATOR", "File locator must be a safe root-relative path.");
            }
            const current = this.files.get(locator);
            if (expectedCurrentDigest === null) {
                if (this.pathOccupied(locator))
                    return storageFailure("ALREADY_EXISTS", `Path ${locator} already exists.`);
                this.files.set(locator, content);
                return storageSuccess(undefined);
            }
            if (!current) return storageFailure("NOT_FOUND", `No file exists at ${locator}.`);
            if ((await sha256Bytes(current)) !== expectedCurrentDigest) {
                return storageFailure(
                    "DIGEST_MISMATCH",
                    `Current bytes at ${locator} do not match the expected digest.`
                );
            }
            this.files.set(locator, content);
            return storageSuccess(undefined);
        });
    }

    rename(
        locator: string,
        newLocator: string,
        expectedCurrentDigest: CanonicalDigest
    ): Promise<RepresentationStorageResult<void>> {
        return this.serializeMutation(async () => {
            if (!isSafeRepresentationLocator(locator) || !isSafeRepresentationLocator(newLocator)) {
                return storageFailure("INVALID_LOCATOR", "Rename locators must be safe root-relative paths.");
            }
            const current = this.files.get(locator);
            if (!current) return storageFailure("NOT_FOUND", `No file exists at ${locator}.`);
            if ((await sha256Bytes(current)) !== expectedCurrentDigest) {
                return storageFailure(
                    "DIGEST_MISMATCH",
                    `Current bytes at ${locator} do not match the expected digest.`
                );
            }
            if (this.pathOccupied(newLocator))
                return storageFailure("ALREADY_EXISTS", `Path ${newLocator} already exists.`);
            this.files.delete(locator);
            this.files.set(newLocator, current);
            return storageSuccess(undefined);
        });
    }

    delete(locator: string, expectedCurrentDigest: CanonicalDigest): Promise<RepresentationStorageResult<void>> {
        return this.serializeMutation(async () => {
            if (!isSafeRepresentationLocator(locator)) {
                return storageFailure("INVALID_LOCATOR", "File locator must be a safe root-relative path.");
            }
            const current = this.files.get(locator);
            if (!current) return storageFailure("NOT_FOUND", `No file exists at ${locator}.`);
            if ((await sha256Bytes(current)) !== expectedCurrentDigest) {
                return storageFailure(
                    "DIGEST_MISMATCH",
                    `Current bytes at ${locator} do not match the expected digest.`
                );
            }
            this.files.delete(locator);
            return storageSuccess(undefined);
        });
    }

    private serializeMutation<T>(
        operation: () => Promise<RepresentationStorageResult<T>> | RepresentationStorageResult<T>
    ): Promise<RepresentationStorageResult<T>> {
        const result: Promise<RepresentationStorageResult<T>> = this.mutationQueue.then(
            () => Promise.resolve(operation()),
            () => Promise.resolve(operation())
        );
        this.mutationQueue = result.then<void, void>(
            () => undefined,
            () => undefined
        );
        return result;
    }

    private pathOccupied(locator: string): boolean {
        if (this.files.has(locator)) return true;
        const segments = locator.split("/");
        for (let index = 1; index < segments.length; index += 1) {
            if (this.files.has(segments.slice(0, index).join("/"))) return true;
        }
        const prefix = `${locator}/`;
        for (const existing of this.files.keys()) {
            if (existing.startsWith(prefix)) return true;
        }
        return false;
    }
}
