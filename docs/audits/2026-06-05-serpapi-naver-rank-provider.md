# SERP Rank Provider Setup - 2026-06-05

## Summary

- `SERPAPI_KEY` was connected from the SerpApi dashboard and added to local env files.
- Vercel currently lists `SERPAPI_KEY` for Development and Production.
- `NAVER_CLIENT_ID` and `NAVER_CLIENT_SECRET` were added to local env and Vercel Development/Production.
- Naver Developers app `d7lEJdugIGHV2EDSABJF` now has both `DATALAB` and `SEARCH` scopes enabled.
- Live checks passed for Naver Search API and Naver DataLab API.
- `/api/cron/serp-rank-snapshot` ran successfully with `provider=naver_api`, inserted 5 recent rank rows, and consumed 0 SerpAPI searches.
- Preview env needs an explicit non-production Git branch in this Vercel project before the same key can be added there. Vercel rejects the Production Branch (`main`) for Preview env vars.
- The rank snapshot cron now defaults to the free Naver Search API provider and only spends SerpAPI quota when explicitly enabled.

## Provider Rules

| Variable | Purpose | Default |
|---|---|---|
| `NAVER_CLIENT_ID` | Free-first Naver Search API client id for `/api/cron/serp-rank-snapshot`. | Required for free rank tracking |
| `NAVER_CLIENT_SECRET` | Free-first Naver Search API client secret. | Required for free rank tracking |
| `SERPAPI_KEY` | Paid SerpAPI fallback/provider key. Keep encrypted in Vercel. | Optional |
| `SERP_RANK_PROVIDER` | Set to `serpapi` only when intentionally spending SerpAPI quota. | `naver_api` |
| `SERP_RANK_FALLBACK_SERPAPI` | Set to `true` only when Naver API failure should spend SerpAPI quota. | `false` |

## Verification

- SerpAPI account remains on Free Plan: 250 searches/month, 250 searches left, 0 used this month after the cron test.
- `public.serp_rank_snapshots` exists in Supabase and stores nullable `position`, so "not found in the sampled result set" can be recorded without failing inserts.
