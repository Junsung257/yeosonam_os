# Blog Ops Runbook

Last updated: 2026-06-17

This runbook defines how operators decide whether the Yeosonam blog automation is healthy. The durable publish contract remains `docs/blog-autopublish-contract.md`; this file explains the daily operating workflow shown in `/admin/blog`.

## Daily Operating Standard

A day is healthy only when all of these are true:

- `/admin/blog` shows the blog OS level as `정상` or an accepted `관찰`.
- Today's published count is at or above the global publishing policy target.
- `/admin/blog/queue` has no failed, overdue, or stale generating rows in `운영 필요`.
- `/admin/blog/system` shows `blog-publisher`, `blog-scheduler`, `blog-daily-summary`, `blog-indexing-worker`, `gsc-index-rank`, and `serp-rank-snapshot` as successful or explainably skipped.
- Published posts have current `quality_gate`, `seo_score`, `readability_score`, `generation_meta.content_brief`, final slug, title, description, and image evidence.
- New or changed published URLs are enqueued through `blog_indexing_jobs`; indexing provider calls are handled by the worker, not inline publish code.
- Google actual URL knowledge is tracked separately from IndexNow or sitemap request success.

## Operator Flow

1. Open `/admin/blog`.
2. Read `오늘 해야 할 일` first.
3. If the first action points to the queue, open `/admin/blog/queue` and stay on `운영 필요`.
4. Requeue only retryable failures. Hide rows that are stale historical noise or blocked by bad topic fit.
5. If the first action points to system, open `/admin/blog/system` and inspect the core cron table before manually running anything.
6. If publishing volume is wrong, open `/admin/blog/policy` and compare the global policy with current active queue pressure.
7. If indexing or exposure is weak, open `/admin/blog/rankings`; do not assume IndexNow, sitemap submission, or URL Inspection means actual ranking.

## Failure Policy

- Do not delete queue rows as the default cleanup action. Use `숨김` so the audit trail remains available.
- Do not mark autopublishing complete after a one-time backfill. Completion requires the live publisher, queue, indexing worker, and daily summary to remain healthy.
- Do not add new Vercel cron entries for blog work without removing or consolidating another cron; the project is already near the cron limit.
- Do not treat SEO score alone as quality. Topic fit, editorial quality, render integrity, image quality, readability, and indexing evidence must also pass.
- Do not requeue `self_heal_blocked` rows until the underlying generator or schema mismatch is fixed.

## Escalation Rules

- `blog-publisher` failure: treat as blocked because new posts may not publish.
- `blog-daily-summary` partial failure: check whether daily count or indexing health failed.
- `gsc-index-rank` reports many unknown URLs: verify sitemap, canonical URLs, internal links, and Search Console property before reindexing in bulk.
- Repeated `topic_fit` failures: fix keyword/topic generation before requeueing.
- Repeated `editorial_quality`, `structure_integrity`, or `raw_directive_leak` failures: fix the publish preparation/repair path before regenerating more posts.
- Repeated `content_creatives_angle_type_check`: normalize queue `angle_type` to a valid content angle before publish.

## Verification Commands

Run these after code changes that affect blog generation, rendering, indexing, or admin operations:

```bash
npm run type-check
npx vitest run src/lib/blog-editorial-repair.test.ts src/lib/blog-seo-scorer.test.ts src/lib/blog-structure-audit.test.ts src/lib/blog-topic-fit-gate.test.ts
npm run audit:blog-quality -- --limit=50
npm run audit:blog-search-daily:strict
```

If local Supabase environment variables are unavailable, use `/admin/blog` and `/api/admin/blog/ops-summary` against the authenticated deployed admin surface as the source of truth.

## Completion Definition

The blog system is complete only when the admin UI can answer these questions without reading raw DB rows:

- How many posts should publish today, and how many did?
- Which queue rows need action now?
- Which failures are retryable, hidden, or blocked by topic quality?
- Are indexing jobs pending or failing?
- How many inspected URLs are actually known to Google?
- Which cron broke the contract?
- Which document defines the contract and which checks currently fail?

## 2026-06-16 Live Ops Evidence

- Supabase project: `Yeosonam_OS` (`ixaxnvbmhzjvupissmly`) is active.
- Vercel project: `os` (`prj_QTQa2iUwEkBON4QczULxG1HPYLSE`) latest production deployment was `READY`.
- Live queue counts: `failed 9`, `queued 28`, `skipped 236`, `published 116`.
- 2026-06-16 KST publishing target was met: `published_today 4`.
- `blog-daily-summary` remained `partial_failure` because 2026-06-15 had `published=1`, `min=3`, and Google actual index rate was low.
- `blog-orchestrator` remained `partial_failure` due to overdue supporting cron checks.
- Google URL Inspection evidence is a separate risk from IndexNow: recent reports included many `Google에는 아직 알려지지 않은 URL입니다` states.
- Repeated DB publish failure found: product queue rows used Ad OS scenario angle values such as `safety`, `family`, `price_objection`, `differentiator`, but `content_creatives.angle_type` accepts the content-generator angle set. The live queued rows were repaired to `value`, and publisher code now normalizes angle values before quality gates and DB insert.
- Vercel runtime logs showed repeated `env-check` warnings. `instrumentation.ts` was deduplicated and `env-check` now logs readable messages once per process.

## 2026-06-17 Autopublish Hardening Evidence

- Root cause class: queue producers and the publisher did not share one data contract.
- `content_creatives.angle_type` only accepts `value`, `emotional`, `filial`, `luxury`, `urgency`, `activity`, and `food`.
- Several producers used producer-only labels such as `trend`, `longtail`, or programmatic SEO angles. These labels must be stored as context in `meta.raw_angle_type`, not as publishable `angle_type`.
- `programmatic-seo-generator`, `promotePendingTopics()`, and manual queue insertion previously sent `search_intent` as if it were a `blog_topic_queue` table column. It is not a table column. Search intent must live in `meta.search_intent`.
- Live DB repair applied on 2026-06-17:
  - normalized 17 queued/generating rows with empty publish angle to `value`;
  - reconciled 9 queue rows that were still `published` while their linked articles were already `archived`;
  - updated `blog_topic_queue_source_check` to allow the live `gsc_longtail` producer.
- Code hardening:
  - `src/lib/blog-queue-normalize.ts` is the single queue normalization contract;
  - queue producers must call `normalizeBlogTopicQueueRow()` before insert;
  - publisher calls `normalizeBlogAngleType()` before quality gates and DB write;
  - `blog-lifecycle` reconciles published queue rows whose linked article is no longer public.
- Publishing policy alignment:
  - `/admin/blog/policy` can set up to 8 posts per day;
  - `normalizeDailyPostTarget()` must not clamp that policy back to 4;
  - `blog-publisher` must read `getBlogPublishingPolicy('global')` before falling back to `BLOG_DAILY_PUBLISH_TARGET`.
- Verification:
  - `npm run type-check` passed;
  - `npx vitest run src/lib/blog-queue-normalize.test.ts` passed;
  - recent 14-day published posts all had `blog_indexing_jobs` rows;
  - after live repair, published queue rows matched public articles: `published queue 107`, `published article 107`, mismatch `0`.

### Queue Producer Rules

- Do not insert producer-only values directly into `blog_topic_queue.angle_type`.
- Do not insert unknown fields into `blog_topic_queue`; put non-schema fields under `meta`.
- Do not add a new queue `source` without updating the DB check constraint, admin labels, and this runbook.
- Do not mark the system healthy while `published_state_mismatch > 0`.
