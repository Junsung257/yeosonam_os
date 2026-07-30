# Threads Autopilot Runbook

Last updated: 2026-07-28

## Go-Live Status

- 2026-07-28 코드 기준으로 주제/원고/게시/댓글/멘션/성과 학습의 폐쇄 루프가 연결됐다.
- 새 실행 경로:
  - `/api/cron/threads-content-autopilot`: 매일 트렌드 학습을 반영한 Threads 원고 1건을 중복 없이 생성
  - `/api/cron/threads-engagement`: 5분마다 최근 자사 게시물의 중첩 댓글과 선택적 멘션을 처리
  - `/api/admin/marketing/threads-autopilot-readiness`: 비밀값 없이 계정·권한·만료·스케줄 차단 사유 진단
- 댓글은 `agent_actions.idempotency_key = threads_engagement:{reply_id}`와 실행 lease로 중복 처리를 막고, 미응답 실패/만료 건만 최대 3회 재시도한다.
- 일일 원고 생성과 실제 게시도 각각 원자적 claim/lease를 사용해 cron 중첩 실행 시 중복 생성·중복 게시를 막는다.
- 자동 게시 대상은 자동화가 만든 원고이거나 운영자가 명시 승인한 원고로 제한한다.
- dry-run은 게시 판단 이력과 일일 quota를 소비하지 않는다.
- 정상 대화만 자동 게시한다. 예약·결제·환불·분쟁·개인정보·법률/의료·프롬프트 공격은 게시하지 않고 운영 확인 큐에 남긴다.
- 댓글 안 URL은 서버에서 열지 않는다.
- Threads OAuth와 장기 토큰 갱신은 `graph.threads.net`의 `authorization_code`, `th_exchange_token`, `th_refresh_token` 흐름을 사용한다.
- 2026-07-28 확인 토큰은 댓글 자동화 필수 권한은 보유했지만 2026-08-02 만료 예정이며, `threads_manage_mentions`, `threads_keyword_search`가 없다. 새 OAuth 승인으로 교체해야 전체 기능이 열린다.

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
- 필수 권한: `threads_basic`, `threads_content_publish`, `threads_read_replies`, `threads_manage_replies`
- 전체 기능 권한: `threads_manage_mentions`, `threads_keyword_search`, `threads_manage_insights`
- 준비 완료(`ready = true`)는 위 7개 필수·전체 기능 권한이 모두 있어야 한다.
- OAuth 성공 시 토큰·사용자 ID·만료 시각을 `system_secrets`와 `social_platform_configs`에 동기화한다.
- 자동 갱신된 DB 토큰이 배포 시점의 env 토큰보다 우선한다.
- Keyword/trend mining requires Meta app review scope for Threads keyword search. Until then, owned-performance and curated fallback learning continue.

## Automation Flow

1. `/api/orchestrator/auto-publish`
   - Generates platform payloads from a product.
   - Inserts rows into `content_distributions`.
   - If `publishNow=true`, immediately publishes `threads_post` and `meta_ads`; other platforms remain queued/scheduled.
   - Threads preview shows rationale, predicted ER, learning mode, trend confidence, sources, and risk flags.

2. `/api/cron/auto-publish-loop`
   - Runs every 2 hours.
   - Evaluates autopilot-created `threads_post` drafts and any operator-approved Threads rows.
   - Atomically claims each row as `scheduled` with a 10-minute lease before external publish, preventing overlapping cron runs from posting the same row twice.
   - Uses the critic gate once, then passes the precomputed gate into the publisher.
   - Dry-run evaluates the gate without writing critic quota/decision history.

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

6. `/api/cron/threads-content-autopilot`
   - Runs daily after trend mining.
   - Rotates customer-open approved products, avoiding products used in the previous 14 days when possible.
   - Generates a content brief and three trend-aware Threads candidates, then persists the winner as a `threads_post` draft.
   - Claims a KST daily idempotency key before generation and creates at most one autopilot distribution per day; stale/failed work retries at most 3 times.
   - The global publish master and anomaly pause remain authoritative. Threads live/dry-run is controlled by `social_platform_configs(platform='threads').enabled`.

7. `/api/cron/threads-engagement`
   - Runs every 5 minutes.
   - Reads up to 20 recent root posts and flattened nested conversations sequentially.
   - Excludes the account's own replies and comments already answered by the account.
   - Reads paginated `/me/mentions` up to 100 items when `threads_manage_mentions` is granted; missing optional permission does not block owned-post replies.
   - Applies deterministic safety policy before any LLM call.
   - Generates a 300-character-or-shorter public reply, validates it again, then uses the official two-step container/publish flow.
   - Stores policy, generated text, provider ID/permalink, or sanitized failure in `agent_actions`.
   - Claims each item with a lease; only still-unanswered failed/stale items retry, up to 3 attempts.
   - Already-handled recent items do not consume the run budget, so older unanswered backlog continues to drain.
   - LLM output that fails post-generation validation is converted to a `threads_reply_review` item instead of being published.
   - Caps processing at 8 items per run and 80 successful replies per KST day.

Threads Graph requests send credentials in the `Authorization: Bearer` header and use bounded request timeouts; tokens are not placed in request URLs or publish form bodies.

## Full Autopilot Chain

`threads-trend-miner` → `threads-content-autopilot` → `auto-publish-loop` → `threads-engagement` → `sync-engagement` → trend/style learning.

Vercel schedules:

- Topic/trend mining: daily
- Threads content generation: daily
- Threads publish queue: every 2 hours
- Scheduled distribution publish: every 15 minutes
- Comment/mention response: every 5 minutes
- Engagement/learning sync: every 30 minutes

## Operator Checks

- `/admin/marketing/auto-publish`: run one-stop generation and inspect immediate publish results.
- `/admin/marketing/published`: inspect scheduled/published/failed rows, retry counts, predicted ER, and errors.
- Threads rows also expose generation rationale and risk flags when available.
- `/admin/marketing/system-health`: check Threads env, recent failed count, retry waiting count, and publish quota probe.
- System health also checks Threads identity, latest post insights probe, and learning row counts.
- `/api/admin/marketing/threads-autopilot-readiness`: canonical token/scopes/account/master-switch readiness result. It never returns token text.
- `agent_actions?action_type=threads_reply_review&status=pending`: high-risk comments requiring an operator.

## Failure Handling

- Critic rejection: inspect `content_distributions.error_message` and `engagement.predicted_er`; regenerate copy before publishing.
- Missing Threads config: set `THREADS_USER_ID` and `THREADS_ACCESS_TOKEN`, then rerun system health.
- Provider failure: let scheduled retry run; after `max_retries`, inspect the provider error and token/quota status.
- Low performance: review the `threads_rewrite_candidate` action before regenerating or publishing a rewrite.
- Empty trend learning: run `sync-engagement` after verified published posts, then confirm `post_engagement_snapshots` and `trend_style_fingerprints` have Threads rows.
- Insights `code=100/subcode=33`: confirm the persisted `content_distributions.external_id` belongs to the same Threads user returned by `GET /me` for `THREADS_ACCESS_TOKEN`.
- `verification_status = pending`: check `external_url`, `/me/threads`, and whether the token is for the same public Threads account.
- `missing_scope:threads_read_replies` or `missing_scope:threads_manage_replies`: reconnect through the Threads OAuth start endpoint and approve the full requested scope set.
- `threads_manage_mentions = false`: owned-post comments still run; mentions wait until app review/token approval.
- `threads_credentials_missing`: complete OAuth; do not paste tokens into logs or admin JSON.
- Failed automatic reply: inspect the corresponding `agent_actions` provider error. The unique idempotency key and execution lease prevent duplicate public replies; still-unanswered failures retry up to 3 times.
