# FuturePlural project documentation

## CURRENT

- [Architecture](ARCHITECTURE.md) — ownership boundaries and state classes.
- [Contracts](CONTRACTS.md) — annotation, identity, persistence, and mutation invariants.
- [Decisions](DECISIONS.md) — settled decisions, open evidence questions, and deferrals.
- [Product](PRODUCT.md) — current interaction invariants and the bounded approved slice order.
- [Slice 0 platform decision memo](PLATFORM_DECISION_MEMO_SLICE_0.md) — evidence and unresolved platform gate. **B0 has not been accepted.**

## BACKGROUND

- [Approved Workspace architecture v0.2](archive/FuturePlural_Workspace_Architecture_v0.2.md)
- [Approved corrections v0.2.1](archive/FuturePlural_Workspace_Architecture_v0.2.1.md)

These proposals were approved as the product/architecture baseline for implementation, subject to platform evidence items explicitly left open in the memo. The current documents above are the operational source of truth. Original handoff copies remain in `.codex/` for local execution context.

## ARCHIVED

- `archive/PRODUCT_DECISIONS_AND_BACKLOG.md` — historical Manager/Group-era product backlog; superseded by `PRODUCT.md`.
- `archive/ANNOTATIONS_MANAGER_COGNITIVE_WALKTHROUGH_v0.1.md` — historical interaction walkthrough; not an active contract.

## Compatibility eras

- **PRE-BASELINE:** old FuturePlural development markup and state (including `data-fp-group`, positional IDs, Manager state, and test canvases) need no forward migration before B0. Identify exact files before any cleanup; disposal permission is not blanket delete permission.
- **EXTERNAL LEGACY:** user-authored or third-party `==highlights==`, older or external `<mark>` syntax, recognizable plugin marks, and ordinary Markdown footnotes remain discoverable without forced rewriting, before and after B0.
- **POST-B0:** once B0 is explicitly accepted and recorded, FuturePlural-managed annotations and required canonical supporting state are user data. Migration, compatibility, backup, and recovery discipline applies. B0 is **not passed** by Slice 0 or Slice 1 alone.

## B0 status and record

B0 is pending. It requires the complete evidence set in [Contracts](CONTRACTS.md#b0-compatibility-baseline-gate) on desktop and real iPad/mobile, including substrate persistence and actual sync behavior. When accepted, record the build ID, schema versions, date, platforms, storage decisions, and evidence here and in `DECISIONS.md`. Do not create valuable FuturePlural annotations in a personal vault before explicit B0 acceptance and deployment authorization.
