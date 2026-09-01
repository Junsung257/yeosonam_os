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
- Publisher/controller/operations regression suite: PASS, 4 files and 50 tests.
- `npm run eval:blog-editorial:offline`: PASS, 100/100 golden fixtures with no failure or provider error.
- `npm run benchmark:blog-korean-semantic-v4`: PASS in dry-run, 100 samples, precision 1.00, recall 1.00.
- `npm run verify:blog-release-bundle-v4`: PASS, 15 ordered migrations and rollback hashes verified.
- `npm run audit:migration-prefix:ci`: PASS, 0 new/unbaselined collisions; 16 known historical collisions remain baselined.
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
