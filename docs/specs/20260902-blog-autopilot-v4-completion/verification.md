# Verification: Blog Autopilot V4 completion

## Automated Checks

```bash
npm run type-check
npm run lint
npm run test:blog-autopilot-v4
npm run eval:blog-editorial:offline
npm run build
```

- `npm run type-check`: PASS.
- `npm run lint`: PASS. The repository's existing TypeScript 5.9 versus ESLint parser support-range warning remains non-blocking.
- `npm run test:blog-autopilot-v4`: PASS, 12 files and 44 tests.
- Publisher/controller/operations/indexing regression suite: PASS, 8 files and 84 tests.
- Full Vitest contract reconciliation: the four stale CI expectations for the 15-migration bundle, 11-cron allowlist, release workdir, and authenticated draft preview were corrected and pass 32/32. A local Windows full-suite run completed 6,596 assertions with only two load-related timeouts; both timed-out files passed immediately in isolation, 16/16. The Linux PR suite remains the release authority.
- `npm run eval:blog-editorial:offline`: PASS, 100/100 golden fixtures with no failure or provider error.
- `npm run benchmark:blog-korean-semantic-v4`: PASS in dry-run, 100 samples, precision 1.00, recall 1.00.
- `npm run verify:blog-release-bundle-v4`: PASS, 15 ordered migrations and rollback hashes verified.
- `npm run audit:migration-prefix:ci`: PASS, 0 new/unbaselined collisions; 16 known historical collisions remain baselined.
- `npm run audit:high`: PASS after pinning the transitive `browserslist` dependency to 4.28.7; 0 high or critical vulnerabilities remain. One low-severity advisory remains outside the release-blocking threshold.
- `npm run check:harness` and `npm run eval:harness:promptfoo`: PASS with 0 harness findings, 30/30 deterministic contracts, 20/20 audit tests, and 30/30 Promptfoo cases. The four canonical SEO skills are mirrored into `.claude/skills`, generated system inventory is current, and the active Tier 3 packet remains open until shadow verification is complete.
- Migration safety checker: PASS for both V4 migrations; four missing foreign-key support indexes were added and the only two approved findings are the measured existing-table lifecycle indexes documented below.
- Protected linked Supabase dry-run: PASS through the release-only worktree. Remote history reconciliation produced 571 placeholders for 582 applied versions and proposed exactly the four manifest-pinned pending migrations (`20260817043000`, `20260817121500`, `20260901114420`, `20260901155821`). No migration was applied by this check.
- Production read-only index probe before release: `indexing_reports` is approximately 4,712 rows / 3.8 MB total and `blog_visibility_snapshots` is approximately 9,396 rows / 10 MB total. The two existing-table lifecycle indexes remain inside the transactional migration with a 5-second lock timeout; the migration-safety exception is limited to exactly those two findings.
- `npm run build` with `NEXT_BUILD_MAX_OLD_SPACE_SIZE=8192`: PASS, type validity, 396 static pages, traces, and postbuild artifacts verified. The first local run compiled successfully but its default 6 GB type worker exhausted heap; the 8 GB rerun completed.
- `git diff --check`: PASS.
- `npm run audit:api-drift` and `npm run audit:drift`: safely skipped because this isolated worktree has no Supabase service credentials.

## Manual QA

- [ ] Verify authenticated noindex preview on mobile and desktop.
- [ ] Verify public URL canonical, robots, JSON-LD, links, images, and hydration.
- [ ] Verify staging migration/readiness and one shadow event without publication.

## Evidence To Report

- Test output: recorded above.
- API response: deferred until an authenticated staging candidate exists.
- DB/schema check: static migration, RLS/grant, runtime-readiness, release-bundle, and rollback checks pass; remote staging apply is deferred.
- Screenshot/browser proof: deferred until the noindex preview can use staging data and credentials.
- Audit/eval/readiness result: Promptfoo and local semantic benchmark pass; Crawl4AI and Docling remain fail-closed until reviewed 30-case live benchmarks and credentials are supplied.

## Approval Gates

- [x] No production DB migration, production deployment, external publication, or credential mutation occurs without a separate explicit release action.

Implementation commit verified: `b001d2b8d`.
