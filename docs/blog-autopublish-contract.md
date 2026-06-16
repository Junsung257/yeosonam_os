# Blog Autopublish Contract

Last updated: 2026-06-16

This document defines the required contract for automatic blog generation, publishing, and indexing. It exists because one-off repairs to already published rows do not prevent the same defect from recurring in live autopublishing.

## Evidence Base

Official and implementation references:

- Google sitemap guidance: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Google sitemap ping deprecation: https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping
- Google URL Inspection API: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- Google Search Console API limits: https://developers.google.com/webmaster-tools/limits
- IndexNow protocol documentation: https://www.indexnow.org/documentation
- Vercel Cron duration guidance: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Server-side sitemap implementation reference: https://github.com/iamvishnusankar/next-sitemap
- IndexNow batch/retry/cache implementation reference: https://github.com/viv1/indexnow-submitter
- Free search-intent fallback: Google Suggest autocomplete via `suggestqueries.google.com` is allowed as keyword/intent guidance when paid or keyed SERP providers are unavailable. It must not be represented as ranking proof.

Local code references:

- Live publisher: `src/app/api/cron/blog-publisher/route.ts`
- Topic fit gate: `src/lib/blog-topic-fit-gate.ts`
- Content brief gate: `src/lib/blog-content-brief.ts`
- SERP/free intent analyzer: `src/lib/serp-analyzer.ts`
- Shared publish evaluator: `src/lib/blog-publish-quality.ts`
- Editorial/structure repair: `src/lib/blog-editorial-repair.ts`
- SEO scorer: `src/lib/blog-seo-scorer.ts`
- Indexing client: `src/lib/indexing.ts`
- Backfill/audit tool: `scripts/backfill-blog-quality.ts`
- Slug redirect map: `src/lib/blog-slug-redirects.ts`
- Slug migration dry-run/write tool: `scripts/migrate-blog-slugs.ts`

## Required Publish State Machine

Every automatic blog must follow this state machine:

1. `queued`
2. `generating`
3. `generated_draft`
4. `prepared_for_publish`
5. `quality_checked`
6. `published` or `gate_failed`
7. `indexing_queued`
8. `indexing_submitted`
9. `visibility_observed`

No path may write `status='published'` unless it has current evidence for:

- `quality_gate`
- `generation_meta.content_brief`
- `seo_score`
- `readability_score`
- `readability_issues`
- final `slug`
- final `seo_title`
- final `seo_description`
- final `blog_html`

## Required Pre-Publish Pipeline

Before the first publish gate:

1. Run `evaluateBlogTopicFit()` before inserting any automatic topic into `blog_topic_queue`.
2. Build `generation_meta.content_brief` with `buildBlogContentBrief()` before LLM writing.
3. Treat raw queue topics as seeds only. The brief is the source of truth for final title, primary keyword, secondary keywords, search intent, required sections, forbidden angles, and source requirements.
4. Run `analyzeSerp()` for eligible keywords. If Naver keys are missing or no results are returned, use the free Google Suggest fallback only as keyword/search-intent guidance.
5. Normalize or reject the slug.
6. Ensure internal CTA links.
7. Ensure official reference links.
8. Insert or verify inline images.
9. Run `repairBlogEditorialQuality()`.
10. Run `repairBlogStructureQuality()`.
11. Run `runQualityGates()`, including `topic_fit` and `editorial_quality`.
12. Run `computeSeoScore()`.
13. Run `computeReadability()` on the final post-gate body.

If a repair mutates body content after any gate failure, `repairBlogStructureQuality()` must run again before the next gate check.

## Blocking Rules

The post must not be published when any of these are true:

- The quality gate fails after repair rounds.
- `generation_meta.content_brief` is missing, failed, or contradicts the raw topic/search intent.
- SERP/free-intent evidence is presented as ranking proof when it came from autocomplete fallback.
- `topic_fit` fails because the topic is a machine slug, placeholder, weak travel intent, or bad destination/intent combination.
- `editorial_quality` fails because the article contains placeholder text, broken Korean particles, excessive highlights, generic image context, or machine-looking slug/title.
- SEO score fails after metadata repair.
- The slug is weak, generated-looking, numeric-leading, or hash-suffixed.
- Render integrity fails.
- Structure integrity fails.
- Readability has repeated phrase spam that cannot be repaired.
- The article has no usable image path or missing image alt evidence.
- The article has no internal CTA and no official external reference.
- Canonical URL, sitemap URL, and stored slug disagree.

SEO score alone is not a publish success signal. A post is complete only when topic fit, editorial quality, render integrity, image quality, SEO, readability, indexing enqueue, and later visibility observation all have durable evidence.

## Indexing Contract

Publishing and indexing must be treated as separate responsibilities.

Correct sequence:

1. Publish only after all gates pass.
2. Revalidate `/blog`, `/blog/[slug]`, and the blog list tag.
3. Enqueue a durable `blog_indexing_jobs` row with `content_creative_id`, `slug`, `url`, and source.
4. The existing `/api/cron/blog-publisher` schedule drains due indexing jobs through `processDueBlogIndexingJobs()`. `/api/cron/blog-indexing-worker` remains available for manual runs.
5. The worker submits sitemap through Google Search Console API or keeps it discoverable in `robots.txt`.
6. The worker submits changed URLs through IndexNow batch endpoints when `INDEXNOW_KEY` is configured.
7. The worker records provider-specific results in `indexing_reports` and visibility snapshots.
8. Observe Google status through URL Inspection within quota.

Google sitemap submission is a hint, not a guarantee of indexing. Google no longer supports the old unauthenticated sitemap ping as the core path. URL Inspection is for status visibility and troubleshooting, not bulk indexing guarantees.

Publishing routes must not call external indexing providers directly. They may only enqueue `blog_indexing_jobs`; retries and evidence persistence belong to the worker.

## Daily Verification

Run:

```bash
npm run audit:blog-quality -- --limit=50
npm run audit:blog-search-daily:strict
npm run audit:blog-render:browser -- --base=https://www.yeosonam.com --json --strict
npm run audit:blog-images -- --base=https://www.yeosonam.com --json
npm run audit:blog-seo -- --base=https://www.yeosonam.com --json
```

Failure policy:

- Any non-slug quality failure blocks the “healthy” status.
- Indexing provider success below 80% creates an admin alert.
- `generating` rows older than 30 minutes must be recovered or quarantined.

## Remaining Hardening Work

Priority 1:

- Extract a shared `prepareBlogForPublish()` helper so every publish path uses the same repair/evaluation contract. Done for direct publish paths on 2026-06-15:
  - `src/app/api/blog/route.ts`
  - `src/app/api/content-queue/route.ts`
  - `src/app/api/content-hub/publish/route.ts`
  - `src/app/api/blog/mrt-hotel-ranking/route.ts`
  - `src/app/api/cron/blog-regenerate-zero-click/route.ts`
  - `src/lib/social-publishing/distribution-publisher.ts`
- Indexing outbox implemented on 2026-06-15:
  - Migration: `supabase/migrations/20260615150000_blog_indexing_jobs.sql`.
  - Enqueue helper: `src/lib/blog-indexing-outbox.ts`.
  - Worker core: `src/lib/blog-indexing-worker.ts`.
  - Manual endpoint: `src/app/api/cron/blog-indexing-worker/route.ts`.
  - Scheduler: existing `/api/cron/blog-publisher` drains due indexing jobs to avoid Vercel's 100-cron limit.
- Slug migration and recent-post quality backfill completed on 2026-06-15 after redirects and indexing worker were live:
  - `npx tsx scripts/migrate-blog-slugs.ts --write`
  - `npm run audit:blog-quality -- --limit=50 --write`
  - `npm run audit:blog-quality -- --limit=50`
  - Final dry-run result: `changed=0`, `qualityGateFailed=0`.
  - Indexing outbox result: `active=0`, `succeeded=112`.
- Latest 10-post follow-up on 2026-06-15:
  - Five latest machine slugs were migrated to reader-facing slugs.
  - Nine repairable recent posts were backfilled and re-indexed.
  - `shijiazhuang-itinerary` was archived instead of repaired because `석가장 신혼여행` is a blocked destination/intent mismatch.
  - Final dry-run result: `changed=0`, `qualityGateFailed=0`.
  - Active indexing queue: `0`.

Priority 2:

- Split sitemap into blog/package/destination sitemap files if URL count or update cadence grows.
- Add canary generation: publish three low-risk topics to draft/preflight, verify gates, then publish.
- Add daily admin summary fields for non-slug failures, slug failures, indexing failures, and stuck queue rows.

Priority 3:

- Add URL Inspection sampling with quota-aware backoff.
- Add IndexNow retry/cache/rate-limit behavior based on the external implementation pattern.
- Add a dashboard card for “publish health” versus “indexing health.”
