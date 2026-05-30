# Marketing Automation Guardrails

This note captures the controls that keep the Meta/GSC/IndexNow automation from drifting after deployment.

## Required Checks

- Run `npm run verify:marketing-env` before production marketing automation changes.
- Keep `GSC_SERVICE_ACCOUNT_JSON` and `GOOGLE_SERVICE_ACCOUNT_JSON` aligned unless a dedicated Search Console service account is intentionally introduced.
- Keep `META_PIXEL_ID` and `NEXT_PUBLIC_META_PIXEL_ID` aligned.
- Use `GSC_SITE_URL=https://yeosonam.com/` because the service account has owner permission on that URL-prefix property.

## GSC Retry Loop

`/api/cron/gsc-index-rank` now does three things in one scheduled run:

- records page-level GSC rank metrics,
- inspects recently published blog URLs that are missing from GSC data,
- automatically submits a capped number of not-yet-indexed URLs to Google Indexing API and IndexNow.

`GSC_INDEXING_RETRY_PER_RUN` controls the retry cap. Default is `10`; keep it at or below `25` unless daily Google quota usage is deliberately reviewed.

## Slug Guard

Manual blog create/update now rejects weak slugs before publish. This blocks malformed values such as generic topic-only slugs or slugs that lose the destination during normalization.
