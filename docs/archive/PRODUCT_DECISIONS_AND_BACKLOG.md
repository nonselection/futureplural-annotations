# FuturePlural Annotations — product decisions and backlog

This file is the durable working backlog for product and interaction decisions that are otherwise easy to lose between implementation sessions. It records intent, not merely current behavior.

## Vocabulary

- **Annotations** is the system-wide collective noun: highlights plus footnotes.
- **Highlights** is the current collective noun for every visual treatment: highlight, underline, box, circle, strike-through, and crossed-off.
- **Markings** is the fallback collective noun if using “highlight” both for the family and one member creates real usability problems.
- **Footnote** means the ordinary Markdown footnote inserted from Reading view.
- User-facing copy should avoid **mark** as the category name. Internal source terminology may remain until a deliberate refactor.

## Surface responsibilities

### Annotation Navigator

The sidebar is a companion to the currently open note.

- It follows the active Markdown note.
- It helps the reader find an annotation in that note.
- Navigation must be explicit: use a small source-location control rather than making every row unexpectedly move the document.
- Per-highlight editing may remain available in the row action menu.
- Infrequent actions belong in progressive disclosure rather than permanently consuming vertical space.
- Selection controls should appear only while selection mode is active.
- The direct Canvas action must describe its current result:
    - **Create Canvas** when no associated Canvas exists;
    - **Add to Canvas** when one exists.

### Annotations Manager

The large view is the operational surface for annotations across the vault.

- Its default row action is safe inspection: clicking expands or collapses details and never mutates content.
- A pencil opens editing; a separate arrow opens the source note in a new tab.
- Results remain grouped by note in every search state, and note headers genuinely expand and collapse.
- Note-wide maintenance is launched from that note's own menu, never inferred from an unrelated scope filter.
- It must eventually include both highlights and footnotes.
- It must support selection and contextual bulk actions.
- File scope, text search, semantic color filters, and other filters constrain what is shown and exported.
- **Refresh** reparses the vault and refreshes the view; it replaces “Scan vault.”

## Implemented in the current slice

- Rename the Reading-view action and modal from “annotation” to **footnote**.
- Rename the sidebar **Annotation Navigator**.
- Rename the large view **Annotations Manager**.
- Rename the sidebar gateway **Manage**.
- Rename **Scan vault** to **Refresh**.
- Change the edit-modal label from **Preview** to **Selected text** and retain a nearby TODO for a real rendered preview.
- Make Navigator source navigation explicit with a small arrow control.
- Make Manager rows open the highlight editor and provide a separate source arrow.
- Put **Select highlights** and export formats in a Navigator kebab menu; show the selection bar only during selection.
- Make the Navigator Canvas action say **Create Canvas** or **Add to Canvas** according to current state.
- Replace the Highlights / Footnotes / Both mode switch with two consistent collapsible sections. Highlights open by default; Footnotes are collapsed by default; search opens both so matches cannot be hidden.
- Use one compact row grammar for highlights and footnotes: a left ordinal, a tiny highlight swatch where applicable, the annotation text, an explicit source arrow, and a vertical item-actions kebab.
- Confirm note-wide highlight removal and both single and note-wide footnote removal, mark those menu items as destructive, and provide a ten-second in-plugin Undo action after the write. Single visual-highlight removal remains immediate but receives the same Undo action.
- Refresh the Navigator's Canvas action when Canvas files are created, deleted, or renamed.
- Treat a missing associated Canvas as a stale association: create a new Canvas from the note's current name and replace the stale record. Existing Canvas files are never silently renamed.
- Distinguish Canvas creation, appended cards, and no-op exports in completion notices.
- Use the **notebook-pen** icon for the Annotation Navigator view and ribbon action.
- Add an explicit trailing clear control to Navigator search; clearing restores the unfiltered sections and returns focus to the field.
- Use vertical kebab icons and the concise visible tooltip **Actions** for per-row menus.
- Let row metadata occupy only the opening line: the ordinal and swatch float left, the source/action controls float right, and subsequent lines reclaim the complete row width.
- Make destructive Navigator menu items reliably use the error color even when the active theme does not visibly style Obsidian's warning state.
- Use action-specific Undo confirmation such as **Restored 12 highlights** rather than the inherited **Undone last highlight** message.
- Use a compact clickable source-link header on newly created canvases instead of embedding the full source note. Existing Canvas nodes remain untouched, and per-card arrow backlinks remain the default.
- Force Navigator menus to use Obsidian's DOM menu so warning states are inspectable and theme-independent styling can reach them.
- Keep note-wide highlight and footnote removal only in the Navigator-level menu, using the self-contained labels **Remove note highlights** and **Remove note footnotes** rather than a separate menu heading.
- Preserve the exact pre-search section-collapse state and restore it whenever search is cleared, including by deleting the query manually.
- Place the search-clear control inside the field and show a visible ten-second lifetime bar on reversible removal notices.
- Put a subdued but permanently visible annotation-actions kebab beneath the ordinal/swatch in the left metadata rail, avoiding both a permanent text column and an undiscoverable hover-only action.
- Clamp long Navigator excerpts to five lines and expose an explicit keyboard- and touch-operable **Show more / Show less** control only when overflow is detected.
- Treat Navigator kebabs as toggles: a second activation of the same trigger closes its open menu. Keep menu icons but scale them to the surrounding text rather than exceeding its visual height.
- Add a separately named `npm run deploy:actual` command backed by `FUTUREPLURAL_ACTUAL_VAULT`; ordinary `npm run deploy` remains isolated to the development vault.
- Stop exposing native `==` syntax as a creation mode. Existing native highlights remain discoverable and migratable; new standard highlights use FuturePlural `<mark>` output.
- Keep Manager results grouped by note before, during, and after search.
- Make note and highlight disclosure controls functional.
- Make Manager row clicks expand safe details; use explicit pencil and new-tab source controls for actions.
- Rename Manager Canvas to **Export to canvas…**.
- Rename note-scope shortcuts to **All** and **None**, and describe scope as notes with highlights.
- Move **Note maintenance…** into each note group's own menu.

## Next coherent implementation slices

### Manager data model and bulk work

- Include standalone footnotes in vault scanning and the Manager.
- Show a primary annotation count with an optional highlights/footnotes breakdown.
- Add Manager selection mode.
- Group or ungroup selected highlights only when the selection is valid; grouping across files is not valid.
- Recolor selected highlights, including selections spanning files, with a preview and atomic per-file writes.
- Define which bulk actions apply to highlights, footnotes, or both before exposing them.
- Keep source navigation separate from selection and editing.

### Canvas creation

- Replace filename prefix with a template; recommended default: `{note} — annotations`.
- Add repeated-export behavior: update associated Canvas, create a new Canvas, or ask each time.
- Keep exported cards as snapshots. Do not add hidden synchronization.
- Add card source-label choices: filename, arrow only, or group header only.
- Normalize alpha-bearing colors for new Canvas nodes without recoloring existing cards.
- Consider whether a renamed source note should produce a non-blocking notice that its existing associated Canvas keeps its current filename. Never rename that Canvas silently.

### Settings and appearance

- Reorder settings around user workflow rather than implementation history.
- Rename **Gesture opacity** to **Highlight appearance**.
- Add numeric fields beside sliders.
- Implement the light/dark rendered highlight preview.
- Resolve filled-highlight text contrast in dark themes.
- Keep Rough Notation’s two-pass behavior unless visual testing gives a concrete reason to change it.

### Navigator interaction and accessibility

- Evaluate `hyphens: auto` as a low-cost enhancement. Browser hyphenation depends on correct inherited language metadata and must not assume that every note uses the interface language.
- Run a deliberate accessibility pass: semantic native controls first, useful accessible names, logical focus order, visible focus, dialog focus containment/return, accurate `aria-expanded` state, sufficient touch targets, and no essential hover-only actions.
- Do not add ARIA roles to inert layout containers merely to silence an audit. A generic non-focusable row is correct when all actual actions are explicit named buttons inside it.

### Manager scaling

- Replace the expanding checkbox list with a bounded, searchable file-picker pattern.
- Show filename, disambiguating folder path, and annotation count.
- Add All, None, and Selected-only controls.
- Update incrementally after note modification, rename, and deletion; retain Refresh as full reconciliation.

### Source and display normalization

- Extract visible text from safe parsed fragments so inline HTML such as `<strong>` does not leak into Navigator, Manager, search, or Canvas text.
- Preserve exact source wrappers and offsets separately for mutation.

## Explicitly retained TODOs

### True edit preview

The current edit modal shows selected text, not a preview. A future preview must use the production renderer, update live, and show light and dark contexts.

### Block-level brackets

Rough Notation brackets remain planned for block-level annotation. The existing block-selection logic can supply the source range, but the storage, toolbar affordance, rendering, cleanup, and table/list behavior must be designed and tested as one feature. Do not bolt `bracket` onto the inline notation enum without that work.

### Code organization

- Rename `ResearchView` and related internal symbols to the Annotations Manager vocabulary while keeping the persisted Obsidian view-type ID compatible.
- Separate scanning/indexing, filter state, item actions, and rendering instead of continuing to grow one view class.
- Share annotation-location and edit-action helpers between Navigator and Manager.
- Replace inherited “annotation means footnote” internal names gradually and with compatibility tests.

## Deferred by decision

### Canvas synchronization

Canvas export is snapshot-based. Full bidirectional synchronization would require persistent annotation IDs, Canvas ownership records, conflict handling, deletion policy, and ongoing maintenance disproportionate to the expected workflow. Reconsider only after real use demonstrates a need.
