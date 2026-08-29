# Product Publication Rebuild Plan

1. Rebase the implementation on current `origin/main` in an isolated worktree and record current characterization tests.
2. Port only the publication authority, typed departure/price projections, customer-copy ledger, admin truth model, and public-catalog boundary from the stale candidate.
3. Replace legacy approval writes with one publication-request command and published-only customer state checks.
4. Make registration stop at an immutable candidate snapshot; run proof, publish, cache convergence, and live canary as durable steps.
5. Serve every public product surface from one minimal public catalog projection and preserve the latest-main KST departure eligibility policy.
6. Verify locally with database contract tests, TypeScript, focused Vitest suites, build checks, and fresh browser evidence before any remote rollout.

## Rollout

- Additive schema and dual-read support first.
- Shadow-write and compare without changing customer pointers.
- Restore the two Danang products as the first golden cohort.
- Keep automatic customer publication disabled until corpus, shadow, and live canary gates pass.
