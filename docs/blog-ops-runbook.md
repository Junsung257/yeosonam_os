# Blog Ops Runbook

Last updated: 2026-07-03

This runbook defines how operators decide whether the Yeosonam blog automation is healthy. The durable publish contract remains `docs/blog-autopublish-contract.md`; this file explains the daily operating workflow shown in `/admin/blog`.

## Daily Operating Standard

A day is healthy only when all of these are true:

- `/admin/blog` shows the blog OS level as `정상` or an accepted `관찰`.
- Today's published count is at or above the global publishing policy target.
- `/admin/blog/queue` has no failed, overdue, or stale generating rows in `운영 필요`.
- `/admin/blog/system` shows `blog-publisher`, `blog-scheduler`, `blog-daily-summary`, `blog-indexing-worker`, `gsc-index-rank`, and `serp-rank-snapshot` as successful or explainably skipped.
- Published posts have current `quality_gate`, `seo_score`, `readability_score`, `generation_meta.content_brief`, final slug, title, description, and image evidence.
- Public blog sections (`/blog`, `/blog/[slug]`, `/blog/destination/[dest]`, `/blog/angle/[angle]`, sitemap, blog API) return healthy titles, canonical URLs, indexability signals, and non-empty collection evidence.
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
- Do not treat provider-specific search submission drift as a publish cron failure when publishing, queue health, and indexing outbox coverage are healthy. Keep it as a `watch` alert under search visibility so operators do not confuse indexing/ranking work with broken autopublishing.

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
npm run audit:blog-public-surfaces -- --base=https://www.yeosonam.com --strict
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

## 2026-07-03 Ops Summary Breakdown Evidence

- `/api/admin/blog/ops-summary` now separates publish, queue, quality, indexing, and cron health under `health_sections`.
- Recent published-post quality is not treated as healthy just because `quality_gate.passed` is absent or not false. The summary checks durable evidence for content brief, SEO score, readability score, metadata, body, image evidence, quality gate failures, and the published info-destination contract.
- Slug-only cleanup is reported separately from non-slug quality failures. Non-slug quality failures block healthy status; slug-only cleanup is a watch item so operators do not confuse URL cleanup with broken article content.
- Queue failures are grouped into `slug_failures`, `non_slug_failures`, `indexing_failures`, and `stuck_queue_rows`.
- Indexing health exposes `outbox_missing`, `provider_failures`, `active_jobs`, and `google_unknown_urls` as separate buckets.
- `/admin/blog/system` and the sticky blog ops strip now surface this breakdown so operators can distinguish publish, queue, quality, indexing, and cron failures without reading raw DB rows.

## 2026-07-08 Daily Publish Count Reconciliation

- `diagnose:blog-autopublish` now reports both the raw `content_creatives` selected-day count and the reconciled operating count.
- If the closed-day `blog-daily-summary` and latest `blog-publisher.dailyQuota` agree that the daily target was reached, the diagnosis uses that evidence for `published.selected_day` and exposes the raw count under `published.selected_day_raw`.
- Do not open a `daily_publish_sla_miss` or `publisher_timeout` bucket from stale raw-count drift when the same-day daily summary and publisher quota show quota reached, preflight passes, and current-day publisher health is healthy.
- Treat this reconciliation as an operating-report correction only. If raw `content_creatives` drift persists, inspect the source query/date boundary separately instead of marking publishing broken.

## 2026-07-08 Customer Language Quality Hardening

- Recent 16-post backfill now targets `changed=0`, not merely `qualityGateFailed=0`. This prevents fixed posts from being rewritten repeatedly because of harmless storage formatting or non-idempotent repairs.
- Customer quality now blocks product DB evidence omissions, internal supplier/settlement term leaks, unsupported source-sensitive info guides, generated placeholder residue, duplicate hashtags, broken Markdown URL fragments, repeated answer-first hooks, and mobile paragraph walls.
- Final repair must normalize the H1 lead to one answer-first paragraph, preserve short answer leads, split only true long paragraphs, and run destination placeholder repair after CTA/FAQ/readability repairs.
- `src/lib/blog-final-customer-surface.ts` is the shared final customer-surface repair used by both `blog-publisher` and `backfill-blog-quality`; do not add a one-off published-row repair unless the live publisher also calls the same rule.
- `engine_v2.category_scores` is the operator-facing 100-point scorecard: reader task completion, customer language, naturalness, evidence/faithfulness, sales pressure, and product decision helpfulness for product posts. `engine_score` without per-category pass evidence is not enough to call a post 100점.
- `/admin/blog/system` recomputes and displays the recent-post engine category scorecard, including average category score, 100점 post count, below-100 count, and top weak categories. This keeps the scorecard visible even for older posts whose stored `generation_meta` predates the field.
- Verification on 2026-07-08:
  - `npm run audit:blog-quality -- --limit=16 --json --write` updated affected recent posts and queued indexing jobs.
  - `npm run run:blog-indexing-worker -- --json --limit=15` processed the queued jobs with `failed=0`.
  - Final `npm run audit:blog-quality -- --limit=16 --json` returned `changed=0`, `qualityGateFailed=0`, and `publishBlocked=0`.
  - `npm run type-check` passed.
  - `npx vitest run src/lib/blog-customer-quality.test.ts src/lib/blog-editorial-repair.test.ts src/lib/blog-product-consultant-writer.test.ts src/lib/blog-editorial-voice.test.ts` passed 68 tests.
  - `npm run diagnose:blog-autopublish -- --json` reported selected-day `4/4`, publish preflight score `100`, publishable candidates `49`, indexing outbox coverage `100`, and `buckets=[]`.
  - After wiring the shared final customer-surface repair into live publishing, `npx vitest run src/lib/blog-final-customer-surface.test.ts src/lib/blog-customer-quality.test.ts src/lib/blog-editorial-repair.test.ts src/lib/blog-product-consultant-writer.test.ts src/lib/blog-editorial-voice.test.ts` passed 72 tests; `npm run audit:blog-quality -- --limit=16 --json` returned `changed=0`, `qualityGateFailed=0`, and `publishBlocked=0`; `npm run diagnose:blog-autopublish -- --json` remained at publish preflight score `100`, publishable candidates `49`, indexing outbox coverage `100`, and `buckets=[]`.

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
- Every automated producer must run the topic-fit gate before inserting queue rows. Current required blockers:
  - seasonal month topics must be weather, clothing, packing, rainy/dry season, or checklist led; lodging micro-topics such as air-conditioner/no-air-conditioner are not publishable;
  - unsupported honeymoon pairings such as Shijiazhuang + honeymoon are not publishable;
  - topics that repeat the destination prefix, for example `Destination Destination(...)`, are not publishable.
- The publisher must re-run topic-fit before generation so old bad queue rows cannot leak into publication even if they were inserted before the current producer rules.

## 2026-06-17 Topic Quality Cleanup Evidence

- Live cleanup skipped 8 queued rows before they could publish:
  - 7 rows with duplicate destination prefix such as `연길/백두산 연길/백두산(...)`;
  - 1 unsupported destination topic for `석가장`.
- After cleanup, active bad-topic candidates matching air-conditioner lodging tangents, unsupported Shijiazhuang topics, or duplicate destination prefixes: `0`.
- Queue counts after cleanup: `published 107`, `queued 14`, `failed 9`, `skipped 259`.
- Published queue/article mismatch remained `0`.
- Code prevention:
  - `evaluateBlogTopicFit()` blocks the above cases;
  - `blog-publisher` blocks failed topic-fit rows before AI generation;
  - `trend-topic-miner`, `programmatic-seo-generator`, and `promotePendingTopics()` filter failed topic-fit rows before queue insert.

## 2026-06-17 Google Inspection URL Evidence

- Root cause: `gsc-index-rank` used `GSC_SITE_URL` to build inspected blog URLs. When `GSC_SITE_URL` pointed to a non-www Search Console property, URL Inspection checked `https://yeosonam.com/blog/...` while public redirects, canonical tags, OG URLs, robots sitemap, and sitemap locs all used `https://www.yeosonam.com/blog/...`.
- Evidence:
  - `audit:blog-gsc-domain -- --json` passed with score 100;
  - redirect, canonical, OG URL, and sitemap all resolved to `https://www.yeosonam.com`;
  - recent URL Inspection reports with `Google에는 아직 알려지지 않은 URL입니다.` were stored against non-www URLs.
- Fix:
  - URL Inspection now builds inspected URLs from the canonical public origin (`BLOG_CANONICAL_ORIGIN`, `NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_SITE_URL`, fallback `https://www.yeosonam.com`);
  - the Search Console property is tried separately through candidates: configured property, canonical URL-prefix, domain property, and non-www fallback;
  - `/api/admin/blog/ops-summary` counts Google unknown URLs only for canonical `https://www.yeosonam.com/blog/...` inspection records.
- Do not use the GSC property host to rewrite the URL being inspected. The inspected URL must stay equal to the public canonical URL.

## 2026-06-23 Daily Summary Timing Evidence

- The live `blog-publisher` schedule runs at 12:05, 15:05, 18:05, and 21:05 KST.
- `blog-daily-summary` previously ran at 09:10 KST, before the daily publish windows, so it was not a true post-publish operating report.
- The daily summary cron now runs at 22:12 KST (`12 13 * * *` UTC) and summarizes the current KST day after the final publisher slot.
- The daily summary uses the global publishing policy target instead of a hardcoded minimum, and duplicate unresolved `admin_alerts` for the same report date/type are suppressed.
- 2026-06-23 live checks found the public `/blog` page reachable. Supabase REST later recovered enough to verify that 2026-06-23 KST had `published=0`, while `blog_topic_queue` still had due queued rows.
- Vercel logs showed `blog-publisher` requests reaching the protected `*.vercel.app` deployment URL with HTTP 200 from Deployment Protection instead of the app route. A protection-bypass query reached the app route and returned JSON 401, which confirms the publisher function itself is behind the protection layer.
- Do not treat an edge-middleware 200 from a protected deployment URL as publish success. Success requires a `blog-publisher` row in `cron_health`/`cron_run_logs` for the current KST day plus `content_creatives.published_at` rows meeting the policy target.
- The daily summary now includes a `Blog Ops Watcher` report and checks whether `blog-publisher` ran today. It writes deduped unresolved alerts by issue code, so repeat failures accumulate in `cron_run_logs` without spamming duplicate open alerts.
- Required production fix: allow Vercel Cron to reach the cron API route despite Deployment Protection. Prefer a secure Vercel-supported automation bypass or a protection setting scoped to production cron traffic; do not commit the bypass secret into `vercel.json`.

## 2026-07-01 Daily Diagnosis Window Evidence

- `blog-daily-summary` and `scripts/diagnose-blog-autopublish.ts` must use the same closed-day rule.
- If the current KST time is before 22:12, both tools report the previous KST publishing day. This prevents a midnight or early manual run from flagging the new in-progress day as `publisher_cron_not_observed`.
- `publisher_cron_not_observed` is only actionable when the selected report day is under the daily target. If the target was already met, a later KST-day cron-health row must not turn a healthy summary into a blocked one.
- If `--date=YYYY-MM-DD` is passed to `diagnose:blog-autopublish`, the script audits that explicit KST date instead of applying the closed-day default.
- The diagnosis JSON exposes `report_period_closed`, `used_previous_day_for_pre_close_run`, and `close_minute_kst` so admin/operator tooling can show why a previous day was selected.

## 2026-07-01 Product Candidate Preflight Evidence

- Product-backed blog candidates must not consume publisher claim slots when their package cannot pass the unified customer-open contract.
- `blog-publisher` preflight now checks due queued rows with `product_id` before `claim_queue_items`.
- Candidates blocked by stale or missing customer mobile proof, failed scorecard evidence, or downstream `blog_publish` eligibility are marked `failed` with `failure_code='product_open_contract'` and `quarantine_reason='product_open_contract'`.
- `countPublishableQueueCandidates()`, `blog-daily-summary`, and `diagnose:blog-autopublish` exclude these rows from publishable candidate counts and treat them as evidence collection work, not as ready inventory.
- `diagnose:blog-autopublish -- --json` includes `product_evidence_work` so operators can see the blocked product title, queue row, blocker categories, raw blockers, and next action without reading raw DB rows.
- If the product proof may have been repaired after the queue row failed, run `npm run recheck:blog-product-evidence -- --json` first. The JSON now includes `write_recommended`, `write_reasons`, and `metadata_refresh_available`.
- Use `--write` when `write_recommended=true`, especially when `write_reasons` includes `requeue_recovered_product_rows` or `skip_duplicate_product_rows`. Passing product rows are requeued; duplicate product candidates are moved to `skipped` so they stop inflating failed evidence work.
- If `write_recommended=false` but `metadata_refresh_available=true`, the remaining rows are still blocked by current product evidence. Do not keep rewriting them just to refresh timestamps; fix the linked package proof, then rerun the dry-run.
- Do not requeue these rows until the linked package has fresh customer mobile proof and its customer-open contract passes.
- `Blog Product Proof Refresh` (`.github/workflows/blog-mobile-proof-refresh.yml`) runs daily at 11:35 KST before the scheduler and first publisher slot. It refreshes stale/missing `/packages` + `/lp` mobile proof for active products, then runs `recheck:blog-product-evidence -- --write` so recovered product-backed blog candidates can publish instead of staying blocked.
- If published product-backed blog posts fail `product_customer_open_contract_failed:mobile_proof stale`, run the same workflow manually or run `npm run prove:hwp-mobile -- --package-ids=... --base=https://www.yeosonam.com --apply-pass-only --continue-on-fail --json`, then rerun `npm run audit:blog-quality -- --limit=300`. Do not archive the posts before attempting proof refresh when the linked product is still active.

## Vercel Cron Bypass Fallback

- `.github/workflows/blog-external-cron.yml` is the Vercel-Cron-independent scheduler.
- It calls the custom domain, not the protected `*.vercel.app` deployment URL:
  - `https://www.yeosonam.com/api/cron/blog-scheduler?force=true` at 11:50 KST to replenish publishable queue candidates.
  - `https://www.yeosonam.com/api/cron/blog-publisher` at 12:07, 15:07, 18:07, and 21:07 KST.
  - `https://www.yeosonam.com/api/cron/blog-indexing-worker?force=true` at 12:27, 15:27, 18:27, and 21:27 KST to drain pending indexing jobs even when publisher quality gates fail.
  - `https://www.yeosonam.com/api/cron/blog-daily-summary` at 22:12 KST.
- The workflow requires a GitHub Actions repository secret named `CRON_SECRET`, with the same value as the production Vercel `CRON_SECRET`.
- Scheduled workflow calls include `force=true`, because blog publishing, scheduling, and daily reporting are critical cron jobs and must not be silently skipped by `DB_RESOURCE_SAVER_MODE`.
- The workflow treats `blog-publisher` as failed when `remainingBeforeRun > 0` and `published=0`. HTTP 200 is not enough; the run must either publish or surface a concrete failure bucket.
- The workflow now retries `blog-publisher` up to two additional times when `dailyQuota.remainingAfterRun > 0`, calling `blog-scheduler?force=true` before each retry. After those retries, any remaining daily quota is a failed run, not a healthy partial success.
- The workflow treats `blog-indexing-worker` as failed when the response reports `failed > 0` or non-empty `errors`. `processed=0` is allowed because no due jobs is a healthy no-op.
- This bypasses the Vercel Cron delivery problem, but it still depends on the Vercel-hosted app route being reachable through `www.yeosonam.com`.
- If Vercel hosting/functions are fully down, move the publisher worker itself to an external runtime such as a small VPS, Cloudflare Worker plus queue, or Supabase Edge Function; do not rely on HTTP calls into the Vercel app in that failure mode.
- `vercel.json` is also aligned to the same daily blog-scheduler and four publisher slots as a redundant path; keep GitHub Actions as the custom-domain fallback when Deployment Protection or Vercel Cron delivery is unreliable.

## 2026-07-02 Canonical Indexing URL Evidence

- Blog publishing, CTA links, indexing outbox jobs, and indexing worker submissions must use the same public canonical origin: `https://www.yeosonam.com`.
- Do not fall back to `https://yeosonam.com` for blog indexing or public blog CTA URLs. Non-www URLs redirect publicly, but indexing evidence, sitemap URLs, canonical tags, and visibility snapshots should stay on the www origin.
- `src/lib/blog-canonical-url.ts` is the shared helper for blog canonical origin and `/blog/{slug}` indexing URLs.
- `enqueueBlogIndexingJob()` canonicalizes newly inserted indexing jobs, and `processDueBlogIndexingJobs()` canonicalizes existing pending jobs before provider submission. If a queued job's stored URL and slug disagree, the slug is treated as the durable source of truth.
- Manual safe drain command:

```bash
npm run run:blog-indexing-worker -- --json --limit=15
```

- This command loads `.env.local` before importing the worker. Keep that order; importing the worker first makes Supabase configuration look missing because the Supabase client reads env at module load.

## 2026-06-24 Micro-Angle Publish Recovery

- Root cause after cron/auth recovery: the active queue was mostly stale duplicate candidates, especially broad `destination + value` topics. Keeping the duplicate gate is correct; the fix is to generate more specific candidates before publishing.
- `blog-scheduler` and `blog-publisher` now call `ensureDailyPublishableQueue()` to maintain at least 8-12 queued candidates.
- `blog-publisher` runs a preflight quarantine before claiming rows. Queued rows that already carry non-retryable duplicate/topic/context failures are moved to `skipped` or `failed` instead of being reclaimed on every run.
- If the publisher burns through candidates before meeting the remaining daily quota, it performs an emergency micro-angle refill and tries to claim again in the same run.
- Product keyword-density checks now use a short generated SEO keyword or `destination package` fallback. Compound destinations such as `Da Nang/Hoi An` are not collapsed to a single city, which prevents false stuffing failures.
- Daily publisher runs defer due `source='pillar'` queue rows by 7 days and lower their priority, because long-form destination hub generation should not consume the daily 3-4 commercial/info publishing slots.
- New generated candidates keep `angle_type='value'` for the content generator, but store specific `meta.micro_angle` values such as `budget_family`, `transport_cost`, `hotel_area`, `food_budget`, `weather_packing`, `first_day_plan`, `shopping_budget`, `kid_friendly`, `airport_arrival`, and `local_mobility`.
- The duplicate gate now uses `destination + micro_angle` for micro-angle candidates. Rows without `micro_angle` still use the older broad `destination + angle_type` protection.
- `cron_run_logs` are no longer skipped for critical blog crons while DB resource saver mode is on. This preserves the daily audit trail for publisher, scheduler, and summary runs.
- `npm run cleanup:blog-queue-health -- --json` is the safe dry-run for stale `generating` rows and failed-row metadata drift. Use `--write` only when the dry-run shows stale generating recovery or failure metadata repair; it does not delete rows or blindly requeue non-retryable failures.
- As of 2026-07-02, the same overdue queued-row rescheduler also runs automatically in `blog-publisher` preflight, so old but otherwise publishable `queued` rows are moved back to the current publish window before claim. Manual `cleanup:blog-queue-health` remains the safe audit/backfill command.
- As of 2026-07-02, strict SEO audits split info-guide and product-consult length expectations. Info guides keep the 2,500-character ideal warning, while product/package consult posts are checked for decision-help signals and only warn below the product-consult length floor.
- `queue_failed` in daily summary means retryable/actionable failed rows. Historical or quarantined failures remain visible as `queue_failed_total` and `queue_operational_health`, but they must not be treated as current publisher blockers unless `actionable_failed_count > 0`.
- Daily summary now records the publisher `failure_breakdown` and a reader-facing `next_action`, so repeated duplicate, structure, render, or candidate-shortage failures can be tracked without retrying the same skipped topics.
- As of 2026-07-02, `diagnose:blog-autopublish`, `blog-daily-summary`, and `/api/admin/blog/ops-summary` expose `editorial_backlog_work`. This groups quarantined quality backlog rows by reader intent, structure/table, keyword use, engine contract, topic fit, SEO metadata, and image evidence so operators can fix the generator contract instead of blindly requeueing old failed rows.
- As of 2026-07-02, repaired editorial backlog rows can be checked with `npm run recheck:blog-editorial-backlog -- --json`. If the dry-run reports `write_recommended=true`, run `npm run recheck:blog-editorial-backlog -- --json --write` to requeue only rows whose failure signatures are covered by the current repair contract and skip active duplicates before they can consume publisher claims.
- As of 2026-07-07, `render_integrity` failures caused only by residual Markdown bold markers (`literal_markdown_bold` / `standalone_markdown_bold`) are recoverable after the current editorial repair contract strips decorative bold markers before render checks. Recheck should requeue those rows instead of leaving them in manual review.
- As of 2026-07-04, image backlog recheck distinguishes image shortage from unsafe image evidence. Rows that failed only with `image_count_below_minimum` may be requeued because the publisher now inserts inline images before quality gates. Rows with missing alt text, malformed URLs, duplicate URLs, or no contextual alt/caption remain blocked until the image selection or metadata source is fixed.
- As of 2026-07-02, the same backlog recheck also includes product-backed rows when the blocker is a generator contract issue such as `keyword_density` or `engine_v2`. It still keeps product proof failures such as `product_open_contract`, customer-open contract failures, and registration evidence failures blocked until the linked package proof is repaired.
- As of 2026-07-02, editorial backlog recheck parses named runtime failures instead of collapsing them into `other`. `blog_content_brief_failed:missing_primary_keyword` and stale generation quarantines are recoverable after the current generator contract is deployed. Legacy broad `source='pillar'` rows blocked by `context_missing` are retired to `skipped` instead of being requeued into daily commercial/info publish slots.

## 2026-07-03 Indexing Outbox Coverage Evidence

- Root cause class: `blog-publisher` previously swallowed indexing enqueue failures, so `operational_checks.indexing_queued` could look healthy even if a published slug never entered the durable worker queue.
- Fix:
  - publisher enqueue results now preserve per-slug failures and append `indexing_enqueue_failed:{slug}:{error}` to the run errors;
  - `/api/admin/blog/ops-summary`, `blog-daily-summary`, and `diagnose:blog-autopublish` expose `indexing_outbox_coverage`;
  - admin health reports `indexing_outbox_missing` separately from provider/worker failures.
- Coverage queries over `blog_indexing_jobs` must order by newest `updated_at` and inspect the latest 1,000 rows. Do not use an unordered capped read; it can miss fresh jobs in a large historical success table.
- Verification on 2026-07-03:
  - `npm run type-check` passed;
  - `npx vitest run src/lib/blog-indexing-coverage.test.ts src/lib/blog-indexing-worker.test.ts src/lib/blog-editorial-repair.test.ts src/lib/blog-seo-scorer.test.ts src/lib/blog-structure-audit.test.ts src/lib/blog-topic-fit-gate.test.ts` passed;
  - `npm run diagnose:blog-autopublish -- --json` reported selected-day publish `4/4`, `indexing_outbox_coverage.coverage_rate=100`, and `buckets=[]`.
- If `diagnose:blog-autopublish` reports `publishability.next_action="quarantine_duplicates"` or `duplicate_candidate_count > 0`, run `npm run cleanup:blog-publishable-duplicates -- --json`, then apply with `--write` when `write_recommended=true`. This only skips duplicate active candidates; it does not delete queue history.

## 2026-07-03 Publish Preflight Evidence

- `src/lib/blog-publish-preflight.ts` is the shared operator preflight evaluator for `/api/admin/blog/ops-summary`, `blog-daily-summary`, and `diagnose:blog-autopublish`.
- The preflight separates:
  - hard blockers: insufficient publishable candidates for remaining slots, evidence blockers, actionable failed/stale generating rows, missing indexing outbox jobs, or failed recent canary quality samples;
  - warnings: low candidate buffer, duplicate pressure, or manual-review backlog;
  - harmless queue history: overdue queued rows are not a warning when publishable inventory is already sufficient and publisher preflight can reschedule them.
- The recent canary baseline is three recent published posts with quality gate, content brief, SEO, and readability evidence.
- Verification on 2026-07-03:
  - `npx vitest run src/lib/blog-publish-preflight.test.ts` passed;
  - `npm run diagnose:blog-autopublish -- --json` reported `publish_preflight.status="pass"`, score `100`, `canary_ready=true`, and `buckets=[]`.

## 2026-07-03 Canary Candidate Readiness Evidence

- `src/lib/blog-canary-preflight.ts` selects safe queued canaries without mutating queue state or publishing.
- The canary set prefers a mixed writer sample so engine changes prove both info-guide and product-consult paths before expanding automation.
- Info canaries must have a concrete destination unless the candidate is intentionally generic. Product canaries must carry product-backed dedup evidence.
- Rejected canary reasons, including `info_missing_destination` and `pillar_deferred`, are reported as queue repair signals instead of hidden publisher failures.
- Verification on 2026-07-03:
  - `npx vitest run src/lib/blog-canary-preflight.test.ts` passed;
  - `npm run diagnose:blog-autopublish -- --json` reported `canary_preflight.status="pass"`, ready `3/3`, and mixed writer coverage.

## 2026-07-03 Current-Day Publisher Failure Evidence

- Closed-day diagnosis intentionally reports the previous KST day before 22:12. This must not hide an active same-day publisher failure.
- `src/lib/blog-current-day-publisher-health.ts` evaluates the latest `blog-publisher` `cron_health` row separately from the closed-day SLA window.
- If the latest current-day publisher run had remaining quota and published `0`, `diagnose:blog-autopublish` reports `current_day_publisher_failure` and `/admin/blog` marks the contract as failed.
- A quota-reached no-op with `remaining=0` remains healthy.
- A single slow AI writer or card-news bridge call must not consume the full Vercel function window. The publisher wraps those calls with local timeout guards (`BLOG_PUBLISHER_AI_TIMEOUT_MS`, `BLOG_PUBLISHER_BRIDGE_TIMEOUT_MS`) so a bad candidate is recorded through queue failure handling and the cron can still write a useful summary before the 285s completion guard.
- Verification on 2026-07-03:
  - `npx vitest run src/lib/blog-current-day-publisher-health.test.ts src/lib/blog-publish-preflight.test.ts src/lib/blog-canary-preflight.test.ts src/app/api/cron/blog-daily-summary/route.test.ts` passed;
  - `npm run diagnose:blog-autopublish -- --json` reported `current_day_publisher_health.status="risk"` and bucket `current_day_publisher_failure` for the current-day zero-published run.

## 2026-07-05 Publisher Time Budget Evidence

- Root cause class: a single slow candidate could start while there was still nominal time left, then consume the whole 285s cron completion guard before the publisher wrote a useful summary.
- The publisher now uses a shared time-budget helper:
  - `src/lib/blog-publisher-time-budget.ts`
  - `src/lib/blog-publisher-time-budget.test.ts`
- `blog-publisher` only starts another queue item when the remaining runtime is above `BLOG_PUBLISHER_MIN_ITEM_START_MS`.
- Generation is wrapped by a dynamic timeout that preserves `BLOG_PUBLISHER_ITEM_FINISH_RESERVE_MS` for gates, DB writes, and the final cron summary.
- Optional post-publish work such as keyword enrichment, RAG indexing, and inline indexing-worker draining runs only when `BLOG_PUBLISHER_OPTIONAL_WORK_MIN_MS` remains. Durable `blog_indexing_jobs` enqueue still happens before this optional split, so independent indexing workers can finish provider submission later.
- Publisher summaries include a `time_budget` object so operators can distinguish a graceful time-budget stop from a hard wrapper timeout.
