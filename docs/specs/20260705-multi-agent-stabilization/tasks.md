# Tasks: Multi-Agent Stabilization

- [x] Confirm tier, SSOT, and acceptance criteria.
- [x] Create isolated coordinator worktree and branch.
- [x] Spawn Agent A for validation-tool stabilization.
- [x] Spawn Agent B for secret-surface audit.
- [x] Spawn Agent C for free-travel expectation alignment.
- [x] Spawn Agent D for read-only collision monitoring.
- [x] Review Agent A/B/C/D results and changed files.
- [x] Integrate only non-overlapping accepted patches.
- [x] Run verification from `verification.md`.
- [x] Prepare closeout with evidence and deferred protected-zone work.

## Parallel Candidates

- [x] Agent A: validation scripts.
- [x] Agent B: secret-surface report.
- [x] Agent C: free-travel/provider files.
- [x] Agent D: read-only collision matrix.

## Integrated Scope

- Agent A: `scripts/audit-public-critical-pages.mjs`, `db/audit_select_unknown_columns.js`.
- Agent B: `docs/audits/2026-07-05-secret-surface-audit.md`, `docs/audits/README.md`.
- Agent C: `src/app/free-travel/FreeTravelClient.tsx`, `src/app/api/free-travel/book/route.ts`, `src/app/api/free-travel/cancel/route.ts`, and focused tests.
- Agent D: no code edits; collision/protected-zone report used for integration gating.

## Deferred Protected Work

- Blog: PR #551 is merged; current blog follow-up is PR #554. No blog files were edited here.
- RFQ: PR #453 remains open/draft. No RFQ/group-inquiry files were edited here.
- Product registration: existing product-registration worktrees remain protected. No product-registration core files were edited here.

## Commit Boundary

- Recommended commit group: docs/spec/audit report, validation scripts, then free-travel UI/API/tests if splitting is desired.