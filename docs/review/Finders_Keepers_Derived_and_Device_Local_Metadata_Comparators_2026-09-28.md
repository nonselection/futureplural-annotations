# Finders Keepers — Derived and Device-Local Metadata Comparators
## Dataview, Metadata Menu, and Smart Connections

**Date:** 2026-09-28  
**Status:** focused precedent review  
**Purpose:** pressure-test the Finders Keepers distinction between shared canonical data, device-local persistent state, and rebuildable derived state.

---

# 1. Executive conclusion

These three plugins support an important rule for Finders Keepers:

> **The fact that state is large, valuable for performance, and persistent does not mean it should sync.**

A better decision test is:

```text
Can the state be reconstructed from canonical/user-authored sources?
    yes → local/rebuildable persistence is often preferable

Does the state describe device/workspace UI?
    yes → device-local persistence is often preferable

Would deleting it destroy user-created FK meaning that cannot be reconstructed?
    yes → it belongs in shared canonical/recovery architecture
```

The three comparators occupy different points:

| Plugin | Persistent internal state | What it means | Sync stance |
|---|---|---|---|
| Dataview | IndexedDB metadata cache | Rebuildable parsed/indexed metadata from vault notes | Device-local |
| Metadata Menu | IndexedDB file-class view records | Device/workspace view restoration | Device-local |
| Smart Connections / Smart Environment | `.smart-env/` embeddings and source index | Expensive but largely regenerable derived semantic index | Third-party sync explicitly discouraged |

This sharpens FK's own storage taxonomy.

---

# 2. Dataview — persistent cache is disposable authority-wise

Repository reviewed:

- https://github.com/blacksmithgu/obsidian-dataview
- source snapshot: `5ad0994ff384cbb797de382e7edff2388141b73a`

Relevant files:

- `src/data-import/persister.ts`
- `src/data-index/index.ts`

## 2.1 Persistence mechanism

Dataview creates a LocalForage instance using **IndexedDB**:

```ts
name: "dataview/cache/" + appId
driver: [localforage.INDEXEDDB]
description: "Cache metadata about files and sections in the dataview index."
```

Each cached file carries:

```ts
version
time
data
```

The cache is keyed by vault file path.

## 2.2 The cache is acceleration, not canonical truth

On initial index load Dataview checks the persisted cache.

It uses cached metadata only if:

- a cache entry exists;
- its cache time is not older than the source file `mtime`;
- the cache version matches the current Dataview index version.

Otherwise it reparses/imports the actual vault file and rewrites the cache.

Dataview also exposes `reinitialize()`, which:

1. drops the entire IndexedDB cache;
2. recreates it;
3. reloads all Markdown files from the vault.

That is the key architectural fact.

Deleting the persistent cache may be expensive, but it does not destroy canonical user meaning.

## 2.3 FK lesson

Finders Keepers can safely have similarly disposable local structures for things such as:

- source lookup indexes;
- normalized text search indexes;
- annotation-to-source acceleration maps;
- rendered-measurement caches;
- search ranking data;
- derived graph/index structures.

They should not be placed into shared canonical storage merely to improve startup speed.

A local cache may contain timestamps because timestamp freshness is valid for cache invalidation.

That does **not** make timestamps canonical conflict authority.

---

# 3. Metadata Menu — IndexedDB is mainly device/workspace state, not its field definitions

Repository reviewed:

- https://github.com/mdelobelle/metadatamenu
- source snapshot: `dc244cc9d274f26226b5a3fee640b9a64b5286d7`

Relevant files:

- `src/db/DatabaseManager.ts`
- `src/db/StoreManager.ts`
- `src/db/stores/fileClassViews.ts`
- `src/components/FileClassViewManager.ts`
- `src/index/FieldIndex.ts`

## 3.1 Important correction to a superficial reading

Metadata Menu does use IndexedDB, but its current IndexedDB schema is **not the main canonical metadata index for all field definitions**.

The current `IndexDatabase` creates one store:

```text
fileClassView
```

with records of approximately:

```ts
{
    id: viewType,
    leafId: workspaceLeafId
}
```

Those records are used by `FileClassViewManager` to restore/open file-class views against specific Obsidian workspace leaves.

That is fundamentally **device/workspace persistent state**.

It should not sync.

## 3.2 The meaningful field model comes from other sources

Metadata Menu rebuilds its working `FieldIndex` from sources such as:

- vault Markdown/frontmatter;
- FileClass Markdown files;
- tags;
- paths;
- bookmarks;
- settings;
- Dataview query results where enabled.

`fullIndex()` / `indexFields()` reconstruct the working maps.

Vault and metadata events trigger re-indexing.

Therefore the large in-memory field maps are derived from canonical/user-visible inputs rather than being a single shared database that must move between devices.

## 3.3 Why this is useful for FK

Metadata Menu gives us a different precedent from Dataview:

> **Some persistent plugin state exists because the local workspace/device needs continuity, not because the logical data should be shared.**

For FK, analogous state may include:

- current local Workspace UI arrangement;
- expanded/collapsed analytical panes;
- transient local selection history if we decide it should survive restart;
- local view restoration identifiers;
- local navigator position;
- local device-specific performance state.

Do not move those into canonical shared storage merely because users appreciate restart persistence.

---

# 4. Smart Connections / Smart Environment — expensive derived state can still be non-canonical

Primary public repositories reviewed:

- https://github.com/brianpetro/obsidian-smart-connections
- https://github.com/brianpetro/obsidian-smart-env
- https://github.com/brianpetro/jsbrains

Relevant Smart Connections source snapshot:

- `0a182cffa67a52fc203f1e9ad9cc555bd4e1c8a0`

Relevant jsbrains snapshot:

- `6f25543fe1213ae93b1e0d84fd84ecfa9c1b73df`

## 4.1 What `.smart-env/` contains

Smart Environment uses a root-level hidden environment directory, commonly:

```text
.smart-env/
```

Public source/docs describe generated environment data there, including note/source indexing and embeddings.

The Smart Environment defaults place environment data under:

```text
<env_path>/.smart-env
```

and source data may include structures such as:

```text
.smart-env/smart_sources.json
```

The content can be large and computationally expensive to reproduce.

## 4.2 Smart Connections explicitly tells third-party sync users not to sync it

The Smart Connections README states that third-party sync users should add:

```text
.smart-env/
```

to ignore patterns to avoid conflicts.

The plugin also attempts to add `.smart-env` to an existing `.gitignore`.

This is a very strong architectural statement:

> Being persistent and expensive to regenerate does not automatically make state a good cross-device replicated artifact.

## 4.3 It can regenerate source-derived data

The Smart Environment / Smart Sources code includes mechanisms to:

- reload/re-import sources;
- clear source data;
- reinitialize filesystem-backed structures;
- re-import and re-embed source content.

That means the environment index has a regeneration path from the underlying source corpus.

The regeneration can be expensive. That affects UX and performance, but not canonical authority.

## 4.4 FK lesson

Finders Keepers may eventually have expensive derived structures:

- semantic search embeddings over annotations/memos;
- recommendation indexes;
- vector representations;
- clustering;
- full-text indexes;
- source-content fingerprints;
- precomputed relationship graphs.

If they can be reconstructed from canonical FK data plus source documents, the default architecture should be:

```text
local derived persistence
+
rebuild protocol
```

not:

```text
shared canonical sync
```

unless a concrete product requirement justifies sharing them.

---

# 5. The three-state taxonomy becomes more concrete

These external implementations support a strong FK classification:

## 5.1 Shared canonical durable state

Deletion means genuine user-created FK meaning is lost or relationships cannot be faithfully reconstructed.

Examples:

```text
SourceRecord
Annotation
Palette identity / custom labels
Workspace analytical structures
Codes
Sets
Memos
canonical migration/recovery evidence
```

This belongs in the dual Hidden/Visible canonical storage protocol.

## 5.2 Device-local persistent state

Deletion is inconvenient and may reset local workflow, but does not destroy shared FK meaning.

Examples:

```text
local pane/view restoration
device-local open state
local selection/navigation continuity
local performance preferences if device-specific
```

This can use device-local persistence such as IndexedDB/local app storage where suitable.

## 5.3 Rebuildable derived state

Deletion costs time/compute but can be reproduced from authoritative sources.

Examples:

```text
text/search indexes
source lookup acceleration
render caches
semantic embeddings
relationship projections
statistics caches
```

This should usually be local and rebuildable.

---

# 6. A useful decision test for every future FK persistence proposal

Before adding anything to shared canonical storage, ask:

### Question A — Is it authoritative?

If this state disappears everywhere, is user-created meaning permanently lost?

If yes, it is probably canonical/recovery state.

### Question B — Is it reconstructable?

Can exactly equivalent state be regenerated from:

- source files;
- canonical FK records;
- stable algorithms/configuration?

If yes, it is probably derived.

### Question C — Is it device-specific?

Does the state describe:

- a particular screen;
- local workspace leaf IDs;
- local tab/view continuity;
- device-specific cache/performance?

If yes, it is probably device-local.

### Question D — Is regeneration expensive?

If yes, persist locally.

Expensive regeneration does **not** by itself justify syncing.

### Question E — Does synchronization create more conflict risk than value?

If yes, keep it local even if persistence is useful.

Smart Connections is the clearest precedent for this last point.

---

# 7. Consequences for Canonical Storage Protocol v0.3

The comparator review strengthens several boundaries.

The canonical shared representation SHOULD NOT become the general dumping ground for all plugin state.

A future FK physical layout could conceptually separate:

```text
SHARED CANONICAL
<Hidden-or-Visible-FK-root>/
    stores/<storeId>/...

DEVICE LOCAL
IndexedDB / app local storage / another qualified local backend

DERIVED
local rebuildable indexes/caches
```

The exact local backend is still an implementation decision.

The important part is semantic separation.

---

# 8. A specific warning about derived state and backups

If FK exports canonical storage, derived/local state should normally be omitted.

That means:

- export size remains bounded;
- restoring an export rebuilds indexes instead of restoring stale caches;
- device-local UI state does not leak into shared canonical recovery;
- canonical backup guarantees stay understandable.

Any derived state included for performance must be clearly marked non-authoritative and discardable.

---

# 9. Bottom line

Dataview says:

> Persist a large index locally if it speeds startup, but be willing to drop and rebuild it from the vault.

Metadata Menu says:

> Persist local workspace/view continuity separately from the shared metadata it operates on.

Smart Connections says:

> Even a very large and expensive semantic index can be better treated as local derived state than as a replicated cross-device artifact when synchronization creates conflict risk.

Together they strongly support the state taxonomy Finders Keepers had already begun to develop.

The practical FK rule should be:

> **Sync meaning, not machinery. Persist local machinery when it improves experience, and make derived machinery rebuildable.**
