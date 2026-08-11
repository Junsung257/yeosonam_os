# Tasks: Product Registration Authority Convergence

- [x] Confirm Tier 3, SSOT, current V6 worktree, and approved acceptance criteria.
- [x] Add authority map telemetry and forbid unapproved direct writers in CI.
- [x] Add catalog identity and tenant-scoped source migration/backfill guards.
- [x] Add revision-first atomic commit repository/RPC and stable Kernel interfaces.
- [x] Remove V6 legacy-first compatibility step; derive projections after revision commit.
- [x] Route authoritative IR, Band, reextract, and correction inputs through the same workflow; keep scan preview-only and fail-close stub/review mutation in kernel mode.
- [x] Add terms, media provenance, hotel/golf observation, schedule revalidation, and cohort quality contracts.
- [ ] Make B2C/B2B/affiliate readers pointer-only by channel.
- [ ] Run unit, corpus, workflow, authority, type, build, and mobile proof verification.
- [x] Update current SSOT/status and prepare safe migration/deployment handoff.

Current partials:

- Correction and reextract create a superseding revision from an immutable replacement source. IR and Band enter the same durable workflow in shadow/kernel mode. Scan endpoints remain non-authoritative previews; stub/review and old mutable CRUD/approval endpoints return `409` in kernel mode. Their legacy bodies remain only for controlled rollback during the staged transition.
- Package/LP, B2B, partner, affiliate OG, kernel `/api/packages`, and kernel sitemap use exact pointer/snapshot readers. Remaining destination/home/blog/recommendation discovery reads still need projection conversion before the pointer-only item is complete.
- Local SQL parse, authority audit, type check, lint, production build, 100-file registration-domain suite, and the full 5,140-test suite pass. Frozen corpus, live DB/RLS, 989-product shadow backfill, provider calls, and real deployed browser proof remain deployment gates.

## Parallel Candidates

- [ ] None. Shared migration, Kernel, workflow, and reader contracts make sequential integration safer in this workspace.

## Commit Boundary

- Commit group 1: spec/tests/authority boundary
- Commit group 2: DB identity/tenant/atomic authority
- Commit group 3: Kernel/workflow/adapters
- Commit group 4: facts/copy/media/readers
- Commit group 5: verification/docs
