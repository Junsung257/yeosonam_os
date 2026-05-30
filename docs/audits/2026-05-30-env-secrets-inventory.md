# Env / Secret Inventory Audit (Redacted)

Generated: 2026-05-30T01:53:55.122Z

## Summary

- Local env files found: .env.local, .env.prod
- Unique local keys: 77
- Vercel keys visible via CLI: 49
- Code-referenced env/getSecret keys: 272
- Duplicate key definitions inside one local file: 0
- Duplicate/split Vercel entries for same key: 8
- Same key with different non-placeholder local values across files: 1
- Code-referenced keys missing from both local files and Vercel: 221
- Code-referenced/critical keys not set for Vercel Production: 27

## Recommended SSOT

- Canonical source for real production secrets: Vercel Environment Variables on project `os`.
- Canonical local working file: `.env.local`, generated/refreshed from Vercel plus local-only overrides.
- `.env.prod` is now a redacted production manifest/template, not a secret store.
- `.env.vercel` has been removed from the local workspace; regenerate only when needed via `vercel env pull`.

## Critical Key Snapshot

| Key | Category | .env.local | .env.prod | Vercel targets | Code refs |
|---|---|---:|---:|---|---:|
| `NEXT_PUBLIC_SUPABASE_URL` | public-client | set(len 40) | placeholder | development, preview, production | 117 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public-client | set(len 46) | placeholder | development, preview, production | 20 |
| `SUPABASE_SERVICE_ROLE_KEY` | secret-server | set(len 219) | placeholder | development, preview, production | 107 |
| `SUPABASE_JWT_SECRET` | secret-server | - | placeholder | preview, production | 8 |
| `DATABASE_URL` | secret-server | - | placeholder | preview, production | 0 |
| `NEXT_PUBLIC_BASE_URL` | public-client | set(len 21) | set(len 24) | production | 80 |
| `CRON_SECRET` | secret-server | set(len 26) | placeholder | development, preview, production | 17 |
| `ADMIN_EMAILS` | server-config | - | set(len 18) | preview, preview:feature/card-news-v2, production | 1 |
| `GOOGLE_AI_API_KEY` | secret-server | set(len 39) | placeholder | development, preview, production | 36 |
| `DEEPSEEK_API_KEY` | secret-server | set(len 35) | placeholder | development, preview, production | 28 |
| `META_CAPI_ACCESS_TOKEN` | secret-server | set(len 200) | placeholder | production | 1 |
| `META_PIXEL_ID` | server-config | set(len 16) | placeholder | production | 2 |
| `NEXT_PUBLIC_META_PIXEL_ID` | public-client | set(len 16) | placeholder | development, preview, production | 2 |
| `META_ACCESS_TOKEN` | secret-server | set(len 208) | placeholder | development, preview, production | 11 |
| `META_AD_ACCOUNT_ID` | server-config | set(len 20) | placeholder | development, preview, production | 3 |
| `META_PAGE_ID` | server-config | set(len 16) | placeholder | development, preview, production | 3 |
| `GSC_SITE_URL` | server-config | - | placeholder | production | 8 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | server-config | set(len 2356) | placeholder | development, production | 5 |
| `INDEXNOW_KEY` | secret-server | - | placeholder | production | 2 |
| `REVALIDATE_SECRET` | secret-server | set(len 64) | placeholder | development, preview, production | 12 |
| `OAUTH_STATE_SECRET` | secret-server | set(len 64) | placeholder | development, preview, production | 8 |

## Duplicate/Split Vercel Entries

| Key | Entries | Targets |
|---|---:|---|
| `NEXT_PUBLIC_META_PIXEL_ID` | 2 | development, preview, production |
| `THREADS_ACCESS_TOKEN` | 2 | development, production |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 2 | development, production |
| `IR_CANARY_ROLLOUT_PCT` | 2 | preview, preview:feature/card-news-v2, production |
| `IR_CANARY_ENABLED` | 2 | preview, preview:feature/card-news-v2, production |
| `CRON_SECRET` | 2 | development, preview, production |
| `MYREALTRIP_MYLINK_ID` | 2 | preview, production |
| `ADMIN_EMAILS` | 2 | preview, preview:feature/card-news-v2, production |

## Local Value Mismatch Across Env Files

| Key | Files | Category |
|---|---|---|
| `NEXT_PUBLIC_BASE_URL` | .env.local, .env.prod | public-client |

## Code-Referenced/Critical Keys Missing In Vercel Production

| Key | Local Files | Vercel Targets | References |
|---|---|---|---:|
| `NEXT_PUBLIC_CONSULT_PHONE` | .env.prod | - | 3 |
| `GSC_SERVICE_ACCOUNT_JSON` | .env.prod | - | 3 |
| `SUPABASE_MANAGEMENT_TOKEN` | - | - | 1 |
| `DEEPSEEK_MODEL` | - | - | 1 |
| `SUPABASE_SERVICE_KEY` | - | - | 1 |
| `SLACK_CWV_WEBHOOK_URL` | .env.prod | - | 2 |
| `META_ADS_TEST_MODE` | .env.prod | - | 2 |
| `GOOGLE_GEMINI_API_KEY` | - | - | 3 |
| `SLACK_ALERTS_WEBHOOK` | .env.prod | - | 1 |
| `META_GRAPH_ACCESS_TOKEN` | - | - | 2 |
| `GSC_SERVICE_ACCOUNT` | - | - | 1 |
| `SLACK_WEBHOOK_URL` | .env.prod | - | 6 |
| `META_ADS_DRY_RUN` | .env.prod | - | 1 |
| `GOOGLE_ADS_CLIENT_ID` | - | - | 4 |
| `GOOGLE_ADS_CLIENT_SECRET` | - | - | 2 |
| `SLACK_PAYMENTS_WEBHOOK_URL` | .env.prod | - | 2 |
| `SLACK_ALERT_WEBHOOK_URL` | .env.prod | - | 1 |
| `SLACK_ALERTS_WEBHOOK_URL` | .env.prod | - | 1 |
| `GOOGLE_API_KEY` | - | - | 4 |
| `META_ADS_ACCESS_TOKEN` | .env.prod | - | 3 |
| `META_GRAPH_API_VERSION` | .env.prod | - | 1 |
| `GOOGLE_SITE_VERIFICATION` | .env.prod | - | 1 |
| `META_WEBHOOK_VERIFY_TOKEN` | .env.prod | - | 2 |
| `GOOGLE_CONVERSION_ID` | - | - | 1 |
| `SLACK_CHANNEL_ID` | .env.prod | - | 1 |
| `GOOGLE_PAGESPEED_API_KEY` | - | - | 1 |
| `SLACK_GROUP_RFQ_WEBHOOK_URL` | .env.prod | - | 1 |

## High-Signal Local-Only Non-Placeholder Keys

| Key | Files | References | Category |
|---|---|---:|---|
| `META_ADS_DRY_RUN` | .env.prod | 1 | server-config |
| `META_ADS_TEST_MODE` | .env.prod | 2 | server-config |
| `META_GRAPH_API_VERSION` | .env.prod | 1 | server-config |
| `NEXT_PUBLIC_PARTYTOWN` | .env.prod | 2 | public-client |
| `VERCEL` | .env.prod | 3 | server-config |
| `VERCEL_OIDC_TOKEN` | .env.local | 0 | secret-server |

## Vercel-Only Keys

| Key | Vercel Targets | Type | References | Category |
|---|---|---|---:|---|
| `ADMIN_API_TOKEN` | preview, production | sensitive | 3 | secret-server |
| `DATABASE_URL` | preview, production | sensitive | 0 | secret-server |
| `DESIGN_PREVIEW_SECRET` | preview, production | sensitive | 1 | secret-server |
| `GSC_SITE_URL` | production | sensitive | 8 | server-config |
| `INDEXNOW_KEY` | production | sensitive | 2 | secret-server |
| `IR_CANARY_ENABLED` | preview, preview:feature/card-news-v2, production | sensitive | 1 | server-config |
| `IR_CANARY_ROLLOUT_PCT` | preview, preview:feature/card-news-v2, production | sensitive | 1 | server-config |
| `JARVIS_ENGINE` | preview, production | sensitive | 0 | server-config |
| `JARVIS_STREAM_ENABLED` | preview, production | sensitive | 1 | server-config |
| `JARVIS_V2_MAX_ROUNDS` | preview, production | sensitive | 1 | server-config |
| `MYREALTRIP_MYLINK_ID` | preview, production | encrypted | 1 | server-config |
| `SMS_WEBHOOK_SECRET` | production | sensitive | 1 | secret-server |
| `SUPABASE_JWT_SECRET` | preview, production | sensitive | 8 | secret-server |
| `THREADS_ACCESS_TOKEN` | development, production | encrypted, sensitive | 3 | secret-server |
| `THREADS_USER_ID` | production | sensitive | 2 | server-config |

## Full Key Matrix

| Key | Category | .env.local | .env.prod | Vercel targets | Type | Code refs |
|---|---|---:|---:|---|---|---:|
| `ADMIN_API_TOKEN` | secret-server | - | placeholder | preview, production | sensitive | 3 |
| `ADMIN_EMAILS` | server-config | - | set(len 18) | preview, preview:feature/card-news-v2, production | encrypted | 1 |
| `AD_FLAG_UP_BID_FACTOR` | server-config | - | - | - | - | 1 |
| `AD_LONGTAIL_CPC_MAX` | server-config | - | - | - | - | 1 |
| `AD_MIN_BID_KRW` | server-config | - | - | - | - | 2 |
| `AD_OFFPEAK_BID_FACTOR` | server-config | - | - | - | - | 2 |
| `AD_OPTIMIZER_APPLY_CHANGES` | server-config | - | - | - | - | 1 |
| `AD_OPTIMIZER_APPLY_OFFPEAK_RULE` | server-config | - | - | - | - | 1 |
| `AD_ROAS_TARGET_PCT` | server-config | - | - | - | - | 1 |
| `AFFILIATE_ATTRIBUTION_MODEL` | server-config | - | - | - | - | 1 |
| `AFFILIATE_INVITE_CODES` | server-config | - | - | - | - | 2 |
| `AFFILIATE_IP_SALT` | server-config | - | - | - | - | 1 |
| `AFFILIATE_JWT_SECRET` | secret-server | - | - | - | - | 1 |
| `AFFILIATE_LIFETIME_EXPERIMENT_RATE` | server-config | - | - | - | - | 1 |
| `AFFILIATE_REF_STRICT_MARKETING_CONSENT` | server-config | - | - | - | - | 1 |
| `AFFILIATE_TOKEN_SECRET` | secret-server | - | - | - | - | 4 |
| `AGODA_AFFILIATE_API_KEY` | secret-server | - | - | - | - | 1 |
| `AI_DEFAULT_PROVIDER` | server-config | - | placeholder | - | - | 1 |
| `AI_EXECUTOR_TIMEOUT_MS` | server-config | - | - | - | - | 2 |
| `AI_IMAGE_GEN_ENABLED` | server-config | - | - | - | - | 1 |
| `AI_SHADOW_MODE` | server-config | - | - | - | - | 1 |
| `AI_TASK_MODEL_OVERRIDES` | server-config | - | - | - | - | 1 |
| `AI_TASK_PROVIDER_OVERRIDES` | server-config | - | - | - | - | 1 |
| `ALLOW_DRAFT` | server-config | - | - | - | - | 2 |
| `AMADEUS_CLIENT_ID` | server-config | - | - | - | - | 1 |
| `AMADEUS_CLIENT_SECRET` | secret-server | - | - | - | - | 1 |
| `ANALYZE` | server-config | - | - | - | - | 1 |
| `ANTHROPIC_API_KEY` | secret-server | - | placeholder | - | - | 9 |
| `AUDIT_BASE_URL` | server-config | - | - | - | - | 1 |
| `AUTO_APPROVE_LEARNING` | server-config | - | - | - | - | 1 |
| `BACKFILL_BASE_URL` | server-config | - | - | - | - | 1 |
| `BAND_RSS_URL` | server-config | - | - | - | - | 1 |
| `BASE_URL` | server-config | - | - | - | - | 5 |
| `BLOG_AI_MODEL` | server-config | set(len 17) | set(len 17) | development, preview, production | encrypted | 1 |
| `BLOG_CARD_NEWS_RENDER_BUFFER_MS` | server-config | - | - | - | - | 1 |
| `BLOG_CHAIN_OF_DENSITY` | server-config | - | - | - | - | 1 |
| `BLOG_OG_WATERMARK` | server-config | - | - | - | - | 1 |
| `BLOG_QUALITY_REVIEW` | server-config | - | - | - | - | 1 |
| `BOOKING_ATTRIBUTION_AUTOFIX` | server-config | - | - | - | - | 1 |
| `BOOKING_AUTOMATION_TIER` | server-config | - | - | - | - | 1 |
| `BOOKING_GUEST_TOKEN_TTL_DAYS` | secret-server | - | - | - | - | 1 |
| `BRIDGE_VERIFY_BASE_URL` | server-config | - | - | - | - | 1 |
| `CARD_NEWS_ID` | server-config | - | - | - | - | 1 |
| `CI` | server-config | - | - | - | - | 3 |
| `COMPANY_ACCOUNT` | server-config | - | - | - | - | 2 |
| `CONCIERGE_EVAL_THRESHOLD` | server-config | - | - | - | - | 1 |
| `CRON_SECRET` | secret-server | set(len 26) | placeholder | development, preview, production | encrypted, sensitive | 17 |
| `DATABASE_URL` | secret-server | - | placeholder | preview, production | sensitive | 0 |
| `DEEPSEEK_API_KEY` | secret-server | set(len 35) | placeholder | development, preview, production | encrypted | 28 |
| `DEEPSEEK_MODEL` | server-config | - | - | - | - | 1 |
| `DEFAULT_COMMISSION_RATE` | server-config | - | - | - | - | 3 |
| `DESIGN_PREVIEW_SECRET` | secret-server | - | placeholder | preview, production | sensitive | 1 |
| `DEV_REVALIDATE_URL` | server-config | - | - | - | - | 1 |
| `DISABLE_AUTO_RENDER` | server-config | - | - | - | - | 1 |
| `DISABLE_COVER_CRITIC` | server-config | - | - | - | - | 1 |
| `DISABLE_RESPONSE_CRITIC` | server-config | - | - | - | - | 1 |
| `DORMANT_MONTHS` | server-config | - | - | - | - | 1 |
| `DRY_RUN` | server-config | - | - | - | - | 5 |
| `E2E_BASE_URL` | server-config | - | - | - | - | 1 |
| `ENABLE_DIRECT_SETTLEMENT` | server-config | - | - | - | - | 1 |
| `ENABLE_PLAYWRIGHT_OTA` | server-config | - | - | - | - | 1 |
| `ENABLE_UNMATCHED_QUEUE_ON_VIEW` | server-config | - | - | - | - | 1 |
| `ENCRYPTION_SECRET_KEY` | secret-server | set(len 32) | placeholder | development, preview, production | encrypted | 3 |
| `EXCHANGE_RATE_API_KEY` | secret-server | - | - | - | - | 1 |
| `EXTERNAL_POI` | server-config | - | - | - | - | 1 |
| `GEMINI_API_KEY` | secret-server | set(len 39) | placeholder | development, preview, production | encrypted | 20 |
| `GOOGLE_ADS_CLIENT_ID` | server-config | - | - | - | - | 4 |
| `GOOGLE_ADS_CLIENT_SECRET` | secret-server | - | - | - | - | 2 |
| `GOOGLE_AI_API_KEY` | secret-server | set(len 39) | placeholder | development, preview, production | encrypted | 36 |
| `GOOGLE_API_KEY` | secret-server | - | - | - | - | 4 |
| `GOOGLE_CONVERSION_ID` | server-config | - | - | - | - | 1 |
| `GOOGLE_GEMINI_API_KEY` | secret-server | - | - | - | - | 3 |
| `GOOGLE_PAGESPEED_API_KEY` | secret-server | - | - | - | - | 1 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | server-config | set(len 2356) | placeholder | development, production | encrypted, sensitive | 5 |
| `GOOGLE_SITE_VERIFICATION` | server-config | - | placeholder | - | - | 1 |
| `GSC_SERVICE_ACCOUNT` | server-config | - | - | - | - | 1 |
| `GSC_SERVICE_ACCOUNT_JSON` | server-config | - | placeholder | - | - | 3 |
| `GSC_SITE_URL` | server-config | - | placeholder | production | sensitive | 8 |
| `GUEST_PORTAL_SESSION_SECRET` | secret-server | - | - | - | - | 1 |
| `GUIDEBOOK_TOKEN_SECRET` | secret-server | - | - | - | - | 2 |
| `INDEXNOW_KEY` | secret-server | - | placeholder | production | sensitive | 2 |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | server-config | - | - | - | - | 1 |
| `IR_CANARY_CONCURRENCY` | server-config | - | - | - | - | 2 |
| `IR_CANARY_DEFAULT_ENGINE` | server-config | - | - | - | - | 1 |
| `IR_CANARY_ENABLED` | server-config | - | placeholder | preview, preview:feature/card-news-v2, production | sensitive | 1 |
| `IR_CANARY_MAX_PRODUCTS` | server-config | - | - | - | - | 2 |
| `IR_CANARY_MULTI` | server-config | - | - | - | - | 2 |
| `IR_CANARY_ROLLOUT_PCT` | server-config | - | placeholder | preview, preview:feature/card-news-v2, production | sensitive | 1 |
| `JARVIS_AGENT_MODEL` | server-config | - | - | - | - | 1 |
| `JARVIS_ENGINE` | server-config | - | placeholder | preview, production | sensitive | 0 |
| `JARVIS_HISTORY_TURNS` | server-config | - | - | - | - | 1 |
| `JARVIS_MAX_ROUNDS` | server-config | - | - | - | - | 1 |
| `JARVIS_ROUTER_MODEL` | server-config | - | - | - | - | 1 |
| `JARVIS_SPECIALIST_ROUTER` | server-config | - | - | - | - | 1 |
| `JARVIS_STREAM_ENABLED` | server-config | - | placeholder | preview, production | sensitive | 1 |
| `JARVIS_TOOL_TIMEOUT_MS` | server-config | - | - | - | - | 1 |
| `JARVIS_V2_AGENT_MODEL` | server-config | - | - | - | - | 1 |
| `JARVIS_V2_HISTORY_TURNS` | server-config | - | - | - | - | 1 |
| `JARVIS_V2_MAX_ROUNDS` | server-config | - | placeholder | preview, production | sensitive | 1 |
| `KAKAO_CHANNEL_SECRET` | secret-server | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_AFFILIATE_CELEBRATION` | server-config | - | - | - | - | 2 |
| `KAKAO_TEMPLATE_BALANCE` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_CONCIERGE_CART_RETARGET` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_DEPOSIT` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_FREE_TRAVEL_RETARGET` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_GUIDEBOOK_READY` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_MAGIC_LINK` | server-config | - | - | - | - | 2 |
| `KAKAO_TEMPLATE_MILEAGE_EARNED` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_MILEAGE_EVENT` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_MILEAGE_EXPIRED` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_MILEAGE_EXPIRING` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_MILEAGE_USED` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_PASSPORT` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_PREPARATION` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_REVIEW_REQUEST` | server-config | - | - | - | - | 3 |
| `KAKAO_TEMPLATE_VOUCHER_ISSUED` | server-config | - | - | - | - | 1 |
| `KAKAO_TEMPLATE_WELCOME_MILEAGE` | server-config | - | - | - | - | 1 |
| `LIMIT` | server-config | - | - | - | - | 2 |
| `LTR_TRAINING_SECRET` | secret-server | - | - | - | - | 1 |
| `LTR_TRAINING_SERVICE_URL` | server-config | - | - | - | - | 1 |
| `MAGIC_LINK_SECRET` | secret-server | - | - | - | - | 1 |
| `MAGIC_SESSION_SECRET` | secret-server | - | - | - | - | 2 |
| `MARKETING_AGENT_TIMEOUT_MS` | server-config | - | - | - | - | 1 |
| `MARKETING_RULES_APPLY_BID_UPDATES` | server-config | - | - | - | - | 1 |
| `MARKETING_RULES_VERBOSE` | server-config | - | - | - | - | 1 |
| `META_ACCESS_TOKEN` | secret-server | set(len 208) | placeholder | development, preview, production | encrypted | 11 |
| `META_ADS_ACCESS_TOKEN` | secret-server | - | placeholder | - | - | 3 |
| `META_ADS_DRY_RUN` | server-config | - | set(len 1) | - | - | 1 |
| `META_ADS_TEST_MODE` | server-config | - | set(len 1) | - | - | 2 |
| `META_AD_ACCOUNT_ID` | server-config | set(len 20) | placeholder | development, preview, production | encrypted | 3 |
| `META_APP_ID` | server-config | set(len 15) | placeholder | development, preview, production | encrypted | 7 |
| `META_APP_SECRET` | secret-server | set(len 32) | placeholder | development, preview, production | encrypted | 8 |
| `META_CAPI_ACCESS_TOKEN` | secret-server | set(len 200) | placeholder | production | sensitive | 1 |
| `META_GRAPH_ACCESS_TOKEN` | secret-server | - | - | - | - | 2 |
| `META_GRAPH_API_VERSION` | server-config | - | set(len 5) | - | - | 1 |
| `META_IG_USER_ID` | server-config | set(len 17) | placeholder | development, preview, production | encrypted | 3 |
| `META_PAGE_ID` | server-config | set(len 16) | placeholder | development, preview, production | encrypted | 3 |
| `META_PIXEL_ID` | server-config | set(len 16) | placeholder | production | sensitive | 2 |
| `META_WEBHOOK_VERIFY_TOKEN` | secret-server | - | placeholder | - | - | 2 |
| `MILEAGE_EARN_RATE_PCT` | server-config | - | - | - | - | 1 |
| `MILEAGE_MAX_USE_PCT` | server-config | - | - | - | - | 1 |
| `MILEAGE_MIN_EARN` | server-config | - | - | - | - | 1 |
| `MIN_SCORE` | server-config | - | - | - | - | 1 |
| `MOCK_RFQ_AI` | server-config | - | - | - | - | 1 |
| `MYREALTRIP_API_KEY` | secret-server | - | - | - | - | 2 |
| `MYREALTRIP_MARGIN_RATE` | server-config | - | - | - | - | 1 |
| `MYREALTRIP_MYLINK_ID` | server-config | - | - | preview, production | encrypted | 1 |
| `NAVER_BLOG_ACCESS_TOKEN` | secret-server | - | - | - | - | 1 |
| `NAVER_CAFE_ID` | server-config | - | - | - | - | 1 |
| `NAVER_CLIENT_ID` | server-config | - | - | - | - | 6 |
| `NAVER_CLIENT_SECRET` | secret-server | - | - | - | - | 5 |
| `NEXT_DIST_DIR` | server-config | - | - | - | - | 2 |
| `NEXT_PUBLIC_` | public-client | - | - | - | - | 2 |
| `NEXT_PUBLIC_APP_URL` | public-client | - | - | - | - | 11 |
| `NEXT_PUBLIC_BASE_URL` | public-client | set(len 21) | set(len 24) | production | encrypted | 80 |
| `NEXT_PUBLIC_CLARITY_PROJECT_ID` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_CONSULT_PHONE` | public-client | - | placeholder | - | - | 3 |
| `NEXT_PUBLIC_CONTACT_EMAIL` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_CRON_SECRET` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_DEFAULT_TENANT_ID` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_DEV_AFFILIATE_CODE` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_GA4_ID` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_GOOGLE_ADS_CUSTOMER_ID` | public-client | - | - | - | - | 2 |
| `NEXT_PUBLIC_GOOGLE_ADS_DEVELOPER_TOKEN` | public-client | - | - | - | - | 3 |
| `NEXT_PUBLIC_INSURANCE_URL` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_KAKAO_CHANNEL_ID` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_KAKAO_PIXEL_ID` | public-client | - | - | - | - | 2 |
| `NEXT_PUBLIC_META_PIXEL_ALLOW_PREVIEW` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_META_PIXEL_ID` | public-client | set(len 16) | placeholder | development, preview, production | encrypted | 2 |
| `NEXT_PUBLIC_NAVER_ADS_API_KEY` | public-client | - | - | - | - | 2 |
| `NEXT_PUBLIC_NAVER_ADS_CUSTOMER_ID` | public-client | - | - | - | - | 2 |
| `NEXT_PUBLIC_NAVER_ADS_SECRET_KEY` | public-client | - | - | - | - | 2 |
| `NEXT_PUBLIC_NAVER_ANALYTICS_ID` | public-client | - | - | - | - | 3 |
| `NEXT_PUBLIC_PARTYTOWN` | public-client | - | set(len 1) | - | - | 2 |
| `NEXT_PUBLIC_QA_CHAT_V2_ENABLED` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_SENTRY_DSN` | public-client | - | - | - | - | 7 |
| `NEXT_PUBLIC_SITE_URL` | public-client | - | - | - | - | 30 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public-client | set(len 46) | placeholder | development, preview, production | encrypted | 20 |
| `NEXT_PUBLIC_SUPABASE_URL` | public-client | set(len 40) | placeholder | development, preview, production | encrypted | 117 |
| `NEXT_PUBLIC_USIM_URL` | public-client | - | - | - | - | 1 |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | public-client | set(len 87) | placeholder | development, preview, production | encrypted | 4 |
| `NEXT_PUBLIC_X` | public-client | - | - | - | - | 3 |
| `NEXT_RUNTIME` | server-config | - | - | - | - | 1 |
| `NODE_ENV` | server-config | - | - | - | - | 39 |
| `NX_DAEMON` | server-config | - | set(len 5) | - | - | 0 |
| `OAUTH_STATE_SECRET` | secret-server | set(len 64) | placeholder | development, preview, production | encrypted | 8 |
| `OPENAI_API_KEY` | secret-server | - | - | - | - | 1 |
| `OPS_VERCEL_DASHBOARD_URL` | server-config | - | - | - | - | 1 |
| `OTA_MAX_PER_RUN` | server-config | - | - | - | - | 1 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | server-config | - | - | - | - | 1 |
| `OTEL_SERVICE_NAME` | server-config | - | - | - | - | 2 |
| `PEXELS_API_KEY` | secret-server | set(len 56) | placeholder | development, preview, production | encrypted | 10 |
| `PLATFORM_LEARNING_STORE_REDACTED_MESSAGE` | server-config | - | - | - | - | 1 |
| `PLAYWRIGHT_MONTHLY_QUOTA_HOURS` | server-config | - | - | - | - | 1 |
| `PORT` | server-config | - | - | - | - | 3 |
| `POST_AUDIT_AI` | server-config | - | - | - | - | 1 |
| `POST_AUDIT_AI_MONTHLY_CAP_KRW` | server-config | - | - | - | - | 1 |
| `POST_AUDIT_AUTOFIX` | server-config | - | - | - | - | 1 |
| `POST_AUDIT_COVE` | server-config | - | - | - | - | 1 |
| `POST_AUDIT_RAG` | server-config | - | - | - | - | 1 |
| `PROD_REVALIDATE_URL` | server-config | - | - | - | - | 2 |
| `PROMPT_CACHE_TTL_MS` | server-config | - | - | - | - | 1 |
| `PUBLIC_SITE_URL` | server-config | - | - | - | - | 1 |
| `PUBLISH_ORCHESTRATION_WRITE_LOGS` | server-config | - | - | - | - | 1 |
| `RESEND_API_KEY` | secret-server | - | - | - | - | 4 |
| `RESEND_FROM_EMAIL` | server-config | - | - | - | - | 2 |
| `REVALIDATE_SECRET` | secret-server | set(len 64) | placeholder | development, preview, production | encrypted | 12 |
| `REVALIDATE_URL` | server-config | - | - | - | - | 1 |
| `RFQ_BID_TIMEOUT_MINUTES` | server-config | - | - | - | - | 1 |
| `RFQ_TIER_DELAY_MINUTES` | server-config | - | - | - | - | 1 |
| `SENTRY_DSN` | server-config | - | - | - | - | 4 |
| `SENTRY_ORG` | server-config | - | - | - | - | 1 |
| `SENTRY_PROJECT` | server-config | - | - | - | - | 1 |
| `SERPAPI_KEY` | secret-server | - | - | - | - | 1 |
| `SKIP_AUTO_APPROVE` | server-config | - | - | - | - | 1 |
| `SKIP_DUMP_RESULT` | server-config | - | - | - | - | 2 |
| `SKIP_ENV_VALIDATION` | server-config | - | - | - | - | 1 |
| `SKIP_EPR_EMBEDDING` | server-config | - | - | - | - | 1 |
| `SKIP_POST_AUDIT` | server-config | - | - | - | - | 2 |
| `SKIP_PRE_INSERT_GATE` | server-config | - | - | - | - | 1 |
| `SKIP_REVALIDATE` | server-config | - | - | - | - | 1 |
| `SKIP_UNMATCHED_INGEST` | server-config | - | - | - | - | 1 |
| `SKIP_VISUAL_BASELINE` | server-config | - | - | - | - | 1 |
| `SKYSCANNER_API_KEY` | secret-server | - | - | - | - | 1 |
| `SLACK_ALERTS_WEBHOOK` | server-config | - | placeholder | - | - | 1 |
| `SLACK_ALERTS_WEBHOOK_URL` | server-config | - | placeholder | - | - | 1 |
| `SLACK_ALERT_WEBHOOK_URL` | server-config | - | placeholder | - | - | 1 |
| `SLACK_BOT_TOKEN` | secret-server | set(len 59) | placeholder | development, preview, production | encrypted | 1 |
| `SLACK_CHANNEL_ID` | server-config | - | placeholder | - | - | 1 |
| `SLACK_CWV_WEBHOOK_URL` | server-config | - | placeholder | - | - | 2 |
| `SLACK_GROUP_RFQ_WEBHOOK_URL` | server-config | - | placeholder | - | - | 1 |
| `SLACK_PAYMENTS_WEBHOOK_URL` | server-config | - | placeholder | - | - | 2 |
| `SLACK_SIGNING_SECRET` | secret-server | set(len 32) | placeholder | development, preview, production | encrypted | 1 |
| `SLACK_WEBHOOK_URL` | server-config | - | placeholder | - | - | 6 |
| `SLIDE_URLS` | server-config | - | - | - | - | 1 |
| `SMS_WEBHOOK_SECRET` | secret-server | - | placeholder | production | sensitive | 1 |
| `STRICT_AUDIT` | server-config | - | - | - | - | 1 |
| `STRICT_VALIDATION` | server-config | - | - | - | - | 2 |
| `SUPABASE_ANON_KEY` | secret-server | set(len 46) | placeholder | development, preview, production | encrypted | 3 |
| `SUPABASE_JWT_SECRET` | secret-server | - | placeholder | preview, production | sensitive | 8 |
| `SUPABASE_MANAGEMENT_TOKEN` | secret-server | - | - | - | - | 1 |
| `SUPABASE_SERVICE_KEY` | secret-server | - | - | - | - | 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | secret-server | set(len 219) | placeholder | development, preview, production | encrypted | 107 |
| `SUPABASE_URL` | server-config | set(len 40) | placeholder | development, preview, production | encrypted | 23 |
| `TEST_MODE` | server-config | - | - | - | - | 1 |
| `THREADS_ACCESS_TOKEN` | secret-server | - | placeholder | development, production | encrypted, sensitive | 3 |
| `THREADS_APP_ID` | server-config | set(len 15) | placeholder | development, preview, production | encrypted | 1 |
| `THREADS_APP_SECRET` | secret-server | set(len 32) | placeholder | development, preview, production | encrypted | 0 |
| `THREADS_USER_ID` | server-config | - | placeholder | production | sensitive | 2 |
| `TOSS_SECRET_KEY` | secret-server | - | - | - | - | 4 |
| `TURBO_CACHE` | server-config | - | set(len 9) | - | - | 0 |
| `TURBO_DOWNLOAD_LOCAL_ENABLED` | server-config | - | set(len 4) | - | - | 0 |
| `TURBO_REMOTE_ONLY` | server-config | - | set(len 4) | - | - | 0 |
| `TURBO_RUN_SUMMARY` | server-config | - | set(len 4) | - | - | 0 |
| `TWITTER_BEARER_TOKEN` | secret-server | - | - | - | - | 2 |
| `UNMATCHED_AUTO_RESOLVE_LIMIT` | server-config | - | - | - | - | 1 |
| `UNMATCHED_AUTO_RESOLVE_MIN_SCORE` | server-config | - | - | - | - | 1 |
| `UNMATCHED_AUTO_RESOLVE_WIKIDATA` | server-config | - | - | - | - | 1 |
| `UPDATE_BASELINE` | server-config | - | - | - | - | 1 |
| `UPLOAD_CATALOG_JUDGE` | server-config | - | - | - | - | 1 |
| `UPLOAD_CATALOG_LLM_SPLIT` | server-config | - | - | - | - | 2 |
| `UPLOAD_JUDGE_REPAIR` | server-config | - | - | - | - | 1 |
| `UPLOAD_JUDGE_SINGLE` | server-config | - | - | - | - | 1 |
| `UPLOAD_MAP_REDUCE` | server-config | - | - | - | - | 1 |
| `UPLOAD_PHASE1_CONCURRENCY` | server-config | - | - | - | - | 1 |
| `UPLOAD_ZOD_REPAIR` | server-config | - | - | - | - | 1 |
| `UPSTASH_REDIS_REST_TOKEN` | secret-server | - | - | - | - | 4 |
| `UPSTASH_REDIS_REST_URL` | server-config | - | - | - | - | 5 |
| `VAPID_PRIVATE_KEY` | secret-server | set(len 43) | placeholder | development, preview, production | encrypted | 1 |
| `VAPID_SUBJECT` | server-config | set(len 25) | set(len 25) | development, preview, production | encrypted | 1 |
| `VA_EMAILS` | server-config | - | - | - | - | 1 |
| `VA_EMAIL_FROM` | server-config | set(len 20) | set(len 20) | development, preview, production | encrypted | 1 |
| `VERCEL` | server-config | - | set(len 1) | - | - | 3 |
| `VERCEL_ENV` | server-config | - | set(len 10) | - | - | 0 |
| `VERCEL_OIDC_TOKEN` | secret-server | set(len 1214) | - | - | - | 0 |
| `VERCEL_OPS_PROJECT_SLUG` | server-config | - | - | - | - | 2 |
| `VERCEL_OPS_TEAM_SLUG` | server-config | - | - | - | - | 2 |
| `VERCEL_PROJECT_ID` | server-config | - | - | - | - | 1 |
| `VERCEL_TARGET_ENV` | server-config | - | set(len 10) | - | - | 0 |
| `VERCEL_URL` | server-config | - | placeholder | - | - | 7 |
| `VISUAL_TEST_URL` | server-config | - | - | - | - | 1 |
| `X_BEARER_TOKEN` | secret-server | - | - | - | - | 1 |
| `ZOD_STRICT` | server-config | - | - | - | - | 1 |