# 2026-06-10 Search Indexability Diagnostics

## Trigger

Google Search Console and Naver Search Advisor showed historical indexability problems:

- Naver: indexed 25, crawl restrictions 7, excluded 46, SEO duplicate-title diagnostics 31.
- Google Search Console: `NOINDEX`, robots blocked, alternate canonical, soft 404, 4xx, redirects, and duplicate canonical signals across domain and URL-prefix properties.

## Root Cause Found In Code

Production sitemap submission was clean for `noindex`, robots blocked, and HTTP errors at the time of this audit, but it still had indexability quality issues:

- `npm run audit:site-indexability -- --base=https://www.yeosonam.com --strict`
- Result before this fix: `84/100`
- Issues: `canonical_mismatch_sitemap_url=19`, `duplicate_title=11`

The code-level causes were:

- `/packages?destination=...` filter URLs were present in sitemap while canonicalizing to `/packages`.
- `/rfq/*` private/action URLs could enter sitemap even though robots.txt blocks `/rfq/`.
- Blog destination hubs were generated from slug prefixes, creating non-destination hubs such as month/seasonal terms.
- Blog destination canonical URLs could be double-encoded.
- `/concierge` and `/group-inquiry` inherited root title/canonical because their pages are client components without route-level metadata.
- Repeated supplier package titles produced duplicate indexable `<title>` values for multiple package IDs.

## Fix

- Added `scripts/audit-site-indexability.mjs` and `npm run audit:site-indexability`.
- Removed RFQ and package filter URLs from sitemap.
- Built blog destination hubs from real `content_creatives.destination` values only.
- Fixed blog destination canonical encoding.
- Added route metadata for `/concierge` and `/group-inquiry`.
- Made package detail titles distinct by including product type, price, and a short product id suffix.
- Added the Search Indexability Gate to `docs/blog-system-runbook.md`.

## Release Gate

After deployment, run:

```bash
npm run audit:site-indexability -- --base=https://www.yeosonam.com --strict
```

Only after this passes should sitemap/reindex submission and GSC/Naver validation be started.
