# Product Registration V6.1 Tasks

- [x] Create an isolated integration worktree from committed V6.
- [x] Capture Release 0 dirty-worktree evidence and recovery hashes.
- [x] Add V6.1 database safety/authority migration.
- [x] Add under-review preflight and generic customer route.
- [x] Add cache-tag invalidation contract and atomic outbox claim.
- [x] Add runtime freeze-manifest tooling and dry-run/apply commands.
- [x] Add one-time release authorization support.
- [x] Split job stage/state/outcome and stage attempts.
- [x] Add surface render hash and proof linkage.
- [x] Add compatibility projection lineage and drift audit.
- [x] Update upload dedupe response contract.
- [x] Add gold-set outcome confusion-matrix gate.
- [x] Extend departure instances with typed price/booking/inventory facts and exact-date override lineage.
- [x] Add canonical entity relations, supplier/product overlays, and fuzzy-review-only attraction candidates.
- [x] Add service-role Jarvis/blog/comparison authority read models and route adapters.
- [x] Add Atitaya malformed-price/variant-boundary regression fixture.
- [x] Add unit, SQL-contract, and route tests (live migration rehearsal remains pending).
- [x] Run TypeScript, focused tests, lint, and authority scan.
- [ ] Run a production-configured Next.js build.
- [x] Update current SSOT and audit index.

The production build was attempted locally but stopped at webpack with `ENOSPC` (disk full); the type check itself passed. Production-only gates still pending: runtime freeze-manifest capture/apply, SQL migration execution, browser proof against the CDN, shadow cohort replay, canary approval, and the 400-section gold-set run.
