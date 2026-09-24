import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const deployToActualVault = process.argv.includes("--actual");
const vaultVariable = deployToActualVault ? "FUTUREPLURAL_ACTUAL_VAULT" : "FUTUREPLURAL_DEV_VAULT";
const vaultPath = process.env[vaultVariable]?.trim();

if (!vaultPath) {
    throw new Error(
        `${vaultVariable} is not set. Add it to .env.local as the absolute path to your ${deployToActualVault ? "actual" : "development"} vault.`
    );
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vaultRoot = resolve(vaultPath);
const obsidianDirectory = join(vaultRoot, ".obsidian");

let obsidianStat;
try {
    obsidianStat = await stat(obsidianDirectory);
} catch {
    throw new Error(`Refusing to deploy: ${vaultRoot} does not contain a .obsidian directory.`);
}

if (!obsidianStat.isDirectory()) {
    throw new Error(`Refusing to deploy: ${obsidianDirectory} is not a directory.`);
}

const manifestPath = join(repositoryRoot, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const pluginId = String(manifest.id || "").trim();

if (!/^[a-z0-9-]+$/.test(pluginId)) {
    throw new Error(`Refusing to deploy: invalid plugin id ${JSON.stringify(pluginId)} in manifest.json.`);
}

const deployFiles = ["main.js", "manifest.json", "styles.css"];

for (const filename of deployFiles) {
    const sourcePath = join(repositoryRoot, filename);
    try {
        const sourceStat = await stat(sourcePath);
        if (!sourceStat.isFile()) throw new Error("not a file");
    } catch {
        throw new Error(`Refusing to deploy: required build file ${filename} is missing.`);
    }
}

const pluginDirectory = join(obsidianDirectory, "plugins", pluginId);
await mkdir(pluginDirectory, { recursive: true });

for (const filename of deployFiles) {
    await copyFile(join(repositoryRoot, filename), join(pluginDirectory, filename));
}

console.log(
    `Deployed ${manifest.name} ${manifest.version} to ${deployToActualVault ? "ACTUAL vault" : "development vault"}: ${pluginDirectory}`
);
