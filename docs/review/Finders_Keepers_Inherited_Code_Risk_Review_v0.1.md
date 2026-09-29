# Finders Keepers — Inherited Code Risk Review

**Version:** 0.1  
**Date:** 2026-09-26  
**Status:** Working engineering note / inherited-code cleanup checkpoint input  
**Scope:** Targeted review of inherited code from `DuckTapeKiller/obsidian-reader-highlighter-tags` against the current `nonselection/futureplural-annotations` `futureplural` branch.

---

## Purpose

This document preserves the findings from a targeted inherited-code review so the same investigation does not need to be repeated later.

The review was intentionally **not** a comprehensive architecture or efficiency review. Its purpose was narrower:

- identify inherited implementation details that can materially bite us later;
- distinguish those from code that is already scheduled for replacement and therefore not worth polishing;
- record concrete recommended action;
- avoid inventing cleanup work merely because inherited code is inelegant.

The review treated the current architecture and product direction as authoritative. Where a subsystem is already being replaced — for example Research View, legacy reading-position persistence, positional palette architecture, or PDF companion-note storage — the review generally did **not** recommend improving the inherited implementation.

---

## Executive Summary

The inherited codebase does **not** appear to contain a hidden foundational defect requiring a broad refactor.

Several of the historically fragile areas have already been substantially displaced or hardened in the current branch, especially:

- source-selection resolution;
- logical annotation identity;
- guarded source writes;
- Highlight Navigator mutation paths;
- Rough Notation rendering;
- Canvas mutation;
- reconciliation-related handling.

The remaining risks are relatively bounded.

The most important findings are:

1. **Obsidian view-type IDs still collide with the upstream plugin**, which likely explains coexistence failure.
2. **iOS gesture listeners are not cleaned up on plugin unload**, allowing zombie listeners and duplicate long-press behavior.
3. **The inherited single-slot Undo mechanism can overwrite unrelated later edits** and should not survive into real-vault use.
4. **Markdown/JSON/CSV export silently mutates source notes by inserting block IDs**, and does so through an unsafe stale-snapshot write.
5. **Several inherited command-palette mutation paths still bypass the safer guarded implementations already added elsewhere.**
6. **`tagSelection()` contains a stale-offset race** because it re-locates against one snapshot and then asks the writer to reread independently.
7. **The “Apply & learn” normalization mechanism is globally broad and should probably be removed unless a clear product need survives.**

These findings support a **small inherited-code cleanup checkpoint**, not a large cleanup slice.

---

# Findings

## 1. Workspace-global Obsidian view IDs still collide with the upstream plugin

### What was found

The upstream plugin and the current FuturePlural fork both register the same Obsidian view-type IDs:

```ts
export const HIGHLIGHT_NAVIGATOR_VIEW = "highlight-navigator";
export const RESEARCH_VIEW = "reader-research-view";
```

The plugin manifest ID itself is already different (`futureplural-annotations`), but Obsidian view-type IDs are registered at the workspace/application level rather than namespaced automatically by plugin ID.

### Why it matters

This gives a concrete explanation for the observed failure when trying to enable the original plugin alongside the fork.

Even though the plugins have distinct manifest identities, both attempt to own the same registered workspace view types.

### Recommendation

Fix this during the planned namespace/identity cleanup.

The current pre-baseline internal IDs do not need compatibility preservation. Rename them into the eventual public plugin namespace rather than carrying upstream identifiers forward.

### Disposition

**Fix at inherited-code cleanup checkpoint.**

Small, confirmed, low-risk change.

---

## 2. iOS mobile gesture listeners leak across unload/reload

### What was found

`FloatingManager.setupMobileGestures()` attaches anonymous document-level listeners on iOS:

- `touchstart`
- `touchmove`
- `touchend`

They are attached directly to `activeDocument`.

The callbacks are not retained and are not registered through a cleanup mechanism.

`FloatingManager.unload()` currently removes the toolbar and clears `_handlers` and the Android debounce timer, but the three mobile document listeners are never removed. A pending `longPressTimer` is also not cleared on unload.

The `_handlers` array exists but is not currently populated with these listener cleanups.

### Why it matters

Disable/re-enable, development reloads, or repeated plugin reloads within one Obsidian process can leave old `FloatingManager` instances retained by document listeners.

This can produce:

- duplicate long-press highlighting;
- actions firing from zombie plugin instances;
- difficult-to-reproduce mobile behavior;
- leaked plugin objects and associated state.

This is especially relevant because iPad/mobile reading is a first-class use case.

### Recommendation

Use one of the following cleanup-safe patterns:

- named handlers with explicit `removeEventListener`;
- Obsidian `registerDomEvent`;
- stored cleanup callbacks added to `_handlers`.

Also clear `longPressTimer` in `unload()`.

### Disposition

**Fix soon / inherited-code cleanup checkpoint.**

This is a real bug, not stylistic debt.

---

## 3. The inherited one-slot Undo mechanism is unsafe

### What was found

The current inherited Undo model stores an entire pre-operation file snapshot:

```ts
this.lastModification = {
    file,
    original
};
```

Undo later performs an unconditional full-file restore:

```ts
await this.app.vault.modify(
    this.lastModification.file,
    this.lastModification.original
);
```

There is no verification that the current file still matches the post-operation state that Undo expects.

The undo slot is also populated *before* some guarded writes execute.

### Failure mode A — unrelated later edits are erased

1. Annotation operation succeeds.
2. Entire pre-operation file is saved as Undo state.
3. User or sync process changes some unrelated part of the note.
4. User invokes Undo.
5. Old full-file snapshot overwrites both the annotation change **and the unrelated later edit**.

### Failure mode B — Undo can revert an operation that never happened

1. Pre-operation snapshot is stored.
2. Another device/process changes the source.
3. Guarded annotation write correctly refuses to write because bytes changed.
4. Stale `lastModification` remains populated.
5. User invokes Undo.
6. Plugin writes the stale snapshot over the external edit.

### Why it matters

This is a direct data-loss risk.

### Recommendation

Do **not** incrementally improve this model.

The already-approved Undo architecture should replace it wholesale with source-operation records that include:

- explicit operation identity;
- expected post-operation source state;
- guarded reverse operation;
- drift/divergence detection;
- no mutation when the target no longer matches expected state.

Until that architecture is implemented, treat the current Undo mechanism as **pre-baseline / do not ship for real-vault use**.

### Disposition

**Already architecturally solved; runtime implementation must be replaced.**

Do not spend time polishing the inherited single-snapshot design.

---

## 4. Export silently mutates the source note

### What was found

Markdown, JSON, and CSV export all call `ensureBlockIdsForHighlightLines()`.

That helper adds random Obsidian block IDs to highlighted source lines when they do not already have them:

```md
^a7gz91
```

The source note is then rewritten before the export artifact is produced.

The write currently uses stale-snapshot `vault.modify()` behavior rather than an exact-content guarded mutation.

### Why it matters

There are two independent problems.

#### A. Concurrency / stale snapshot risk

The exporter:

1. reads source;
2. derives a modified version;
3. later writes that modified version through `vault.modify()`.

An intervening source edit can therefore be overwritten.

#### B. Product semantics

Export appears to be a read-like action but has a hidden source-strengthening side effect.

A user asking for JSON or CSV of annotations would reasonably not expect their Markdown source to be silently modified.

The original justification — manufacturing Obsidian block references for exported items — is also increasingly unnecessary now that the system has durable annotation identity and is moving toward durable source identity.

### Recommendation

Make export **read-only by default**.

If a future workflow genuinely requires durable Obsidian block references, treat block-ID insertion as an explicit source-strengthening operation with:

- user-visible intent;
- guarded writes;
- clear separation from ordinary export.

### Disposition

**Remove/redesign before real-vault use.**

This should be part of the inherited-code cleanup checkpoint unless the export routes are being deleted outright first.

---

## 5. Legacy command-palette mutation paths bypass safer current implementations

### What was found

The current branch has safer guarded mutation logic in several newer UI paths, especially the Navigator.

However, `main.ts` still exposes older command-palette paths for operations including:

- Remove all highlights from note
- Remove all footnotes from note
- Merge adjacent highlights in note
- Recolor `<mark>` highlights
- Migrate `<span>` highlights to `<mark>`

Several of those older methods still use:

```text
read → transform → vault.modify
```

rather than guarded `vault.process()` semantics.

The old `removeAllHighlights()` implementation is particularly concerning because it performs raw regex replacement:

```ts
raw = raw.replace(/==(.*?)==/gs, "$1");
raw = raw.replace(/<mark[^>]*>(.*?)<\/mark>/gs, "$1");
```

This has no source-structure awareness and can potentially modify examples inside code blocks, comments, or other non-annotation contexts.

### Why it matters

The visible Navigator path may be safe while an older command-palette route remains as an unguarded trapdoor into the same source data.

That creates inconsistent safety guarantees based purely on which UI entry point the user happened to invoke.

### Recommendation

Do not harden every old method independently unless it still has a clear product role.

For each command:

- route it through the already-safe implementation where one exists;
- move it into the future guarded Maintenance system if that is its intended home;
- or remove/disable it if the feature is being retired.

Do not retain duplicate unsafe mutation pathways merely for inherited compatibility.

### Disposition

**Fix/remove at inherited-code cleanup checkpoint.**

---

## 6. `tagSelection()` contains a stale-offset race

### What was found

`tagSelection()` correctly performs an initial source match, opens the tag modal, and then re-runs source resolution after the human interaction.

The second lookup yields:

- `newResult.file`
- `newResult.raw`
- `newResult.start`
- `newResult.end`

However, the subsequent write calls:

```ts
await this.applyMarkdownModification(
    targetFile,
    "",
    newResult.start,
    newResult.end,
    "tag",
    tag
);
```

Two problems are present:

1. `targetFile` comes from the **first** resolution rather than `newResult.file`.
2. Passing `""` as `raw` causes `applyMarkdownModification()` to reread the file independently before applying offsets that were calculated against `newResult.raw`.

This breaks the otherwise-good invariant that source offsets and source bytes belong to the same observation.

### Failure mode

1. Second resolution computes offsets against source snapshot B.
2. File changes immediately afterward.
3. Writer rereads snapshot C.
4. Offsets from B are applied to C.

Usually B and C are identical, but the guard has been accidentally bypassed.

### Recommendation

If source tagging remains a supported feature:

- use `newResult.file`;
- pass `newResult.raw`;
- let the existing `vault.process()` equality check reject any later change.

If inherited source tagging has no continuing role in Finders Keepers, delete the feature instead of repairing it.

### Disposition

**Conditional. Fix if retained; otherwise remove.**

---

## 7. “Apply & learn” normalization rules are globally broad inherited behavior

### What was found

The failure-recovery modal can derive a literal “junk” substring from one corrected match and save it as a learned normalization rule.

Future source matching then strips that pattern globally.

The rule derivation is intentionally conservative in some ways — it refuses alphabetic substitutions and only learns certain deletions — but the resulting rule still applies globally rather than only to the source pattern or document context that produced it.

### Why it matters

A one-off source-selection failure can alter future matching behavior everywhere.

This risks:

- making later source matching less discriminating;
- hiding legitimate punctuation/symbol content;
- producing hard-to-understand stateful behavior that persists after the original recovery event.

### Recommendation

Unless a clear user/product need survives, remove “Apply & learn” rather than investing in making this adaptation layer more sophisticated.

If retained, it would need a much narrower scope and explicit explainability.

### Disposition

**Low urgency. Likely delete rather than improve.**

---

# Areas Reviewed and Deliberately Not Recommended for Cleanup

## VaultScanner / Research View

`VaultScanner` is a coarse full-vault scanner with an mtime/path cache.

It is not worth optimizing because its worldview is being superseded by the canonical registry, storage, and Workspace architecture.

**Recommendation:** leave alone until removed.

---

## Legacy PDF companion-note storage

The inherited PDF workflow writes selections into companion Markdown notes.

That architecture has already been rejected for the future product direction. PDF annotations are intended to use source-owned adapter/canonical sidecar handling while leaving PDF bytes untouched.

**Recommendation:** do not harden the old PDF writer. Remove it when the replacement arrives.

---

## Reading-position persistence

The plugin stores reading positions in plugin settings and exposes resume behavior.

A dedicated plugin already solves this problem more completely.

**Recommendation:** delete the feature rather than improve it.

---

## Positional palette architecture

The old semantic-color array and related palette model are already being replaced by stable IDs and the new label/palette architecture.

**Recommendation:** do not invest in inherited palette cleanup.

---

## SelectionLogic architectural elegance

`SelectionLogic.ts` is large and complicated.

However, it also contains many concrete protections for real Obsidian Reading View/source mismatches, including:

- repeated occurrences within one rendered block;
- soft line breaks;
- embeds;
- headings;
- tables;
- links;
- footnotes;
- invisible Markdown syntax;
- pathological zero-content selections;
- multi-block matching.

There is no current evidence that a broad “make this cleaner” rewrite would improve reliability.

The current ordinary mark/highlight write path also preserves the important invariant that offsets are resolved against exact raw bytes and then committed through `vault.process()` with an equality guard.

**Recommendation:** no cleanup crusade. Change only when a concrete bug or new source-adapter architecture requires it.

---

# Positive Findings

The review also confirmed several areas where earlier work has already eliminated inherited risks.

## Main annotation write path is guarded

Ordinary mark/highlight creation resolves against a specific raw source snapshot and later commits through `vault.process()` only if the source remains byte-identical.

This substantially reduces stale-offset and overwrite risk.

---

## Multi-block marking uses the same guarded source-write path

Multi-block selection now anchors the first and last selected blocks and ultimately routes through the guarded source rewriter rather than blindly applying one huge rendered-text match.

---

## Footnote creation uses exact-source guarding

Footnote insertion similarly refuses to write if source bytes changed between match and mutation.

---

## Highlight Edit reparses inside `vault.process()`

Current highlight editing resolves the actual target from current source inside the guarded mutation callback, rather than trusting stale offsets from modal-open time.

---

## Navigator deletion is substantially safer than the inherited implementation

Current Navigator delete/remove logic uses `vault.process()` and additional legacy-state checks.

The risk is no longer “all mutation code is unsafe”; it is specifically the remaining inherited escape hatches.

---

## Repeated-occurrence selection bug appears genuinely addressed

The current branch contains dedicated `blockOccurrence` handling that derives an occurrence ordinal from the live DOM Range when identical text appears multiple times inside one rendered block.

This directly addresses the known upstream bug where a later occurrence in the same paragraph could resolve to the first occurrence.

Dedicated tests also exist for this behavior.

---

## Rough Notation rendering is no longer inherited architecture

The rendering lifecycle was substantially rewritten and now has dedicated lifecycle/failure tests.

The previously observed redraw lag/flicker disappeared as a side effect of the more robust implementation.

No inherited-renderer cleanup is recommended.

---

# Recommended Inherited-Code Cleanup Checkpoint

This should be a **small targeted checkpoint**, not an expensive cleanup slice.

It should happen **after the current storage/iPad evidence run**, so the probe build remains controlled and comparable.

## Definitely do

1. **Namespace Obsidian view-type IDs**
   - eliminate collisions with upstream;
   - use the eventual public plugin namespace;
   - do not preserve pre-baseline internal IDs unnecessarily.

2. **Fix iOS gesture listener lifecycle**
   - register cleanup-safe handlers;
   - clear pending long-press timer on unload.

3. **Remove reading-position persistence**
   - settings;
   - commands;
   - lifecycle hooks;
   - dead state.

4. **Neutralize source-mutating export behavior**
   - ordinary export should be read-only;
   - do not silently insert block IDs.

5. **Remove or route legacy unsafe command-palette mutation paths**
   - use safe implementations where appropriate;
   - otherwise move to Maintenance or delete.

6. **Mark/remove the current one-slot Undo implementation**
   - do not treat it as shippable;
   - replace only with the approved guarded operation-log architecture.

## Conditional

7. **`tagSelection()`**
   - if retained, bind second resolution to `newResult.file + newResult.raw`;
   - if source tagging is no longer part of the product, delete the feature.

8. **Failure-recovery “Apply & learn”**
   - probably remove;
   - retain only if a clear product case is articulated.

## Explicitly do not touch in this checkpoint

- VaultScanner / Research View efficiency
- legacy PDF companion-note infrastructure
- positional palette internals
- broad SelectionLogic refactoring
- already-rewritten Rough Notation renderer

---

# Suggested Sequencing

The cleanup checkpoint should be scheduled **after** the current storage/iPad/two-device evidence checkpoint.

Reason:

- none of the findings invalidates the current storage probe;
- changing runtime code before the evidence run would perturb the build under test;
- the cleanup items are orthogonal to storage backend selection.

After the evidence run, the checkpoint can be kept deliberately small and should not become a prerequisite for unrelated canonical-storage work beyond removing genuinely unsafe runtime paths before real-vault use.

---

# Bottom Line

The fork is no longer accurately described as “the upstream plugin with features bolted on.”

In the seams that matter most, substantial inherited behavior has already been replaced:

- annotation identity;
- source parsing and guarded writes;
- rendering;
- Navigator mutation;
- reconciliation;
- Canvas handling.

The remaining inherited risk is concentrated in a small number of identifiable paths.

The correct response is therefore **surgical cleanup**, not architectural demolition.

The main purpose of this note is to make sure those specific findings are retained and can be acted on later without repeating the investigation.
