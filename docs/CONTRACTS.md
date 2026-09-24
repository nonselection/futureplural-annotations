# FuturePlural Workspace contracts

These contracts are the approved v0.2 + v0.2.1 baseline and final handoff clarifications. They describe the target behavior; they do not claim implementation or B0 acceptance.

## Annotation identity and integrity

- Every continuous marking gesture creates one logical `AnnotationId`. Markdown may represent it with several ordered physical parts. A future PDF selection may have several ordered text segments across pages. Navigator, Workspace, Codes, Sets, Memos, and Canvas see one annotation.
- `AnnotationId` is opaque and stable. `SourceReference` carries a stable `SourceRecordId`; paths are locators. Source-specific anchors and capabilities stay behind adapters.
- `identityMode` is `managed | tracked-legacy`. `integrity` is exactly `resolved | degraded | ambiguous | missing`. The axes are independent and queryable. `problematic` is never an enum value.
- `identityMode` describes where durable logical identity is carried. Verified strengthening may transition `tracked-legacy + resolved → managed + resolved` while preserving the same AnnotationId and analytical edges. If confident reconciliation establishes continuity after an external edit removed an ID or changed a generated footnote label, it may transition `managed + resolved → tracked-legacy + resolved` with the same AnnotationId. Partial loss requires assessing surviving carriers; it does not automatically downgrade the mode.
- Source disappearance alone changes neither identity mode nor relationships; a managed annotation may be `managed + missing`. Ambiguous candidates never inherit analytical edges silently.
- Preserve bounded last-known excerpt, source title/path, kind, context when useful, and observation time for missing annotations. Relinking, cleanup, and collision resolution are explicit operations. Source deletion never cascades to analytical relations.
- Tracked-legacy input remains discoverable and may participate in Code assignment, Set membership, and Memo links. Explain weaker identity when it matters and provide unresolved/relink affordances before large-scale legacy analysis.

## Source adapter contracts

- Adapters own markup/footnote/PDF locators, supported gestures, create/edit capabilities, navigation, rendering, and reconciliation. Shared analytical code uses normalized records, not scattered source-type branching.
- Preserve external `==highlights==`, older/external `<mark>` syntax, recognizable third-party annotations, and ordinary Markdown footnotes without rewriting source merely to discover them.
- New managed footnotes use ordinary Markdown labels that encode an opaque AnnotationId and are collision-checked against both definitions and references in the source file. One definition may have zero or many references. Duplicate definitions are integrity conflicts. Existing external labels are not renamed except through separately previewed, explicit strengthening.
- Future PDF annotations refer to the PDF as source and use a canonical source-associated sidecar; never modify PDF bytes. One gesture may cross pages and creates one ID with one or more ordered segments. Quote/context and selection evidence aid resolution; geometry is derived/versioned display state, never identity. PDF belongs to no Workspace.

## Palette and semantic identity

- Palette-slot identity and semantic-concept identity are different stable IDs. Names and colors do not define identity.
- New annotations capture the selected palette ID, exact display-color snapshot, semantic ID and optional label snapshot, notation, and opacity. Historical meaning is not inferred or rewritten from current slot settings.
- Renaming a concept changes its display name and preserves its ID. Reassigning a palette slot changes only future gesture association. Historical annotation semantic IDs remain unchanged. Notation, color, and semantic meaning are independent.

## Workspace and typed relations

- Workspace durable domain and Scope are shared. The default is shared and unnamed. Save As forks under a new Workspace ID with fresh local history; Rename is separate.
- Temporary View, timestamped bounded history, and active Workspace pointer persist per device and do not silently sync. If the active saved Workspace disappears, use the shared default and show a non-destructive notice; never recreate the missing Workspace.
- Sets contain annotations, not Codes. Codes, Sets, and Memos do not own source annotations. Empty Sets, unused Codes, and unlinked Memos are valid. Memos may link to annotations, Codes, and Sets; reverse links are derived. Canvas is a projection, never canonical relationship state.
- Code, Set, and Memo have stable IDs, `createdAt`, and `updatedAt`. `updatedAt` changes only for that entity's own mutable fields. Assignment, membership, and Memo-link edges have their own `createdAt` and do not update endpoint timestamps.
- Scope controls eligible material; temporary View only filters the table. Out-of-scope relations are retained. Selecting a Code/Set/Memo detail does not itself filter the stream.
- Source loss does not delete edges. Preserve bounded recovery context and provide explicit relink/cleanup. Invalid schemas and conflicts stay visible and recoverable. Canonical user data is never an evictable cache.

## Persistence and sync

- Shared canonical source registry/catalogue, palette/semantic catalogue, and Workspace domain require durable cross-device storage validated on desktop and actual iPad/mobile, including restart and conflict behavior under the actual selected transport. Storage representation and transport are separate decisions; Obsidian Sync-specific settings are not universal requirements for vault JSON.
- Active pointer, temporary View, and history require a truly device-local vault-namespaced store validated across restart, two synced devices, retention, and isolation. Plugin config cannot be presumed local. Browser stores cannot be presumed durable.
- Vault/API write preconditions protect a single observed file operation, not a vault-wide or cross-device transaction. Sync conflict behavior and backup/export implications must be explicit before backend selection.
- Keep Node/Electron runtime dependencies out of mobile code paths. SQLite and speculative database/event-sourcing infrastructure are not approved.

## B0 compatibility baseline gate

B0 is one explicit acceptance gate after Slice 0, Slice 1, and required foundational work from Slice 2A. It requires evidence together for:

1. Stable AnnotationId and ordered multipart one-gesture Markdown creation, rendering, editing/navigation as relevant, round trips, and external edits.
2. Collision-safe managed footnote labels/identity, including zero/multiple references and duplicate definitions.
3. Stable palette-slot and semantic-label IDs, snapshots, Rename vs Reassign, and historical filtering.
4. Persisted SourceRecordIds and canonical legacy registry; confident source-edit continuity, collisions, missing context, both identity-mode directions, and explicit coverage of `managed | tracked-legacy` and each integrity value: `resolved | degraded | ambiguous | missing`.
5. Chosen canonical storage/API proven on desktop and actual iPad/mobile, with relevant restart and actual sync tests; source registry and palette/semantic catalogue persistence already proven. Session-store feasibility is investigated in Slice 0 and may be implemented later where not required by the annotation substrate.
6. External legacy discovery without forced migration; parser/malformed-input behavior checked; no valuable source rewrite merely from opening Workspace.

At acceptance record actual build ID, schema versions, date, platforms, storage decisions, and proof in repository docs. Do not claim B0 by implication. Actual-vault creation/deployment still requires explicit human authorization.

## Explicitly deferred

Before ordinary bulk source-annotation edits ship, define a user-visible recovery/Undo contract for partial failure, restart, checked source versions, and restorable scope. Workspace inverse-delta history is not source-edit Undo. Multi-file Maintenance stays outside Workspace Undo. This decision is deferred and does not block B0 or initial Workspace slices.
