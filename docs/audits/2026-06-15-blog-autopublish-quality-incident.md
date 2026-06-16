# Blog Autopublish Quality Incident - 2026-06-15

## Current Status

The blog automatic publishing pipeline is not just a backfill job. It is composed of:

- `src/app/api/cron/blog-publisher/route.ts`: live autopublish path.
- `src/lib/blog-quality-gate.ts`: blocking publish gates.
- `src/lib/blog-editorial-repair.ts`: editorial and structure repair helpers.
- `src/lib/blog-seo-scorer.ts`: SEO scoring.
- `scripts/backfill-blog-quality.ts`: DB-backed repair/audit for already published posts.

As of the latest 2026-06-15 follow-up, recent published content has been repaired, bad topic fit is blocked before queue/publish, weak slug cleanup has been executed for the latest machine-generated slugs, and indexing jobs have been drained successfully.

The durable operating contract is maintained in `docs/blog-autopublish-contract.md`.

Latest recent-post audit result:

- Body/render/readability/longtail issues: repaired.
- Latest published 10 dry-run: `changed=0`, `qualityGateFailed=0`.
- Active `blog_indexing_jobs`: `0`.
- `shijiazhuang-itinerary` was archived because `석가장 신혼여행` failed `topic_fit` / `editorial_quality` with `destination_intent_mismatch`.

Slug migration status:

- `scripts/migrate-blog-slugs.ts` is repeat-safe: previously migrated redirects are treated as `missing_or_already_migrated`, not collisions.
- 2026-06-15 follow-up migration updated five latest machine-generated slugs and enqueued indexing jobs.

## What Repeated

The same classes of issues kept reappearing because earlier fixes mostly cleaned already-published posts or only ran after a specific gate failed.

Observed repeat classes:

- Collapsed or malformed Markdown tables.
- Overlong headings and blank headings.
- Repeated support blocks, repeated checklist headings, and repeated planning hooks.
- Longtail keyword blocks where the same long prefix repeated across every bullet.
- Weak slugs such as `post-hv01`, `7-bali`, `danang-34`.

The key root cause was not a single bad post. It was that generated text, backfill repair, and live publish repair were not using the exact same prevention contract.

## Prevention Contract

All live blog publishing must satisfy this contract before a row becomes `status='published'`:

1. Generate or promote draft content.
2. Insert images and official links.
3. Run `repairBlogEditorialQuality()`.
4. Always run `repairBlogStructureQuality()` before the first quality gate.
5. Run `runQualityGates()`.
6. If any gate fails, run repair rounds.
7. After each repair round, run `repairBlogStructureQuality()` again.
8. Re-run quality gates.
9. Compute SEO score and block if it fails.
10. Compute final readability after all repairs, immediately before DB insert/update.

This is now reflected in `src/app/api/cron/blog-publisher/route.ts`.

## Backfill Contract

Published-post cleanup must use:

```bash
npm run audit:blog-quality -- --limit=50
npm run audit:blog-quality -- --limit=50 --write
```

Rules:

- Dry-run first.
- `--write` only updates rows that pass the quality gate.
- Failed rows are skipped and must not be force-written.
- Use `--slug=<slug>` for single-post diagnosis.
- Use `--debug-diff` when a failed reason is unclear.

## Regression Coverage Added Or Reused

Relevant tests:

```bash
npx vitest run src/lib/blog-editorial-repair.test.ts src/lib/blog-seo-scorer.test.ts src/lib/blog-structure-audit.test.ts src/lib/slug-utils.test.ts src/app/blog/[slug]/page.test.tsx
npx eslint src/lib/blog-editorial-repair.ts src/lib/blog-editorial-repair.test.ts src/lib/blog-seo-scorer.ts src/lib/blog-seo-scorer.test.ts scripts/backfill-blog-quality.ts scripts/migrate-blog-slugs.ts src/lib/blog-slug-redirects.ts 'src/app/blog/[slug]/page.tsx'
npm run type-check -- --pretty false
```

Verification on 2026-06-15:

- Vitest: 5 files, 26 tests passed.
- ESLint: passed for the touched blog quality files.
- Type check: passed.
- Blog quality audit: recent 50 scanned, remaining failures are slug cleanup only.
- Slug migration dry-run: 12 rows `would_update`.

## Do Not Repeat

Do not treat a one-time DB backfill as completion of the autopublish system.

Before calling the blog autopublish work complete, confirm all of the following:

- Live publisher runs `repairBlogStructureQuality()` before quality gates.
- Repair rounds run `repairBlogStructureQuality()` again after any mutation.
- Final readability is calculated after all repairs.
- `npm run audit:blog-quality -- --limit=50` has no non-slug failures.
- Weak slug migration has either been deployed with redirects or explicitly left pending.
- Published posts enqueue `blog_indexing_jobs`; external Google/Naver/IndexNow requests run only in `/api/cron/blog-indexing-worker`.
- `indexing_reports` evidence is written by the worker after provider requests.
- This document and `docs/audits/README.md` are updated.

## Completion Evidence

Completed on 2026-06-15 after redirect code, indexing outbox, and production DB migration were live:

```bash
npx tsx scripts/migrate-blog-slugs.ts --write
npm run audit:blog-quality -- --limit=50 --write
npm run audit:blog-quality -- --limit=50
```

Final verification:

- Slug migration updated 12 weak slugs and enqueued indexing jobs for the new URLs.
- Recent 50-post backfill converged to `changed=0`.
- Quality gate result is `qualityGateFailed=0`.
- Backfill script now strips generated SEO appendix before regeneration, removes lone `#` headings, treats optional generated cost-table formatting as equivalent, and enqueues indexing jobs on writes.
- Indexing queue result after worker runs: `active=0`, `succeeded=112`.

## Indexing Worker Added

Implemented on 2026-06-15:

- `supabase/migrations/20260615150000_blog_indexing_jobs.sql`
- `src/lib/blog-indexing-outbox.ts`
- `src/lib/blog-indexing-worker.ts`
- `src/app/api/cron/blog-indexing-worker/route.ts`
- Existing `vercel.json` `/api/cron/blog-publisher` schedule drains due indexing jobs; no extra cron is added because the project is already at Vercel's 100-cron limit.

This prevents the repeated failure mode where publish succeeds but inline indexing fails without a durable retry trail.

Production DB verification on 2026-06-15:

- `public.blog_indexing_jobs` exists.
- RLS is enabled.
- Service role can select/insert/delete.
- Enqueue smoke inserted one pending job, duplicate enqueue deduped to the same job, and cleanup deleted the smoke row.
- Worker route returned `200` with an empty queue: `processed=0`, `errors=[]`.
- Production worker processed slug migration and quality backfill jobs with no retry or failed rows.

## Follow-Up Execution Evidence - Latest 10 Posts

Executed on 2026-06-15:

```bash
npx tsx scripts/migrate-blog-slugs.ts --write
npx tsx scripts/backfill-blog-quality.ts --limit=10 --write
npx tsx scripts/backfill-blog-quality.ts --limit=10
npx vitest run src/lib/blog-topic-fit-gate.test.ts src/lib/blog-renderer.test.ts
npm run type-check
npm run lint
```

Final evidence:

- Recent published 10 dry-run: `changed=0`, `qualityGateFailed=0`, `failedSamples=[]`.
- Indexing worker runs: `processed=10 succeeded=10`, then `processed=1 succeeded=1`.
- Active indexing queue after worker: `activeCount=0`.
- Tests: 20 Vitest tests passed for topic-fit and renderer coverage.
- TypeScript and ESLint passed.
- The bad `shijiazhuang-itinerary` topic is not repaired into another bad article; it is `status='archived'`, `featured=false`, and has `URL_DELETED` indexing evidence.
