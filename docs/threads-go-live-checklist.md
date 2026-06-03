# Threads Go-Live Checklist

Last updated: 2026-06-03

## Current Verification

- Remote Supabase project: `Yeosonam_OS` (`ixaxnvbmhzjvupissmly`)
- Applied migrations:
  - `threads_autopilot_closure`
  - `agent_actions_idempotency_key`
  - `threads_trend_learning_fingerprints`
- Verified schema:
  - `post_engagement_snapshots.tenant_id`
  - `agent_actions.idempotency_key`
  - `idx_peng_tenant_platform_time`
  - `idx_cd_threads_autopilot_candidates`
  - `idx_agent_actions_threads_rewrite`
  - `idx_agent_actions_idempotency_key_unique`
  - `trend_style_fingerprints`
  - `threads_learning_signals_14d`

## Required Account Checks

- [x] `THREADS_USER_ID` is the real operating Threads account (`yeosonam` verified via `/me`).
- [x] `THREADS_ACCESS_TOKEN` is configured for the operating Threads account.
- [x] `/admin/marketing/system-health` shows Threads publish config as `ok`.
- [x] Threads quota probe returns a quota value (`2/250` after smoke tests).
- [x] Threads generation stores `why_this_will_work`, `trend_sources`, `predicted_er`, and `risk_flags`.
- [x] Threads generation stores `learning_mode` and `trend_confidence`.
- [x] Threads publish persists `external_url` and `engagement.verification_status` when available.
- [x] Threads insights failures are classified and persisted in `content_distributions.engagement`.
- [x] System health checks Threads identity, latest post insights, and learning row counts.
- [x] Trend miner has `fallback_learning` mode for missing keyword search permission.
- [ ] `THREADS_KEYWORD_SEARCH_ENABLED=1` is set only after keyword search scope approval.
- [ ] `post_engagement_snapshots(platform='threads')` contains rows from the same Threads account/token as `content_distributions.external_id`.
- [ ] `trend_style_fingerprints(platform='threads')` contains at least one owned or external learning row.

## First Live Run

1. Open `/admin/marketing/system-health`.
2. Confirm Threads config, queue, and quota status.
3. Open `/admin/marketing/auto-publish`.
4. Select one low-risk test product.
5. Run dry-run first.
6. Review the generated Threads preview:
   - main/thread text
   - `why_this_will_work`
   - `predicted_er`
   - `learning_mode`
   - `trend_confidence`
   - risk flags
7. After manual approval, run `publishNow=true` for one live Threads post.
8. Open `/admin/marketing/published`.
9. Confirm:
   - `status = published`
   - `external_id` exists
   - `external_url` exists when probe returns permalink
   - `published_at` exists
   - `predicted_er` is visible
   - `verification_status` is visible in engagement metadata
   - no unexpected `error_message`
10. Confirm the actual post exists in Threads.
11. Run or wait for `/api/cron/sync-engagement`.
12. Confirm either:
   - `insights_status = synced`
   - or a classified `insights_error_category` explains the failure.

2026-06-03 smoke-test result:

- Direct Threads Graph publish succeeded.
- App publisher path publish succeeded and persisted the DB row.
- Latest verified permalink: `https://www.threads.com/@yeosonam/post/DZHCF1ZmI_a`

## First 24 Hours

- Check `/admin/marketing/published` every few hours for failed/retry rows.
- Run or wait for `/api/cron/sync-engagement`.
- Confirm snapshots are inserted into `post_engagement_snapshots`.
- Confirm `trend_style_fingerprints` refreshes after `sync-engagement`.
- Confirm low-performance posts create at most one `threads_rewrite_candidate` per distribution.
- Keep keyword/trend mining in fallback mode until Meta keyword scope is approved.

2026-06-03 learning-loop verification note:

- Current token can call `/me/threads`, but the latest DB `content_distributions.external_id` is not in that token's recent `/me/threads` list.
- Insights for that DB external id returned `code=100/subcode=33`.
- Treat generation and publish as live, but engagement learning is pending account/id alignment.

## Guard Activation

Use this only after the first dry-run and one live test post succeed.

```sql
UPDATE card_news_publish_guards
SET auto_publish_dry_run = false,
    auto_publish_enabled  = true,
    min_predicted_er      = 0.0150
WHERE scope_label = 'global';
```
