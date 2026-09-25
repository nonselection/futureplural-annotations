# Slice 0 platform decision memo

**Date:** 2026-09-24  
**Status:** evidence incomplete; backend and minimum-version decisions remain open.  
**B0:** not passed.

## Recommendation at this gate

Do not freeze the shared canonical backend, local-session backend, or `minAppVersion` yet. The human accepted Slice 0 documentation and authorized the sequence to proceed to Slice 1 without resolving these platform questions, provided Slice 1 does not silently choose a backend. Actual desktop/iPad and two-device transport evidence remains mandatory before B0 and before relying on the substrate for valuable real-vault annotations. B0 has not passed.

## Environment inspected

- Checkout: clean `futureplural` branch at `cfca083`; package scripts include test/typecheck/lint/format/build, `deploy`, and `deploy:actual`.
- Development vault: `/Users/nonselection/Library/Mobile Documents/iCloud~md~obsidian/Documents/dev-vault`, configured by `FUTUREPLURAL_DEV_VAULT`. It is under iCloud Drive and contains existing parser-spike notes, canvases, and plugin state. Directory contents were listed read-only. No files were written, deployed, removed, or renamed.
- Personal vault: path value was not inspected or used; no command targeted it.
- Human verified outside the Codex sandbox that Obsidian desktop 1.13.7 runs normally, `which obsidian` resolves to `/usr/local/bin/obsidian`, that symlink resolves to `/Applications/Obsidian.app/Contents/MacOS/obsidian-cli`, and `obsidian help` works in ordinary Terminal. Treat the earlier `open -a`/CLI IPC failure and direct launch exit 134 as this sandbox's macOS GUI/IPC boundary, not as host app/CLI unavailability. Codex did not obtain live runtime/DOM output in this session.
- Project dependency is `obsidian` 1.13.1. This is a type package, not a tested minimum runtime. `manifest.json` currently declares `minAppVersion: 1.7.2`.
- Deploy script chooses `FUTUREPLURAL_DEV_VAULT` by default and selects `FUTUREPLURAL_ACTUAL_VAULT` only with `--actual`; neither deploy command was run.

## Candidate backends

Separate the **canonical storage representation** (for example, visible vault JSON or configuration-directory files) from the **transport** that moves those files between devices. The configured development vault is stored in iCloud Drive, so its B0 cross-device transport experiment is desktop ↔ actual iPad over iCloud Drive. Obsidian Sync is a separate, optional provider and its controls are not universal requirements for vault JSON or iCloud Drive.

| State / representation                   | Candidate                                                         | Characteristics and required proof                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared canonical data                    | Vault-visible JSON in a dedicated visible folder via Vault APIs   | Visible as vault files; Vault events; Vault.process() for guarded single-file read/modify/write; portable with ordinary vault backup/export. Test actual iCloud Drive desktop↔iPad propagation, availability/offline behavior, duplicates/conflicts, restart, and restore/export. This API is not a distributed transaction. |
| Shared canonical data                    | Hidden/config-directory files via Vault.adapter / Vault.configDir | Access to hidden paths; provider-specific configuration sync may include config data. Test iCloud Drive behavior for the actual config directory and hidden target, plus mobile access, conflict, backup, and restore behavior.                                                                                              |
| Device-local active pointer/View/history | Obsidian App.loadLocalStorage() / saveLocalStorage()              | Declarations mark the vault-specific helpers since 1.8.7. Restart retention, device/vault isolation, eviction, and iPad behavior remain untested.                                                                                                                                                                            |
| Device-local active pointer/View/history | IndexedDB                                                         | Structured bounded storage separate from vault files; origin/vault isolation, iPad webview persistence, eviction, backup, and lifecycle remain untested. Not a candidate for canonical analytical data.                                                                                                                      |
| Modest plugin preferences                | Plugin.loadData() / saveData() (.obsidian/plugins/<id>/data.json) | Official plugin settings mechanism used by the current plugin. Whole settings snapshot; may be synced as configuration and is not inherently device-local. Not an unbounded analytical store.                                                                                                                                |

Official references: [Obsidian Vault API](https://docs.obsidian.md/Plugins/Vault) (hidden files require Adapter API; `Vault.process()` preferred to avoid stale writes), [mobile support guidance](https://docs.obsidian.md/oo/plugin) (CapacitorAdapter on mobile; prefer Vault API), and [plugin manifest requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins) (minimum version must match actual compatibility). Optional **Obsidian Sync-specific** compatibility references: [selective syncing](https://obsidian.md/help/sync/settings) and [conflict troubleshooting](https://obsidian.md/help/sync/troubleshoot). These describe Obsidian Sync only; they do not govern iCloud Drive transport.

These official docs describe API and provider-specific behavior but do not replace the required experiment on the actual iCloud Drive desktop/iPad pair.

## API and runtime inventory

- `Vault.process(file, synchronousTransform)` is exposed by the installed 1.13.1 declarations and current docs describe it as an atomic read/modify/write abstraction for one vault file, preferable to a separate read/modify sequence. It is not a cross-file or distributed transaction.
- `Vault.adapter` exposes exists/list/read/write/process and other low-level file methods. Official mobile guidance identifies `CapacitorAdapter` on mobile and recommends Vault API where possible. Hidden paths require Adapter API.
- `App.loadLocalStorage` / `saveLocalStorage` are present in local declarations with `@since 1.8.7` and described as vault-specific. Read-only desktop runtime availability was verified in the Slice 2A addendum below; restart retention and storage eviction are untested.
- `Plugin.loadData` / `saveData` read and write plugin `data.json` and serialize the whole settings object in current code. These are not a canonical analytical database.
- Current `src/main.ts` is mobile-marked (`isDesktopOnly: false` in manifest) and imports only Obsidian platform APIs plus web-compatible code at module top level; build tooling uses Node modules but is not bundled into plugin runtime. This is a source inspection, not a mobile execution test.
- A minimum of 1.8.7 is a candidate floor only if the chosen local-session implementation requires Obsidian's localStorage helpers. It is not a tested recommendation. 1.13.0 remains a provisional planning target only; neither it nor 1.7.2 has been tested against the complete future runtime API surface on desktop and iPad. Do not change manifest in Slice 0.

## Bounded desktop CLI evidence

At Slice 0, the Obsidian CLI was available on the host but Codex's sandbox could not communicate with the running app. That limitation is superseded: direct `obsidian vault=dev-vault ...` commands now work from Codex. The explicit `vault=` argument avoids relying on the active vault. Bounded read/inspection commands:

```sh
obsidian vault="dev-vault" version
obsidian vault="dev-vault" vault info=path
obsidian vault="dev-vault" plugin id=futureplural-annotations
obsidian vault="dev-vault" dev:errors
obsidian vault="dev-vault" dev:console limit=50 level=error
obsidian vault="dev-vault" dev:dom selector=".workspace-leaf" total
obsidian vault="dev-vault" dev:screenshot path="/tmp/futureplural-slice0-desktop.png"
```

The screenshot writes only to `/tmp`. Do not repeatedly launch Obsidian processes. For a later authorized plugin build, the bounded reload check is `obsidian vault="dev-vault" plugin:reload id=futureplural-annotations`, followed by `obsidian vault="dev-vault" dev:errors`; reload only after built files have been deliberately deployed to the dev vault. CLI commands can verify desktop state but cannot prove iPad behavior or iCloud cross-device transport. These command forms follow the [official Obsidian CLI guide](https://obsidian.md/help/cli).

## Required experiment when devices are available

Use only the dedicated dev vault. Choose unique exact probe paths, back up any pre-existing content first, and retain existing notes/artifacts. Proposed candidates are a visible vault JSON file such as `FuturePlural-Platform-Spike/probe.json`, a hidden Adapter-only file under a dedicated temporary directory, and a local-session key with a unique task namespace. Record initial state before mutation. After each experiment, verify expected data, events, restart behavior, iCloud/provider status, and cleanup only of the exact created probe paths.

1. **Desktop file API:** create/read/update JSON using Vault API and `Vault.process`; verify explorer visibility, create/modify/delete/rename events, `process` conflict/precondition behavior under an external intervening edit, and parse after restart.
2. **Storage representation:** use Adapter APIs for hidden/config paths; verify access/visibility and compare file events, guarded writes, backup/export, restart, and recovery with vault-visible JSON. Do not infer transport behavior from API/path choice.
3. **iCloud Drive transport (B0 path):** on desktop and actual iPad, begin from the same disposable probe revision; make distinct edits while one device is offline, reconnect iCloud Drive, and record propagation timing, availability, duplicate/conflict behavior, file recovery, and restart. Never perform this test on canonical or valuable data.
4. **Provider-specific compatibility:** if Obsidian Sync is later supported, separately configure `Sync all other types`, vault configuration categories, and conflict policy on every device; test automatic merge and conflict-copy behavior on disposable probes. These are not requirements for the current iCloud Drive test path.
5. **Local session:** store uniquely namespaced canary values via localStorage and IndexedDB on each device; restart app/device; open a second vault; compare separate devices; clear only the canary; test quota/eviction only if safely observable. Confirm that no local session key appears in synced vault/config files.
6. **Backup/export:** export/copy a disposable dev vault and restore the probe; verify what the chosen backup/export includes and how iCloud Drive recovers or surfaces competing file versions. Obsidian Sync version recovery is optional provider-specific evidence only. Record whether local session data is intentionally absent.
7. **Minimum version:** validate the future implementation's exact public APIs on the oldest actual desktop/iPad versions the user intends to support, then set `minAppVersion` to the oldest successful supported runtime and retain evidence.

## Evidence status at Slice 0

| Check                                                    | Status                    | Evidence / missing proof                                                                                                                                                               |
| -------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository, Git state, scripts, manifest, dev vault path | Inspected read-only       | Clean `futureplural` at `cfca083`; configured dev vault path and existing top-level entries listed.                                                                                    |
| Installed desktop version                                | Inspected                 | App bundle plist reports 1.13.7.                                                                                                                                                       |
| Desktop app and CLI availability                         | Human verified            | Obsidian 1.13.7 runs; `/usr/local/bin/obsidian` resolves to bundled CLI; `obsidian help` works in ordinary Terminal. Earlier Codex sandbox IPC/launch failure is environment-specific. |
| Desktop live vault/API/restart/events                    | **Not run by Codex**      | Host-side CLI is available, but Codex sandbox could not invoke the running app. Bounded commands above allow manual desktop evidence.                                                  |
| API declaration inventory                                | Partial static inspection | Local Obsidian declarations are 1.13.1; APIs above and annotations found. Not runtime proof.                                                                                           |
| iPad/mobile path, visibility, restart, storage, events   | **Not run**               | No iPad interface/device automation is available in this session.                                                                                                                      |
| iCloud Drive settings and JSON/config behavior           | **Not run**               | Dev vault resides in iCloud Drive; actual provider settings and iCloud behavior have not been observed. Obsidian Sync docs do not establish iCloud behavior.                           |
| Desktop↔iPad iCloud divergence/conflict and recovery     | **Not run**               | Requires actual iPad + desktop and a disposable probe in the configured iCloud Drive vault.                                                                                            |
| Local-store retention, isolation, eviction               | **Not run**               | No runtime session store was modified.                                                                                                                                                 |
| Backup/export restore                                    | **Not run**               | No probe data was created.                                                                                                                                                             |
| B0                                                       | **Not passed**            | All source identity, registry, palette, reconciliation, and cross-platform criteria remain future work.                                                                                |

## Human gate

This memo does not select a backend or set the manifest floor. Human review accepted Slice 0 and established that Slice 1 may proceed in the dedicated dev vault while these platform questions remain open. Stop before resolving a backend implicitly; if Slice 1 proves dependent on an open platform choice, return for review. Desktop+iPad iCloud transport evidence, local-store evidence, and the minAppVersion decision remain open and are mandatory before B0. No vault data was changed in Slice 0, so rollback is limited to the reversible repository documentation and local planning files.

## Slice 2A read-only desktop addendum — 2026-09-25

- Direct Codex CLI returned Obsidian `1.13.7`, the configured iCloud-backed `dev-vault` path, and `app.vault.getName() === "dev-vault"`; `dev:errors` returned no captured errors. No additional app process was launched.
- The installed `obsidian` 1.13.1 declarations place vault-scoped `loadLocalStorage`/`saveLocalStorage` on **`App`**, not `Plugin`. Real Obsidian 1.13.7 returned `function` for both `app` methods and `undefined` for both methods on the loaded FuturePlural plugin. Reading a uniquely named unused key returned `null`; nothing was written. The earlier candidate row and inventory have been corrected. Retention, device isolation, eviction, sync, and iPad behavior remain untested.
- Read-only runtime inspection found `Vault.process`, `Vault.adapter.process`, Adapter `exists`/`list`, `indexedDB`, and browser `localStorage` present. `app.vault.configDir` was `.obsidian`; Adapter `exists` found the current plugin `data.json`, while `Vault.getAbstractFileByPath` did not expose that hidden file. This establishes API availability/visibility only, not safe writes, restart persistence, backup behavior, or iCloud conflict handling.
- Three proposed disposable dev-vault paths were checked through Adapter and were absent: `FuturePlural-Platform-Spike/slice2a-2026-09-25-visible.json`, `.futureplural-platform-spike/slice2a-2026-09-25-hidden.json`, and `.obsidian/plugins/futureplural-annotations/slice2a-2026-09-25-config-probe.json`. Their absence is preparation, not proof that the corresponding path/API works after creation.
- The canonical backend, local-session backend, and minimum version remain open. No disposable probe file, canonical state, local-store canary, or personal-vault data was written in this preparatory pass. Actual iPad and two-device divergence/recovery evidence is still required before the human storage checkpoint and B0.
