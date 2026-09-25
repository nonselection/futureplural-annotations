# FuturePlural decisions and open questions

Dates use ISO format. Approved target contracts are in [CONTRACTS.md](CONTRACTS.md); this log records settled decisions, platform questions, and explicit deferrals. No B0 acceptance record exists yet.

## Settled by approved v0.2 / v0.2.1

- **2026-09-24 — Workspace and source ownership.** Shared default Workspace; Save As forks a new ID with fresh local history; Rename is separate. Source annotations belong to sources, not Workspaces. Missing sources do not cascade-delete analytical relations.
- **2026-09-24 — Identity axes.** `identityMode` and `integrity` remain orthogonal, with same-ID bidirectional managed/tracked-legacy transitions only when continuity is established. Four integrity values are `resolved`, `degraded`, `ambiguous`, `missing`; `problematic` is informal shorthand only.
- **2026-09-24 — Legacy participation.** Recognizable external legacy markup and ordinary footnotes remain discoverable without forced rewrite and may participate in analysis under tracked-legacy identity.
- **2026-09-24 — Managed footnotes.** New labels are ordinary Markdown, collision-checked, and carry managed AnnotationId identity; one definition may have zero/many references. External labels remain unchanged absent explicit previewed strengthening.
- **2026-09-24 — Palette semantics.** Palette slots and semantic concepts have separate stable IDs. Rename preserves concept ID; slot reassignment changes future gestures, not historical annotations.
- **2026-09-24 — Device-local session.** Active Workspace pointer, temporary View, and bounded timestamped Undo/Redo are per device; missing active Workspace falls back to shared default with a notice and is never recreated.
- **2026-09-24 — Source adapter/PDF fitness.** Adapters own source-specific behavior. Future PDF remains an immutable selectable source with canonical sidecar, ordered cross-page text segments, and no Workspace ownership; no PDF implementation is approved in these slices.
- **2026-09-24 — Time and edges.** Code/Set/Memo `updatedAt` changes only when the entity's own fields change; typed relations carry their own `createdAt`.
- **2026-09-24 — Slice 0 human review and sequencing.** Slice 0 documentation/platform work is accepted with desktop CLI/sandbox, transport, and sequencing corrections. Unresolved canonical storage, local-session storage, `minAppVersion`, iPad behavior, and two-device conflict behavior remain open but do not block Slice 1 in the dedicated dev vault. If Slice 1 depends on an open choice, stop for review. B0 remains pending and still requires actual desktop↔iPad evidence using the configured iCloud Drive transport.
- **2026-09-24 — Slice 1 footnote reference presentation.** Human testing did not reproduce the earlier opaque managed-label leak in the main Reading Mode note; that screenshot interpretation is superseded. Real Obsidian 1.13.7 DOM did reproduce repeated native labels such as `[2-1]`. Default FuturePlural display now shows the same base ordinal for all references to one footnote, with an option to restore native labels. Only visible reference text changes; generated Markdown labels, distinct occurrence anchors, hrefs, and backlinks remain Obsidian-owned and unchanged. FuturePlural is not a general footnote-renumbering engine.
- **2026-09-24 — Slice 1 Navigator gate corrections.** Compact previews project human-readable text, managed zero-reference footnotes show status without an opaque ID, and section expansion is derived anew on a document-source change. Human host traces showed that sidebar focus can retain `activeLeaf` while `getActiveFile()` advances on `layout-change`; Navigator therefore reconciles document context from `getActiveFile()` on that event, clears on null, and skips unchanged-source rerenders. File Explorer selection and section collapse do not control source refresh. No delay, polling, focus change, annotation identity change, or storage decision is involved.

## Evidence-driven open decisions

- **2026-09-24 — Shared canonical storage.** Exact vault-visible JSON/API versus hidden/config Adapter location is unresolved until desktop+iPad and actual two-device behavior under the chosen transport, file visibility, conflict/write preconditions, and backup/export behavior are tested. Current dev-vault transport is iCloud Drive. Do not implement a contested choice silently. Obsidian Sync settings are provider-specific compatibility evidence only.
- **2026-09-24 — Device-local persistent session store.** Browser localStorage (including Obsidian's vault-scoped helpers) versus IndexedDB remains open until retention across restart, vault/device isolation, eviction/reset behavior, and actual two-device non-sync are verified on desktop and iPad.
- **2026-09-24 — `minAppVersion`.** Existing manifest says 1.7.2; installed desktop is 1.13.7; package declarations are 1.13.1. Do not infer a tested floor from these facts. Complete runtime API and real desktop+iPad validation before changing the manifest.

## Deferred

- **2026-09-24 — Ordinary source-edit recovery/Undo.** Before bulk source annotation edits ship, define and test user-visible recovery for checked versions, partial failure, restart, and restorable scope. No source-operation manifest or separate mechanism is selected. Workspace inverse-delta history does not promise source-edit Undo; multi-file Maintenance is outside it.

## B0 acceptance record

**Pending.** On explicit acceptance, record build identifier, schema versions, date, validated desktop/iPad versions, storage decisions, and evidence here. Slice 0 or Slice 1 alone cannot pass B0.
