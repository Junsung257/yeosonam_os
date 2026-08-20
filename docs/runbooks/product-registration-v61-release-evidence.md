# Product Registration V6.1 Release Evidence Runbook

This runbook is evidence-only. It does not apply a Supabase migration, change a customer pointer, publish a product, or invalidate a production cache.

## 0. Exact source and clean worktree

Use a new detached worktree at the exact release commit. The source-integrity command must report `cleanExactCommit: true`:

```powershell
npm run verify:product-registration-v61-release-evidence -- --strict
```

`--strict` validates only source integrity and required artifact presence. It deliberately does not mark build, database, browser, or gold-set gates as passed; those gates remain false until their independent evidence is attached.

Capture the JSON output as the release evidence artifact. It includes:

- exact `HEAD` and `origin/main` references;
- clean/untracked worktree status;
- SHA-256 hashes for the three V6.1 migrations, current SSOT, and verification contract;
- test-file manifest and static skip inventory;
- non-mutating Supabase/psql/Docker CLI and daemon preflight;
- explicit build, migration, browser-canary, and gold-set gate states.

## 1. Test manifest

Run the full suite with a JSON reporter in the clean worktree and preserve its output beside the evidence artifact. Compare the test-file manifest to the previous release commit before accepting a green result. Any deleted, renamed, newly skipped, or excluded V6.1 test is a release blocker until reviewed.

```powershell
npx vitest run --reporter=json --outputFile=artifacts/product-registration-v61-vitest.json
npx tsc --noEmit --pretty false --incremental false
npx eslint src --ext .js,.jsx,.ts,.tsx --max-warnings=0
```

The current seven skipped tests are explicitly inventoried in the evidence JSON. They are legacy `publish_package_snapshot_atomic` scenarios in `src/lib/package-publication/repository.test.ts`; they cannot be counted as proof of the V6.1 revision transaction or publication CAS.

## 2. Build

Run the production build only after the clean worktree and test manifest are captured. The acceptance condition is process exit code `0` and a complete `.next` output. A timeout, `ENOSPC`, partial output, or recovery-wrapper success is **not** a pass.

```powershell
$env:NODE_OPTIONS='--max-old-space-size=12000'
npm run build
```

## 3. Staging migration rehearsal

Use a clean, disposable Supabase/Postgres environment. First inspect the installed CLI version and command help; do not guess flags. Apply the migrations in repository order, then run the staging SQL rehearsal and advisors. The rehearsal must cover idempotent re-run, interrupted migration, old/new application compatibility, RLS, `SECURITY DEFINER` search paths, CAS conflicts, authorization consumption, fencing, and outbox dedupe.

No production migration is permitted until the rehearsal report is attached to the same exact-commit evidence bundle.

## 4. Browser canary evidence

The first canary remains shadow-only until all of the following are persisted for both `/packages/{id}` and `/lp/{id}`:

- product, revision/hash, snapshot/hash, renderer build, deployment, URL, `390x844` viewport;
- HTTP status, DOM assertions, CTA result, screenshot/artifact hashes, source, and timestamps;
- proof invalidation after snapshot, renderer, pointer, or customer-visible mutation.

The canary must prove one-time authorization, pointer CAS, cache invalidation, canonical URL reads, and rollback. It must not alter a real customer pointer without explicit approval.

## 5. Gate rule

The V6.1 P0 gate remains closed until clean exact commit, build exit-code `0`, staging migration rehearsal, atomicity failure-injection, publication-CAS concurrency, stale-fencing rejection, 400-section gold set, shadow diff, browser canary, cache transition, and rollback evidence are all attached. The JSON gate fields are intentionally false until those artifacts exist.
