# Blog Autopublish Contract

Last updated: 2026-07-07

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
- Customer-facing quality evaluator: `src/lib/blog-customer-quality.ts`
- Editorial/structure repair: `src/lib/blog-editorial-repair.ts`
- SEO scorer: `src/lib/blog-seo-scorer.ts`
- Indexing client: `src/lib/indexing.ts`
- Blog canonical URL helper: `src/lib/blog-canonical-url.ts`
- Backfill/audit tool: `scripts/backfill-blog-quality.ts`
- Manual indexing worker runner: `scripts/run-blog-indexing-worker.ts`
- Publish preflight evaluator: `src/lib/blog-publish-preflight.ts`
- Canary candidate preflight evaluator: `src/lib/blog-canary-preflight.ts`
- Current-day publisher health evaluator: `src/lib/blog-current-day-publisher-health.ts`
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
5. Build the LLM prompt from the same visual/content contract used by gates: no `==...==`, no `<mark>`, no highlight-style emphasis, and tables must be valid GitHub Flavored Markdown with a separator row and no blank lines inside table rows.
6. Normalize or reject the slug.
7. Ensure internal CTA links.
8. Ensure official reference links.
9. Insert or verify inline images.
10. Run `repairBlogEditorialQuality()`.
11. Run `repairBlogStructureQuality()`.
12. Run `runQualityGates()`, including `topic_fit`, `editorial_quality`, `accent_density`, `table_integrity`, and `cta_destination_integrity`.
13. Run `inspectBlogCustomerQuality()` through `evaluateBlogPublishQuality()` so customer-visible writing defects are scored with the same publish decision as render/SEO gates.
14. Run `computeSeoScore()`.
15. Run `computeReadability()` on the final post-gate body.

If a repair mutates body content after any gate failure, `repairBlogStructureQuality()` must run again before the next gate check.

## Publish Preflight Contract

Before expanding or manually forcing automatic publishing, the operator-facing preflight must pass:

- enough actually publishable candidates for the remaining daily slots;
- no evidence-insufficient or product-open-contract candidates blocking the ready pool;
- no actionable failed queue rows or stale `generating` rows;
- recent indexing outbox coverage at 100%;
- at least three recent published samples passing quality gate, content brief, SEO, and readability evidence.

The preflight may pass when overdue queued rows exist if the publishable candidate buffer is sufficient and publisher preflight can reschedule them. It must block when the issue changes publish safety, not when the row is harmless queue history.

## Current-Day Publisher Health Contract

Before the daily close window, reports may intentionally evaluate the previous KST day. That must not hide a current-day publisher failure.

- If the latest `blog-publisher` run is inside the current KST day and ran with remaining quota but published `0`, diagnostics must expose `current_day_publisher_failure`.
- The admin health summary must mark this as an active operating issue even when the closed-day SLA was already met.
- A quota-reached no-op with `remaining=0` remains healthy.

## Canary Candidate Contract

Before widening automatic publishing after engine changes, `diagnose:blog-autopublish` and admin health must be able to identify at least three low-risk queued candidates without claiming or publishing them.

- The preferred canary set includes both `info_writer` and `product_consultant_writer`.
- `info_writer` canaries require a concrete destination unless the candidate is explicitly marked `intentionally_generic`.
- Product canaries require a durable product dedup key using product, departure date, duration, and supplier evidence.
- Broad pillar rows, evidence-insufficient rows, duplicate rows, and topic-fit failures must be rejected before they consume publisher claim slots.
- Candidate topics that already violate the pre-publish title/slug contract must also be rejected before they consume publisher claim slots. Current blockers include banned editorial cliches such as `총정리` and `완벽 가이드`, machine separators such as `|`, month/year-leading topics that generate numeric slugs, weak expected slugs, and destinationless broad recommendation topics without a concrete comparison brief.
- Queue/admin operational health must use the same candidate pre-publish contract. A blocked queued row must be counted as `candidate_pre_publish_contract` / `quarantine_candidate_contract`, not as `publish_ready` or merely overdue inventory. Broad `pillar` rows are separate planning inventory and must be counted as `pillar_deferred`, not as candidate-contract failures.
- Editorial cliche blockers are `총정리`, `완벽 가이드`, `완벽 정리`, and similar title templates. If older mojibake text appears in historical evidence, interpret it as one of these Korean cliche blockers and do not use it as a literal prompt phrase.
- Candidate pre-publish contract failures are unsafe seeds, not manual rewrite backlog. Cleanup and publisher preflight should move them to `skipped` with durable `candidate_pre_publish_contract` metadata so they stop inflating failed/manual-review queue counts.

## Blocking Rules

The post must not be published when any of these are true:

- The quality gate fails after repair rounds.
- `customer_quality` fails because the post still has AI-like generic openings, weak answer-first paragraphs, duplicated product price suffixes such as `원부터부터`, repeated consultation placeholders, placeholder destination copy, unsupported internal data claims, early hard CTA in information posts, or table render risk.
- `generation_meta.content_brief` is missing, failed, or contradicts the raw topic/search intent.
- SERP/free-intent evidence is presented as ranking proof when it came from autocomplete fallback.
- `topic_fit` fails because the topic is a machine slug, placeholder, weak travel intent, or bad destination/intent combination.
- `editorial_quality` fails because the article contains placeholder text, visible prompt/writing-rule residue such as `규칙 A (감각 디테일)`, broken Korean particles, excessive highlights, generic image context, or machine-looking slug/title.
- SEO score fails after metadata repair.
- The slug is weak, generated-looking, numeric-leading, or hash-suffixed.
- Render integrity fails.
- Structure integrity fails.
- `accent_density` fails because highlight markup exists, numeric emphasis is excessive, heading counts are excessive, or paragraph walls remain.
- `table_integrity` fails because a Markdown table is missing a separator row, has inconsistent cells, or is too short to be useful.
- `cta_destination_integrity` fails because a package CTA has an empty or mismatched destination parameter.
- A product-backed post references a package whose unified `customer_open_contract` fails or whose `registration_evidence_pack_v1.downstream_eligibility.blog_publish` is false.
- Readability has repeated phrase spam that cannot be repaired.
- The article has no usable image path or missing image alt evidence.
- The article has no internal CTA and no official external reference.
- Canonical URL, sitemap URL, and stored slug disagree.
- Public article links contain localhost, 127.0.0.1, 0.0.0.0, or any non-public HTTP origin. Product CTA links must use the blog canonical public origin.

SEO score alone is not a publish success signal. A post is complete only when topic fit, editorial quality, render integrity, image quality, SEO, readability, indexing enqueue, and later visibility observation all have durable evidence.

## Customer Writing Contract

Automatic publishing must optimize for a reader who is deciding what to do next, not for a template that only looks SEO-complete.

Required writer split:

- `info_writer`: answer the reader's search intent first. The first 120-200 characters must contain a concrete answer, question, comparison, price/time/weather/document trigger, or checklist direction. Product or consultation CTA appears only near the bottom and must be soft.
- `product_consultant_writer`: help the customer make a pre-inquiry decision. The post must show price/from-city/duration, included/excluded items, fit/not-fit, risk notes, price-change conditions, and questions to ask before consultation.

Forbidden customer-visible patterns:

- Generic openings such as "답부터 말하면, 20XX년 X월 기준..." or "먼저 볼 것은 예산 범위, 이동 순서, 현지 확인 사항입니다."
- Product copy that says only "상담에서 최종 확인" repeatedly instead of giving a useful condition to check.
- Duplicate price suffixes such as `1,369,000원부터부터`.
- Weather or packing guides that open with cost/reservation copy instead of temperature, rain, clothing, and packing decisions.
- Product posts that invent hotel names, fixed benefits, scarcity, or confirmed schedules not present in product evidence.

Backfill and live publishing must use the same customer contract. `scripts/backfill-blog-quality.ts` should repair customer-visible copy and then run the full publish evaluator; a dry run with `qualityGateFailed=0`, `publishBlocked=0`, and `minorOnlyIssues=0` is the target for "100점" recent-post evidence.

## Indexing Contract

Publishing and indexing must be treated as separate responsibilities.

Correct sequence:

1. Publish only after all gates pass.
2. Revalidate `/blog`, `/blog/[slug]`, and the blog list tag.
3. Enqueue a durable `blog_indexing_jobs` row with `content_creative_id`, `slug`, `url`, and source.
4. Blog indexing URLs must be canonical `https://www.yeosonam.com/blog/{slug}` URLs. `BLOG_CANONICAL_ORIGIN` is the first-choice origin, and queued job URLs are canonicalized again before provider submission.
5. The existing `/api/cron/blog-publisher` schedule drains due indexing jobs through `processDueBlogIndexingJobs()`, and the GitHub external cron fallback calls `/api/cron/blog-indexing-worker` independently after publisher slots. Indexing must not depend on a successful publish run.
6. The worker submits sitemap through Google Search Console API or keeps it discoverable in `robots.txt`.
7. The worker submits changed URLs through IndexNow batch endpoints when `INDEXNOW_KEY` is configured.
   The same key must be publicly verifiable at `https://www.yeosonam.com/{INDEXNOW_KEY}.txt`; the app serves this only when the requested root `.txt` path exactly matches the configured key.
8. The worker records provider-specific results in `indexing_reports` and visibility snapshots.
9. Observe Google status through URL Inspection within quota.

IndexNow submissions must be duplicate-aware and provider-safe:

- The runtime caches recently submitted update URLs for 10 minutes by default (`INDEXNOW_RECENT_TTL_MS`) so repeated publisher/worker runs do not burn provider quota on the same canonical URL.
- `URL_DELETED` notifications bypass the recent-submit cache and must still be sent.
- Batch submissions are split by `INDEXNOW_MAX_URLS_PER_REQUEST` and provider calls are spaced by `INDEXNOW_PROVIDER_MIN_INTERVAL_MS`.
- If IndexNow responds with `Retry-After`, the worker must persist that evidence in `indexnow_retry_after_ms` and schedule the next durable outbox attempt no earlier than the provider's requested backoff.
- When `INDEXNOW_KEY` is configured, a failed IndexNow provider submission must not be hidden behind a successful Google sitemap hint. The outbox job remains retryable until IndexNow succeeds, is cached from a recent successful attempt, or exhausts `max_attempts`.

The durable blog outbox worker must not depend on legacy unauthenticated sitemap ping or WebSub calls for success. Those calls may exist only as explicit manual/backfill compatibility behavior, not as the normal `/blog` indexing success path.

Google sitemap submission is a hint, not a guarantee of indexing. Google no longer supports the old unauthenticated sitemap ping as the core path. URL Inspection is for status visibility and troubleshooting, not bulk indexing guarantees.

URL Inspection sampling must be quota-aware:

- The sampling cron must cap per-run inspection volume and also look at recent `indexing_reports` evidence before calling Google.
- Default internal caps stay below Google's public Search Console URL Inspection quotas: 25 per run, 100 per 10 minutes, and 1,500 per 24 hours.
- If the rolling budget is exhausted, the cron must skip URL Inspection and return `inspection_skipped_quota=true` with `inspection_quota` details instead of treating the skipped sample as publish/indexing failure.
- If Google returns a quota or rate-limit response during a run, the cron must stop additional URL Inspection calls for that run and surface `inspection_stopped_by_quota=true`.

Publishing routes must not call external indexing providers directly. They may only enqueue `blog_indexing_jobs`; retries and evidence persistence belong to the worker.

Every published slug must be observable in the indexing outbox. Treat these as separate failure classes:

- `indexing_outbox_missing`: a published slug never reached `blog_indexing_jobs`.
- `indexing_queue_error`: a durable job exists, but the worker/provider submission is pending, retrying, or failed.

Outbox coverage checks must compare recent published `content_creatives` rows with recent `blog_indexing_jobs` rows by `content_creative_id`, `slug`, or canonical `/blog/{slug}` URL. Queries over `blog_indexing_jobs` must be ordered by newest `updated_at` before applying a limit, otherwise large historical success tables can hide fresh jobs and create false alarms.

## Public Section Contract

The public blog is a topical cluster, not just a chronological list.

Required public surfaces:

- `/blog`
- `/blog/[slug]`
- `/blog/destination/[dest]`
- `/blog/angle/[angle]`
- `/sitemap.xml`

Rules:

- All public blog surfaces must use the shared canonical origin helper, `resolveBlogCanonicalOrigin()`.
- `/blog` destination guide cards must link to `/blog/destination/{dest}`, not the general `/destinations/{dest}` page. General destination pages can still exist, but blog destination pages carry the blog topical cluster.
- `/blog` destination sections should use site-wide active destination evidence (`active_destinations`) and only fall back to current-page posts when DB reads are unavailable.
- Destination and angle pages must use the same image display helper as the main blog list, so Supabase/remote images are normalized consistently.
- Sitemap must include blog destination and blog angle collection URLs when corresponding published posts exist.
- `/blog` list cache revalidation must not turn a transient DB timeout into a production error log or a silent empty list. If the primary list query times out, the page should serve last-good or Korean fallback content and record the event as degraded telemetry, not as a published-post count of zero.

## Daily Verification

Run:

```bash
npm run audit:blog-quality -- --limit=50
npm run audit:blog-search-daily:strict
npm run audit:blog-render:browser -- --base=https://www.yeosonam.com --json --strict
npm run audit:blog-images -- --base=https://www.yeosonam.com --json
npm run audit:blog-seo -- --base=https://www.yeosonam.com --json
npm run audit:blog-public-surfaces -- --base=https://www.yeosonam.com --strict
npm run diagnose:blog-autopublish -- --json
```

Failure policy:

- Any non-slug quality failure blocks the “healthy” status.
- Any recent published post missing a durable indexing outbox job blocks healthy status as `indexing_outbox_missing`.
- Any public blog section with a missing/mismatched canonical URL, duplicate brand title, noindex, DB-unavailable fallback, or missing blog collection sitemap entry blocks healthy status.
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
  - Independent endpoint: `src/app/api/cron/blog-indexing-worker/route.ts`.
  - Scheduler: existing `/api/cron/blog-publisher` drains due indexing jobs, and `.github/workflows/blog-external-cron.yml` runs `blog-indexing-worker` through the custom domain after publisher slots to avoid coupling indexing to publisher health.
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

- URL Inspection sampling with quota-aware backoff was added on 2026-07-04:
  - Helper: `src/lib/gsc-url-inspection-quota.ts`.
  - Cron integration: `src/app/api/cron/gsc-index-rank/route.ts`.
  - Test: `src/lib/gsc-url-inspection-quota.test.ts`.
- IndexNow retry/cache/rate-limit behavior was hardened on 2026-07-04:
  - Runtime cache and provider spacing: `src/lib/indexing.ts`.
  - Provider `Retry-After` propagation: `src/lib/indexing.ts`.
  - Durable retry scheduling: `src/lib/blog-indexing-worker.ts`.
  - Tests: `src/lib/indexing.test.ts`, `src/lib/blog-indexing-worker.test.ts`.
- A dashboard card for publish health versus indexing health was added on 2026-07-04:
  - UI: `src/app/admin/blog/system/page.tsx`.
  - Contract test: `src/app/admin/blog/blog-admin-ops-ui-contract.test.ts`.
- Candidate pre-publish readiness was hardened on 2026-07-04:
  - Shared contract: `src/lib/blog-candidate-prepublish-contract.ts`.
  - Publishable inventory and canary preflight now exclude candidates with banned editorial cliches, machine separators, numeric-leading slug risk, weak expected slugs, or destinationless broad recommendation topics.
  - Publisher preflight can quarantine these rows with `failure_code='candidate_pre_publish_contract'` before claim.
  - Production-data dry run showed publishable candidates `67 -> 49`, `candidate_contract_blocked_count=18`, canary still mixed with one info writer and two product consultant writers, and indexing outbox coverage remained 100%.
