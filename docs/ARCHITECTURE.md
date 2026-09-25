# FuturePlural Workspace architecture

**Status:** current approved target architecture, incorporating v0.2 and v0.2.1. Platform persistence choices remain open pending the evidence in [the Slice 0 memo](PLATFORM_DECISION_MEMO_SLICE_0.md). This document describes the target boundary, not a claim that it is implemented. B0 has not been accepted.

## Ownership boundaries

- A source adapter owns source-specific discovery, anchors, creation/edit capabilities, navigation, rendering, and reconciliation. Analytical views consume a normalized annotation projection and do not grow Markdown/PDF conditionals.
- Markdown source files own Markdown marks and ordinary footnotes. A continuous gesture is one logical annotation even when a source-safe representation needs ordered physical fragments.
- A future PDF adapter treats the PDF as the selectable source and an associated source-layer sidecar as canonical annotation storage. The PDF bytes stay untouched. A continuous cross-page gesture remains one logical annotation with ordered text segments; geometry is a versioned display hint, never identity. PDF annotations are source-owned, not Workspace-owned.
- A global canonical source catalogue owns stable `SourceRecordId` values and observations. A path is a locator, not identity. Source disappearance never deletes analytical edges.
- A vault-global palette catalogue owns stable palette-slot IDs. A separate semantic catalogue owns stable concept IDs. Assigning a slot affects future gestures; historical annotations retain their snapshots and semantic IDs.
- A Workspace owns shared durable analytical domain and Scope: Codes, Sets, Memos, and typed relations. The default Workspace is shared and usable without naming. Save As forks a new Workspace ID and starts with fresh local history; Rename is separate.
- Canvas and other presentation surfaces are projections/exports. They do not own Sets or canonical analytical relationships.
- Per-device session state owns the active Workspace pointer, temporary View, and bounded timestamped Undo/Redo. If a selected saved Workspace disappears, fall back to the shared default with an intelligible notice; do not recreate it.

## State classes and persistence boundary

| State class                     | Examples                                                                       | Authority and loss behavior                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Canonical source state          | Markdown marks/footnotes; future PDF sidecars                                  | Source adapter reads/writes with guarded source-specific behavior. No source rewrite just to open Workspace.                               |
| Shared durable domain           | Source registry, palette/semantic catalogues, Workspace domain/Scope/relations | Synced canonical state, never an evictable cache. The exact storage API/path is open until validated on desktop and iPad with actual sync. |
| Device-local persistent session | Active Workspace pointer, temporary View, bounded Workspace Undo/Redo          | Must remain device-local across restart and must not silently sync. Backend is open pending retention/isolation tests.                     |
| Transient                       | Hover, open menus, drag, unchecked selection, uncommitted search input         | Memory only.                                                                                                                               |
| Rebuildable derived state       | Search/reverse indexes, counts, candidate indexes, PDF geometry                | Rebuildable; cache loss cannot lose canonical IDs or analytical data.                                                                      |

`Plugin.loadData()` and `saveData()` read/write the plugin's whole `data.json` settings snapshot. They are suitable for modest plugin preferences, not an unbounded analytical store and not a proven device-local session store. Vault-visible JSON/API, hidden/config Adapter paths, browser localStorage, and IndexedDB have different discovery, Sync, conflict, export, and retention properties. No backend is selected in this document until the platform gate is resolved.

Keep storage representation separate from cross-device transport. The configured development vault is carried by iCloud Drive, so desktop-to-iPad evidence for that vault must test iCloud Drive. Obsidian Sync settings and conflict behavior apply only when Obsidian Sync is the selected transport; they are not universal requirements for vault JSON.

## Mutation and history boundary

Workspace mutations validate schema, revision, and base digest before committing; history records a reversible delta only after the durable mutation succeeds. Undo/Redo are new guarded Workspace mutations. A changed remote digest suspends stale history. File-level preconditions are not a distributed transaction and cannot prevent a sync provider overwriting bytes before the plugin observes them.

Markdown/PDF source edits have different write, concurrency, and partial-failure behavior. Workspace inverse-delta history does not promise to undo source edits. A user-visible recovery contract for ordinary bulk source edits is **DEFERRED** until before those actions ship; multi-file Maintenance also remains outside Workspace Undo.

## Implementation status

Slice 1 and its focused gate corrections are implemented in the working tree for human review, with B0 still pending. `src/models/annotation.ts` defines the shared ID, SourceReference, anchor and independent identity/integrity axes. The Markdown adapter parses and writes managed `data-fp-id` plus ordered `data-fp-part` wrappers, observes ordinary/managed footnotes, and supplies Markdown navigation locators. Navigator and current export/Canvas consumers project multipart marks as one logical annotation. New footnotes use collision-checked managed labels. Reading Mode now adjusts only the displayed repeated-reference text by default, retaining Obsidian's ordinal, unique occurrence anchors, hrefs and backlinks; a setting restores native repeated labels. The earlier opaque-label leak in the main note is not currently reproducible and is superseded by direct Obsidian DOM evidence. Navigator follows `workspace.getActiveFile()` as document context, including when sidebar focus persists, and derives its section state per source. External legacy observations have temporary keys, not claimed durable AnnotationIds; SourceRecordId assignment and durable cross-edit reconciliation remain Slice 2A work. Palette/semantic catalogues and persistence also remain open; the old Manager and settings-array palette are still pre-baseline UI/state. No backend or `minAppVersion` choice was made in Slice 1, and this status is not B0 acceptance.
