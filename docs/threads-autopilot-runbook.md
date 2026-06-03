# Threads Autopilot Runbook

Last updated: 2026-06-03

## Go-Live Status

- Remote Supabase project `Yeosonam_OS` (`ixaxnvbmhzjvupissmly`) has the Threads autopilot schema applied.
- Verified DB objects:
  - `post_engagement_snapshots.tenant_id`
  - `agent_actions.idempotency_key`
  - `idx_peng_tenant_platform_time`
  - `idx_cd_threads_autopilot_candidates`
  - `idx_agent_actions_threads_rewrite`
  - `idx_agent_actions_idempotency_key_unique`
  - `trend_style_fingerprints`
  - `threads_learning_signals_14d`
- `system_secrets` has verified `THREADS_ACCESS_TOKEN` and `THREADS_USER_ID` for the `yeosonam` Threads account.
- Local `.env.local` has verified `THREADS_ACCESS_TOKEN`, `THREADS_USER_ID`, `THREADS_APP_ID`, and `THREADS_APP_SECRET`.
- Vercel production and development envs have been updated with the Threads credentials. Production values are sensitive and show as placeholders when pulled.
- Live publish smoke tests completed on 2026-06-03:
  - Direct Threads Graph publish succeeded.
  - App publisher path wrote a `content_distributions` row, published it, and persisted `status = published`, `external_id`, and `published_at`.
  - Threads quota health reported `2/250`.
- Trend learning engine completed on 2026-06-03:
  - Generation prompt reads compact trend/style fingerprints.
  - Threads output now stores `why_this_will_work`, `trend_sources`, `predicted_er`, and `risk_flags`.
  - Threads output also stores `learning_mode` and `trend_confidence`.
  - Keyword search permission failure now falls back to existing trend rows and owned performance learning.
  - If no rows exist yet, generation uses `learning_mode = fallback_curated` instead of an empty trend context.
  - Current learning source rows are empty: `external_trend_posts = 0`, `post_engagement_snapshots(platform='threads') = 0`, `trend_style_fingerprints = 0`.
  - Latest DB `threads_post` external id is not returned by the current `/me/threads` token and insights returned `code=100/subcode=33`; resolve account/token/id alignment before declaring the engagement learning loop fully live.

## Canonical Model

- Platform key: `threads_post`
- Source table: `content_distributions`
- Main payload shape: `{ main: string, thread?: string[], hashtags?: string[], image_urls?: string[] }`
- Publish state flow: `draft` or `approved` -> `scheduled` -> `published` or `failed`
- Low-performance rewrite queue: `agent_actions.action_type = 'threads_rewrite_candidate'`
- Trend/style memory: `trend_style_fingerprints`
- Owned performance view: `threads_learning_signals_14d`

## Required Settings

- `THREADS_USER_ID`
- `THREADS_ACCESS_TOKEN` preferred, with `META_ACCESS_TOKEN` as fallback where supported
- `CRON_SECRET`
- `NEXT_PUBLIC_SITE_URL` or `NEXT_PUBLIC_BASE_URL`
- Keyword/trend mining requires Meta app review scope for Threads keyword search. Keep mining in dry-run or fallback trend mode until the scope is approved.

## Automation Flow

1. `/api/orchestrator/auto-publish`
   - Generates platform payloads from a product.
   - Inserts rows into `content_distributions`.
   - If `publishNow=true`, immediately publishes `threads_post` and `meta_ads`; other platforms remain queued/scheduled.
   - Threads preview shows rationale, predicted ER, learning mode, trend confidence, sources, and risk flags.

2. `/api/cron/auto-publish-loop`
   - Runs every 2 hours.
   - Evaluates `threads_post` rows in `draft` or `approved`.
   - Uses the critic gate once, then passes the precomputed gate into the publisher.

3. `/api/cron/publish-scheduled`
   - Runs every 15 minutes.
   - Publishes due `scheduled` distributions.
   - Failed rows retry after 30 minutes until `max_retries`, then become `failed`.
   - Threads publish persists `external_url` when the post probe returns a permalink.
   - Threads publish stores `engagement.verification_status` and `engagement.verification_error`.

4. `/api/cron/sync-engagement`
   - Pulls platform metrics for published rows.
   - Inserts `post_engagement_snapshots`.
   - Updates `content_distributions.engagement`.
   - Stores `insights_status`, `insights_error`, and `insights_error_category` when Threads insights fail.
   - Classifies `code=100/subcode=33` as `identity_or_permission_mismatch` and avoids hiding the failure.
   - Queues a single rewrite candidate for weak Threads posts using `agent_actions.idempotency_key = threads_rewrite:{distribution_id}`.
   - Refreshes `trend_style_fingerprints` after metrics sync.

5. `/api/cron/threads-trend-miner`
   - Pulls keyword trend rows only when Threads keyword search scope is available.
   - If keyword search returns permission errors, returns `mode = fallback_learning`.
   - Refreshes `trend_style_fingerprints` from whatever existing external/owned rows are available.

## Operator Checks

- `/admin/marketing/auto-publish`: run one-stop generation and inspect immediate publish results.
- `/admin/marketing/published`: inspect scheduled/published/failed rows, retry counts, predicted ER, and errors.
- Threads rows also expose generation rationale and risk flags when available.
- `/admin/marketing/system-health`: check Threads env, recent failed count, retry waiting count, and publish quota probe.
- System health also checks Threads identity, latest post insights probe, and learning row counts.

## Failure Handling

- Critic rejection: inspect `content_distributions.error_message` and `engagement.predicted_er`; regenerate copy before publishing.
- Missing Threads config: set `THREADS_USER_ID` and `THREADS_ACCESS_TOKEN`, then rerun system health.
- Provider failure: let scheduled retry run; after `max_retries`, inspect the provider error and token/quota status.
- Low performance: review the `threads_rewrite_candidate` action before regenerating or publishing a rewrite.
- Empty trend learning: run `sync-engagement` after verified published posts, then confirm `post_engagement_snapshots` and `trend_style_fingerprints` have Threads rows.
- Insights `code=100/subcode=33`: confirm the persisted `content_distributions.external_id` belongs to the same Threads user returned by `GET /me` for `THREADS_ACCESS_TOKEN`.
- `verification_status = pending`: check `external_url`, `/me/threads`, and whether the token is for the same public Threads account.
