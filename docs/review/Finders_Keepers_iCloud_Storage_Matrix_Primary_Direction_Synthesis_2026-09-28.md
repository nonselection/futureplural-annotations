# Finders Keepers — iCloud Storage Matrix Primary-Direction Synthesis
## 2026-09-28

**Status:** durable continuity / experimental evidence artifact  
**Suggested repo home:** `docs/review/Finders_Keepers_iCloud_Storage_Matrix_Primary_Direction_Synthesis_2026-09-28.md`  
**Purpose:** preserve exactly what was tested, the evidence files, the observed results, and the current architectural conclusions so a new chat or worker can continue without reconstructing this investigation from fragments.  
**Scope:** iCloud / Apple File Provider behavior for the disposable Finders Keepers storage probe, especially the replicated 4 × 15 primary-direction matrix.  
**Authority:** this is an evidence-and-handoff artifact. It does not itself authorize production canonical persistence. Where it conflicts with the storage recommendation in the 2026-09-27 continuity synthesis, the newer replicated evidence here should control the current working hypothesis.

---

# 1. Executive state

The **primary-direction replicated iCloud storage matrix is complete**.

We ran four repetitions, each containing fifteen conditions:

- **R1**
- **R2**
- **R3**
- **R4**

The primary direction was:

> **mobile offline first → mobile initializes → desktop initializes while mobile remains offline → desktop/iCloud settles → mobile reconnects → no further writes → repeated read-only inspection until stable → desktop read-only cross-device inspection**

For **every repetition**:

1. desktop baseline was confirmed clean before initialization;
2. iPad baseline was confirmed clean before initialization;
3. iPad initialized all 15 conditions while offline and reported all `VALID`, `COMPLETE=true`;
4. desktop initialized all 15 conditions while the iPad remained offline and reported all `VALID`, `COMPLETE=true`;
5. iCloud was allowed to settle;
6. the iPad reconnected;
7. two successive iPad read-only reports were taken after settling;
8. the full `## Results` block in those two iPad reports was exactly identical;
9. a desktop read-only report was then taken;
10. the desktop `## Results` block was exactly identical to the stable second iPad `## Results` block.

Therefore all four repetitions are:

> **STABLE + CROSS-DEVICE CONVERGED**

The experiment is behavioral evidence about the tested iCloud/File Provider configuration. It is **not** a provider contract and must not be generalized into deterministic claims about all Apple sync states, all transports, or all future OS versions.

---

# 2. Important correction to the previous storage recommendation

The earlier artifact:

`Finders_Keepers_Storage_Palette_and_Continuity_Synthesis_2026-09-27.md`

was written after the first Visible/Hidden parity experiments, before this replicated matrix. Its sections 4.1–4.2 provisionally moved toward “Visible as the leading iCloud-compatible candidate” and treated Hidden as comparatively disfavored.

**That framing is now too strong and should be treated as superseded by the replicated evidence.**

The architecture was never fundamentally about choosing one representation globally.

The intended product/storage model is better stated as:

- **Hidden root-level storage is the preferable UX representation where the active sync transport can carry it safely and reliably.**
  - It avoids exposing Finders Keepers’ canonical machinery in the ordinary vault file tree.
  - It avoids unnecessary indexing / user-facing clutter.
- **Visible root-level storage is a compatibility representation for transports or configurations where a hidden/dotfolder representation is unsuitable or is not synchronized reliably.**
  - The original concern included users whose sync setup may not carry hidden folders in the way Finders Keepers needs.
- Both representations should use the **same canonical schemas** and sit behind the same storage-neutral repository boundary.
- Choosing Hidden or Visible is therefore plausibly a **transport/capability decision**, not a global winner-take-all architecture decision.
- Moving between them remains a **migration**, not a preference-string flip.

The matrix gives us a better understanding of the failure shapes that **both** representations must tolerate. It does not establish that one must replace the other.

---

# 3. Evidence and implementation files to preserve

## 3.1 Primary matrix harness

- `storageMatrix.ts`
  - experiment definition;
  - condition definitions;
  - repetition orders;
  - deterministic fixture generation;
  - bounded candidate discovery;
  - read-only classification/fingerprinting.
- `StorageMatrix.test.js`
  - test coverage for the matrix model/classifier and its safety behavior.
- `storageSpike.ts`
  - earlier disposable storage-probe infrastructure and commands.

At the start of the live matrix, the harness had passed the focused matrix tests and the full suite; the implementation was frozen during the experiment.

## 3.2 Prior continuity/evidence artifact

- `Finders_Keepers_Storage_Palette_and_Continuity_Synthesis_2026-09-27.md`

This remains useful for:
- the canonical storage principles;
- the earlier same-file divergence experiments;
- the first Visible independent-store result;
- the Hidden parity experiment;
- palette/product continuity.

Its **specific recommendation that Visible should become the leading iCloud backend is superseded by the more cautious dual-representation interpretation in this document.**

## 3.3 Earlier Hidden-parity evidence

- `report-ios-1790474064768-997671.md`

That earlier targeted parity experiment observed:
- Hidden same-file divergence converging to one ordinary surviving value;
- Hidden independent same-path initialization producing one mixed invalid directory containing artifacts from two store IDs.

This result motivated the replicated matrix and especially the `stores/<storeId>/...` candidate topology.

## 3.4 Primary matrix reports

### R1
- first iPad snapshot: `report-ios-1790554654041-872319.md`
- second/stable iPad snapshot: `report-ios-1790555134273-362590.md`
- desktop cross-device snapshot: `report-desktop-1790555329105-821695.md`

### R2
- first iPad snapshot: `report-ios-1790557016026-792372.md`
- second/stable iPad snapshot: `report-ios-1790557630072-892032.md`
- desktop cross-device snapshot: `report-desktop-1790557909141-737725.md`

### R3
- first iPad snapshot: `report-ios-1790558990422-224588.md`
- second/stable iPad snapshot: `report-ios-1790560083742-334246.md`
- desktop cross-device snapshot: `report-desktop-1790560405301-887252.md`

### R4
- first iPad snapshot: `report-ios-1790561747425-798001.md`
- second/stable iPad snapshot: `report-ios-1790562625891-555399.md`
- desktop cross-device snapshot: `report-desktop-1790562737539-931040.md`

Machine comparison of the retained report files confirmed:

| Repetition | iPad snapshot 1 vs 2 `## Results` | stable iPad vs desktop `## Results` |
|---|---|---|
| R1 | exact match | exact match |
| R2 | exact match | exact match |
| R3 | exact match | exact match |
| R4 | exact match | exact match |

Metadata such as report time, device role, and runtime adapter naturally differs between iPad and desktop; the observed matrix result blocks do not.

---

# 4. Matrix design

Experiment ID:

`fk-icloud-matrix-20260927`

Primary direction ID:

`primary-mobile-offline-desktop-online`

The iPad runtime was `CapacitorAdapter`.  
The desktop runtime was `FileSystemAdapter`.

The matrix deliberately varied:
- Visible vs Hidden roots;
- Vault vs DataAdapter writer routes;
- same-path independent store initialization;
- one colliding file;
- ten disjoint files;
- ten same-named colliding files;
- the candidate merge-tolerant `stores/<storeId>/...` topology.

## 4.1 Family A — standard store topology / API-route matrix

Each device independently created a different logical store at the same nominal condition root.

| Condition | Representation | Desktop route | Mobile route |
|---|---|---|---|
| A1 | Visible | Vault / Vault / Vault | Vault / Vault / Vault |
| A2 | Visible | Adapter / Adapter / Adapter | Adapter / Adapter / Adapter |
| A3 | Visible | Vault / Vault / Vault | Adapter / Adapter / Adapter |
| A4 | Visible | Adapter / Adapter / Adapter | Vault / Vault / Vault |
| A5 | Visible | directory+manifest Vault, document Adapter | same |
| A6 | Visible | directory+manifest Adapter, document Vault | same |
| A7 | Hidden | Adapter / Adapter / Adapter | Adapter / Adapter / Adapter |

The purpose was to test whether writer API route materially determines iCloud reconciliation topology.

## 4.2 Family B — topology stress

All Family B conditions used Adapter/Adapter on both devices.

| Condition | Representation | Topology |
|---|---|---|
| B1 | Visible | one same-named colliding child file |
| B2 | Hidden | one same-named colliding child file |
| B3 | Visible | ten disjoint child files per device |
| B4 | Hidden | ten disjoint child files per device |
| B5 | Visible | ten same-named colliding files with differing payloads |
| B6 | Hidden | ten same-named colliding files with differing payloads |

## 4.3 Family C — store-ID namespaced candidate

All Family C conditions used Adapter/Adapter on both devices.

The topology was:

```text
<outer-root>/
  stores/
    <store-A-id>/
      manifest.json
      document-00.json
      document-01.json
      document-02.json
    <store-B-id>/
      manifest.json
      document-00.json
      document-01.json
      document-02.json
```

- **C1:** Visible outer root.
- **C2:** Hidden outer root.

Critically, there is **no shared mutable root manifest** that claims authority over both independently initialized stores.

---

# 5. Repetition order

The order varied between repetitions to reduce the chance that a simple position/timing artifact would masquerade as a condition effect.

- **R1:** `A1,A2,A3,A4,A5,A6,A7,B1,B2,B3,B4,B5,B6,C1,C2`
- **R2:** `A6,A7,B1,B2,B3,B4,B5,B6,C1,C2,A1,A2,A3,A4,A5`
- **R3:** `C2,C1,B6,B5,B4,B3,B2,B1,A7,A6,A5,A4,A3,A2,A1`
- **R4:** `B3,B2,B1,A7,A6,A5,A4,A3,A2,A1,C2,C1,B6,B5,B4`

The condition order was the same on both devices within a repetition.

This is disciplined falsification, not a statistical randomized trial. We are not assigning p-values or claiming a probability distribution for iCloud behavior.

---

# 6. Exact final classifications and aggregate fingerprints

The following values come from the **stable second iPad report** for each repetition. Each repetition’s desktop report has the exact same `## Results` block.

| Condition | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| A1 | `OTHER_OBSERVED` `eed320c0` | `SPLIT_COHERENT` `8f739ec7` | `SPLIT_COHERENT` `cdc4c4a7` | `SPLIT_COHERENT` `6ab47623` |
| A2 | `OTHER_OBSERVED` `0529f987` | `SPLIT_COHERENT` `0b210527` | `SPLIT_COHERENT` `0676ed87` | `SPLIT_COHERENT` `47d282cf` |
| A3 | `OTHER_OBSERVED` `3e5ee134` | `SPLIT_COHERENT` `f4251edf` | `SPLIT_COHERENT` `9104cb27` | `SPLIT_COHERENT` `26d64d3f` |
| A4 | `OTHER_OBSERVED` `e4258153` | `SPLIT_COHERENT` `1d8b9ca7` | `SPLIT_COHERENT` `b188f017` | `SPLIT_COHERENT` `4f6dadeb` |
| A5 | `OTHER_OBSERVED` `b310469e` | `SPLIT_COHERENT` `36e09833` | `SPLIT_COHERENT` `769eb30f` | `SPLIT_COHERENT` `a358224b` |
| A6 | `OTHER_OBSERVED` `d1d0da59` | `SPLIT_COHERENT` `3b5dbd1b` | `SPLIT_COHERENT` `17005447` | `SPLIT_COHERENT` `e1f45867` |
| A7 | `MERGED_MIXED_INVALID` `a671d8d0` | `MERGED_MIXED_INVALID` `cb3d1195` | `MERGED_MIXED_INVALID` `6387c16e` | `MERGED_MIXED_INVALID` `088864e3` |
| B1 | `OTHER_OBSERVED` `cb675f54` | `SPLIT_COHERENT` `12df54a0` | `SPLIT_COHERENT` `bac3ed1a` | `OTHER_OBSERVED` `caa48553` |
| B2 | `WINNER_ONLY` `9d224483` | `WINNER_ONLY` `21e179ae` | `WINNER_ONLY` `ef763299` | `WINNER_ONLY` `1679d49c` |
| B3 | `MERGED_COHERENT_UNION` `0ca9a9c7` | `SPLIT_COHERENT` `2c1e349d` | `SPLIT_COHERENT` `f384a42b` | `SPLIT_COHERENT` `f2f426dd` |
| B4 | `MERGED_COHERENT_UNION` `4da15bd6` | `MERGED_COHERENT_UNION` `700eebdd` | `MERGED_COHERENT_UNION` `6951bf74` | `MERGED_COHERENT_UNION` `52498c7b` |
| B5 | `SPLIT_COHERENT` `728178df` | `SPLIT_COHERENT` `bfdd553d` | `OTHER_OBSERVED` `16e67af5` | `SPLIT_COHERENT` `5dbe81d5` |
| B6 | `WINNER_ONLY` `27eeab9b` | `WINNER_ONLY` `0e0c505c` | `WINNER_ONLY` `51b5f91d` | `WINNER_ONLY` `6a38737e` |
| C1 | `SPLIT_COHERENT` `3e4e2d6c` | `SPLIT_COHERENT` `71bbf3cc` | `SPLIT_COHERENT` `2018f388` | `SPLIT_COHERENT` `82358ad8` |
| C2 | `MERGED_COHERENT_UNION` `a36a3d23` | `MERGED_COHERENT_UNION` `3228db37` | `MERGED_COHERENT_UNION` `b06ed9ef` | `MERGED_COHERENT_UNION` `353ad2e3` |

These fingerprints are experiment/repetition-specific because the fixture payload itself contains the repetition and condition identity. They are useful for detecting exact state equality **within** a repetition, not for expecting equal hashes across different repetitions.

---

# 7. Observed topology by repetition

## 7.1 R1

R1 exposed a relatively merge-heavy Visible outcome.

- **A1–A6:** `OTHER_OBSERVED`.
  - Both device documents were present in one Visible root.
  - iCloud preserved the competing manifest as a provider-renamed `manifest 2.json` rather than splitting the whole root.
  - The exact nominal/conflict-copy role differed in A5 versus the other A conditions, but the key behavior was one root plus a renamed manifest conflict artifact.
- **A7 Hidden:** `MERGED_MIXED_INVALID`.
  - One root contained files from both store IDs under a single surviving manifest.
- **B1 Visible:** one root with `collision.json` plus `collision 2.json` → `OTHER_OBSERVED`.
- **B2 Hidden:** `WINNER_ONLY`, mobile side.
- **B3 Visible disjoint files:** all twenty files recursively unioned into one coherent root → `MERGED_COHERENT_UNION`.
- **B4 Hidden disjoint files:** same high-level coherent 20-file union.
- **B5 Visible ten collisions:** two complete coherent sibling roots → `SPLIT_COHERENT`.
- **B6 Hidden ten collisions:** all ten ordinary surviving files were mobile → `WINNER_ONLY`.
- **C1 Visible namespaced:** `SPLIT_COHERENT`.
- **C2 Hidden namespaced:** `MERGED_COHERENT_UNION`.

R1 alone already showed that “Visible means split” and “Hidden means merge” were too simplistic.

## 7.2 R2

R2 shifted many Visible cases to whole-root splitting.

- **A1–A6 Visible:** all `SPLIT_COHERENT`; one complete mobile root and one complete desktop sibling root.
- **A7 Hidden:** again `MERGED_MIXED_INVALID`.
- **B1 Visible:** `SPLIT_COHERENT`.
- **B2 Hidden:** mobile `WINNER_ONLY`.
- **B3 Visible disjoint:** `SPLIT_COHERENT` rather than R1’s merged union.
- **B4 Hidden disjoint:** `MERGED_COHERENT_UNION`.
- **B5 Visible ten collisions:** `SPLIT_COHERENT`.
- **B6 Hidden ten collisions:** mobile `WINNER_ONLY`.
- **C1 Visible namespaced:** `SPLIT_COHERENT`.
- **C2 Hidden namespaced:** `MERGED_COHERENT_UNION`.

The A1–A6 conditions moved together despite different Vault/Adapter writer routes.

## 7.3 R3

R3 largely reproduced R2, with one especially valuable new shape.

- **A1–A6 Visible:** again all `SPLIT_COHERENT`.
- **A7 Hidden:** again `MERGED_MIXED_INVALID`.
- **B1 Visible:** `SPLIT_COHERENT`.
- **B2 Hidden:** mobile `WINNER_ONLY`.
- **B3 Visible disjoint:** `SPLIT_COHERENT`.
- **B4 Hidden disjoint:** `MERGED_COHERENT_UNION`.
- **B5 Visible ten collisions:** **one single root** containing:
  - ten mobile nominal files `file-00.json` … `file-09.json`;
  - ten desktop provider-renamed conflict copies `file-00 2.json` … `file-09 2.json`.
  - classifier: `OTHER_OBSERVED`.
- **B6 Hidden ten collisions:** mobile `WINNER_ONLY`.
- **C1 Visible namespaced:** `SPLIT_COHERENT`.
- **C2 Hidden namespaced:** `MERGED_COHERENT_UNION`.

R3 proves that provider conflict preservation can occur at **individual-file granularity inside a root**, not only as sibling root directories.

## 7.4 R4

R4 again mostly resembled R2 but moved the per-file conflict-copy behavior to B1.

- **A1–A6 Visible:** all `SPLIT_COHERENT`.
- **A7 Hidden:** again `MERGED_MIXED_INVALID`.
- **B1 Visible:** one root containing mobile `collision.json` plus desktop `collision 2.json` → `OTHER_OBSERVED`.
- **B2 Hidden:** mobile `WINNER_ONLY`.
- **B3 Visible disjoint:** `SPLIT_COHERENT`.
- **B4 Hidden disjoint:** `MERGED_COHERENT_UNION`.
- **B5 Visible ten collisions:** back to two complete sibling roots → `SPLIT_COHERENT`.
- **B6 Hidden ten collisions:** mobile `WINNER_ONLY`.
- **C1 Visible namespaced:** `SPLIT_COHERENT`.
- **C2 Hidden namespaced:** `MERGED_COHERENT_UNION`.

This is especially useful because B1 and B5 in the same repetition reconciled at different granularities.

---

# 8. What the replicated matrix supports

## 8.1 iCloud reconciliation topology is not a dependable application-level contract

The same broad class of Visible conflict produced different stable shapes across repetitions:

- one root with recursively merged/disjoint content;
- complete sibling root copies;
- provider-renamed conflicting child files inside one root.

Therefore Finders Keepers must **not** make correctness depend on one expected iCloud conflict shape.

The safe model is:

> iCloud/File Provider may split, recursively merge, preserve conflicts through renamed children, or expose only one ordinary surviving same-path value. FK must inspect and validate what is actually present.

## 8.2 Vault API vs DataAdapter is not showing distributed conflict semantics we can rely on

A1–A6 deliberately varied writer routes.

Observed behavior:
- R1: all six landed in the same broad one-root/provider-renamed-manifest family.
- R2: all six split coherently.
- R3: all six split coherently.
- R4: all six split coherently.

The different API routes did not separate into reproducibly different reconciliation classes.

Current working conclusion:

> Vault vs DataAdapter matters for local platform behavior and representation, but the matrix provides no basis for treating one route as a distributed iCloud CAS/conflict primitive.

## 8.3 Physical path is not store identity

A7 repeatedly produced a single directory whose contents belonged to different logical stores.

Therefore:
- directory path is a locator;
- a manifest is not sufficient by itself to prove whole-directory coherence;
- every persisted artifact must be bound to its `storeId`;
- the repository must validate candidate stores as a whole;
- mixed store bindings halt normal operation and enter recovery.

## 8.4 Bounded discovery must include more than sibling roots

Earlier we already knew to scan deterministic provider-created sibling roots without hard-coding the literal suffix `" 2"`.

R3 and R4 add another requirement:

> bounded recovery discovery must also tolerate provider-renamed **files inside a candidate root**.

Do not assume every competing state will appear as a sibling directory.

## 8.5 Provider-preserved conflict copies are useful evidence, not a durability guarantee

Visible B1/B5 sometimes preserved both sides through root or file conflict copies.

Hidden B2/B6 repeatedly exposed only the mobile ordinary winner.

Therefore:

> Finders Keepers may recover from competing representations it actually observes, but cannot promise preservation of provider-overwritten bytes that never become visible to it.

This keeps the earlier preservation guarantee appropriately narrow.

---

# 9. The `stores/<storeId>/...` result

The strongest positive architectural result of the matrix is Family C.

Across **all four primary repetitions**:

- **C1 Visible** survived as `SPLIT_COHERENT`.
  - The provider could split the outer root, but each resulting root contained a complete internally coherent store-ID subtree.
- **C2 Hidden** survived as `MERGED_COHERENT_UNION`.
  - The provider recursively merged the outer root, but the store-ID subtrees remained separate, complete, and internally bound.

No C repetition produced a cross-store Frankenstein representation.

This does **not** prove that the topology is universally safe under every provider behavior.

It does support the specific design claim we were testing:

> Explicit store-ID namespacing makes both observed outer-directory behaviors — splitting and recursive union — recoverable without mixing the logical contents of different stores.

This is a substantially stronger design basis than a shared root manifest plus heterogeneous children.

---

# 10. What store-ID namespacing does not solve

`stores/<storeId>/...` solves the **cross-store directory-mixing** problem represented by A7.

It does **not** solve:

- two devices editing the same canonical record in the same logical store while disconnected;
- provider reconciliation choosing one ordinary same-path file;
- a valid offline write disappearing from the ordinary current filesystem view.

That remains a separate same-store/same-file durability problem.

The current likely direction remains:

> a **small, bounded, FK-owned immutable recovery layer with unique mutation/revision identifiers**, alongside mutable canonical snapshots.

The important properties are:

- unique filenames for immutable recovery records, reducing direct provider path collisions;
- explicit document/store identity;
- base digest/revision linkage;
- enough before/after information for bounded recovery;
- bounded retention;
- no timestamps as truth authority;
- no claim of distributed transactionality;
- not a generalized event-sourcing architecture unless later evidence forces that complexity.

This mechanism has **not yet been selected or implemented**.

---

# 11. Hidden and Visible: current product/storage interpretation

Do **not** reduce the decision to “Hidden won” or “Visible won.”

The better model now is a **capability-qualified dual representation**.

## Hidden

Why we still want it where viable:
- cleaner user experience;
- canonical machinery stays out of ordinary vault browsing;
- avoids unnecessary visible application-owned files;
- ordinary CRUD/lifecycle behavior has already worked on desktop and iPad.

What the matrix says Hidden must tolerate:
- recursive directory union;
- mixed stores if an un-namespaced layout is used;
- same-path colliding files where only one ordinary winner may be visible.

Architectural response:
- store-ID namespacing;
- whole-store validation;
- bounded recovery history for same-store edits;
- provider/transport qualification.

## Visible

Why it remains important:
- compatibility for transports/configurations where hidden folders cannot be relied on;
- easier direct user inspection/export/recovery if needed.

What the matrix says Visible must tolerate:
- whole-root splitting;
- recursive union in at least some conditions;
- per-file provider conflict copies;
- same-file ordinary winner behavior from earlier tests;
- non-deterministic conflict granularity.

Architectural response:
- the same store-ID namespacing;
- bounded root and file conflict discovery;
- the same canonical schemas;
- the same higher-level recovery semantics.

## Working architectural implication

It is plausible that Finders Keepers can offer both:

```text
canonical domain / repository boundary
             |
      storage representation
        /             \
   Hidden              Visible
 preferred UX      compatibility path
 where qualified    where required
```

Both would carry the same logical store model and schemas.

The chosen representation can depend on transport capability and user configuration rather than being a universal architectural winner.

A storage-mode change remains an explicit guarded migration.

---

# 12. Stable canonical-storage principles after the matrix

The following principles survived and were strengthened:

1. Canonical domain data remains storage-neutral.
2. Source adapter and storage adapter are independent axes.
3. `data.json` is settings only, never the canonical database.
4. Store path, `storeId`, `SourceRecordId`, and `AnnotationId` are distinct identities.
5. Every persisted canonical artifact binds to its `storeId`.
6. Canonical discovery is independent of `data.json`.
7. Bootstrap happens only after deterministic candidate locations are positively `ABSENT`.
8. Discovery distinguishes absent, valid, incomplete, invalid, unsupported, and unavailable states.
9. Provider-created siblings/conflict copies are recovery evidence, not automatic winners.
10. Timestamps do not choose canonical truth.
11. Storage-mode changes are durable migrations.
12. FK-level guarded writes are useful local concurrency control but not distributed/provider CAS.
13. FK preserves divergent/invalid representations it actually observes; it cannot preserve bytes the provider overwrote before FK ever sees them.
14. Whole-vault backup/export guidance remains part of the public-safety story.
15. A schema write fence is still required to prevent old-client downgrade writes.
16. Hidden/Visible backend APIs may expose different local guarantees; the repository boundary must not pretend away meaningful differences.
17. The new candidate store layout should be explicitly **merge/split tolerant**, most likely through `stores/<storeId>/...`.
18. Same-store concurrent/offline edits require a separate bounded recovery mechanism.

---

# 13. What is not yet concluded

The following claims would be premature:

- “Visible folders always split on iCloud.”
- “Hidden folders always recursively merge on iCloud.”
- “Visible is safe while Hidden is unsafe.”
- “DataAdapter is safer than Vault API for cloud conflict reconciliation.”
- “Vault API is safer than DataAdapter.”
- “iCloud always preserves a conflict copy.”
- “iCloud always loses the desktop side.”
- “The `stores/<storeId>` layout is universally safe on every provider.”
- “The B0 persistence gate is passed.”
- “Production canonical persistence can now be wired.”

The evidence is strong enough to shape the next design, not strong enough to turn provider behavior into a contract.

---

# 14. Next experiment: reverse-direction falsification

The original plan remains:

> after synthesizing the four primary repetitions, reverse the device/reconnection direction and try to falsify the working hypothesis.

The current harness source identifies the experiment as:

`primary-mobile-offline-desktop-online`

Therefore the reverse-direction run should **not** be improvised by merely reusing the current primary labels as though they meant something else.

Before the reverse test:
- preserve R1–R4 primary artifacts;
- do not clean or reuse their roots;
- extend/parameterize the disposable harness with an explicit reverse direction ID;
- keep condition definitions comparable;
- decide the reverse repetition count/order deliberately;
- baseline both devices clean for the new reverse experiment before any writes.

The provisional hypothesis to challenge is:

> **iCloud reconciliation topology is provider-controlled and non-deterministic at the plugin level; correctness must come from Finders Keepers’ own identity, namespacing, validation, and recovery semantics. `stores/<storeId>/...` is tolerant of the split and recursive-union directory behaviors observed so far, while same-store same-path edits still require an independent recovery mechanism.**

A reverse result that changes which device becomes an ordinary winner, changes split/merge tendencies, or exposes new shapes would not be a failure of the experiment. It is exactly the kind of evidence the falsification phase is meant to surface.

---

# 15. Current B0 status

**B0 is not passed.**

Do not wire production canonical persistence yet.

The remaining storage work includes at least:

- reverse-direction iCloud falsification/challenge;
- promote the merge/split-tolerant store topology into a revised canonical architecture if it survives;
- decide the bounded immutable recovery-history shape;
- specify discovery of provider-created root and file conflicts;
- specify Hidden/Visible transport capability/qualification behavior;
- preserve explicit migration semantics between storage representations;
- complete the other previously identified B0 gates such as backup/export and local-session persistence where still outstanding.

---

# 16. Handoff note for a new chat

A new thread should begin from this state, not from the older “Visible vs Hidden winner” framing:

> The four-repetition, fifteen-condition **primary-direction iCloud matrix is complete**. Each repetition stabilized across two successive iPad read-only observations and then matched the desktop `## Results` block exactly. Visible conflict topology varied between whole-root splits, merged/union states, and per-file provider-renamed conflict copies. Hidden un-namespaced standard stores repeatedly demonstrated recursive merge/mixed-store risk, and hidden same-name collisions repeatedly exposed only one ordinary winner. Vault versus DataAdapter routing did not produce a reproducible distributed conflict advantage. The `stores/<storeId>/...` topology survived every primary repetition coherently: Visible C1 tolerated outer splitting, Hidden C2 tolerated recursive outer merging. That solves cross-store mixing but not same-store same-file offline edits, so a small bounded immutable recovery layer is still needed. **Do not choose Hidden or Visible as a universal winner**: Hidden remains the preferred UX representation where the transport supports it; Visible remains a compatibility representation where hidden storage is unsuitable. Both should share schemas and recovery semantics behind the storage-neutral repository boundary. Production persistence remains gated. The next storage experiment is an explicitly labeled reverse-direction falsification run.

Preserve and consult the exact report filenames listed in Section 3 before making any new storage conclusions.
