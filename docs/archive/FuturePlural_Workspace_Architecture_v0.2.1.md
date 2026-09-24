# FuturePlural Workspace architecture — v0.2.1 corrections

**Status:** proposed for approval, 24 September 2026. This is a **targeted addendum** to [v0.2](FuturePlural_Workspace_Architecture_v0.2.md), not a replacement proposal. The v0.2 audit, persistence comparison, model, fitness tests and slice plan otherwise stand. No implementation, source migration or repository-documentation edits are authorized by this addendum. After explicit approval, this architecture thread prepares a handoff prompt for the separate local implementation thread.

## 1. Exact amendments to v0.2

| v0.2 location | v0.2.1 correction |
| --- | --- |
| §2, `LogicalAnnotation` sketch and identity/integrity paragraphs | Add `identityMode` **independent of** `integrity`; define managed for either Markdown or PDF, and strengthening as a same-ID transition. |
| §2, `Anchor` sketch and PDF paragraph | Replace the single `page` field with ordered PDF text segments, possibly crossing page boundaries. |
| §4, Code/Set/Memo metadata paragraph | Define `updatedAt` as changes to *owned mutable fields*, excluding ordinary relation changes. |
| §4 and §5, active Workspace pointer | Settle **per-device**, with safe fallback to shared default if the active saved Workspace disappears. |
| §3, palette semantics | Settle Rename semantic concept versus Reassign palette slot as distinct domain commands; UX controls remain product work. |
| §5, Workspace history, and §6, Maintenance | Explicitly defer source-annotation edit Undo/recovery; do not treat every ordinary source mutation as Maintenance or promise Workspace inverse-delta Undo for it. |
| §8, PDF fitness test | Verify cross-page/multi-segment gestures remain one annotation, and source-adapter capability differences do not escape into analytical relations. |
| §9, slices and dependency correction | Replace the tentative Slice 1 baseline with one named **B0 gate** after the required portions of Slices 0–2. Add test gates for independent identity/integrity axes. |
| §10, documentation contract | Specify the additional architecture/contract entries and log settled/deferred decisions. |
| §11, human decisions | Remove pointer, semantic operation, baseline timing and tracked-legacy participation from open questions; keep two storage spikes and the minimum-version inventory open, source-edit recovery deferred. |

## 2. Source contract: independent identity and integrity

```ts
type IdentityMode = 'managed' | 'tracked-legacy';
type Integrity = 'resolved' | 'degraded' | 'ambiguous' | 'missing';

type LogicalAnnotation = {
  id: AnnotationId;
  source: SourceReference;
  anchor: Anchor;
  identityMode: IdentityMode;
  integrity: Integrity;
  // Other fields remain as in v0.2.
};
```

`identityMode` answers **where durable logical identity is carried**. Managed Markdown marks carry the ID in managed source markup; managed footnotes carry it in their generated source label; a future managed PDF annotation carries it in its canonical source-layer sidecar. Tracked legacy identity depends on the canonical registry and reconciliation. `integrity` answers **whether the present source can be located and reconciled confidently**. Both axes are queryable for audit/Maintenance; neither demands badges on every normal reading row.

Thus `managed + degraded` can mean a partial multiblock mark, and `tracked-legacy + resolved` can mean an external `==highlight==` located confidently today but still dependent on the registry tomorrow. `tracked-legacy + ambiguous` is not silently attached to a plausible match. Managed PDF is *managed* because of its source-layer sidecar, **not** because the PDF bytes carry metadata. Identity strengthening of a confirmed legacy observation changes `tracked-legacy + resolved → managed + resolved` while retaining the **same AnnotationId** and all Code, Set and Memo edges. If normalization exposes a conflicting ID or uncertain source match, pause for explicit resolution rather than declaring that transition complete. Source loss can yield `missing` under either identity mode.

Tracked legacy annotations **may** be assigned Codes, added to Sets, and linked to Memos. Show their weaker durability when a decision depends on it and expose unresolved/relink status before large-scale legacy analysis; full Maintenance may still come later. Do not solve weaker identity by barring analytical participation or silently rewriting source.

The source adapter owns parsing and source-specific create/edit/navigation/render/reconciliation capabilities. An eventual adapter contract may report supported notation types and operations, but no broad capability framework is mandated now. The common query/relationship model must not accumulate scattered `if (markdown)` / `if (pdf)` branches. If a PDF viewer cannot support a bracket gesture, that is an adapter/UI affordance constraint, not a different Code/Set/Memo schema.

### PDF anchor correction

```ts
type PdfTextAnchor = {
  type: 'pdf-text';
  // One logical ID, one source PDF; one continuous gesture may cross pages.
  segments: Array<{
    order: number;
    page: number;
    quote: string;
    prefix?: string;
    suffix?: string;
    selectionEvidence?: unknown;
    cachedGeometry?: unknown; // derived/versioned display hint
  }>;
  displayQuote?: string; // assembled projection, not sole anchor
};
```

Require at least one ordered segment; allow multiple segments on a page or adjacent pages. If the PDF.js viewer permits selecting from the end of page 41 into page 42, **one gesture is one AnnotationId** and its segments stay ordered. PDF file identity/SourceRecordId belongs to `SourceReference`, not the page segments. Text and selection evidence support resolution; cached rectangles never become logical identity. No PDF implementation is part of the initial Workspace slices.

## 3. Analytical time, palette operations and device pointer

`Code.updatedAt`, `Set.updatedAt` and `Memo.updatedAt` advance only when that entity's **own mutable fields** change—e.g. name, description, definition, title or body. Assigning a Code, adding a Set member or linking a Memo creates a relation with its own `createdAt` but does **not** change an endpoint's `updatedAt`. If a future UI needs “last analytical activity,” define `lastActivityAt` separately rather than retrospectively changing what `updatedAt` meant. Existing v0.2 relation timestamps and clock-skew cautions remain.

The domain distinguishes two semantic actions: **Rename concept** keeps the SemanticLabelId and changes its display name; **Assign palette slot to existing/new concept** updates the slot's SemanticLabelId for future gestures, leaving annotations' captured semantic IDs unchanged. The present free-text settings edit is insufficient to express this distinction safely. Exact controls belong to product/UX, but the two commands and their history behavior must not be conflated.

The active Workspace pointer is **device-local persistent session state**. Laptop and iPad may display different active Workspaces while accessing the same synced Workspace domain and Scope. On reopening, if a locally selected saved Workspace has been deleted or is absent after sync, **do not recreate or mutate it**: switch to the shared default and show a comprehensible non-destructive notice (including the missing Workspace's last-known name if available). Missing saved state must not wipe the user's unrelated local preferences or source annotations. This settles v0.2's pointer recommendation.

## 4. Compatibility baseline gate B0

**B0 is a single explicit release/use gate**, not a casual milestone after Slice 1. Before B0, old FuturePlural-created development markup/state is disposable; *external legacy* annotations remain required input. Do **not** begin creating valuable FuturePlural marks/footnotes in the personal or other real vault before all of these are validated together:

1. Durable logical AnnotationId; one gesture yields one annotation across Markdown fragments.
2. Managed footnote label/identity and parser behavior, including multiple references.
3. Stable palette-slot **and** semantic-label identity, with historical associations preserved.
4. Persisted SourceRecordIds/registry and the reconciliation behaviors needed for managed and tracked-legacy identities; `identityMode` and `integrity` tested independently.
5. Chosen canonical storage location/API and persistence of the substrate on **desktop and iPad/mobile**, including the relevant actual sync/storage tests.
6. Source read/write round trips and external-legacy discovery validated without forced migration.

At B0 record the **actual build, schema version(s), date, validated platforms/storage choices and test evidence** in the repository architecture/decision index; only then authorize real-vault annotation creation. After B0, managed annotations and their required supporting canonical registry/palette/source state are real user data. Future changes require explicit migration, backup/conflict handling and data-preservation discipline. B0 lets the corrected annotation substrate enter actual reading use **while later Workspace slices continue**. It does not require Codes/Sets/Memos, Canvas projection, or PDF support first.

**Slice adjustment:** Slice 0's platform spike and documentation, Slice 1's reader/writer/footnote identity, and the **relevant foundational part of Slice 2** (palette/semantic IDs, source registry persistence and reconciliation) are all prerequisites for B0. Do not label Slice 1 alone the candidate real-data baseline. Remaining broad indexing, UI refinements and future Workspace features may continue afterward. Tests must cover all four combinations `managed/tracked-legacy × resolved/problematic` where meaningful, multi-fragment loss/collision, and unchanged AnnotationId after tracked-legacy strengthening. PDF segment and adapter-capability tests remain contract/fitness fixtures, not an early PDF feature request.

## 5. Deferred source-edit recovery decision

Ordinary Workspace actions may later recolor, relabel, change notation or remove source annotations. Such actions are **not automatically Maintenance**. Conversely, writing Markdown or a future PDF sidecar has different failure and concurrency semantics from updating Workspace domain JSON. The v0.2 local inverse-delta history must **not** be read as a promise that it can undo these source operations. Multi-file Maintenance remains outside Workspace Undo.

**DEFERRED, not blocking B0 or initial Workspace slices:** before ordinary **bulk source-annotation edits** ship, define and validate a user-visible source-edit recovery/Undo contract. It must account for checked source versions, partial failure, restart, and what Undo can or cannot restore; a storage boundary is no excuse for a silently weaker safety promise. A source-operation manifest surfaced in Workspace history, a separate persistent recovery mechanism, or another design may satisfy this. No choice is made here. Existing narrow local edit/undo behaviors should be described honestly; do not extrapolate them to durable bulk Undo.

## 6. Repository docs and remaining decisions

When the local implementation thread establishes `docs/README.md`, `ARCHITECTURE.md`, `CONTRACTS.md`, `DECISIONS.md` and the active product/backlog document as planned in v0.2, explicitly record: both identity axes; adapter-owned capabilities; one-gesture continuity across Markdown fragments and future PDF page segments; durable/local persistent/transient/rebuildable state; B0 prerequisites and actual passage; pre-baseline disposal versus external legacy versus post-baseline migration obligations; per-device active pointer/fallback; and source-edit recovery **DEFERRED**. Move superseded Manager/Group plans to archive, not merely beneath a warning. `DECISIONS.md` should record Save As=fork, shared default, no source-loss cascade, local View/history/pointer, managed footnote labels, legacy analytical participation, Rename versus Reassign, and source-edit recovery's deferred status. The local worker updates repository docs; this architecture thread does not.

**Settled, not open:** Save As=fork and Rename separate; shared durable default; per-device active pointer and fallback; no cascade on missing source; device-local temporary View/history; managed opaque footnote labels and unchanged external footnotes; PDF as selectable immutable source with canonical sidecar; tracked legacy may enter analysis; semantic Rename versus Reassign.

**Evidence-driven open until the required platform/API spike:** (1) exact cross-device durable canonical storage location/API; (2) proven device-local persistent session backend; (3) honest `minAppVersion` after runtime API inventory and desktop+iPad validation. If a spike cannot uphold a stated product expectation, bring the consequence back for review rather than treating an untested alternative as equivalent.

**Deferred, not a blocker:** ordinary source-annotation edit Undo/recovery interaction and architecture, to be resolved before bulk source-edit actions ship.

These corrections expose no new fundamental contradiction in v0.2. They strengthen the foundation without introducing PDF implementation or redesigning the approved Workspace relationships.
