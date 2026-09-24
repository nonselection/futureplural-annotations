# FuturePlural Workspace architecture — revision v0.2

**Status:** proposed for product/engineering review, 24 September 2026. **No Workspace implementation, source migration, or repository documentation edit is authorized by this proposal.** This is a revision of `docs/WORKSPACE_ARCHITECTURE_PROPOSAL_v0.1.md` in the repository; its current-state audit and the external-legacy/pre-baseline distinction still apply unless explicitly amended below. The interface sketch is an interaction baseline, not a UI specification. On approval, a separate local implementation thread will receive a handoff prompt; this architecture thread will not implement it.

## 1. What changes from v0.1

| Concern | v0.1 | v0.2 recommendation |
| --- | --- | --- |
| Annotation source | Primarily Markdown wrappers/footnotes with a possible companion Markdown PDF note | Global logical AnnotationId and SourceRecordId; source-specific Markdown mark, Markdown footnote and future PDF adapters. PDF itself is a selectable source, its sidecar is storage. |
| Palette semantics | Stable palette ID proposed; semantic meaning treated as current slot metadata | Separate stable palette slot and semantic-label identities; annotations snapshot actual color and semantic association at creation. |
| Legacy strengthening | Registry and managed identities considered separately | Strengthening/relinking preserves the same AnnotationId where continuity is established; no reassignment of Codes/Sets/Memos. |
| Workspace persistence | One synced file including View/history provisionally proposed | Synced durable domain/Scope separated immediately from verified device-local persistent View/history. No cross-device Undo. |
| Analytical schema | Entities without time metadata, relationships as bare tuples | Code/Set/Memo have createdAt/updatedAt; typed unique edges carry createdAt, without an event-sourcing framework. |
| Missing source | Relations retained; missing ID could be opaque | Global last-known observation plus minimal fallback per referencing Workspace so missing excerpts remain identifiable. |
| Footnotes | Opaque label recommended, awaiting decision | Generated collision-checked label encodes managed AnnotationId; 0..many references per definition. |
| Minimum app | 1.7.2 declaration questioned | Establish an honest tested desktop/mobile floor; 1.13.0 is a preliminary lower bound for the existing declarative settings API, subject to implementation API inventory. |
| Documentation | Proposal and warning atop stale backlog | Local worker should establish an indexed current contract, decision log, and archive superseded operational plans as an early explicit task. |

The audited repository still has positional `Highlight.id`, overloaded `data-fp-group`, palette `{color, meaning}` by array index, a full-vault Markdown-only `VaultScanner`, numeric new-footnote labels, and a single `data.json` for current settings/reading positions/Canvas associations. These are implementation facts, not the proposed domain. Current Navigator grouping selection has no other identified legitimate local use, so remove its selection machinery when replacing grouping. Existing plugin-created development data and old Manager state are disposable; **external legacy** Markdown/HTML/footnotes are not. Once new managed IDs are used for actual reading, establish the post-baseline compatibility obligation.

## 2. Source and identity domain

### Logical model

```ts
type AnnotationId = string; // globally opaque; independent of storage and path
type SourceRecordId = string; // vault-wide identity for a source asset

type SourceReference = {
  sourceId: SourceRecordId;
  kind: 'markdown' | 'pdf'; // extensible by a future EPUB adapter
  lastKnownPath: string;   // locator, never the identity
};

type Anchor =
  | { type: 'markdown-mark'; parts: Array<{ partId: string; order: number; locator: RangeHint }> }
  | { type: 'markdown-footnote'; label: string; definition: RangeHint;
      references: RangeHint[] }
  | { type: 'pdf-text'; page: number; quote: string; prefix?: string;
      suffix?: string; selectionHint?: unknown; cachedGeometry?: unknown };

type LogicalAnnotation = {
  id: AnnotationId;
  source: SourceReference;
  anchor: Anchor;
  kind: 'visual' | 'footnote';
  visual?: { notation: NotationType; bracketSide?: string;
    paletteId: string | null; displayColorSnapshot: string | null;
    semanticLabelId: string | null; semanticLabelSnapshot?: string;
    opacity?: number };
  createdAt: string | null;
  updatedAt: string | null;
  firstSeenAt?: string; // observation, never substituted for true creation
  integrity: 'resolved' | 'degraded' | 'ambiguous' | 'missing';
  lastKnown: { excerpt: string; sourceTitle: string; sourcePath: string;
    kind: 'visual' | 'footnote'; context?: string; observedAt: string };
};
```

This is a **domain/read contract, not a promise to serialize all fields in one record**. Source adapters own locating, parsing, reading, write capability and integrity evidence. Code/Set/Memo/Workspace/Canvas see only annotation ID, source identity and normalized query fields. A Markdown visual annotation can have ordered physical `<mark>` fragments sharing `data-fp-id`, each with a distinct `data-fp-part`, but this representation does not define what *annotation* means. One gesture produces one logical ID. A mark-derived footnote and its mark are separate annotation objects if both are intentionally exposed, never a footnote comment hidden inside the mark.

A future PDF-backed annotation is source-owned but stored in a canonical source-associated sidecar; it belongs to no Workspace. Its `SourceReference` names the **PDF**, not the sidecar. The PDF is never modified. Anchor quote/page/context and PDF.js selection hints are durable evidence; geometry is derived or a versioned hint and must be re-resolved at render zoom/layout. Failure to resolve precisely is visible, not silently attached to a nearby phrase. A portable exit for PDFs means exporting sidecar records/anchors and source links; uninstalling necessarily removes the SVG overlay, so the original PDF alone cannot preserve the visual annotation. This is a genuine limitation of the nonintrusive PDF model and must eventually be explained to users.

A SourceRecordId lives in a global canonical source catalogue; for PDF, its sidecar also carries that ID and a file fingerprint. Track observed paths and rename/move events. A content hash helps verify an independently moved PDF but cannot uniquely identify two identical PDF copies: allocate distinct SourceRecordIds and request review when a lost path yields multiple equally plausible assets. Hash in bounded/background work, cached by size/mtime with verification where needed; never hash every PDF at startup. Markdown source association can reconcile from vault events, path history, embedded managed IDs and fingerprints without forcing frontmatter onto notes merely to open Workspace. Loss of a source catalogue must have explicit recovery behavior rather than pretending path identity is stable.

### Footnote contract

Generate new references/definitions as ordinary Markdown `[^fp-<opaque-id>]`, where the opaque suffix encodes the same global AnnotationId; choose an ASCII-safe, collision-resistant alphabet and check *both labels and references within that Markdown file* before insertion. A gesture initially makes one definition and one reference. Parsing permits one definition with **zero or many observed references**; duplicate definitions for one label are an integrity conflict, not two identities. Product policy may show only referenced footnotes in the normal stream, while maintenance still discovers unreferenced definitions. Existing external labels are unchanged, assigned registry identity and reconciled conservatively. A user-renamed managed label is not automatically treated as a new footnote when evidence supports continuity, but uncertain cases need explicit relinking. A legacy footnote strengthened on request can rename its definition and all file-local references in one guarded file transformation to encode its *existing* AnnotationId; review references/ambiguities first. No source mutation solely because Workspace opens.

### Identity strengthening and conflict handling

For an observed legacy `==...==` assigned A123, a later user-approved conversion to `<mark data-fp-id="A123">...` retains A123. Code assignments, Set memberships and Memo links therefore require no foreign-key migration. The same holds for a user-confirmed relink of a missing source to the *same underlying annotation*. Exceptions: two competing source annotations already claim A123; the candidate is demonstrably a different annotation; or a user explicitly chooses duplicate/copy-as-new. In those cases quarantine and preview which occurrence retains A123; allocate a fresh ID only to a confirmed distinct object. Never silently merge two actual annotations or transfer analytical relationships to the wrong text.

A managed Markdown ID with coherent ordered parts in one source is one annotation. Copied markup reusing the ID in another location/file, conflicting part IDs/metadata, and lost fragments become degraded or ambiguous observations. Surviving parts can still display with an integrity warning. External edits, deletion and source move update observations but never automatically cascade-delete Workspace edges or rewrite a user's note. A missing annotation retains bounded last-known excerpt, last-known title/path, kind, context when helpful, first/last observed time and status. Keep a global last-known registry observation for all referenced annotations, and a small fallback snapshot alongside each Workspace's references/export so even a lost registry does not reduce a relation to a bare UUID. These copies are **recovery/context**, not competing canonical source text; refresh them opportunistically after confirmed reconciliation. Protect excerpts as user content in backup/export; cap *per-record context length*, not the number of user records. Caches can be rebuilt; registry-only IDs cannot be losslessly regenerated after losing every canonical registry copy.

## 3. Palette and semantics

A vault-global, cross-device durable palette catalogue contains about 15 stable slot IDs, current colors and an optional association to a semantic-label ID. A separate semantic catalogue contains stable IDs, current display names and optional description/retired state. Multiple palette slots may point to the same semantic ID. Semantic labels are **neither Codes nor merely current palette metadata**. Names are editable; IDs are not inferred from names or hex values. Do not delete a semantic record while historical annotations still reference it: retire/hide it from new gestures, with history accessible in filters/maintenance. Empty semantic association is valid.

On gesture, capture `paletteId | null`, exact `displayColorSnapshot`, `semanticLabelId | null` and optional last-known semantic display text, plus notation and opacity. Markdown marks carry enough portable attributes and inline color to preserve visible appearance and stable semantic ID; PDF sidecars carry the equivalent. The catalogue provides current names, not retroactive reassignment. If slot 03 switches from Question (S1) to Contradiction (S2), earlier annotations remain S1 and newly created ones get S2. Renaming S1 to Open question changes its current displayed name across history without changing S1. Explicit historical relabel/recolor is a previewed source-editing operation, outside changing palette settings. Filtering by palette slot, saved color, or semantic ID are distinct queries; semantic and notation type remain independent. Legacy markup without reliable IDs keeps observed color/text, with unknown semantic ID: never manufacture history by mapping its hex to a current palette slot.

**Engineering issue to surface:** `data.json` settings may not reliably sync across devices, while these semantic identities must. Therefore the palette/semantic catalogue belongs in vault-shared canonical state (or another backend proven to sync), not exclusively in the present plugin settings snapshot. Keep UI preferences in plugin settings. If the palette catalog is unavailable, the snapshot label and exact color help explain old marks without guessing their new semantics. Duplicate display names are not identity collisions; prefer offering reuse of an existing semantic record when assigning a slot, and visually distinguish same-named distinct records rather than silently merging them.

## 4. Analytical domain

Each Workspace has opaque WorkspaceId, schema version, durable revision/content digest, name (optional for the default), Scope, Codes, Sets, Memos and typed relations. The shared default Workspace is usable without naming. **Save As forks** current durable domain/Scope under a new ID with fresh local history; Rename is separate. Optional provenance `forkedFrom` is metadata, not shared state. Deleting or switching Workspaces never deletes source annotations or PDF sidecars. The currently active Workspace pointer should be **local per device**: independent devices can pursue different work in the same vault, while the default and saved analytical contents sync. If absent, open the shared default. This is a recommendation requiring product review, not a hidden decision.

Codes/Sets/Memos each have `id`, display fields, `createdAt`, `updatedAt`. An empty Code/Set and an unlinked Memo remain valid. Treat edges as small typed records with composite-key uniqueness:

```ts
type CodeAssignment = { annotationId: AnnotationId; codeId: CodeId; createdAt: string };
type SetMembership = { annotationId: AnnotationId; setId: SetId; createdAt: string };
type MemoLink = { memoId: MemoId; target:
  { kind: 'annotation'; id: AnnotationId } |
  { kind: 'code'; id: CodeId } |
  { kind: 'set'; id: SetId }; createdAt: string };
```

An edge's `createdAt` is when *that relation* was committed as known by FuturePlural; not historical source-annotation time and not a full audit trail. No synthetic edge ID, events or edge-updatedAt until relations themselves gain mutable attributes. A merge that creates a new target relation records the merge time; an already-existing target edge keeps its existing creation time. Preview reassignment/dedup and preserve the source Code's definitions until the merge transaction commits. Treat times as descriptive UTC dates, **not** ordering or sync-conflict authority: devices' clocks can differ. Inverse indexes and “Codes represented by annotations in Set X” are derived. Scope controls eligibility, never erases out-of-scope edges; temporary View filters cannot expand beyond Scope. Selecting a Code/Set/Memo detail does not itself filter the stream.

## 5. Persistence and device boundaries

| Class | Canonical meaning | Candidate persistence and behavior |
| --- | --- | --- |
| Source annotations | Markdown source markup/footnotes; future PDF source-linked sidecars | Sync with vault; no Workspace ownership. Sidecar is canonical for PDF overlays, source PDF bytes unchanged. |
| Shared durable state | Source registry/catalogue, palette/semantic catalogue, per-Workspace domain/Scope/relations | Small vault-global catalogue plus lazily loaded per-Workspace files and bounded source-registry shards; chosen storage API/path only after desktop+iPad/sync spike. |
| Local persistent session | Active Workspace pointer, per-Workspace temporary filters/sort/context/pane state, timestamped bounded Undo/Redo | Verified device-local, vault-namespaced store; **never** accidentally put this in a path synced with plugin config. May be lost/reset safely if local storage is cleared. |
| Truly transient | Hover, open menus, active drag, scan progress, unchecked selection, uncommitted search keystrokes | Memory only; no persistence/history. |
| Rebuildable | Search and reverse indexes, counts, reconciliation candidate indexes, PDF geometry caches | Memory first; add IndexedDB only when measured. Cache loss triggers bounded rebuild, not analytical data loss. |

`Plugin.loadData()`/`saveData()` are whole-snapshot helpers for plugin `data.json`, appropriate for existing modest settings and lightweight preferences, **not** an unbounded synced analytical database or a guaranteed local-session store. IndexedDB can be considered for *local session persistence* if its isolation, lifetime and behavior on desktop/iPad are verified. This differs from putting irreplaceable synced Codes in IndexedDB. `localStorage` is another bounded local-session candidate, but synchronous/quota limits make it unsuitable for large histories; do not pick solely by familiarity. Obsidian plugin-config files may sync and therefore cannot be assumed device-local. The platform spike must test local-session retention across restart, independence across two synced devices, vault namespacing, backup/privacy behavior and eviction. If no supported reliable device-local store satisfies the requirement, surface that limitation before implementing Undo; do not silently sync it.

**Durable store choice remains conditional.** Prefer separate vault-side canonical files if the Vault API can discover/process them on both desktop and iPad and actual sync settings move them; a hidden vault directory requires Adapter API and its different write guarantees. Obsidian Sync may exclude `.json` unless additional file types are enabled. The serious alternative is config-directory Adapter files with explicit sync/export caveats; neither backend is selected until a real-app two-device spike. Put the storage details behind `WorkspaceStore`, `SourceRegistryStore`, `PaletteStore`, `LocalSessionStore`. A small rebuildable catalogue enumerates Workspace IDs/paths and source record shards; never let a lost catalogue erase canonical objects. No SQLite/Postgres; no Node/Electron dependency on the mobile code path. Explicit Saved Views, if later introduced, are **durable synced analytical objects**, separate from ordinary temporary View state.

**Durable transaction and history boundary:** one Workspace domain mutation validates current schema/revision *and base digest* and commits with an optimistic precondition (`Vault.process()` when an actual visible `TFile`; Adapter needs a tested serial queue/recheck/recoverable strategy). Only after success record its reversible local history delta. A crash between those writes may lose *that Undo entry*, but cannot record an Undo for an uncommitted domain action. Persist session updates atomically within the local store if possible. Undo/Redo of a domain action is a **new guarded durable mutation**, with inverse delta and per-entity preconditions, not a rewind of a file revision number. Track the local timeline's most recent durable content digest and update it after each successful local forward/undo/redo operation; mere integer revision guards cannot detect concurrent same-revision branches. If external sync changes the durable digest unexpectedly, suspend stale domain Undo/Redo rather than replay it. Conservatively reset or quarantine the mixed local timeline; retain the temporary View only if its references still resolve, with visible explanation. That means cross-device changes can clear local Undo availability, an explicit product limitation. A sync provider can overwrite bytes before plugin observation; file-level checks are not a distributed transaction or a substitute for backup/conflict copies.

Bound local history to about 20 meaningful entries plus a byte cap; labels and timestamps are mandatory, redo branch discarded after a new action from an earlier cursor. Persist committed View filter/sort/context changes and durable Scope/domain actions, not every search keystroke, scroll, pane open or temporary multi-selection. Coalesce memo typing and filter edits into meaningful commit boundaries. View-only actions do not rewrite synced domain files. Source Markdown/PDF sidecar transformations and multi-file maintenance are outside Workspace Undo, with their own preview/recovery. Saved Workspace switch/Save As are outside the active Workspace history. Avoid huge snapshots: store affected before/after deltas and validate schema and relationships on replay. On local session loss, current durable domain remains intact; Undo disappears honestly.

Defer full-vault work until needed: Navigator parses its active note; Workspace opens its selected durable state and catalogue, then progressively indexes eligible sources with bounded batches and scan progress after layout readiness. A new Scope based on tags/properties may require a baseline vault walk. Vault create/modify/rename/delete events invalidate one source's observations and dependent indexes, with rescan and manual reconcile for missed events. For future PDFs, watch PDF and associated sidecar independently and keep SourceRecordId stable on rename. Clamp per-action parsed bytes, affected annotations/fragments/files, writes and preview size; **never evict canonical records or silently truncate results**. Window the stream. Avoid eager hashing or loading all saved Workspaces. Official guidance recommends `Vault.process()` for background read-modify-write and keeping `onload` light; it does not guarantee multi-file or cross-device atomicity. [Obsidian Vault documentation](https://docs.obsidian.md/Plugins/Vault).

## 6. Maintenance, missing records, exit

Annotation Maintenance remains separate from everyday Code/Set/recolor actions. Discovery is read-only; preview shows exact source/sidecar changes and unresolved cases; confirmation precedes guarded per-file application; progress manifest records partial success and supports idempotent resume and checked backup/inverse where feasible. Strengthening a legacy annotation preserves its AnnotationId; missing-source relinking retains the ID only when the user confirms sameness. Preserve broken links and small recognizable fallback excerpts until explicit cleanup. If source markup conflicts with registry observation, do not overwrite either blindly. PDF anchor repair later uses the same integrity workflow but cannot depend on Markdown offsets or generic regex.

Export human-readable Markdown and machine-readable Workspace data, source registry and PDF sidecars with their IDs, schema and relationship references. A clean-exit operation previews stripping plugin attributes from `<mark>` while preserving portable text/color/markup, keeps regular footnotes intact, and explains that non-highlight Rough Notation geometry requires the plugin and cannot be perfectly preserved as ordinary HTML. PDF overlays similarly need the exported sidecar or a deliberate format conversion in a future product; removing the plugin leaves the original PDF intact but loses the overlay. Never delete source material automatically on uninstall. Once post-baseline managed data exists, schema migrations need versioned reads, recoverable backup, idempotent transforms and read-only behavior on unknown future schemas. Pre-baseline `data-fp-group` compatibility work remains unnecessary.

## 7. Minimum supported Obsidian version

`manifest.json` currently says `1.7.2`; the project compiles against `obsidian ^1.13.1` and implements `getSettingDefinitions()` while maintaining a second imperative `display()` for older versions. Obsidian's current declarative-settings guide treats 1.13.0 as the clean declarative floor. **Provisional minimum: 1.13.0**, subject to an inventory of *every actual runtime API and rendering behavior* adopted in the first implementation slices and desktop+iPad validation at the selected floor. If any required API/behavior first works later, raise the declared minimum rather than ship a false guarantee. Do not assume the npm type package version itself establishes a runtime minimum. Keep `isDesktopOnly: false`; audit dependencies for Node/Electron and unsupported mobile browser features. The local worker can remove the duplicate older-settings path only after the minimum has been validated. If the version test cannot be run on a given device, publish only the lowest version actually demonstrated to work, or use the current stable version rather than an untested historic number. [Obsidian manifest](https://docs.obsidian.md/Reference/Manifest); [declarative settings guide](https://docs.obsidian.md/plugins/guides/migrate-declarative-settings); [mobile guidance](https://docs.obsidian.md/Plugins/Getting%20started/Mobile%20development).

## 8. Future-view fitness tests

| Projection | Domain facts available | Limitation or additional index |
| --- | --- | --- |
| Relationship graph | Annotation↔Code, annotation↔Set, Memo typed links, annotation→SourceRecordId | Direct query; source nodes include Markdown and PDF without Canvas ownership. |
| Code × Code | Code assignments sharing one AnnotationId | Derived co-occurrence; zero-assignment Codes remain valid. |
| Source × Code | SourceRecordId from logical annotation joined to Code assignments | PDF is the source, not its sidecar; same path/title may refer to distinct source records. |
| Set overlap | Annotation membership in multiple Sets | Derived intersection; no Code-as-Set-member representation. |
| Annotation chronology | Managed createdAt/updatedAt, edge createdAt, firstSeenAt distinguished | Legacy unknown remains unknown; reading/rereading sessions require additional facts, not inferred from file mtime. |
| Source→Code→Set flows | Common annotation ID joins Source, Codes and Sets | Multiple Canvas cards for same annotation must not inflate counts. |
| Memo network | Typed Memo links, unlinked Memos and derived inverse links | Clean projection independent of UI location. |
| **PDF adapter** | PDF SourceRecordId + anchored logical annotation yields same query shape | Requires source-aware locator/renderer, source-specific repair and canonical sidecar. **No PDF branch in Code/Set/Memo/Workspace relations or Canvas membership.** If one appears, source abstraction leaked. |

Future EPUB is another anchor/renderer adapter, not a schema commitment. Notation applicability may differ by source adapter: an unsupported PDF bracket gesture should be disabled or described explicitly, without forcing every annotation type to be representable on every medium.

## 9. Implementation slices for the separate LOCAL thread (after approval)

| Slice / gate | User-visible behavior | Dependencies and validation / rollback |
| --- | --- | --- |
| **0. Contract/docs/platform spike** | No Workspace UI yet. | Establish `docs/` source of truth below; test canonical JSON files and truly local session storage on desktop+iPad/two synced devices; inventory APIs and set honest version; fixture the source adapter/API contracts. Storage choice blocks persistence slices, not local parser work. No source rewrite. |
| **1. Markdown identity + reader/Navigator** | One gesture across blocks is one logical mark; footnotes use collision-checked managed label; external legacy visible; no Select/Group/Ungroup. | Separate shared AnnotationId/SourceReference/Anchor types from Markdown parser and write path; preserve parser spike. Replace disposable group tests, cover tables/multiblock/part loss/copied ID, footnote 0..many refs and duplicate defs. User checks Reading Mode and Navigator. This is the first candidate compatibility baseline after real-use sign-off. |
| **2. Shared palette/catalogue + legacy registry/reconciliation** | Semantic changes no longer reinterpret historical annotations; legacy items can retain registry IDs without source writes; unresolved cases identifiable. | Canonical global store and source records, observed/fallback excerpts, rename/missing/collision/registry loss tests, query source adapter boundary, volume limits. Test two-device catalogue and history of repurposed slots. Do not postpone stable semantic IDs until after marking valuable data. |
| **3. Workspace persistence/Scope/stream** | Shared default opens without name; scope picks actual source notes and shows unified stream; temporary filters local; Save As forks. | Per-Workspace durable store, local session and source query, progressive indexing, conflict detection. Include interface seam for PDF as an unimplemented adapter. Test lazy loading/empty vault/out-of-scope links/restart/sync. UX gate: scope vs View and active-pointer behavior. |
| **4. Local history** | Timestamped persistent Undo/Redo for Scope and committed View actions, later domain actions. | Guard digests and cross-device invalidation, branch semantics, crash after commit, local storage eviction, bounded deltas. User tests undo across restart and different device behavior. |
| **5. Codes; 6. Sets; 7. Memos** | In turn: multi-assignment/zero-use Codes; empty/multi-membership Sets; independent/unlinked Memos and bidirectional typed links. | Shared typed edge serializer and createdAt rules; each slice includes source-missing and external-change tests, undo integration, explicit mutation previews when destructive. Gate each UX flow with user. |
| **8. Canvas projection** | Optional structured Set/unsorted export; same annotation can appear in multiple Set groupings. | Stable annotation IDs/provenance, no Canvas-owned membership; replace old group/text dedup; snapshot versus append and card provenance choices require product validation. No silent modification of user-edited Canvas nodes. |
| **9. Maintenance/exit** | Previewed legacy strengthening, relink/repair, cleanup/export. | Same-ID migration tests including existing Code/Set/Memo links; guarded per-file writes, backup, partial-failure resume, PDF sidecar export contract. The minimal integrity warning/relink path may need to ship earlier than the full maintenance UI so broken links are never invisible. |

**Dependency correction:** stable palette+semantic IDs must be present *before* managed marks become real valuable annotations. The local worker may combine the palette portion of slice 2 with slice 1 and establish the compatibility baseline only after both pass. Full PDF anchoring/rendering remains a separate later capability, not a hidden addition to slices 1–9. External-legacy support is required from first readers onward; disposable old FuturePlural group markup does not need conversion.

## 10. Minimal durable repository documentation contract for local implementation

```text
docs/
  README.md                 # index: CURRENT / BACKGROUND / ARCHIVED, compatibility baseline
  ARCHITECTURE.md           # approved source of truth: boundaries, persistence, schema ownership
  CONTRACTS.md              # source adapters, identity, reconciliation, mutations, history invariants
  DECISIONS.md              # ADR-lite dated decisions, rationale, supersedes links, open choices
  PRODUCT.md                # current surfaces, user-facing invariants, active bounded backlog
  archive/                  # v0.1/v0.2 proposals and superseded Manager/group plans
```

A smaller arrangement may combine `ARCHITECTURE.md` and `CONTRACTS.md` if navigation remains clear. Do **not** leave the current `PRODUCT_DECISIONS_AND_BACKLOG.md` actionable merely under a warning: extract still-current tasks into PRODUCT, move obsolete operational Manager/Group plans to archive with a superseded label, and link the archive from the index. The existing UX walkthrough may stay as dated background, not a current implementation contract. Record in index and decisions: **PRE-BASELINE** old FuturePlural test markup/data disposable; **EXTERNAL LEGACY** supported real product input; **POST-BASELINE** managed annotations and Workspace data require migration and data-preservation discipline. Mark the actual baseline build/schema and date when established, not retroactively now. The local handoff should require docs updates as gates for changed domain contracts and ADR-lite entries when a core choice changes; no ceremonial ADR for ordinary UI polish.

## 11. Decisions still needing product/technical review

1. **Canonical store location after the required spike.** Vault-visible directory of separate Workspace/catalogue/registry JSON files versus config-directory Adapter storage, or a better demonstrated option. Prefer vault-side only if visible-file APIs and actual desktop+iPad sync work without hidden assumptions; the choice affects discoverability, exit, mobile write safety and configuration guidance. Do not choose it from theory.
2. **Device-local session store, proven on iPad.** Prefer a tested vault-namespaced IndexedDB (or similarly reliable local runtime store) for small View/history/pointer records; localStorage is a bounded fallback only if it meets reliability and quota tests. If persistent device-local storage cannot be guaranteed, agree on degraded history semantics *before* presenting it as a promise.
3. **Per-device active Workspace pointer.** Recommend yes; switching on the laptop should not unexpectedly switch the iPad, while domain/Scope sync. Shared pointer is possible but would make unrelated device sessions interfere.
4. **Meaning of editing a semantic name.** Recommend explicit Rename existing concept versus Assign slot to another/new concept controls. The current free-text `meaning` field alone cannot distinguish them; reusing that interaction would silently change historical semantics. The precise UI belongs to the product thread.
5. **When to declare the real-data baseline.** Recommend after source identity, semantic identity, registry persistence and mobile tests are validated together, before creating valuable plugin marks in the personal vault. Prior development files can be reset only at identified paths with explicit authorization. Once declared, even later implementation slices must treat existing data as durable.
6. **External-source integrity minimum before analytical edits.** Recommend allow Code/Set/Memo links to tracked legacy annotations with clear weaker-integrity state, and ship visible unresolved/relink affordances before bulk analytical use; delaying the entire Maintenance console is fine. If declined, users could accumulate irrecoverable unidentifiable references.

Save As=fork, shared durable default, no source cascade-delete, no automatically synced temporary View/history, managed opaque footnote labels and PDF-as-source are already product direction, **not open decisions**. The exact value of `minAppVersion` and storage backends are evidence-driven spike outputs, not discretionary UI preferences. This revision ends at architecture review; no implementation is authorized.
