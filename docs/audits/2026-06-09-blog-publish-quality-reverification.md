# Blog Publish Quality Reverification (2026-06-09)

## Scope

Rechecked whether blog publishing is complete for SEO, readability, tone, Markdown rendering, images, tables, and indexing safety after the previous blog repair.

## Finding

The main auto publisher and `/api/blog` publish transition were gated, but several other public-entry paths could still publish or replace a public blog without the same complete gate:

- Content queue approve
- Content hub publish and manually published actions
- Social distribution `blog_body` existing-post publish
- MRT hotel ranking immediate publish
- Backfill write script
- Zero-click regeneration body replacement

This was the remaining root cause class behind “audit says 100, but the visible blog can still break”: the audited path was not the only path that can make content public.

## Implemented Guard

Added `src/lib/blog-publish-quality.ts` as the shared publish contract:

- Runs `runQualityGates()` for render, image, structure, duplicate, link, CTA, hook, tone, and readability gates.
- Runs `computeSeoScore()` for title, meta description, headings, longtail coverage, image SEO, internal links, external authority links, structured data, helpful content, mobile safety, and slug checks.
- Runs `computeReadability()` and stores readability evidence.
- Blocks publishing when either quality or SEO fails.

## Code Paths Covered

- `src/app/api/blog/route.ts`
- `src/app/api/content-queue/route.ts`
- `src/app/api/content-hub/publish/route.ts`
- `src/lib/social-publishing/distribution-publisher.ts`
- `src/app/api/blog/mrt-hotel-ranking/route.ts`
- `scripts/backfill-blog-quality.ts`
- `src/app/api/cron/blog-regenerate-zero-click/route.ts`

## Verification

- `npm run type-check`: passed
- `npm run lint`: passed
- `npx vitest run src/lib/blog-structure-audit.test.ts src/lib/blog-renderer.test.ts`: 22 tests passed
- `git diff --check`: passed

## Remaining Production Step

After merge and deployment, run production audits again:

- `npm run audit:blog-render:browser -- --base=https://www.yeosonam.com --json`
- `npm run audit:blog-images -- --base=https://www.yeosonam.com --json`
- `npm run audit:blog-seo -- --base=https://www.yeosonam.com --json`
- `npm run audit:blog-visual -- --base=https://www.yeosonam.com --full --strict --json`
- `npm run audit:blog-gsc-domain -- --strict --json`

Only after those pass should bulk reindexing be triggered.
