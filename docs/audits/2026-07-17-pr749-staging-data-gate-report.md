# PR #749 Staging Data Gate No-Write Report

Date: 2026-07-17
PR: #749
Branch: `codex/public-egress-boundary-v1`
Mode: no-write

## Executive Verdict

`STAGING IDENTITY NOT VERIFIED`

PR #749 must remain Draft. This report did not run staging migration, seed, backfill, proof writes, promotion, browser smoke, admin smoke, or the 500-package regression audit because the only supplied environment file is `.env.prod`, and it does not satisfy the non-production staging identity contract.

No production mutation was performed.
No staging mutation was performed.
Ready-for-review is not recommended.

## Evidence

Generated JSON report:

- `docs/audits/2026-07-17-pr749-staging-data-gate-report.json`

Command:

```powershell
npm run verify:pr749-staging-data-gate -- --json --env-file=.env.prod --out=docs/audits/2026-07-17-pr749-staging-data-gate-report.json
```

Result:

- Status: `blocked`
- Staging verdict: `STAGING_IDENTITY_NOT_VERIFIED`
- `writeAllowed`: `false`
- Environment label detected: `production`
- API host detected: `ixaxnvbmhzjvupissmly.supabase.co`
- DB host: missing
- Production denylist evidence: missing
- Non-production mutation opt-in: missing

Blocked checks:

- `explicit-non-prod-opt-in`
- `staging-db-host-present`
- `environment-label-non-production`
- `project-ref-allowlisted`
- `production-project-ref-denylisted`
- `production-db-host-denylisted`
- `db-host-separated-from-production`

## Static Gates

The no-write static gates passed:

- `public-egress`: pass
- `public-package-security`: pass
- `public-package-rollout-mode`: pass

These are necessary but not sufficient for operating PR #749. They do not prove staging data readiness.

## Skipped Gates

The following gates were intentionally skipped because staging identity is not verified:

- Staging pre-inventory
- Staging migration apply
- Source-backed snapshot generation
- Exact fresh proof generation
- Atomic promotion and revoke checks
- Projection route smoke
- Positive path route checks
- Negative path blocker checks
- Admin public-review browser smoke
- `npm run audit:public-snapshot-generation -- --json --limit=500 --samples=80`

## Required Before Ready-For-Review Recommendation

Ready-for-review can only be recommended after all of the following are proven in a verified non-production environment:

- Staging identity is verified with explicit non-production write guards.
- Staging migration succeeds.
- Public snapshots are generated from source-backed evidence.
- Gate-pass snapshots are greater than zero.
- Published pointers are greater than zero.
- Exact fresh proofs are greater than zero.
- Required projection coverage is 100%.
- Active unresolved public pollution is zero.
- External raw fallback is zero.
- Blocked external exposure is zero.
- Admin public-review smoke passes.
- The 500-package regression audit runs successfully.

Until then, the correct operational state is:

`CODE READY, STAGING GATE NOT VERIFIED`
