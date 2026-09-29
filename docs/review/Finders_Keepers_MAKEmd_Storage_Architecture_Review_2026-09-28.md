# Finders Keepers — MAKE.md Storage Architecture Review
## External precedent review for Canonical Storage Protocol v0.3

**Date:** 2026-09-28  
**Status:** architectural precedent / pressure-test document  
**Repository reviewed:** `Make-md/makemd`  
**Source snapshot reviewed:** commit `cb9ca900d419ac9294d90adfed4140ad0a9675f2`  
**Primary question:** What can Finders Keepers learn from a mature, non-sync Obsidian plugin that stores substantial plugin-owned metadata in the vault and must coexist with multi-device synchronization?

---

# 1. Why MAKE.md is a strong comparator

MAKE.md is a much better comparison for Finders Keepers than a sync plugin.

Its primary job is not synchronization. It provides Spaces, contextual metadata, views, schemas, commands, navigation, and related knowledge-management capabilities. To provide those capabilities, it maintains substantial plugin-owned state associated with user vault content.

That makes its design problem structurally similar to ours:

> The plugin has useful user-facing capabilities, those capabilities depend on durable metadata, the metadata is not merely plugin settings, and users may expect the capabilities to exist on several devices.

MAKE.md does **not** provide the only reasonable implementation, and this review is not an argument to reproduce its storage format. The value is comparative: where MAKE.md and Finders Keepers independently converge, we gain useful precedent; where FK is more defensive, we can identify why.

---

# 2. MAKE.md separates meaningful Space state from rebuildable cache state

MAKE.md persists at least two materially different classes of plugin-owned state.

## 2.1 Space metadata

A normal Space can carry metadata such as:

```text
Some Folder/
    .space/
        def.json
        context.mdb
        views.mdb
        commands.mdb
        templates/
        ...
```

Relevant source locations include:

- `src/core/utils/spaces/space.ts`
- `src/core/spaceManager/filesystemAdapter/spaceInfo.ts`
- `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts`
- `src/adapters/mdb/mdbAdapter.ts`
- `src/adapters/mdb/db/db.ts`

`spaceSubFolder` defaults to `.space`.

The MDB files are not merely acceleration caches. They store Space context/database definitions, views, commands, fields, schemas, etc. They are meaningful plugin metadata that can affect user-visible behavior.

## 2.2 Rebuildable/cache machinery

MAKE.md separately stores cache/index machinery such as:

```text
.makemd/
    fileCache.mdc
    ...
```

`ObsidianFileSystem` creates either `LocalStorageCache` or `MobileCachePersister` for `.makemd/fileCache.mdc`, depending on platform.

The cache source explicitly describes itself as:

> “Simpler wrapper for a file-backed cache for arbitrary metadata.”

The cache is populated from the vault and used to accelerate operation. This is conceptually closer to Finders Keepers' future derived indexes than to canonical annotations, palettes, Sets, Codes, or Memos.

### FK implication

MAKE.md reinforces the need to classify plugin state by semantics rather than by the fact that “the plugin needs it”:

```text
shared canonical state
    ≠
device-local persistent state
    ≠
rebuildable derived/index state
```

Finders Keepers should not automatically synchronize every useful internal structure merely because it is persistent.

---

# 3. Hidden metadata is MAKE.md's default

MAKE.md defaults include:

```ts
spaceSubFolder: ".space"
spacesMDBInHidden: true
```

Relevant source:

- `src/core/schemas/settings.ts`

The path resolver in:

- `src/core/utils/spaces/space.ts`

uses those settings to determine whether the database files live under the hidden Space metadata subfolder or elsewhere.

This is useful precedent for FK's product preference:

> Hidden plugin-owned metadata is a reasonable default user experience when the active transport can carry it safely.

It avoids cluttering the ordinary vault tree with application-owned metadata.

---

# 4. MAKE.md explicitly detects an Obsidian Sync incompatibility

The most directly relevant precedent is in:

- `src/adapters/obsidian/ui/ui.tsx`

Its `getWarnings()` method inspects Obsidian's Sync state through internal APIs.

If Sync is enabled and the configured Space metadata folder begins with `.`, MAKE.md emits a warning with:

- an explanation that the current Sync setup will not sync the Spaces;
- a recommendation to use a non-hidden folder;
- a direct action to the `move-space-folder` command.

It also inspects Sync's allowed file types and warns when unsupported file types such as MAKE.md's MDB files are not configured to sync.

Conceptually, MAKE.md has independently arrived at:

```text
Hidden is preferred
        +
transport cannot carry it
        ↓
tell the user
        +
offer an actionable migration to non-hidden storage
```

This strongly supports Finders Keepers' emerging **dual-representation** model:

```text
Hidden representation
    preferred UX where qualified

Visible representation
    compatibility representation where required
```

The logical domain does not need to become a different data model merely because the transport requires a different physical representation.

---

# 5. Important nuance: MAKE.md's capability check is on-demand, but its change detection is not robust enough for FK

A specific question for this review was:

> What happens if a user starts with some other arrangement and enables Obsidian Sync later, during the lifetime of the plugin?

MAKE.md's implementation is more dynamic than a one-time installer check, but it is **not** a robust subscription to Sync capability changes.

## 5.1 What is dynamic

`ObsidianUI.getWarnings()` computes warnings from the **current** values of:

```ts
this.plugin.app.internalPlugins.config.sync
```

and:

```ts
this.plugin.app.internalPlugins.plugins?.sync?.instance?.allowTypes
```

It does not cache the Sync state captured during plugin installation.

Therefore, whenever `getWarnings()` is called later, it evaluates the current Sync configuration.

The warnings modal initializes its state by calling `getWarnings()` when opened. So enabling Sync mid-session can be detected the next time the warning surface is opened.

The main menu also recomputes warnings on internal MAKE.md events including:

- `superstateUpdated`
- `settingsChanged`
- `warningsChanged`

## 5.2 What I did **not** find

I did not find a dedicated listener for:

> “Obsidian Sync has just been enabled/disabled or its unsupported-file-type setting has changed.”

So the implementation does not appear to guarantee immediate proactive detection of that capability transition.

## 5.3 A small implementation oddity

The warning modal itself listens to `settingsChanged`, but its Refresh button dispatches `warningsChanged`.

The main menu listens to `warningsChanged`; the modal component shown in the reviewed source does not.

That appears to mean the Refresh action is not, by itself, a clean direct refresh of the modal's own local warning state unless some other event causes a rerender. This is not a pattern FK should reproduce.

## 5.4 FK requirement

Finders Keepers should treat storage compatibility as a **runtime capability state**, not an installation-time decision.

At minimum FK should re-evaluate storage capability:

- on plugin/application startup;
- after app resume / meaningful foreground re-entry;
- when FK Settings or Storage Health is opened;
- before a representation-affecting action;
- after an explicit migration;
- when a supported host signal tells us storage/sync configuration changed.

If Obsidian exposes no stable public Sync-toggle event, FK should use a lightweight state comparison at appropriate lifecycle boundaries rather than relying on a fragile internal event.

The check should be cheap and side-effect-free.

A transition:

```text
Hidden qualified → Hidden not qualified
```

should become an actionable storage-health state, not an immediate automatic destructive migration.

---

# 6. MAKE.md provides an actionable migration command

MAKE.md registers:

```text
Move Space Data Folder
```

Relevant sources:

- `src/commands.tsx`
- `src/adapters/obsidian/filesystem/spaceFileOps.tsx`

The user can choose a new Space metadata folder name, allowing a hidden `.space` representation to become a visible/non-hidden folder when necessary.

This is excellent **product precedent**:

> Compatibility diagnostics should lead directly to a comprehensible corrective action.

Finders Keepers should similarly avoid warnings that merely say “your sync is wrong.”

A future FK warning can instead lead to:

```text
Move Finders Keepers storage to visible compatibility mode
```

with explanation, verification, and recovery semantics underneath.

---

# 7. MAKE.md's actual migration protocol is not strong enough for FK

The implementation of `moveSpaceFiles()` is simple:

1. immediately change `settings.spaceSubFolder` to the new value;
2. save settings;
3. iterate through Spaces;
4. rename each existing old metadata folder to the new name;
5. rename the root metadata folder if one exists;
6. reinitialize Spaces;
7. notify success.

This works as straightforward path migration.

It is **not** a recoverable canonical migration protocol.

There is no visible equivalent of:

```text
migrationId
prepared
copied
verified
committed
cleanup-pending
```

There is no durable inventory verifying that all expected Space data arrived at the destination before authority changes.

Most notably, the setting is updated **before** all filesystem renames complete.

If the application or device fails halfway through a large move, the persisted preference can point at the destination while part of the metadata remains at the source.

### FK implication

Our more defensive migration design is justified.

For FK:

- `data.json` MUST NOT decide migration authority;
- source and destination must remain discoverable independently of settings;
- the same `storeId` must survive the move;
- migration must be resumable;
- destination completeness must be verified before commit;
- cleanup must be a later, explicit phase.

MAKE.md validates the UX need for migration but gives us a concrete reason **not** to copy a preference-first rename implementation.

---

# 8. MAKE.md is heavily path-identified

MAKE.md's Space APIs are overwhelmingly path-centered:

```ts
spaceInfoForPath(path)
spaceDefForSpace(path)
renameSpace(path, newPath)
contextForSpace(path)
pathExists(path)
renamePath(oldPath, newPath)
```

`SpaceInfo` contains path-oriented fields such as:

```text
path
folderPath
defPath
notePath
```

I found IDs within database rows, frames, schemas, fields, etc., but I did not find an analogue of FK's proposed **opaque logical store identity independent of physical path**.

This makes sense for MAKE.md: a Space is often conceptually attached to a vault folder, tag, or path.

Finders Keepers has a different identity problem.

Annotations, SourceRecords, palette slots, Sets, Codes, Memos, etc. must survive:

- source rename;
- vault movement;
- representation migration;
- provider-generated sibling directories;
- provider recursive directory union.

### FK implication

MAKE.md makes `storeId` look **more necessary**, not less.

FK should retain:

```text
physical path = locator
storeId       = logical store identity
record ID     = logical artifact identity
```

---

# 9. MAKE.md's database write model is comparatively coarse

MAKE.md's MDB implementation uses SQL.js / SQLite-like structures in memory, then serializes the database to bytes and writes the file back.

Relevant sources:

- `src/adapters/mdb/db/db.ts`
- `src/adapters/mdb/localCache/localCache.ts`
- `src/adapters/obsidian/filesystem/filesystem.ts`

A compressed MDB save eventually:

1. builds/loads a database;
2. modifies tables in memory;
3. exports bytes;
4. ZIP-compresses them;
5. writes the same file path through the filesystem adapter.

The filesystem layer reaches operations such as:

```ts
vault.adapter.writeBinary(path, buffer)
```

I did not find an equivalent of FK's candidate protocol:

```text
read expected base
→ write unique immutable intent
→ guarded canonical mutation
→ reread
→ verify
→ retain bounded recovery evidence
```

Nor did I find a distributed/provider reconciliation layer around concurrent offline MDB writes.

### FK implication

MAKE.md is evidence that coarse database files are viable for its feature set.

It is **not** evidence that FK should collapse many independently mutable canonical artifacts into one frequently overwritten shared file.

Our iCloud matrix gives FK a reason to prefer disjoint physical paths for independently mutable aggregates.

---

# 10. MAKE.md's writer granularity creates provider-collision opportunities we can avoid

A file such as:

```text
context.mdb
```

can contain many logically distinct rows or fields.

Two offline devices editing unrelated logical entries can therefore still both rewrite:

```text
context.mdb
```

and create a same-provider-path conflict.

Finders Keepers can reduce unnecessary collision surface by preferring something closer to:

```text
annotations/<AnnotationId>.json
sources/<SourceRecordId>.json
palette/slots/<PaletteSlotId>.json
```

subject to measured filesystem/mobile performance.

This does not eliminate same-record conflicts, but it ensures:

> independent logical edits are more often independent physical writes.

---

# 11. MAKE.md does not appear to implement provider-level reconciliation semantics

I specifically looked for equivalents of FK concepts such as:

- bounded provider-created sibling discovery;
- provider-created conflicting-file discovery;
- store-wide opaque identity;
- same-record divergent-valid-state classification;
- immutable recovery intents;
- cross-device compare-and-swap;
- preservation of provider conflict copies;
- mixed-store invalidity detection.

I did not find an equivalent layer.

MAKE.md does observe filesystem/vault events and uses modification times in local event handling. That is normal and useful.

This distinction matters:

> FK's rule is not “timestamps are forbidden.”

Timestamps are valid for:

- local event suppression;
- retention;
- diagnostics;
- user explanation;
- performance heuristics.

They MUST NOT decide distributed canonical truth:

```text
newer mtime ≠ automatic winner
```

---

# 12. What FK should borrow

## 12.1 Hidden-first product preference

MAKE.md provides real precedent for hidden plugin-owned metadata as the ordinary UX.

Adopt the principle, not its exact folder structure.

## 12.2 Transport capability diagnostics

FK should actively detect known incompatibilities where reliable capability information exists.

For Obsidian Sync this may include:

- hidden-folder behavior;
- whether required file types are transported.

## 12.3 Actionable warnings

A compatibility warning should include:

- what is incompatible;
- what the consequence is;
- the safe next action.

For example:

> Finders Keepers storage is currently hidden, but this Sync configuration cannot carry that storage reliably. Your annotation data has not been moved. Switch to visible compatibility storage to keep Finders Keepers data available on synced devices.

Action:

> **Move storage…**

## 12.4 Separate canonical metadata and rebuildable indexes

MAKE.md's distinction between Space metadata and `.makemd` cache state strengthens FK's own state taxonomy.

---

# 13. What FK should deliberately not copy

Do **not** inherit:

- physical path as the primary logical identity;
- preference-first representation migration;
- best-effort sequential renames with no durable migration protocol;
- large shared mutable files solely for implementation convenience;
- assuming the provider will resolve concurrent database rewrites safely;
- treating successful local file writes as cross-device concurrency control;
- one-time or weakly-triggered storage capability checks;
- fragile dependence on Obsidian internal APIs without a fallback strategy.

---

# 14. Actionable capability diagnostics for FK

MAKE.md's warning system is the strongest product idea to carry forward, but FK should make it more systematic.

Candidate storage-health states:

```text
HEALTHY

HIDDEN_TRANSPORT_UNQUALIFIED
    → recommend visible compatibility representation

REQUIRED_FILETYPE_NOT_SYNCED
    → explain required transport setting

PROVIDER_COPY_DETECTED
    → do not delete or rename; FK is inspecting candidates

DIVERGENT_VALID_STATE
    → no overwrite; review/reconciliation needed

MIXED_STORE_INVALID
    → normal writes stopped; recovery required

UNSUPPORTED_NEWER_SCHEMA
    → read-only/write fence; update required

MIGRATION_INCOMPLETE
    → resume/repair migration
```

These are not all necessarily persistent banners.

Most of the time storage should be quiet.

The value is that the repository already knows these semantic states, and product UI should translate them into clear actions rather than leaking filesystem trivia.

---

# 15. Capability-transition detection requirement

A user's storage environment can change after initial setup.

Examples:

- Obsidian Sync is enabled later;
- unsupported file types are enabled or disabled;
- a transport configuration changes;
- a user moves the vault to a different provider;
- another device introduces a provider-created FK candidate.

Therefore FK MUST NOT treat the initial storage choice as permanently validated.

A candidate check policy:

```text
plugin load / layout ready
        ↓
evaluate known local capabilities

app returns to foreground after meaningful absence
        ↓
cheap re-evaluation if state may have changed

FK Settings / Storage Health opened
        ↓
always evaluate current capability

before storage migration or other representation-affecting action
        ↓
evaluate

host exposes a stable relevant configuration-change event
        ↓
evaluate
```

If no stable public event exists for a capability, FK MAY retain a small last-observed capability fingerprint and re-evaluate at safe lifecycle boundaries.

Detection MUST be observational. It MUST NOT silently migrate canonical state merely because a capability changed.

---

# 16. Comparative result against Canonical Storage Protocol v0.3

MAKE.md supports the **upper half** of FK v0.3 very strongly:

```text
plugin-owned metadata can live outside data.json
hidden metadata can be preferable
transport constraints can force non-hidden compatibility storage
users deserve capability warnings
warnings should lead to fixes
persistent canonical-ish metadata and caches are different things
storage location can be migrated
```

It does not provide evidence against FK's additional protocol mechanisms.

Instead, the review exposes requirements MAKE.md does not attempt to solve at the same level:

```text
storeId namespace
positive-absence bootstrap
whole-store validation
provider-candidate discovery
same-store divergence
bounded immutable mutation recovery
recoverable representation migration
schema write fence
provider-copy user communication
```

Those mechanisms remain justified by FK's experimentally observed failure shapes.

---

# 17. Architectural decisions strengthened by this review

The following v0.3 positions should be considered **strengthened**:

1. Hidden is the preferred representation where qualified.
2. Visible is a compatibility representation, not a different logical database.
3. Storage capability must be diagnosable after setup, not merely during installation.
4. Known incompatibility should produce an actionable migration route.
5. Canonical data, local session state, and rebuildable indexes require different persistence strategies.
6. Representation choice belongs below the canonical domain.
7. Path must not become FK store identity.
8. Representation migration requires stronger semantics than “save new setting and rename folders.”
9. Independently mutable canonical aggregates should avoid unnecessary shared provider paths.
10. FK's provider-independent recovery layer remains warranted.

---

# 18. Follow-up work created by the MAKE.md review

## 18.1 Add capability diagnostics to v0.3

The storage protocol should explicitly define:

- capability evaluation;
- last-observed capability state;
- capability-transition behavior;
- warning severity;
- migration recommendation behavior.

## 18.2 Determine what stable Obsidian APIs exist

MAKE.md uses internal APIs:

```ts
app.internalPlugins.config.sync
app.internalPlugins.plugins?.sync?.instance?.allowTypes
```

FK should separately investigate:

- whether a public supported API exists for the information we need;
- whether a stable event exists for a Sync configuration change;
- what fallback behavior is acceptable if no supported API exists.

## 18.3 Do not couple canonical correctness to capability detection

Capability diagnostics inform representation choice.

Canonical discovery/recovery must still work if:

- capability detection fails;
- the provider changes;
- the user copies the vault manually;
- a provider behaves differently than expected.

---

# 19. Bottom line

MAKE.md is valuable precedent because it independently confirms that our **product-level storage architecture is normal**:

> a non-sync plugin can require substantial durable metadata, prefer to keep that metadata hidden, detect when a transport cannot carry it, warn the user, and provide a path to a visible/non-hidden representation.

Finders Keepers should borrow that product stance.

The storage protocol underneath FK should remain more defensive than MAKE.md's implementation because our own experiments have established failure modes its architecture does not model:

- independent logical stores can be merged by the provider;
- provider conflict resolution can occur at directory or individual-file granularity;
- same-path offline writes may expose only one ordinary winner;
- physical paths therefore cannot safely constitute canonical authority.

The useful conclusion is not “MAKE.md solved this already.”

It is:

> **MAKE.md validates the UX premise. Finders Keepers' experimental work justifies a stronger identity, migration, validation, and recovery protocol beneath that same premise.**

---

# Source map

Primary repository:

- https://github.com/Make-md/makemd

Key reviewed files:

- `src/core/schemas/settings.ts`
- `src/core/utils/spaces/space.ts`
- `src/core/spaceManager/filesystemAdapter/spaceInfo.ts`
- `src/core/spaceManager/filesystemAdapter/filesystemAdapter.ts`
- `src/core/spaceManager/spaceManager.ts`
- `src/adapters/obsidian/filesystem/filesystem.ts`
- `src/adapters/obsidian/filesystem/spaceFileOps.tsx`
- `src/adapters/obsidian/ui/ui.tsx`
- `src/core/react/components/Navigator/SyncWarnings.tsx`
- `src/core/react/components/Navigator/MainMenu.tsx`
- `src/commands.tsx`
- `src/adapters/mdb/db/db.ts`
- `src/adapters/mdb/localCache/localCache.ts`
- `src/adapters/mdb/localCache/localCacheMobile.ts`
