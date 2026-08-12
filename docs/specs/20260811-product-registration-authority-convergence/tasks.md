# Tasks: Product Registration Authority Convergence

- [x] Confirm Tier 3, SSOT, current V6 worktree, and approved acceptance criteria.
- [x] Add authority map telemetry and forbid unapproved direct writers in CI.
- [x] Add catalog identity and tenant-scoped source migration/backfill guards.
- [x] Add revision-first atomic commit repository/RPC and stable Kernel interfaces.
- [x] Remove V6 legacy-first compatibility step; derive projections after revision commit.
- [x] Route authoritative IR, Band, reextract, and correction inputs through the same workflow; keep scan preview-only and fail-close stub/review mutation in kernel mode.
- [x] Add terms, media provenance, hotel/golf observation, schedule revalidation, and cohort quality contracts.
- [x] Make the primary B2C/B2B/affiliate/search/blog/RSS/embed/print readers pointer-only by channel.
- [ ] Run the remaining deployed workflow, 990-row backfill, annotated corpus, full build, and cohort mobile-proof verification.
- [x] Update current SSOT/status and prepare safe migration/deployment handoff.

Current partials:

- Correction and reextract create a superseding revision from an immutable replacement source. IR and Band enter the same durable workflow in shadow/kernel mode. Scan endpoints remain non-authoritative previews; stub/review and old mutable CRUD/approval endpoints return `409` in kernel mode. Their legacy bodies remain only for controlled rollback during the staged transition.
- Package/LP, public package search, B2B v1, affiliate public/landing/embed/referral, blog detail/destination, destination RSS, itinerary print, content generation, home, destination, and sitemap now read exact pointer-bound snapshots. Legacy compatibility reads remain only in explicitly tracked operational/admin/booking code and in a small number of package-detail ancillary queries; customer facts must still come from `getCurrentPublicPackage()`.
- The 40-file HWP structural corpus is 40/40 extracted and normalized, with 53/66 sections automatically terminal as verified/degraded (80.30%) and 13/66 blocked. Critical claim evidence is 248/248. This result is recorded in production as a **non-passing structural benchmark** because annotated field exact-match and critical false-publication review have not yet been completed.
- Production stale V6 jobs are now zero. Two abandoned historical jobs were dead-lettered and terminalized without publication. Production remains `shadow` with publication freeze enabled.
- The first live legacy batch started 25/25 workflows and terminalized 25/25 without publication. It exposed and fixed shared-source identity selection, selected-section propagation, and ambiguous-variant failure classification; evidence-rich rows are prioritized, engine-version retries are bounded, lifetime attempts are audited, and ledger terminal state synchronizes transactionally. The remaining 965 rows stay a bounded shadow gate.
- TypeScript, lint, authority/registration contracts, the full 710-file/5,261-test suite, and production build pass after the latest changes. Live 40-source workflow corpus, the remaining 965-row shadow backfill, paid provider calls, and a representative deployed browser-proof cohort remain release gates.

## Parallel Candidates

- [ ] None. Shared migration, Kernel, workflow, and reader contracts make sequential integration safer in this workspace.

## Commit Boundary

- Commit group 1: spec/tests/authority boundary
- Commit group 2: DB identity/tenant/atomic authority
- Commit group 3: Kernel/workflow/adapters
- Commit group 4: facts/copy/media/readers
- Commit group 5: verification/docs
