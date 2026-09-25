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

## Undo, source-operation recovery, and divergence

FuturePlural presents one coherent user-facing Undo history. Users must not be asked to choose between separate “Workspace Undo” and “source Undo” systems because their implementations differ. Workspace-domain mutations may use inverse deltas or other reversible application-state operations. Source mutations require durable operation/recovery records because they change user-owned notes and may be interrupted, externally edited, or synchronized while recovery is pending.

Before a source-mutating operation begins, FuturePlural must persist enough durable information to recover safely after interruption or restart. At minimum, the record must identify the intended logical operation and affected logical annotations/source targets; capture relevant before-state and expected after-state for each target; record which targets succeeded, remain pending, or failed; and retain guards/fingerprints sufficient to decide whether a target still matches the operation's expected post-state. This is a semantic requirement, not a prescribed schema or storage API. It must not default to restoring whole old files when the logical annotation/source transformation can be reversed while preserving unrelated edits in the same note.

On ordinary Undo, if all affected targets still match their expected post-state, FuturePlural must reverse the operation without unnecessary confirmation. Undo is guarded best-effort reversal, not unconditional byte restoration. If any target has diverged, FuturePlural must make no changes before asking the user. The choice must include a primary safe action to undo unchanged targets only, review of divergent targets, an explicit secondary/destructive choice equivalent to replacing later changes and undoing all anyway, and cancel. FuturePlural must not automatically undo the safe subset before asking, because divergence may affect the user's intent for the operation as a whole. Exact wording may evolve; the divergence warning must not be permanently suppressible by default.

Review may initially show a comprehensible per-target comparison of before-operation state, operation-produced state, and current state. Sophisticated merge tooling is not required. Recovery records must also make interrupted partial operations inspectable after restart and support actions equivalent to resume remaining work, revert applied work, and review partial state. A partially applied batch must not be treated as unknowable or silently restarted from the beginning.

Timestamps explain chronology; they are never authority for choosing a winner. FuturePlural must compare explicit source/operation state and guards. It must not infer that the newest timestamp is intended, overwrite later edits because a record is older, or resolve conflicts by last-write-wins ordering. This is provider-agnostic guarded recovery, not distributed Undo or a globally ordered cross-device transaction history.

The first ordinary source-mutating bulk operation may show a dismissible introductory explanation that FuturePlural stores recovery information and can normally undo the operation unless affected annotations change elsewhere afterward. This explanation is distinct from a warning for an actual detected divergence.

Bulk source maintenance follows the established safety sequence: read-only discovery, exact preview, explicit selection/confirmation, guarded per-file apply, manifest/partial-success record, resume/recovery, and verification. Source-operation recovery must fit that sequence.

## Persistence and sync

- Shared canonical source registry/catalogue, palette/semantic catalogue, and Workspace domain require durable cross-device storage validated on desktop and actual iPad/mobile, including restart and conflict behavior under the actual selected transport. Storage representation and transport are separate decisions; Obsidian Sync-specific settings are not universal requirements for vault JSON.
- Active pointer, temporary View, and history require a truly device-local vault-namespaced store validated across restart, two synced devices, retention, and isolation. Plugin config cannot be presumed local. Browser stores cannot be presumed durable.
- Source-operation recovery records are durable enough to survive restart/interruption where needed for guarded reversal; their storage location/provider behavior is not yet selected. Remote or external durable changes may invalidate or quarantine stale local Workspace history. For source Undo they are evaluated against target guards and the expected post-state, never against timestamps alone.
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

## Implementation deferral

The product/architecture decision above is settled. Its implementation is deferred until before ordinary bulk source-mutating operations ship; it does not block Slice 2A. Storage location, record schema, guard representation, retention/compaction strategy, and detailed review UI remain implementation choices, provided they satisfy the normative contract and existing persistence/platform boundaries. Source-operation records must survive restart/interruption as required for recovery, but do not establish distributed transaction ordering or sync arbitration. Workspace inverse-delta history alone is insufficient.
