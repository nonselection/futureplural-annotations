import { Notice, type App, type Plugin } from "obsidian";
import { type DiscoveryReadPort } from "../storage/discovery";
import { discoverPhysicalStorageTree } from "../storage/discoveryTraversal";
import { isSafeRepresentationLocator, storageFailure, storageSuccess } from "../storage/RepresentationStoragePort";

function immediateName(path: string, directory: string): string {
    const normalizedPath = path.replace(/^\/+/, "");
    const normalizedDirectory = directory.replace(/^\/+|\/+$/g, "");
    const prefix = normalizedDirectory ? `${normalizedDirectory}/` : "";
    if (prefix && !normalizedPath.startsWith(prefix) && normalizedPath.includes("/")) {
        throw new Error("Adapter returned an entry outside the requested directory.");
    }
    const relative = prefix && normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath;
    if (!relative || relative.includes("/")) throw new Error("Adapter did not return an immediate child entry.");
    return relative;
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : typeof error === "string" ? error : "Unexpected discovery error.";
}

/**
 * Bounded read-only bridge used only by the dev-vault discovery diagnostic.
 * It deliberately exposes no S1 port mutation operations.
 */
export function createDevVaultDiscoveryReadPort(app: App): DiscoveryReadPort {
    if (app.vault.getName() !== "dev-vault") {
        throw new Error("Storage discovery diagnostic is restricted to dev-vault.");
    }
    const adapter = app.vault.adapter;
    return {
        rootIdentity: "dev-vault-root-handle",
        async listChildren(directory, limit) {
            if (!Number.isSafeInteger(limit) || limit < 1) {
                return storageFailure("INVALID_LIMIT", "Discovery listing limit must be a positive safe integer.");
            }
            try {
                const listed = await adapter.list(directory || "/");
                const entries = [
                    ...listed.files.map((path) => ({ name: immediateName(path, directory), kind: "file" as const })),
                    ...listed.folders.map((path) => ({
                        name: immediateName(path, directory),
                        kind: "directory" as const,
                    })),
                ].sort((left, right) => compareText(left.name, right.name) || compareText(left.kind, right.kind));
                return storageSuccess({ entries: entries.slice(0, limit), truncated: entries.length > limit });
            } catch (error) {
                return storageFailure("UNAVAILABLE", error instanceof Error ? error.message : "Vault listing failed.");
            }
        },
        async readBytes(locator) {
            if (!isSafeRepresentationLocator(locator)) {
                return storageFailure("INVALID_LOCATOR", "Discovery read locator is not a safe root-relative path.");
            }
            try {
                const bytes = await adapter.readBinary(locator);
                return storageSuccess(new Uint8Array(bytes));
            } catch (error) {
                return storageFailure("UNAVAILABLE", error instanceof Error ? error.message : "Vault read failed.");
            }
        },
    };
}

export function registerStorageDiscoveryReadOnlyCommand(plugin: Plugin): void {
    if (plugin.app.vault.getName() !== "dev-vault") return;
    plugin.addCommand({
        id: "fk-storage-s2-discovery-readonly",
        name: "Inspect bounded storage structure (read only, dev vault)",
        callback: () => {
            try {
                const port = createDevVaultDiscoveryReadPort(plugin.app);
                void discoverPhysicalStorageTree(port)
                    .then((snapshot) => {
                        const candidates = snapshot.rootDiscovery.candidates
                            .filter((candidate) => candidate.state !== "ABSENT" && candidate.state !== "NON_FK")
                            .map((candidate) => `${candidate.locator}:${candidate.state}`);
                        const message = [
                            `S2 read-only discovery ${snapshot.state.toLowerCase()}`,
                            `roots=${candidates.length ? candidates.join(",") : "none"}`,
                            `stores=${snapshot.storeCandidates.length}`,
                            `unknown=${snapshot.unknownNodes.length}`,
                        ].join("; ");
                        new Notice(message, 12000);
                    })
                    .catch((error: unknown) => {
                        new Notice(`S2 read-only discovery failed: ${errorMessage(error)}`, 12000);
                    });
            } catch (error) {
                new Notice(`S2 read-only discovery refused: ${errorMessage(error)}`, 12000);
            }
        },
    });
}
