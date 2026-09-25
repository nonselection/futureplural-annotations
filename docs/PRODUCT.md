# FuturePlural product contracts and bounded roadmap

This is the active product reference. The historical Manager/Group backlog has been moved to `archive/PRODUCT_DECISIONS_AND_BACKLOG.md`; it is not actionable guidance.

## Interaction invariants

- One continuous marking gesture represents one annotation, even when stored as several Markdown fragments or future PDF page segments.
- Navigator, Workspace, Codes, Sets, Memos, and Canvas operate on logical annotations. Physical fragment Group/Ungroup actions are retired. Workspace Sets are analytical collections, not source-fragment grouping.
- Normal reading does not require integrity badges; identity mode and integrity remain queryable for maintenance. Explain weaker tracked-legacy identity when it affects a decision and provide unresolved/relink affordances before large-scale legacy analysis.
- External legacy markup and ordinary footnotes remain discoverable without source rewrite on Workspace open.
- In Reading Mode, repeated visible references to one footnote show its Obsidian base/document-order number by default; a setting restores Obsidian's native repeated-reference labels. Occurrence anchors and backlinks remain distinct. FuturePlural does not renumber footnotes generally.
- Navigator previews show compact human-readable text, including text within inline formatting. Managed footnote IDs stay internal; zero-reference definitions remain visible with an unreferenced status.
- Navigator follows the Markdown document occupying the main/root workspace, resolved from `workspace.getMostRecentLeaf(workspace.rootSplit)`, including when a sidebar owns keyboard focus. It does not follow File Explorer selection, active editor/leaf, or the global `getActiveFile()` fallback. An empty/non-Markdown root leaf clears the source. A newly active source initializes section expansion from its contents: only populated sections expand when exactly one kind is present, and both expand when both or neither are present. Manual collapse persists while that note remains the source; layout changes with the same source do not reset it.
- Semantic Rename and palette-slot Reassign are distinct actions. Changing current palette configuration does not rewrite historical meaning.
- Source disappearance preserves analytical relationships and last-known context. Cleanup/relink is explicit.
- Scope bounds eligible material; temporary View only filters it. Selecting a Code/Set/Memo detail is not an implicit filter.
- Canvas is a projection/export, never the owner of Sets or analytical relationships.
- Device-local active Workspace, temporary View, and history may differ between devices. A missing active saved Workspace falls back to shared default with an intelligible notice.
- Undo is one coherent user-facing history across Workspace and source mutations. Source-operation recovery details and divergence choices are specified in [Contracts](CONTRACTS.md#undo-source-operation-recovery-and-divergence); users are not asked to choose between separate Undo systems.
- B0 precedes real-vault creation of valuable managed annotations and canonical substrate state. No actual-vault deployment before B0 and explicit approval.

## Approved slice order

1. **Slice 0 — repository contracts + platform spikes:** canonical docs, archives, platform decision memo. Documentation work is accepted; backend/version questions stay open and do not block Slice 1 in the dedicated dev vault. Do not resolve a storage choice silently.
2. **Slice 1 — Markdown source identity + Navigator:** accepted 2026-09-25 after human validation of identity behavior, root-workspace source context, Rough Notation lifecycle, and current/legacy rendering.
3. **Slice 2A — B0 foundation:** not started. It covers stable palette/semantic identities and snapshots, global SourceRecordId registry, and essential managed/legacy reconciliation and integrity states. Stop at explicit B0 with the full evidence set.
4. **Slice 2B — wider registry/query scaling:** bounded indexing and additional repair/scaling after B0 foundation; stop for performance/integrity review.
5. **Slice 3 — Workspace persistence + Scope + stream:** shared durable Workspace/Scope, separate View, actual source selection, lazy hydration, local active pointer and safe fallback; stop for UX/platform review.
6. **Slice 4 — local bounded history:** guarded, timestamped, byte-capped history for View and Workspace/Scope changes; stop for restart/conflict review.
7. **Slices 5–7 — Codes, Sets, Memos:** one entity/typed edge family at a time, including empty/unused/unlinked cases, timestamps, reverse relationships, and missing-source behavior; stop after each.
8. **Slice 8 — structured Canvas projection:** preview source-linked snapshots grouped by Sets and unsorted material; stop for append/snapshot review.
9. **Slice 9 — Maintenance/exit:** previewed strengthening/repair/relink/export/cleanup with guarded writes and recovery; stop before bulk mutation of real source notes.

Dependencies do not authorize implementation of later slices in the same turn. The product decision for source-operation Undo/recovery is settled; its implementation is deferred until before ordinary bulk source-mutating operations ship. This implementation deferral does not block Slice 2A.

## Current implementation status

Slice 1 was accepted by the human on 2026-09-25. Acceptance passed after a clean Obsidian restart and repeated tab switching, sidebar focus changes, closure with deliberately mismatched MRU ordering, sidebar collapse/expand, Reading/Live Preview/Source transitions, and current/legacy annotation rendering. The Rough Notation lifecycle correction and root-workspace source resolver both passed retesting. Slice 2A has not started. New Markdown marks use one managed ID across ordered physical parts, and Navigator no longer offers physical Select/Group/Ungroup. Navigator projects plain previews, shows managed unreferenced footnotes without exposing IDs, initializes sections for each source, and resolves source from the root workspace's most-recent Markdown leaf on workspace events including `layout-change`. Reading Mode normalizes repeated native footnote reference labels by default with a native-display option; Markdown labels and links are unchanged. Rough Notation skips unmeasurable hidden targets and retries bounded attachment on reveal while retaining its seeded instances. External legacy remains discoverable without opening or rewriting source. Source registry/reconciliation, palette identities and persistence, iPad/iCloud evidence, and an evidence-based minimum version remain open. Do not treat Slice 1 acceptance as B0 acceptance.

The source-edit Undo/recovery product contract is settled: FuturePlural presents one coherent user-facing Undo history; guarded durable source-operation records support safe reversal, divergence review/choice, and interrupted-operation recovery. The engineering mechanism remains implementation-deferred until before ordinary bulk source-mutating operations ship. The normative details are in [Contracts](CONTRACTS.md#undo-source-operation-recovery-and-divergence); this work does not block Slice 2A and does not promise distributed Undo.
