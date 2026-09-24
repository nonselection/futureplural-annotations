# FuturePlural Annotations Manager — cognitive walkthrough and interaction model

**Version:** 0.1  
**Status:** UX audit and recommended model; Slice 1 implemented  
**Lens:** recognition over recall, progressive disclosure, explicit scope, reversible work, and no hidden consequential side effects

## Outcome

The Annotations manager contains the right families of capability, but it does not yet have a stable interaction grammar. The main problem is not visual polish. Browse, scope, select, edit, export, and repair actions currently share one surface without clearly communicating which mode the user is in or what set of annotations an action will affect.

The recommended model is not a customizable Adobe-style workspace system. It is a smaller state-responsive interface:

1. **Browse** is the calm default.
2. **Select** is an explicit, visible mode with a sticky contextual action bar.
3. **Edit** is launched by an explicit pencil control.
4. **Open source** is launched by an explicit arrow control.
5. **Export** and **Maintenance** are separate, previewed workflows with their scope stated before anything is written.

## Important correction to the current behavior

The current Manager does not edit on right-click. It opens the edit modal on an ordinary single left-click anywhere on a result row. Right-click has no dedicated Manager behavior.

That single-click behavior should not remain. Nothing in the row says that clicking the passage means “edit,” and row clicking will also be needed for selection or contextual inspection. Editing should use a conventional pencil button or an explicitly labelled row action.

## Likely work, by frequency

| User intention                                 |                    Likely frequency | Required access                           |
| ---------------------------------------------- | ----------------------------------: | ----------------------------------------- |
| Search or filter annotations                   |                         Very common | Permanently visible                       |
| Limit results to one or several notes          |                              Common | Permanently discoverable scope control    |
| Read the complete passage and its context      |                              Common | Safe row disclosure                       |
| Open the source passage                        |                              Common | Explicit source arrow                     |
| Select several highlights for structural work  |               Common in the Manager | Visible **Select** action                 |
| Recolor, group, or ungroup selected highlights |                            Periodic | Contextual selection toolbar              |
| Edit one highlight                             |                            Periodic | Explicit pencil control                   |
| Export selected or filtered results to Canvas  |                            Periodic | Explicit **Export to Canvas…** action     |
| Export Markdown, JSON, or CSV                  |                          Occasional | Export menu                               |
| Migrate legacy formats or run note-wide repair |                                Rare | Maintenance workflow, not primary toolbar |
| Force a full vault rescan                      | Rare once incremental updates exist | Secondary **Refresh** control             |

## Walkthrough findings

### 1. Opening the Manager to look around

The title promises annotations, but the data currently contains highlights only. Footnotes are absent. The statistics do say “highlights,” which partly mitigates the mismatch, but the view should either add footnotes as the next data-model slice or explicitly state the temporary limitation.

**Recommendation:** keep the Manager name, add the footnote index next, and show `73 annotations` with a subordinate `68 highlights · 5 footnotes` breakdown.

### 2. Searching

Entering any search text currently changes the results from a flat list into file-grouped cards. Clearing the text changes the architecture back. Search should narrow a stable information structure; it should not silently switch views.

The grouped version also displays a downward disclosure arrow and pointer cursor, but the header has no expand/collapse action. `expandedFiles` exists in state but is not used for rendering.

**Recommendation:** use one results architecture regardless of search state. Group by note with real collapsible headers, or use one flat list with source metadata; do not alternate between them because a query is non-empty.

### 3. Understanding a result row

The default list truncates long passages at 120 characters. The only way to see more is currently to open the edit modal. This conflates inspection with mutation.

**Recommended browse-mode row grammar:**

- row click: expand or collapse safe details/context;
- pencil: edit;
- arrow: open source;
- kebab/right-click: Copy, Edit, Open source, Recolor, Remove;
- selection mode: row click toggles selection because the mode is visibly active.

On wide layouts, the safe details may eventually become a side inspector. On narrow layouts, use inline expansion. The first implementation can simply reveal the full passage, note path, highlight type/color, grouping state, and attached footnote.

### 4. Opening the source

The Manager arrow currently calls `getLeaf("tab")`, so it opens the note in another tab. The tooltip only says “Go to highlight in…”.

**Recommendation:** either preserve the Manager by opening a new tab and say **Open source in new tab**, or implement platform-standard modifiers for new-tab behavior. Do not imply in-place navigation while silently creating tabs.

The Navigator is different: its arrow moves the already-open current note. That is appropriate because the Navigator is a companion to that note.

### 5. Selecting annotations

Selection is central to the Manager’s future structural work. Hiding **Select** in a kebab here would repeat the discoverability failure the user described in other applications. The Navigator may hide selection because it is primarily a reading companion; the Manager should not.

**Recommendation:** put a text-labelled **Select** action beside the result count. Once active:

- show checkboxes;
- let row clicks toggle selection;
- keep a sticky action bar visible while scrolling;
- state the selected count and note count;
- provide **Done** and **Clear** explicitly.

The action bar should expose only actions relevant to the selected object types.

| Action  | Valid scope                                                |
| ------- | ---------------------------------------------------------- |
| Group   | Two or more highlights in the same note                    |
| Ungroup | One or more grouped highlights; writes remain per note     |
| Recolor | Highlights across one or many notes                        |
| Export  | Highlights and footnotes, once both are indexed            |
| Remove  | Highlights or footnotes, with explicit review/confirmation |

When an action is invalid, keep it visible but disabled and explain why: for example, `Group requires at least two highlights from one note.` This teaches the capability without allowing an unsafe operation.

### 6. Choosing note scope

The existing file control mixes two mental models:

- note scope for filtering results;
- selection of one note as a hidden prerequisite for maintenance.

`Clear selection` actually means “show no notes,” not “clear a temporary item selection.” With `Files: all`, **Note maintenance…** finds zero explicitly selected files and fails with a transient notice. To succeed, the user must infer that they should clear the file scope and then check exactly one note.

**Recommendation:**

- call the control **Notes** or **Note scope**, not selection;
- summarize it as `All notes with annotations (300)` or `12 of 300 notes`;
- use **All** and **None**, not “Clear selection”;
- use a bounded searchable picker with note counts;
- never use the scope picker as an implicit argument to an unrelated maintenance command.

Note maintenance should contain its own explicit note picker, or be launched from a note group’s menu where the note is already unambiguous.

### 7. Filters

The property-value input remains active while `All Properties` is selected, but typing there has no effect. Active filters are not summarized in one place, so Canvas export may act on a narrower set than the user remembers.

**Recommendation:**

- disable the value input until a property is chosen, or make “All properties” genuinely search all values;
- show every active constraint as a removable chip;
- provide **Clear filters**;
- show `32 visible of 73 annotations` near the results;
- repeat the exact export scope in the Canvas modal.

### 8. Canvas export

The Canvas modal is already one of the strongest interactions. It states the highlight count, file count, append behavior, and snapshot policy before writing. The weak point is the launcher label **Canvas…**, which does not say whether it will open, create, append, or export.

**Recommendation:** use **Export to Canvas…** in the Manager. Its scope rule should be explicit:

1. if annotations are selected, export the selection;
2. otherwise, export the visible filtered results;
3. state which rule is being used before the modal opens and again inside it.

Markdown/JSON/CSV belong together under **Export**, not as permanent controls.

### 9. Note-wide maintenance and legacy repair

Maintenance is rare, consequential work. It should not compete with browsing controls in the primary title row.

The existing maintenance modal has the correct safety architecture:

- it names the affected note;
- it says filters do not constrain the operation;
- nothing is written before preview;
- it shows counts and source changes;
- it uses optimistic concurrency;
- Undo remains available while the dialog is open.

Keep that architecture. Improve it by putting errors and completion state persistently inside the modal rather than relying only on disappearing notices.

Move entry into a **Maintenance…** menu/workflow containing operations such as legacy review, migration, merge, and whole-note recolor. The workflow itself should ask for scope.

### 10. Removal and other consequential operations

The following currently write immediately:

- remove one highlight;
- remove all highlights in a note;
- remove one footnote;
- remove all footnotes in a note;
- clear reading positions;
- delete one or all learned normalization rules.

A red menu item is not enough for note-wide removal, and a five-second notice is not adequate recovery communication.

**Recommended policy:**

- low-impact, clearly named, locally reversible operation: may apply immediately, but show a persistent Undo action;
- multi-item, destructive, cross-file, or content-deleting operation: confirmation or preview is mandatory;
- errors from an open modal remain visible in that modal;
- do not make a consequential action available and explain its invalidity only after it is pressed.

At minimum, **Remove all highlights**, **Remove footnote**, **Remove all footnotes**, **Clear reading positions**, and **Clear all normalization rules** require confirmation or durable Undo. Footnote removal is more consequential than removing visual highlight styling because it deletes authored text.

## Recommended Manager structure

### Persistent header

- **Annotations manager**
- secondary Refresh/status control
- overflow for Maintenance and rare utilities

### Scope and filters

- note scope picker
- text search
- property filter
- semantic color filters
- active-filter chips and Clear filters

### Results header

- `32 visible of 73 annotations · 4 notes`
- visible text-labelled **Select**
- **Export to Canvas…** or a clear Export menu, depending on observed frequency

### Browse-mode rows

- color/type indicator
- passage text
- source note metadata
- explicit pencil
- explicit source arrow
- overflow/context menu
- safe inline disclosure on row click

### Selection mode

- checkboxes and row-toggle behavior
- sticky count
- Group / Ungroup / Recolor / Export
- More for destructive or rare actions
- disabled-state explanations

## Priority order

### Slice 1 — remove broken promises

1. Stop row clicks from opening the edit modal.
2. Add an explicit pencil button.
3. Make search preserve one results architecture.
4. Remove or implement the false disclosure affordance.
5. Rename file-scope actions to **All** and **None**.
6. Move Note maintenance out of its hidden “exactly one checked file” dependency.
7. Rename Manager Canvas to **Export to Canvas…**.

**Implementation status:** complete. Manager results now use one note-grouped architecture; note and row disclosures are real; row clicks safely inspect; pencil and new-tab arrow controls are explicit; note scope says **All** and **None**; note maintenance lives in the relevant note menu; and the Canvas launcher says **Export to canvas…**.

### Slice 2 — establish the Manager’s core work mode

1. Add a visible **Select** action.
2. Add sticky selection state and contextual actions.
3. Implement same-note group/ungroup validity.
4. Add multi-file recolor with preview and per-file atomic writes.
5. Distinguish selected export from visible-results export.

### Slice 3 — make “Annotations” true

1. Index standalone footnotes.
2. Add annotation totals with highlight/footnote breakdown.
3. Define footnote-safe bulk actions.
4. Add responsive details/inspector content.

### Slice 4 — consequence and recovery pass

1. Add confirmation for destructive multi-item actions.
2. Add persistent Undo where immediate application is justified.
3. Replace important transient errors with inline state.
4. Audit settings deletion/clearing controls under the same policy.

## Decision recommendation

Adopt the following interaction grammar unless live testing contradicts it:

- **click row:** inspect/expand, never mutate;
- **pencil:** edit;
- **arrow:** open source;
- **checkbox/selection mode:** structurally operate on several annotations;
- **kebab/right-click:** secondary actions;
- **ellipsis in an action label:** a dialog or additional decision step follows;
- **no ellipsis:** the named action happens immediately;
- **preview/confirmation:** required before consequential multi-item writes.

This gives every recurring gesture one stable meaning and leaves room for analysis without turning the Manager into a wall of permanent controls.
