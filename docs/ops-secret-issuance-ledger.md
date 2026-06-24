# Ops Secret Issuance Ledger

Date: 2026-06-24 KST

This ledger records operational credential status without storing secret values.
Never commit token bodies, webhook URLs, OAuth client secrets, or service-role
keys here.

## Current Decision

Blog autopublishing readiness is separated from optional marketing/social
integrations.

- Blocking blog/runtime inputs: `SERPAPI_KEY`, `NAVER_CLIENT_ID`,
  `NAVER_CLIENT_SECRET`, `CRON_SECRET`
- Optional integrations tracked as warnings: `BAND_RSS_URL`,
  `TWITTER_BEARER_TOKEN`, `NAVER_CAFE_ID`, `GOOGLE_ADS_DEVELOPER_TOKEN`,
  `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_CLIENT_ID`,
  `GOOGLE_ADS_CLIENT_SECRET`, `SLACK_WEBHOOK_URL`

## Issuance Rules

| Key | Source of truth | Agent can register? | Agent can issue from current MCP/tools? | Notes |
|---|---|---:|---:|---|
| `SERPAPI_KEY` | SerpAPI account | Yes, if value is available | No | Provider account token is required. |
| `NAVER_CLIENT_ID` | Naver Developers | Yes, if value is available | No | Existing value is already present in GitHub configuration. |
| `NAVER_CLIENT_SECRET` | Naver Developers | Yes, if value is available | No | Existing value is already present in GitHub configuration. |
| `CRON_SECRET` | Internal generated secret | Yes | Yes | Existing value is already present in GitHub/Vercel configuration. |
| `BAND_RSS_URL` | Band/Naver Band feed settings | Yes, if URL is available | No | Public/private feed URL must come from the Band account. |
| `TWITTER_BEARER_TOKEN` | X Developer Portal | Yes, if value is available | No | Requires X developer app/project access. |
| `NAVER_CAFE_ID` | Naver Cafe admin/page URL | Yes, if value is available | No | The ID is account/content specific. |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API Center | Yes, if value is available | No | Requires Google Ads manager/admin access and approval state. |
| `GOOGLE_ADS_CUSTOMER_ID` | Google Ads account | Yes, if value is available | No | Account-specific ID. |
| `GOOGLE_ADS_CLIENT_ID` | Google Cloud Console OAuth app | Yes, if value is available | No | Requires Google Cloud project access. |
| `GOOGLE_ADS_CLIENT_SECRET` | Google Cloud Console OAuth app | Yes, if value is available | No | Secret value is shown only at creation/download time. |
| `SLACK_WEBHOOK_URL` | Slack app incoming webhook | Yes, if value is available | No | Requires Slack workspace/app admin flow. |

## Registration Targets

- GitHub Actions secrets: token, secret, key, and webhook values.
- GitHub Actions variables: non-secret IDs and URLs when they are safe to expose
  to workflow metadata.
- Vercel production/preview environment variables: runtime values needed by the
  deployed app.

## Operating Policy

1. Do not use dummy values to make readiness pass.
2. Do not store secret bodies in docs, issues, logs, or commits.
3. Missing optional marketing/social integrations should not block blog
   autopublishing release checks.
4. Full marketing automation readiness still requires the real provider-issued
   credentials above.
