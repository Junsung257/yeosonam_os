# Verification: Migration Baseline Remediation

Verified: 2026-07-16 KST

## Result

**PASS — LOCAL DB VERIFIED**

## Environment Gate

- Docker Client/Server: 29.6.1, PASS
- Supabase CLI: 2.109.1
- PostgreSQL: 17.6
- Dedicated worktree and branch verified.
- Remote DB environment variables removed before every Supabase command.
- No `--linked`, remote URL, push, PR, staging, or production operation.

## Fresh Migration Gate

```powershell
npx supabase start -x logflare,vector --ignore-health-check
npx supabase db reset --local --no-seed
npx supabase db reset --local --no-seed
```

Result:

- Fresh start: PASS
- Consecutive reset 1: PASS
- Consecutive reset 2: PASS
- Migration history: 374 rows
- Latest version: `20260716101000`
- Duplicate version groups: 0

## Upgrade Gate

A separate disposable local stack was held at the pre-V2 boundary. Four legacy informational rows and one product `auto_heal + product_id` row were inserted, then the 14 informational migrations and two final correction migrations were applied.

- Rows before/after: 5/5
- Slug, product ID, status, topic source, and null review preserved.
- Public classification: four `information_legacy`, one `product`.
- No silent representative backfill.
- No product-to-information conversion.

## Database Contract Gate

```powershell
npx supabase test db --local supabase/tests
npx supabase db lint --local --schema public --level warning --fail-on error
```

- pgTAP: 4 files, 77 tests, all PASS, zero skip.
- DB lint: exit 0, zero errors, 14 non-blocking legacy variable warnings.
- RLS/privileges: PASS.
- Atomic success and idempotency: PASS.
- Real two-session advisory-lock concurrency: PASS, no deadlock or duplicates.
- Nine failure/exception rollback boundaries: PASS.

## Application Gate

```powershell
npm run eval:blog-info-v2
npm test
npm run type-check
npm run lint
$env:NEXT_BUILD_MAX_OLD_SPACE_SIZE='8192'; npm run build
```

- Safety evaluation: 10/10 PASS, no external API or operational write.
- Focused tests: 24 files, 216 tests PASS.
- Full tests: 511 files, 3,611 tests PASS.
- Typecheck: PASS.
- Lint: PASS, zero warnings.
- Production build: PASS, 390/390 pages.

## Boundary Gate

- No product parser, snapshot, writer, detail page, or landing-page runtime changes.
- No attraction seed or matching run.
- No remote database mutation.

## Deployment Hold

Local verification is complete. Staging remains blocked until the already-applied remote migration history is backed up and reconciled with the normalized historical version numbers. Production remains blocked until staging migration and informational publication smoke tests pass.
