---
name: yeosonam-technical-seo
description: Audit Korean Yeosonam first-party blog delivery for canonical, robots, sitemap, Article/Breadcrumb/FAQ structured data, HTTP status, internal links, images, mobile rendering, hydration, Search Console lifecycle, PageSpeed/CrUX, and SEO drift. Use for draft previews, public URLs, weekly site audits, or indexing diagnostics; do not judge factual article claims.
---

# Yeosonam Technical SEO

Separate delivery facts from search-engine outcomes.

## Required checks

- Preview: authenticated, same public component, `noindex`, canonical, one visible H1, valid structured data, usable links/images, no hydration errors, and mobile/desktop score at least 95.
- Public: HTTP success, indexable robots, self-consistent canonical, sitemap inclusion, Article and Breadcrumb data, stable title/description/H1, links/images, no overflow or generated residue.
- Search lifecycle: `queued → submitted → received → discovered → crawled → indexed → ranking`. Sitemap or IndexNow acceptance is never evidence of indexing.
- Weekly observation: compare immutable metadata/render hashes, GSC observations, CrUX field data, PageSpeed lab data, keyword-family ownership, and content-decay signals.

Persist provider responses unchanged and append a versioned derived classification. Ordinary `/blog` pages never use Google Indexing API. D+3 permits one sitemap resubmission; D+7 routes unresolved cases to a finite technical/content correction queue.

## Boundaries

- Do not claim ranking or indexing guarantees.
- Do not auto-unpublish, redirect, merge, or rewrite content from an audit alone.
- Follow `docs/blog-autopublish-contract.md` and `docs/blog-ops-runbook.md`.
