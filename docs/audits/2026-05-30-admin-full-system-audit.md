# Admin Full-System Audit (2026-05-30)

## Scope
- Admin page smoke audit: 20 core `/admin` pages on local dev with dev-admin cookie.
- Admin API performance gate: `npm run check:perf`.
- Admin/API security sweep: `/api/admin/**/route.ts` guard pattern scan.
- Package API drift gate: `npm run audit:api-drift` and `npm run audit:select-cols`.
- Dependency/dead-code/bundle budget discovery.

## Findings
1. All 20 checked admin pages loaded with HTTP 200 and no page crashes.
2. Admin API hot paths passed performance budgets after dev-server restart.
3. Several mutating admin routes lacked direct admin/cron guard patterns.
4. Vercel Speed Insights script was blocked by CSP.
5. `/api/admin/session` returned 401 during dev-admin bypass, creating noisy console errors in admin pages.
6. Package list API drift had 9 required DB columns missing from `PACKAGE_LIST_FIELDS`.
7. `audit_api_field_drift.js` could report success but exit 1 on Windows/Node 24 due HTTP-client shutdown instability.
8. Bundle budget still reports shared API routes at ~7565KB first-load JS in current `.next` stats, likely stale or server-route accounting noise; requires a clean production build/analyze pass for a trustworthy number.
9. `knip` reports many unused files/exports. Treat as a refactor backlog, not automatic deletion, because many files are agent/cron/template entrypoints.

## Fixes Applied
1. Added admin guards to mutating/high-sensitivity admin APIs.
2. Switched cron optimization POST to central `withCronGuard`; kept GET admin-guarded.
3. Allowed dev-admin bypass in `requireAuthenticatedRoute` and `/api/admin/session` for stable local admin audits.
4. Added `https://va.vercel-scripts.com` to CSP `script-src`.
5. Added missing package fields to `PACKAGE_LIST_FIELDS`.
6. Stabilized `db/audit_api_field_drift.js` by replacing JS HTTP client usage with a short-lived `curl` call and fixing broken strings.

## Verification
- `npm run type-check`: pass.
- `npm run lint`: pass with pre-existing warnings.
- `npm run test`: pass, 80 files, 1015 passed, 1 skipped.
- `npm run check:perf`: pass, 6/6.
- `npm run audit:api-drift`: pass.
- `npm run audit:select-cols`: pass.
- `npm run check:deps:circular`: pass, 0 errors/warnings.
- `npm run check:bundle`: completes but reports oversized API route budget warnings.
- `npm run check:deadcode`: fails with unused/dependency backlog; not auto-fixed.

## Artifacts
- `docs/audits/2026-05-30-admin-local-page-audit.json`
