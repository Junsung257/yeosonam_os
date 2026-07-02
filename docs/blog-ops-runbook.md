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
- As of 2026-07-02, the same backlog recheck also includes product-backed rows when the blocker is a generator contract issue such as `keyword_density` or `engine_v2`. It still keeps product proof failures such as `product_open_contract`, customer-open contract failures, and registration evidence failures blocked until the linked package proof is repaired.
- If `diagnose:blog-autopublish` reports `publishability.next_action="quarantine_duplicates"` or `duplicate_candidate_count > 0`, run `npm run cleanup:blog-publishable-duplicates -- --json`, then apply with `--write` when `write_recommended=true`. This only skips duplicate active candidates; it does not delete queue history.
