# Finders Keepers — iCloud Storage Matrix Reverse-Direction Addendum
## 2026-09-28

**Status:** durable experimental-evidence addendum  
**Suggested repo home:** `docs/review/Finders_Keepers_iCloud_Storage_Matrix_Reverse_Direction_Addendum_2026-09-28.md`  
**Companion artifact:** `Finders_Keepers_iCloud_Storage_Matrix_Primary_Direction_Synthesis_2026-09-28.md`  
**Purpose:** record the planned reverse-direction falsification run, preserve its exact evidence, compare it against the four primary repetitions, and update the storage working hypothesis without rewriting the primary-direction record.  
**Authority:** this is an evidence-and-handoff artifact. It does not authorize production canonical persistence.

---

# 1. Executive state

The planned **reverse-direction iCloud storage matrix is complete**.

Two reverse repetitions were run:

- **RV1**
- **RV2**

The reverse direction was:

> **desktop offline first → desktop initializes → mobile initializes while desktop remains offline → mobile/iCloud settles → desktop reconnects → no further writes → repeated desktop read-only inspection until stable → iPad read-only cross-device inspection**

This deliberately mirrored the primary direction:

> **mobile offline first → mobile initializes → desktop initializes while mobile remains offline → desktop/iCloud settles → mobile reconnects → no further writes → repeated mobile read-only inspection until stable → desktop read-only cross-device inspection**

For both reverse repetitions:

1. desktop baseline was confirmed clean with all 15 conditions `ABSENT`;
2. iPad baseline was confirmed clean with all 15 conditions `ABSENT`;
3. desktop initialized all 15 conditions while offline and reported all `VALID`, `COMPLETE=true`;
4. iPad initialized all 15 conditions while the desktop remained offline and reported all `VALID`, `COMPLETE=true`;
5. the mobile/iCloud side was allowed to settle while desktop remained offline;
6. desktop reconnected;
7. no further writes were performed;
8. two successive desktop read-only reports were taken after settling;
9. the complete `## Results` block in those two desktop reports was exactly identical;
10. an iPad read-only report was then taken;
11. the iPad `## Results` block was exactly identical to the stable second desktop `## Results` block.

Therefore:

> **RV1 = STABLE + CROSS-DEVICE CONVERGED**  
> **RV2 = STABLE + CROSS-DEVICE CONVERGED**

Together with primary R1–R4, the matrix now contains **six stable, cross-device-converged repetitions** across the two opposed synchronization directions.

The reverse run produced genuinely new evidence. Most importantly:

- the Hidden same-path collision conditions B2 and B6 switched ordinary survivor from **mobile in all four primary repetitions** to **desktop in both reverse repetitions**;
- A7 remained a mixed-store invalid merge, but its surviving shared manifest likewise switched from mobile in the primary runs to desktop in the reverse runs;
- RV2 C1 produced a new stable provider reconciliation shape in which the collision was resolved at an **intermediate directory boundary**: one common outer root contained both `stores/` and provider-created `stores 2/`, with one complete coherent logical store under each;
- Family C still preserved both logical store-ID subtrees coherently in both reverse repetitions.

The reverse experiment therefore **falsifies the tempting interpretation that mobile intrinsically wins these Hidden collisions**. It strengthens the broader working model that iCloud/File Provider reconciliation is sensitive to synchronization/reconciliation circumstances and is not an application-level conflict contract.

However, the experiment deliberately confounds two properties: the device that was **offline-first** was also the device that later **reconnected**. The evidence therefore supports saying that the survivor tracked the **experimental direction/order**. It does **not** identify whether offline-first status, reconnecting status, or some other ordering effect is causal.

---

# 2. Relationship to the primary-direction synthesis

Read this document as an addendum to:

`Finders_Keepers_iCloud_Storage_Matrix_Primary_Direction_Synthesis_2026-09-28.md`

The primary synthesis remains the authoritative record of:

- matrix condition definitions;
- primary R1–R4 protocol and results;
- the Hidden/Visible dual-representation interpretation;
- canonical storage principles established before reversal;
- the original rationale for the reverse-direction falsification run.

This addendum updates that artifact in three specific ways:

1. **Section 14, “Next experiment: reverse-direction falsification,” is now complete rather than pending.**
2. The statement that `stores/<storeId>/...` tolerated observed outer-root split and recursive-union behavior needs refinement: RV2 shows that a provider may split at an **intermediate namespace boundary** as well.
3. The current B0 checklist should no longer list the reverse-direction iCloud challenge as outstanding.

Nothing in the reverse run supports returning to a universal “Hidden vs Visible winner” framing. The capability-qualified dual-representation model remains the appropriate product/storage interpretation.

---

# 3. Harness extension and validation

The disposable matrix harness was extended before any reverse fixtures were initialized.

Reverse direction ID:

`reverse-desktop-offline-mobile-online`

The implementation preserved literal device/store roles:

- desktop = role `desktop`, store A;
- mobile = role `mobile`, store B.

Roles were **not** renamed according to which device was offline first.

The reverse roots were given distinct deterministic identities so they could not collide with or overwrite primary R1–R4 evidence.

The worker reported the following validation before the live experiment:

- focused matrix tests: **17 passed**;
- full suite: **29 files, 294 tests passed**;
- typecheck: passed;
- format check: passed;
- build: passed;
- `git diff --check`: passed;
- lint: passed with the already-known `Vault.delete()` warning;
- deployment to the dedicated `dev-vault`: succeeded;
- deployed `main.js`, `manifest.json`, and `styles.css`: byte-for-byte matches with repository artifacts;
- plugin reload: succeeded;
- `dev:errors`: no errors captured;
- command registry: exactly 12 expected matrix commands, with no duplicates;
- all eight primary R1–R4 commands remained registered;
- no reverse matrix command had been executed before the live protocol began;
- no personal-vault or production canonical state was touched.

The implementation was then treated as frozen for the reverse experiment.

---

# 4. Reverse repetition orders

The reverse run intentionally used two substantially different condition orders already represented in the primary experiment rather than inventing a new randomized schedule.

## RV1

Equivalent to the primary R2 order:

`A6, A7, B1, B2, B3, B4, B5, B6, C1, C2, A1, A2, A3, A4, A5`

## RV2

Equivalent to the primary R3 order:

`C2, C1, B6, B5, B4, B3, B2, B1, A7, A6, A5, A4, A3, A2, A1`

This gave the reverse direction one replication while also challenging it under very different write ordering.

---

# 5. Retained reverse evidence files

## RV1

- desktop snapshot 1: `report-desktop-1790604420480-159608.md`
- desktop snapshot 2 / stable: `report-desktop-1790605337416-230716.md`
- iPad cross-device snapshot: `report-ios-1790605538983-300743.md`

Machine comparison of the complete `## Results` block:

- desktop snapshot 1 vs desktop snapshot 2: **exact match**;
- stable desktop vs iPad: **exact match**;
- results-block length: **173,205 characters**;
- SHA-256 of the complete results block: `33c00e0a10b287b2da1effd62964c70d754e48a92baf81b21c786be06f5ebb4b`.

## RV2

- desktop snapshot 1: `report-desktop-1790607606092-74601.md`
- desktop snapshot 2 / stable: `report-desktop-1790609845386-237526.md`
- iPad cross-device snapshot: `report-ios-1790609955867-265547.md`

Machine comparison of the complete `## Results` block:

- desktop snapshot 1 vs desktop snapshot 2: **exact match**;
- stable desktop vs iPad: **exact match**;
- results-block length: **173,721 characters**;
- SHA-256 of the complete results block: `88130fa34f1c8e1618bc7eb9e35d574bd6fe96082d9d620835537bc4d04afea5`.

Report-level metadata such as time, device label, and adapter runtime differs naturally between desktop and iPad. The matrix `## Results` sections are identical within each repetition.

---

# 6. Exact reverse classifications and aggregate fingerprints

The following values come from the stable second desktop report for each reverse repetition. Each repetition’s iPad report has the exact same `## Results` block.

| Condition | RV1 | RV2 |
|---|---|---|
| A1 | `SPLIT_COHERENT` `3a1b3d17` | `SPLIT_COHERENT` `bb47750b` |
| A2 | `SPLIT_COHERENT` `90a384ff` | `SPLIT_COHERENT` `fb4850bb` |
| A3 | `SPLIT_COHERENT` `c374dd17` | `SPLIT_COHERENT` `dc082973` |
| A4 | `SPLIT_COHERENT` `b62d35ab` | `SPLIT_COHERENT` `ebd4b897` |
| A5 | `SPLIT_COHERENT` `4a889167` | `SPLIT_COHERENT` `ee782ef3` |
| A6 | `SPLIT_COHERENT` `bc0f260b` | `SPLIT_COHERENT` `cb7ed7ef` |
| A7 | `MERGED_MIXED_INVALID` `ced15505` | `MERGED_MIXED_INVALID` `8440803c` |
| B1 | `OTHER_OBSERVED` `5c425e48` | `SPLIT_COHERENT` `4e8df6dc` |
| B2 | `WINNER_ONLY` `86cb77c0` — desktop | `WINNER_ONLY` `0b1253d1` — desktop |
| B3 | `SPLIT_COHERENT` `c58698dd` | `SPLIT_COHERENT` `91747f2d` |
| B4 | `MERGED_COHERENT_UNION` `12522eb6` | `MERGED_COHERENT_UNION` `631dcc21` |
| B5 | `SPLIT_COHERENT` `e12305a9` | `SPLIT_COHERENT` `3846b96d` |
| B6 | `WINNER_ONLY` `01f8f6bb` — desktop ×10 | `WINNER_ONLY` `5929f224` — desktop ×10 |
| C1 | `SPLIT_COHERENT` `de862bf4` | `OTHER_OBSERVED` `68a168d2` — coherent `stores/` + `stores 2/` |
| C2 | `MERGED_COHERENT_UNION` `bb331721` | `MERGED_COHERENT_UNION` `c7da6f67` |

As in the primary synthesis, fingerprints are repetition-specific because fixture payloads contain the repetition and condition identity. They are useful for exact-state equality within a repetition, not for expecting matching hashes across repetitions.

---

# 7. RV1 topology

RV1 strongly resembled the split-heavy primary repetitions while reversing the ordinary Hidden collision winner.

- **A1–A6 Visible:** all `SPLIT_COHERENT`.
  - The nominal root contained the complete desktop fixture.
  - A provider-suffixed sibling root contained the complete mobile fixture.
- **A7 Hidden:** `MERGED_MIXED_INVALID`.
  - One root contained both desktop and mobile documents under a single surviving **desktop** manifest.
- **B1 Visible one-file collision:** `OTHER_OBSERVED`.
  - One root contained mobile `collision.json` and desktop `collision 2.json`.
  - This demonstrates per-file provider conflict-copy behavior in the reverse direction as well.
- **B2 Hidden one-file collision:** `WINNER_ONLY`, **desktop**.
- **B3 Visible ten disjoint files per device:** `SPLIT_COHERENT`.
  - Desktop and mobile survived as separate complete sibling roots.
- **B4 Hidden ten disjoint files per device:** `MERGED_COHERENT_UNION`.
  - All twenty files survived in one coherent union.
- **B5 Visible ten same-name collisions:** `SPLIT_COHERENT`.
  - One complete desktop root and one complete mobile sibling root survived.
- **B6 Hidden ten same-name collisions:** `WINNER_ONLY`.
  - All ten ordinary surviving files were desktop.
- **C1 Visible namespaced:** `SPLIT_COHERENT`.
  - Desktop and mobile each survived as a complete logical store in separate outer roots.
- **C2 Hidden namespaced:** `MERGED_COHERENT_UNION`.
  - One outer root contained both complete store-ID subtrees under the common `stores/` namespace.

RV1 alone was enough to reject “mobile always wins Hidden same-path collisions” as an explanation of the primary B2/B6 results.

---

# 8. RV2 topology

RV2 replicated the important directional effects and added a new reconciliation granularity.

- **A1–A6 Visible:** all `SPLIT_COHERENT` again.
  - As in RV1, the nominal root held desktop and the provider-suffixed root held mobile.
- **A7 Hidden:** `MERGED_MIXED_INVALID` again.
  - Both device documents survived under a single **desktop** manifest.
- **B1 Visible one-file collision:** `SPLIT_COHERENT`.
  - Unlike RV1’s per-file conflict copy, RV2 preserved the two colliding values in two complete sibling roots.
- **B2 Hidden one-file collision:** `WINNER_ONLY`, **desktop** again.
- **B3 Visible disjoint files:** `SPLIT_COHERENT`.
- **B4 Hidden disjoint files:** `MERGED_COHERENT_UNION`.
- **B5 Visible ten same-name collisions:** `SPLIT_COHERENT`.
- **B6 Hidden ten same-name collisions:** `WINNER_ONLY`, **desktop ×10** again.
- **C1 Visible namespaced:** `OTHER_OBSERVED`, with a new stable shape:

```text
C1/
  stores/
    <desktop-store-A>/
      manifest.json
      document-00.json
      document-01.json
      document-02.json
  stores 2/
    <mobile-store-B>/
      manifest.json
      document-00.json
      document-01.json
      document-02.json
```

  - Both logical stores remained complete and internally bound to their own store IDs.
  - iCloud did **not** split at the outer condition root.
  - It did **not** recursively union both store-ID children under one literal `stores/` directory.
  - Instead, it created a provider-renamed competing directory at the **intermediate namespace boundary**.
- **C2 Hidden namespaced:** `MERGED_COHERENT_UNION` again, with both complete store-ID subtrees under one common `stores/` directory.

The C1 state remained byte-for-byte identical across the later desktop snapshot and the iPad cross-device inspection, so this was a stable converged result rather than an observed intermediate reconciliation state.

---

# 9. Cross-direction comparison

## 9.1 Hidden same-path ordinary winners track experimental direction, not device type

The strongest falsification result is B2/B6.

| Condition | Primary R1–R4 | Reverse RV1–RV2 |
|---|---|---|
| B2 Hidden one colliding file | mobile ordinary winner in **4/4** | desktop ordinary winner in **2/2** |
| B6 Hidden ten colliding files | mobile ordinary winner for all ten files in **4/4** | desktop ordinary winner for all ten files in **2/2** |
| A7 surviving shared manifest | mobile in **4/4** | desktop in **2/2** |

In the primary direction, **mobile** was both:

- the device that initialized while offline first; and
- the device that later reconnected.

In the reverse direction, **desktop** held both of those roles.

Therefore the evidence supports:

> the observed ordinary survivor is direction/order-sensitive and is not a stable mobile-vs-desktop property.

The experiment does **not** distinguish whether the relevant causal variable is:

- offline-first status;
- reconnecting status;
- some interaction between them;
- or another provider-internal ordering effect correlated with the protocol.

That distinction is not required for the current architecture: all of those possibilities imply that Finders Keepers must not treat the ordinary surviving same-path file as an application-level truth-selection rule.

## 9.2 A7 remains a robust warning against shared-root manifest authority

Across all six repetitions:

- A7 was `MERGED_MIXED_INVALID`;
- a single Hidden physical root contained material from both logical stores;
- one shared manifest survived and belonged to only one of them.

The surviving manifest’s device role changed with experiment direction, but the invalid mixed-store structure did not.

This strongly reinforces:

> a physical directory path and a single root manifest cannot safely serve as whole-store identity/authority under recursive provider reconciliation.

Every canonical artifact must remain bound to its logical `storeId`, and candidate validity must be checked across the whole discovered representation.

## 9.3 Vault vs DataAdapter still shows no distributed conflict advantage

A1–A6 vary Vault/DataAdapter writer routes.

Reverse results:

- RV1: A1–A6 all `SPLIT_COHERENT`;
- RV2: A1–A6 all `SPLIT_COHERENT`.

This extends the primary observation that the API-route variants tend to move together within a repetition rather than separating into distinct distributed-reconciliation classes.

Current working conclusion remains:

> Vault API versus DataAdapter matters for local Obsidian/platform semantics and for which representation is addressable, but there is still no evidence that either route provides a distributed iCloud CAS/conflict primitive.

## 9.4 Visible conflict granularity remains variable

Across primary and reverse repetitions, Visible cases have now stably exhibited:

- complete sibling outer roots;
- recursive union/merge of disjoint children;
- provider-renamed conflicting individual files inside one root;
- provider-renamed conflicting manifests inside one root;
- provider-renamed **intermediate directories** inside one outer root.

The reverse experiment therefore strengthens rather than weakens the primary conclusion:

> iCloud reconciliation topology is not a dependable application-level contract.

A correctness design cannot assume that conflict preservation will occur at one fixed filesystem level.

## 9.5 Family C remains the strongest positive topology signal, but the interpretation is refined

Across all six stable repetitions:

- both logical store IDs remained recoverably distinct in C-family observations;
- no C repetition produced an A7-style cross-store Frankenstein representation inside a single logical store subtree;
- C2 was `MERGED_COHERENT_UNION` in **all 6/6 repetitions**;
- C1 preserved both logical stores in **all 6/6 repetitions**, but RV2 exposed a new physical arrangement at the intermediate `stores` directory boundary.

The original positive claim should therefore be refined from:

> `stores/<storeId>/...` tolerates observed outer-root splitting and recursive union.

To:

> **explicit store-ID subtrees provide a logical merge/split boundary that remained coherent across all observed provider outcomes, but the provider may rename or split ancestors at more than one structural level. Discovery therefore cannot assume one literal physical `stores/` path.**

This is stronger as an identity result and more cautious as a path result.

---

# 10. New bounded-discovery requirement from RV2 C1

Before RV2, the evidence already required bounded discovery of:

- known canonical candidate roots;
- provider-created sibling roots;
- provider-renamed conflicting files inside a recognized root.

RV2 C1 adds another required case:

- provider-created sibling **directories at an intermediate FK-owned namespace boundary**.

The production design should therefore avoid a rule equivalent to:

> find one candidate outer root, then require exactly one literal child named `stores/`.

A safer design direction is **bounded structural discovery**:

1. begin only from deterministic FK-owned candidate locations;
2. inspect the finite structural levels Finders Keepers itself owns;
3. recognize provider-created sibling/conflict branches at those known boundaries without hard-coding a particular suffix such as `" 2"`;
4. identify logical stores by validated `storeId`-bound content, not by physical branch name;
5. preserve every observed coherent competing representation as recovery evidence;
6. halt ordinary authority selection when discovered representations conflict or are mixed/invalid;
7. do not turn this into an arbitrary recursive scan of the user’s vault.

This is an architectural requirement, not yet an implementation specification. The exact discovery grammar and limits still need to be designed and tested.

---

# 11. What the reverse experiment falsified, strengthened, and did not answer

## Falsified

The following interpretation is no longer tenable:

> “Hidden iCloud collisions preferentially keep the mobile value.”

The reverse run produced desktop ordinary winners in the same conditions in both repetitions.

## Strengthened

The reverse evidence strengthens these working conclusions:

- provider reconciliation is direction/order-sensitive and not a truth-selection contract;
- same-path mutable files remain unsafe as the sole durability mechanism for disconnected writes;
- physical path is not logical identity;
- store-ID binding is necessary;
- A7-style shared-root manifest authority is unsafe;
- Vault/DataAdapter choice does not supply distributed conflict semantics;
- Visible conflict preservation may occur at several filesystem granularities;
- Hidden and Visible need the same higher-level validation/recovery model behind a storage-neutral repository boundary;
- `stores/<storeId>/...` remains the strongest tested cross-store isolation concept, provided discovery is expressed logically rather than as one immutable physical path;
- a separate bounded immutable recovery mechanism is still needed for same-store/same-file offline writes.

## Still unanswered

The reverse run does **not** establish:

- which exact synchronization-order variable causes the B2/B6 winner flip;
- a contractual rule that the offline-first/reconnecting device will always win;
- that Hidden always merges or Visible always splits;
- that provider-created conflict copies will always be preserved;
- that `stores/<storeId>/...` is universally safe under every iCloud/File Provider state;
- that the same behavior applies to Syncthing, Obsidian Sync, Remotely Save, Dropbox, WebDAV, LiveSync, Google Drive, OneDrive, or any other transport;
- that the bounded immutable recovery layer’s exact record format has been selected;
- that production canonical persistence is ready to wire.

No further experiment is presently required merely to separate “offline-first” from “reconnecting” behavior. The architecture already cannot rely on either outcome. Such an experiment should only be added later if a concrete design choice would depend on that distinction.

---

# 12. Updated storage working hypothesis

After the four primary and two reverse repetitions, the current working hypothesis is:

> **iCloud/File Provider reconciliation topology and ordinary same-path survivor are sensitive to synchronization circumstances and are not application-level contracts. Finders Keepers correctness must therefore come from its own identities, store-ID-bound persistence, merge/split-tolerant namespacing, bounded structural discovery, whole-candidate validation, explicit recovery semantics, and independent protection for same-store mutable-write conflicts.**

A compact consequence map is:

```text
provider may split / merge / rename at multiple structural levels
                         |
                         v
physical path cannot be authority
                         |
                         v
storeId-bound logical subtrees + bounded structural discovery
                         |
             +-----------+-----------+
             |                       |
             v                       v
cross-store isolation         same-store edits
stores/<storeId>/...          still collide at same path
             |                       |
             v                       v
validate/recover branches     bounded immutable recovery layer
```

The Hidden/Visible representation decision remains separate:

- **Hidden** remains the preferable UX representation where the active transport can reliably carry it;
- **Visible** remains the compatibility representation where hidden storage is unsuitable or unsupported;
- both should use the same canonical logical schema, identities, validation, and recovery semantics;
- Hidden↔Visible remains an explicit guarded migration rather than a preference flip.

---

# 13. B0 status after the reverse run

**B0 is still not passed.**

The reverse-direction iCloud challenge is now complete and can be removed from the outstanding list.

The remaining storage work includes at least:

- revise the canonical storage architecture to incorporate the six-repetition evidence;
- promote store-ID namespacing as the current merge/split-tolerant logical topology, with the RV2 intermediate-directory caveat;
- specify bounded structural discovery for provider-created sibling roots, conflicting files, and intermediate directory branches;
- design the bounded immutable recovery-history/revision shape for same-store concurrent or offline writes;
- define how mutable canonical snapshots relate to immutable recovery records;
- define conflict/recovery UI and authority rules when multiple coherent or invalid candidates are discovered;
- specify Hidden/Visible transport qualification and capability behavior;
- preserve explicit guarded Hidden↔Visible migration semantics;
- complete other previously identified B0 gates, including backup/export and any still-open local-session persistence or minimum-platform requirements.

Production canonical persistence remains unauthorized until those gates are resolved.

---

# 14. Recommended next step

The highest-value next activity is **architecture synthesis, not another iCloud matrix**.

Specifically:

1. revise the canonical storage architecture against the combined primary + reverse evidence;
2. define the logical store namespace independently of physical provider branch names;
3. specify bounded structural discovery;
4. design the smallest bounded immutable recovery layer that protects same-store edits without turning Finders Keepers into a generalized event-sourcing system;
5. only then decide whether another targeted provider experiment is needed to falsify a particular implementation choice.

Additional broad iCloud repetitions are unlikely to add proportional value unless the revised architecture makes a new provider-behavior assumption that needs direct challenge.

---

# 15. Handoff note for a new chat or worker

> The Finders Keepers iCloud matrix now has **six stable, cross-device-converged repetitions**: four primary (`primary-mobile-offline-desktop-online`) and two reverse (`reverse-desktop-offline-mobile-online`). In all four primary runs, Hidden B2/B6 ordinary same-path winners were mobile; in both reverse runs they were desktop. A7’s surviving shared manifest switched the same way while remaining `MERGED_MIXED_INVALID`. This falsifies “mobile wins” and shows the ordinary survivor is direction/order-sensitive, although offline-first and reconnecting status remain confounded. Vault/DataAdapter route variants still show no reproducible distributed-conflict advantage. Visible reconciliation has now produced stable whole-root splits, recursive unions, per-file conflict copies, conflicting manifests, and an RV2 intermediate-directory split where one outer C1 root contained `stores/<desktop-store>` plus `stores 2/<mobile-store>`. Despite that new physical shape, Family C preserved both coherent store-ID subtrees in all six repetitions; C2 was `MERGED_COHERENT_UNION` in all six. The architectural lesson is to treat `stores/<storeId>/...` as a **logical namespacing boundary**, not as one immutable physical path, and to perform bounded structural discovery at known FK-owned levels. Same-store/same-file offline edits remain unsolved and still require a small bounded immutable recovery mechanism. Hidden remains preferred UX where the transport supports it; Visible remains a compatibility representation. B0 is not passed and production canonical persistence must not yet be wired.

Preserve the exact reverse reports listed in Section 5 alongside the primary evidence before changing the storage design.
