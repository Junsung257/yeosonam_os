# Product Registration V6.1 Authority Specification

Date: 2026-08-20
Architecture name: V6
Workflow version: `v6.1-recompile`

## Objective

Promote the existing V6 immutable source, revision, snapshot, browser-proof, and CAS publication path to the only product-registration authority. Stop unsafe customer exposure first, then run new and existing products through the same replayable compiler.

## Invariants

- Source documents and extractions are immutable and hash-addressed.
- A product revision is never edited in place.
- Candidate snapshots are immutable and bound to an exact revision and policy.
- Browser proof is valid only for the exact surface render hash, renderer build, policy, viewport, and browser version.
- Customer publication changes only through an atomic CAS operation.
- A global publication freeze can only be crossed by a single-use authorization bound to the exact revision, snapshot, proof, and expected pointer version.
- Legacy product tables are compatibility projections, never customer authority.
- Under-review routing is decided before a snapshot body is fetched.
- Fuzzy attraction matching creates review candidates only. It never links or inserts an attraction.
- Source-declared pending facts are distinguishable from missing, conflicting, or unsupported inferred facts.
- Departure facts carry typed selling price, currency, pricing/booking/inventory state, and rule/override lineage. Exact-date overrides outrank date-range rules; malformed source amounts remain conflicting.
- Canonical lodging/golf/airline/airport entities and product relations retain the source mention and entity revision. Fuzzy candidates are review-only, and supplier/product overlays cannot mutate a master or immutable revision.
- Jarvis, blog, and comparison readers consume service-role-only views bound to the current customer pointer and snapshot; they do not use legacy `travel_packages`, `price_tiers`, `excluded_dates`, or `net_price` as customer facts.

## Release gates

1. Evidence and recovery point fixed without touching the existing dirty worktree.
2. Generic HTTP 200 `noindex` under-review route deployed before any overlay is applied.
3. Runtime freeze manifest captures the actual customer-pointer set; no fixed count is accepted.
4. Manifest rows are quarantined using expected pointer version CAS and cache invalidation.
5. V6.1 workflow authority, atomic commit/publish, lineage, typed IR, and review queues are enabled in shadow mode.
6. Manual canaries require exact one-time authorization.
7. Supplier/parser automation remains default-off and requires the frozen gold-set and live stability gates.

## Out of scope for automatic action

- Production migration application, deployment, freeze activation, or overlay mutation without an explicit production change approval.
- Reconstructing source facts that do not exist.
- Automatic attraction-master creation or fuzzy-match approval.
