# Finders Keepers — Storage, Palette, and Continuity Synthesis
## 2026-09-27

**Status:** durable continuity / evidence-synthesis artifact  
**Recommended repo home:** `docs/review/Finders_Keepers_Storage_Palette_Continuity_Synthesis_2026-09-27.md`  
**Purpose:** preserve the most recent architectural evidence and product decisions so work can continue safely after chat-context loss.  
**Authority:** this document does **not** replace the canonical architecture, contracts, naming artifact, platform memo, or active implementation plan. It records new evidence, current recommendations, and decisions that must be promoted into those authorities where appropriate.

---

# 1. Executive state

The recent logical storage experiment is complete.

Finders Keepers now has real desktop ↔ iPad iCloud evidence for both root-level **Visible** and root-level **Hidden** storage representations, including:

- local desktop behavior;
- real iPad behavior through `CapacitorAdapter`;
- online and cold-offline operation;
- background/resume and app force-quit/reopen;
- a full iPad device reboot for vault-backed probe state;
- guarded local `process()` behavior;
- same-file offline divergence;
- independent same-path initialization;
- provider-created conflict/sibling behavior;
- Hidden-only parity for the two nastiest conflict cases.

The result is not “Hidden storage does not work.” Hidden storage worked extremely well for ordinary read/write/lifecycle use.

The important result is narrower and more consequential:

> **Under the tested iCloud Drive configuration, root-level Hidden storage can reconcile independently-created same-path stores into one internally mixed (“Frankenstein”) directory.**

This materially changes the backend recommendation.

The overall B0 gate is still **not passed**. Production canonical persistence is still not authorized. Open work remains around the final backend decision, recovery history, local-session persistence, backup/export, vault isolation, minimum supported Obsidian version, and final palette schema.

---

# 2. Canonical storage architecture — stable principles that survived testing

The architecture developed before the final experiment remains broadly sound.

The important durable principles are:

1. **Canonical domain data is storage-neutral.**  
   Persistence sits behind a repository / ports-and-adapters boundary.

2. **Source type and storage backend are orthogonal axes.**  
   Markdown/PDF/future source adapters are separate from Hidden/Visible/future canonical-store adapters.

3. **`data.json` is settings, not the canonical database.**

4. **Storage path is not identity.**  
   `storeId`, `SourceRecordId`, `AnnotationId`, and physical store location are distinct identities.

5. **Every persisted canonical artifact must bind to its `storeId`.**  
   This is now empirically essential, not merely defensive.

6. **Discovery must distinguish absence from unreadable, malformed, incomplete, unsupported, or conflicting state.**  
   Bootstrap is permitted only when both deterministic candidate locations are positively established `ABSENT`.

7. **Storage-mode changes are migrations, not preference-string flips.**  
   Migration requires durable semantic phase metadata; timestamps do not choose truth.

8. **Two stores present is recovery/conflict state, not timestamp winner selection.**

9. **Per-document guarded writes are useful but are not distributed transactions.**

10. **The system must preserve competing states it actually observes.**  
    It cannot promise preservation of provider-overwritten bytes it never receives.

11. **Provider-created sibling/conflict paths must be discovered by a bounded scan around deterministic store locations.**  
    Do not scan the whole vault; do not assume a provider-specific suffix such as `" 2"`.

These principles should remain the basis of the next canonical-storage revision.

---

# 3. What the iCloud experiments established

## 3.1 Ordinary desktop and iPad operation

Both root-level representations worked on desktop and on the real iPad:

- **Visible:** ordinary root-level vault folder through Vault APIs.
- **Hidden:** root-level dotfolder through `DataAdapter`.

On the iPad:

- runtime adapter was `CapacitorAdapter`;
- `Vault.process` and `DataAdapter.process` were callable;
- Hidden and Visible CRUD/process behavior worked;
- stale-base guards rejected changed bases;
- two competing guarded local calls produced one success and one precondition failure;
- both roots remained usable cold offline;
- both roots survived app force-quit/reopen;
- vault-backed state remained readable after a full device reboot.

This establishes strong local/lifecycle viability for both representations.

It does **not** establish a distributed compare-and-swap guarantee.

---

## 3.2 Visible same-file offline divergence

Two devices independently edited the same Visible JSON file while the iPad was offline.

After iCloud reconciliation:

- the ordinary file contained the iPad-side edit;
- no ordinary sibling/conflict file preserving the desktop edit appeared in the bounded scan;
- the desktop-side edit disappeared from ordinary current probe state.

Important limit:

> This does **not** prove that the overwritten desktop bytes are unrecoverable from iCloud provider history or some external backup. It proves only that FK cannot rely on ordinary reconciled vault state to preserve every competing offline write.

Architectural consequence:

> Local guarded `process()` semantics do not protect against provider reconciliation after two devices have independently made valid offline writes.

---

## 3.3 Visible independent same-path initialization

Both devices independently created a different logical store at the same **Visible** directory path while disconnected.

After reconciliation, iCloud preserved the two stores as separate sibling directories:

- nominal directory: store B / mobile state;
- provider-created sibling (observed as `... 2`): store A / desktop state.

The stores were not mixed.

Architectural consequence:

> For this Visible/iCloud case, independent stores survived in a recoverable split representation, provided discovery scans bounded provider-created siblings rather than only the nominal path.

The literal suffix `" 2"` is evidence, not a contract.

---

## 3.4 Hidden same-file offline divergence — final parity result

The equivalent same-file divergence was then run inside the Hidden root.

After reconciliation:

- the bounded matching set contained exactly one ordinary file;
- it contained store A with value `mobile-edit`;
- no matching Hidden conflict copy preserved `desktop-edit`.

The final iPad read-only inspector reported the file as valid with `value=mobile-edit`.

The read-only desktop inspection agreed.

Architectural consequence:

> Hidden does not solve the same-file lost-write problem. Under iCloud, both representations can converge to one ordinary surviving value without an ordinary preserved copy of the other offline write.

---

## 3.5 Hidden independent same-path initialization — final parity result

This was the decisive experiment.

Desktop and iPad independently initialized the same fresh **root-level Hidden directory path** while disconnected:

- desktop created store A with `document-desktop.json`;
- mobile created store B with `document-mobile.json`.

After iCloud reconciliation there was **one** matching root-level Hidden directory and no sibling/conflict root.

Its contents were:

```text
manifest.json             -> store B
document-desktop.json     -> store A / desktop
document-mobile.json      -> store B / mobile
```

The iPad targeted inspector classified it:

```text
PRESENT_INVALID
unexpected or mixed directory entries
```

The read-only desktop inspection saw the same mixed directory.

This is a real provider-produced specimen of a **Frankenstein store**.

Architectural consequence:

> A Hidden directory name and even a valid-looking manifest are not sufficient evidence that the directory is one coherent logical store. Every canonical artifact must be validated against store identity, and mixed bindings must halt ordinary operation and enter recovery.

This result also demonstrates that the current classifier boundary is doing useful work: it detected the provider-produced mixed state instead of silently accepting the manifest as authority.

---

# 4. Current storage recommendation

## 4.1 What is now disfavored

Do **not** qualify root-level Hidden storage as the preferred iCloud canonical representation in its current form.

This is not because Hidden is generally broken. It is because the tested iCloud reconciliation behavior introduces a materially worse independent-store failure mode than the corresponding Visible test.

Hidden may still be viable:

- with another transport;
- with stronger FK-owned recovery machinery;
- as an explicitly provider-qualified option;
- or in a future architecture that makes mixed-directory recovery cheap and reliable.

But it should not become the default merely because its UX is cleaner.

---

## 4.2 Current leading candidate for iCloud

Root-level **Visible** canonical storage is now the leading iCloud-compatible candidate.

Why:

- ordinary operations/lifecycle are proven;
- independent same-path stores were preserved separately rather than merged;
- provider-created siblings are discoverable with a bounded scan;
- the representation is easier for backup/export/recovery tooling to expose.

Important caveat:

> Visible still has the same-file lost-write problem.

Therefore “Visible is the leading candidate” is **not** equivalent to “Visible is sufficient without additional recovery design.”

A human architecture decision still needs to promote this recommendation into the canonical storage authority.

---

# 5. Recovery history: the next storage design decision

The experiments now show two different failure classes:

### A. Same-file provider overwrite
One valid offline write can disappear from ordinary reconciled state.

### B. Cross-store directory mixing
At least under Hidden+iCloud, independently-created stores can be merged into an internally contradictory directory.

The architecture should now decide the minimum FK-owned recovery machinery required.

The likely direction is:

> **a small, bounded, durable recovery-history layer**

—not a generalized event-sourcing system, Git clone, speculative database, or permanent full write log.

Properties worth considering:

- immutable or append-only recovery records for a bounded recent window;
- enough information to reconstruct the immediately previous known-good canonical document;
- explicit base/revision/digest linkage;
- bounded retention by count/bytes/time;
- storage-local validation before pruning;
- recovery metadata that survives ordinary provider reconciliation;
- no implication of distributed transactionality;
- no timestamp-based “latest wins” authority.

The exact mechanism is **not yet selected**.

The previous instruction “do not implement speculative event sourcing” remains valid and must not be interpreted as forbidding this smaller evidence-driven recovery layer.

---

# 6. Transport qualification strategy

Do not test every cloud provider now.

A useful near-term representative set is:

- **Syncthing** — file-level/P2P sync with conflict-copy behavior;
- **Remotely Save** with one representative backend such as Dropbox or WebDAV — sync mediated inside Obsidian and relevant to iOS;
- **Self-hosted LiveSync** — materially different database/object-sync architecture.

A mainstream Google Drive or OneDrive desktop-filesystem run can be added as a commodity-cloud baseline if useful.

Before a public release, a broader provider matrix is reasonable because provider-specific peculiarities are exactly what the iCloud experiment exposed.

Therefore distinguish:

- **architecture qualification now:** representative transport classes;
- **release pressure testing later:** all major supported/expected providers practical to test.

Never generalize the iCloud Hidden result into “Hidden folders are unsafe everywhere.”

---

# 7. Palette / color model — current product direction

The previous vocabulary of **“semantic colors”** and **“semantic concepts”** is no longer the intended product model.

A user may name a color:

- conceptually: `Friction`;
- literally: `Pink`;
- relationally/idiosyncratically: `Stuff Selma said`;
- or not name it at all.

The system must not assume that a custom name expresses semantics.

## 7.1 Separate concepts

Each palette color should distinguish:

1. **Stable palette-slot identity**
2. **Exact color value**
3. **Always-present system-generated human-readable color name**
4. **Optional user-defined custom color name/label**
5. **Stable identity for that optional custom label, if/when the durable schema requires one**
6. **Active/inactive availability in the current palette**
7. **Historical creation-time snapshot on annotations**

These concepts must not be collapsed.

---

## 7.2 System-generated color names

Every palette color should have a human-readable system name such as:

- Salmon
- Chartreuse
- Pear
- Cerulean

The purpose is to avoid exposing hex strings or anonymous “swatch 5” identifiers as the ordinary human label.

Desired behavior:

- derive the name deterministically from the committed color;
- use a perceptual color space / curated nearest-name lexicon, likely OKLab/OKLCH or equivalent;
- generate on **committed color-picker change**, not necessarily on every live drag;
- store the generated name at assignment time;
- do **not** silently recompute historical names every time the naming algorithm evolves.

Two distinct colors may legitimately share the same generated name.

Global name uniqueness is not an identity requirement.

Where text-only disambiguation is necessary, restrained qualifiers such as `light`, `deep`, `muted`, or a numeric discriminator may be used without contorting the underlying name system.

---

## 7.3 Optional custom names

A custom user label is optional.

Palette availability must be independent of custom naming.

Example:

- 8 active palette colors;
- only 3 have custom names;
- the remaining 5 remain fully usable through their system-generated names.

Do not recreate the inherited behavior where “named/semantic colors” and “available colors” are effectively the same axis.

---

## 7.4 Historical behavior

Annotations should preserve creation-time snapshots sufficient to explain their historical appearance/meaning later, including at least:

- palette-slot reference where appropriate;
- exact display color;
- system-generated color name snapshot;
- optional custom label identity/reference if ratified;
- optional custom label text snapshot;
- notation;
- opacity.

Changing the current palette must not silently reinterpret historical annotations.

---

## 7.5 Rename versus Reassign

The old Rename/Reassign distinction remains useful after removing semantic assumptions:

- **Rename custom label:** same custom-label identity; display text changes.
- **Reassign palette slot:** future gestures use a different label identity/association; historical annotations retain their prior identity and snapshots.

The exact final schema names are not ratified.

`ColorLabelId` is a plausible internal direction, not an approved public/schema commitment.

Before canonical persistence is wired, the provisional Region 1 palette codecs that still use semantic-concept vocabulary must be corrected or superseded.

---

# 8. Reading-position functionality — scope decision

The inherited Reader Highlighter reading-position feature is **out of Finders Keepers scope**.

Do not rewrite or modernize it as part of this plugin.

The inherited implementation was also not robust enough to justify preserving for compatibility: it was based on path-keyed raw scroll positions and did not provide a strong cross-layout/cross-device identity model.

But implementation quality is not the primary reason for removal.

The product decision is simply:

> Reading-position restoration is useful, but it is a separate concern already served by dedicated Obsidian plugins. Finders Keepers should not own it.

Personal use can be solved through a dedicated plugin or a small patch to one if necessary.

The inherited-code review already records this decision; this section exists only to preserve it at continuity level.

---

# 9. Sidebar / note-adjacent Finders Keepers — recent direction worth preserving

The naming decision itself is already durable in `NAMING_AND_SURFACE_LANGUAGE.md`:

- public product: **Finders Keepers**;
- note-adjacent surface: **Finders Keepers**;
- larger sensemaking surface: **Finders Keepers Workspace**.

Recent interaction work adds an important product direction that is not yet obviously consolidated in one canonical artifact.

## 9.1 One annotation stream

The note-adjacent surface should use **one source-ordered annotation stream**.

Highlights/visual markings and footnotes are interleaved by source order.

Do not return to separate “Highlights / Footnotes / Both” modes or two independent panes as the conceptual model.

Filtering is lightweight and transient.

Example:

> show all `Friction` annotations in this note

---

## 9.2 Context without ownership

Optional heading landmarks may be inserted to orient long documents.

They are context markers, not groups and not annotation ownership.

Because space is precious, heading landmarks can reasonably be off by default.

---

## 9.3 Remove debug residue from rows

Do not expose user-facing:

- ordinal numbers merely because the parser has an order;
- multipart/group counts;
- implementation IDs.

Rows should expose annotation kind through familiar glyphs/icons and useful human content.

---

## 9.4 Long-preview and expansion preferences

Two legitimate preferences should remain configurable:

- line clamp: e.g. `3 / 5 / 8 / never collapse`;
- expansion behavior:
  - accordion;
  - multiple rows may remain expanded.

Do not treat either preference as universally correct.

---

## 9.5 Explicit current-view orientation action

Provide an explicit action equivalent to:

> **Reveal annotations in current view**

Behavior:

- inspect annotations physically visible in the active note viewport;
- scroll the Finders Keepers stream to the corresponding row/region;
- if none are visible, report/disable honestly;
- do not continuously synchronize sidebar scroll with document scroll;
- do not invent a “nearest midpoint” annotation.

This is an orientation command, not permanent coupled scrolling.

---

## 9.6 Canvas and Workspace relationship

Canvas should be a first-class lightweight note-local workflow from Finders Keepers.

Possible actions include:

- create/open the source-associated Canvas;
- add the current annotation;
- add the current filtered selection.

Canvas is still much lighter than Workspace.

Workspace should remain discoverable and independently launchable, but non-dominant.

> The sidebar is a main working surface, not a lobby whose purpose is to send users to Workspace.

---

# 10. Product/repository identity already durably settled elsewhere

Do not re-decide these unless new evidence appears:

- public name: **Finders Keepers**;
- plugin/repository ID direction: `finders-keepers`;
- internal `FuturePlural` provenance should not become the eventual public plugin name;
- at Obsidian-level boundaries, preserve the Finders Keepers name for recognition;
- inside the product, use plain domain language;
- **Annotations** remains the system-wide object family;
- the collective visual-annotation term remains open between **Highlights** and **Markings**.

See `docs/NAMING_AND_SURFACE_LANGUAGE.md` / the current naming artifact for the authoritative wording.

---

# 11. What is complete versus what is still open

## Completed / evidenced

- Slice 1 source-identity work accepted.
- Region 1 canonical model/reconciliation foundation implemented and tested.
- Desktop storage spike complete.
- Real iPad online/offline/lifecycle evidence complete.
- Full iPad device-reboot vault-state read complete.
- Visible iCloud divergence experiment complete.
- Hidden iCloud parity experiment complete.
- Final Hidden mixed-store failure reproduced and independently read from iPad and desktop.
- Current classifier successfully detects the mixed Hidden store as invalid.
- Palette product direction has moved away from “semantic colors.”
- Inherited reading-position support is out of product scope.

## Still open

- Explicit human backend selection for production canonical storage.
- Exact bounded recovery-history design.
- Promotion of the final Hidden parity evidence into the platform memo / canonical storage architecture.
- Final palette schema/type names and correction of provisional semantic-concept codecs.
- Device-local session-store decision (`App` localStorage helper vs IndexedDB or another bounded mechanism).
- Device-reboot retention of the local canaries, if still relevant to that decision.
- Vault isolation behavior for local session state.
- Backup/export and restore qualification.
- Honest tested `minAppVersion`.
- B0 acceptance.
- Production canonical persistence wiring.
- Later representative transport testing and eventual public-release provider matrix.

---

# 12. Immediate next architectural sequence

Recommended order:

1. **Promote the final Hidden-parity evidence** into the platform decision memo and canonical-storage architecture.
2. **Make the explicit canonical-backend decision** for the iCloud-backed primary case. Current evidence favors Visible as the default candidate.
3. **Design the smallest bounded FK-owned recovery-history layer** needed for provider-overwritten same-file writes and recovery from observed divergence.
4. **Define recovery behavior for mixed/Frankenstein stores**:
   - halt ordinary writes;
   - identify every conflicting artifact/storeId;
   - preserve evidence;
   - require explicit recovery rather than timestamp selection.
5. **Correct the palette model** before durable persistence wiring.
6. Resolve the remaining B0 platform questions that materially affect production persistence.
7. Only then wire production canonical storage and move toward the B0 acceptance gate.
8. After the core storage decision is stable, run representative non-iCloud transport qualification rather than repeating an exhaustive provider matrix prematurely.
9. Before any public release, broaden provider pressure testing.

---

# 13. Evidence references for the storage synthesis

Important retained evidence includes:

- the existing `docs/PLATFORM_DECISION_MEMO_SLICE_0.md`;
- `.codex/plans/slice-2a-b0-foundation.md`;
- `Finders_Keepers_Canonical_Storage_Architecture_v0.2.md` / its repository copy if already installed there;
- visible-iCloud divergence reports listed in the platform memo;
- post-device-reboot iPad report:
  - `report-ipad-1790459738704-765159.md`;
- final Hidden-parity iPad read-only report:
  - `report-ios-1790474064768-997671.md`;
- final read-only desktop inspection performed immediately afterward.

The final iPad Hidden-parity report observed:

```text
Hidden parity root candidates:
[".fk-storage-probe-b0-hidden-independent"]

Independent root:
PRESENT_INVALID
unexpected or mixed directory entries

Shared Hidden same-document:
VALID
storeId=fk-probe-store-A
value=mobile-edit
```

The desktop inspection agreed and read the independent root as:

```text
manifest.json          -> store B
document-desktop.json  -> store A / desktop
document-mobile.json   -> store B / mobile
```

No Hidden sibling/conflict root was present in the immediate vault root.

No matching same-document conflict file preserved `desktop-edit` in ordinary current state.

Preserve these probe artifacts until the resulting architecture revision and recovery design are complete.

---

# 14. Handoff note for a new chat / worker

A new thread should **not** restart the storage investigation from first principles.

Treat the following as the current state:

> The iCloud qualification experiment is complete. Hidden and Visible both function locally and on iPad, but both can lose one ordinary same-file offline edit after provider reconciliation. Visible independent same-path initialization produced separate intact sibling stores; Hidden independent same-path initialization produced one mixed invalid store. Therefore Hidden is no longer the preferred iCloud default candidate. Visible is the leading candidate but still requires a bounded FK-owned recovery strategy for provider-overwritten writes. B0 is not passed and production canonical persistence is not yet authorized.

For palette work:

> Do not implement the provisional “semantic concept” model as durable truth. Use stable palette slots, exact colors, stored system-generated human-readable color names, optional custom labels with separate identity if ratified, independent active/inactive availability, and historical snapshots. Exact schema names remain open.

For product scope:

> Do not reintroduce inherited reading-position support. Preserve the one-stream Finders Keepers sidebar direction and treat Canvas as a first-class lightweight workflow, with Workspace important but non-dominant.

