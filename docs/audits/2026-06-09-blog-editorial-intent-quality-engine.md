# Blog Editorial Intent Quality Engine Audit

Date: 2026-06-09

## Why This Exists

Previous production checks reported 100/100 for render, image, SEO, visual, and GSC/domain alignment. That was technically true for those audit surfaces, but it missed editorial quality:

- Informational posts could contain product-sales wording.
- Weather posts could lack monthly weather/clothing/rain-risk blocks.
- Preparation posts could lack checklist shape.
- Articles could pass with weak tables/lists or paragraph walls.

This audit adds a separate editorial-quality axis so "SEO 100" no longer means "article 100" unless the body itself is useful and readable.

## External Research Basis

- Google Search Central: Helpful, reliable, people-first content must be useful to readers regardless of whether AI assisted the writing.
- Google Search spam policies: scaled content abuse is a risk when many pages are generated without enough value.
- Google SEO Starter Guide: clear headings, useful links, images/alt, structured data, and unique helpful content matter together.
- Google Ads Performance Max guidance: automation works best with high-quality assets and intent-aligned asset groups, not one generic creative.
- Modern content optimization tools such as Surfer/Clearscope/MarketMuse converge on a similar operating model: search intent, content brief, topic coverage, and quality scoring before publication.

Primary references:

- https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- https://developers.google.com/search/docs/essentials/spam-policies
- https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- https://support.google.com/google-ads/answer/10724817

## Code Changes

- Added `src/lib/blog-content-intent.ts`.
- Added `intent_quality` to `runQualityGates()`.
- Added intent-contract prompt injection through `buildBlogIntentPromptContract()`.
- Added `npm run audit:blog-editorial`.
- Changed automatic publishing quota to 3-4 posts/day with default 4 and a publisher-side daily cap.

## Production Sample Result

Command:

```bash
npm run audit:blog-editorial -- --base=https://www.yeosonam.com --limit=20
```

Result:

- Editorial quality: 72/100
- Passed: 5/20
- Failed: 15/20
- Issue counts:
  - `missing_required_block`: 13
  - `weak_list_or_table_shape`: 9
  - `forbidden_sales_tone`: 6
  - `paragraph_wall`: 6
  - `weak_reading_design`: 1

Worst examples:

- `bohol-preparation`: 34/100
- `6-nagasaki`: 46/100
- `nagasaki-best`: 46/100
- `bohol-weather`: 58/100
- `zhangjiajie-weather`: 64/100

Full production command:

```bash
npm run audit:blog-editorial -- --base=https://www.yeosonam.com
```

Full result:

- Editorial quality: 76/100
- Passed: 32/101
- Failed: 69/101
- Issue counts:
  - `paragraph_wall`: 50
  - `missing_required_block`: 47
  - `weak_list_or_table_shape`: 40
  - `forbidden_sales_tone`: 23
  - `weak_reading_design`: 1

Existing technical QA recheck:

- `npm run audit:blog-render -- --base=https://www.yeosonam.com`: 100/100, 101/101 passed
- `npm run audit:blog-images -- --base=https://www.yeosonam.com`: 100/100, 101/101 passed
- `npm run audit:blog-seo -- --base=https://www.yeosonam.com --limit=20`: 100/100, 20/20 passed, 7 warnings

## New 100-Point Definition

Blog quality is now the intersection of:

- render integrity
- image quality
- visual/browser quality
- SEO metadata and structured data
- canonical/GSC/domain consistency
- editorial intent quality

The old checks can still be 100 while editorial quality fails. A blog post is not 100 until all axes pass.

## Next Remediation

- Run full production editorial audit without `--limit`.
- Put failed posts into a regenerate/backfill queue after validating that the new gate blocks bad replacements.
- For every repeated failure, add a fixture test and update `docs/errors/blog.md`.

## Follow-Up Implementation — Intent Classifier and Auto-Repair

Date: 2026-06-09

The first implementation found the right audit surface, but the classifier still over-weighted incidental body terms. Example: a preparation or food article that mentioned rainy weather could be scored as a weather post. The fix changes intent selection from first-match body regex to weighted evidence:

- title and primary keyword: strongest signal
- category/content type/slug: strong signal
- body text: weak supporting signal

The repair layer is implemented in `src/lib/blog-editorial-repair.ts` and shared by:

- `GET /api/cron/blog-publisher`
- `scripts/backfill-blog-quality.ts`
- `scripts/audit-blog-editorial-quality.ts --repair-preview`

Safe deterministic repairs now cover:

- information articles with product-sales wording
- missing weather tables
- visa/currency/transport posts without official links
- preparation posts with fewer than five checklist items
- wall-of-text paragraphs
- insufficient reading-design aids

Validation:

```bash
npx vitest run src/lib/blog-content-intent.test.ts src/lib/blog-editorial-repair.test.ts src/lib/blog-publish-quality.test.ts
npm run audit:blog-editorial -- --base=https://www.yeosonam.com --repair-preview --json
npm run audit:blog-revenue-funnel -- --strict
npx tsc --noEmit --pretty false --skipLibCheck
```

Results:

- Production editorial sample without repair improved from 72/100 to 86/100 after classifier fixes.
- Production editorial sample with repair preview: 20/20 passed, average 100.
- Full production corpus with repair preview: 101/101 passed, average 100.
- Blog revenue funnel readiness remains 100/100.
- TypeScript validation passed.

Important distinction:

- `--repair-preview` proves the engine can repair historical posts safely.
- The live production pages keep old content until the backfill write path is run, deployed, revalidated, and reindexed.
