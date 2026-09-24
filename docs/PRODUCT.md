# FuturePlural product contracts and bounded roadmap

This is the active product reference. The historical Manager/Group backlog has been moved to `archive/PRODUCT_DECISIONS_AND_BACKLOG.md`; it is not actionable guidance.

## Interaction invariants

- One continuous marking gesture represents one annotation, even when stored as several Markdown fragments or future PDF page segments.
- Navigator, Workspace, Codes, Sets, Memos, and Canvas operate on logical annotations. Physical fragment Group/Ungroup actions are retired. Workspace Sets are analytical collections, not source-fragment grouping.
- Normal reading does not require integrity badges; identity mode and integrity remain queryable for maintenance. Explain weaker tracked-legacy identity when it affects a decision and provide unresolved/relink affordances before large-scale legacy analysis.
- External legacy markup and ordinary footnotes remain discoverable without source rewrite on Workspace open.
- Semantic Rename and palette-slot Reassign are distinct actions. Changing current palette configuration does not rewrite historical meaning.
- Source disappearance preserves analytical relationships and last-known context. Cleanup/relink is explicit.
- Scope bounds eligible material; temporary View only filters it. Selecting a Code/Set/Memo detail is not an implicit filter.
- Canvas is a projection/export, never the owner of Sets or analytical relationships.
- Device-local active Workspace, temporary View, and history may differ between devices. A missing active saved Workspace falls back to shared default with an intelligible notice.
- B0 precedes real-vault creation of valuable managed annotations and canonical substrate state. No actual-vault deployment before B0 and explicit approval.

## Approved slice order

1. **Slice 0 — repository contracts + platform spikes:** canonical docs, archives, platform decision memo. Documentation work is accepted; backend/version questions stay open and do not block Slice 1 in the dedicated dev vault. Do not resolve a storage choice silently.
2. **Slice 1 — Markdown source identity + Navigator:** shared annotation identity/adapter boundary, one-gesture ordered fragments, managed footnotes, retire Group/Ungroup, retain external legacy discovery; stop for source behavior acceptance.
3. **Slice 2A — B0 foundation:** stable palette/semantic identities and snapshots, global SourceRecordId registry, essential managed/legacy reconciliation and integrity states. Stop at explicit B0 with the full evidence set.
4. **Slice 2B — wider registry/query scaling:** bounded indexing and additional repair/scaling after B0 foundation; stop for performance/integrity review.
5. **Slice 3 — Workspace persistence + Scope + stream:** shared durable Workspace/Scope, separate View, actual source selection, lazy hydration, local active pointer and safe fallback; stop for UX/platform review.
6. **Slice 4 — local bounded history:** guarded, timestamped, byte-capped history for View and Workspace/Scope changes; stop for restart/conflict review.
7. **Slices 5–7 — Codes, Sets, Memos:** one entity/typed edge family at a time, including empty/unused/unlinked cases, timestamps, reverse relationships, and missing-source behavior; stop after each.
8. **Slice 8 — structured Canvas projection:** preview source-linked snapshots grouped by Sets and unsorted material; stop for append/snapshot review.
9. **Slice 9 — Maintenance/exit:** previewed strengthening/repair/relink/export/cleanup with guarded writes and recovery; stop before bulk mutation of real source notes.

Dependencies do not authorize implementation of later slices in the same turn. Ordinary bulk source-edit recovery remains a separate deferred review before those actions ship.

## Current implementation status

The existing plugin and tests still describe a prior Manager/Group design. They are historical PRE-BASELINE implementation evidence, not the approved target. Slice 0 does not change runtime behavior, source data, or schemas.
