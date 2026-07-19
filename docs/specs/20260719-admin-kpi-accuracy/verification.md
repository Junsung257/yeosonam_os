# Admin KPI Accuracy Verification

## Automated evidence

### Independent-review remediation

- `npx vitest run src/lib/admin-guard.test.ts src/lib/db/dashboard.test.ts src/app/api/dashboard/dashboard-routes.security.test.ts --reporter=verbose --pool=forks --maxWorkers=1`
  - PASS: 3 files, 19 tests.
  - Covers non-admin JWT 403 boundaries before KPI calls, private/no-store responses, settlement error status, KST chart cutoff, shared browser month keys, and DB error propagation.
- Changed-file ESLint and `git diff --check`
  - PASS.
- Ordered full type-check
  - PASS after the tenant lane completed (`tsc --noEmit --pretty false`, 174.1s).
- Migration safety and prefix collision checks
  - PASS again after remediation: 1 file/0 issues; 379 files, 16 known historical collisions, 0 new/unbaselined collisions.

### Initial KPI correction

- `npx vitest run src/lib/db/dashboard.test.ts --reporter=verbose --pool=forks --maxWorkers=1`
  - PASS: 1 file, 4 tests.
  - Covers KST month rollover while UTC is still the prior day, closed recognized-date range, future operational booking separation, per-booking outstanding floor, new-booking upper bound, cancelled-booking cash/refund inclusion, and RPC JSON contract keys.
- `npx eslint src/lib/db/dashboard.ts src/lib/db/dashboard.test.ts src/app/admin/AdminPageClient.tsx`
  - PASS.
- `git diff --check`
  - PASS.
- `node scripts/migration-safety-checker.js supabase/migrations/20260719172000_admin_dashboard_kpi_kst_bounds.sql`
  - PASS: 1 file checked, 0 issues, 0 approvals required.
- `npm run audit:migration-prefix:ci`
  - PASS: 379 migration files, 16 known historical collisions, 0 new/unbaselined collisions.
- `npm run audit:admin-dashboard`
  - BLOCKED as designed because no authenticated admin cookie/dev server was supplied. All protected dashboard endpoints returned the audit tool's `auth-required` result; no runtime claim is made from this check.
- `npm run type-check`
  - PASS after shared dependency recovery (`tsc --noEmit --pretty false`).

## DDL purpose and compatibility

`20260719172000_admin_dashboard_kpi_kst_bounds.sql` is a forward-only `CREATE OR REPLACE FUNCTION` correction for `public.get_admin_dashboard_stats()`.

- Function name, zero-argument signature, `jsonb` return type, security mode, and all ten existing JSON keys are preserved.
- Only read formulas change: `Asia/Seoul` boundaries, an explicit recognized-month upper bound, operational active-booking separation, and per-booking non-negative outstanding aggregation.
- The migration contains no table/row mutation, destructive DDL, RLS change, ledger write, or remote apply/repair action.

## Manual/deferred evidence

- Authenticated live `/admin` runtime and browser visual QA remain outside this isolated code test. The existing card structure and design tokens were retained; only its financial labels and source fields changed.
- Remote migration application requires the normal release approval path.

Remote DB mutation: **not performed**.
