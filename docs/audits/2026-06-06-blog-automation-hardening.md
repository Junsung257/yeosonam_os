# Blog Automation Hardening - 2026-06-06

## Summary

- Blog publisher now rejects stale or thin `expected_slug` values and regenerates SEO-safe slugs from the topic when possible.
- Product blog generation now normalizes unknown `angle_type` values to `value` before calling the content generator.
- Official reference links are handled by `src/lib/blog-official-links.ts` and are re-applied after image insertion. A final retry repair forces official links if the links gate still fails.
- Publisher now auto-repairs deterministic gate failures before giving up:
  - strengthens weak H1 introductions with a dated, numeric hook paragraph;
  - softens excessive primary-keyword repetition before the keyword-density gate;
  - retries links and hook gate checks after deterministic repair.
- AI-readable structure failures are retried after adding a definition paragraph, question-style H2, and FAQ block.
- Duplicate queue items are no longer spun into near-duplicate replacement posts. Duplicate gate failures are marked `skipped`.
- `autoHealQueue()` now skips canonical duplicate failures and only requeues repairable failures.
- Topic slugs now collapse repeated category terms such as `currency-currency-currency`.

## Production Queue Cleanup

- Requeued or repaired stale failed queue items caused by malformed slugs and old gate behavior.
- Archived one newly created duplicate blog post with slug `shimonosekifukuokabeppu`; canonical post already existed at `shimonoseki-fukuoka-beppu-preparation`.
- Repaired one repeated category slug from `bohol-currency-currency-currency` to `bohol-currency`.
- Converted duplicate failures to `skipped` instead of leaving them in `failed`.
- Converted no-context pillar failures to `skipped` with `needs_source_context` metadata.

## Verification

- `npx eslint src/app/api/cron/blog-publisher/route.ts src/lib/blog-official-links.ts src/lib/blog-official-links.test.ts src/lib/blog-content-orchestrator.ts`
- `npx vitest run src/lib/blog-official-links.test.ts src/lib/slug-utils.test.ts src/lib/blog-inline-images.test.ts src/lib/indexing.test.ts`
- `npm run type-check`
- Production queue audit after cleanup:
  - `failed`: 0
  - `generating`: 0
  - `queued`: 79
  - `published`: 76 queue records
  - `skipped`: 140
- A local publisher cron run completed with HTTP 200 and published `shijiazhuang-preparation`; later cleanup kept duplicate and stale locks out of `failed`.

## Remaining Non-Code Reality

- Google Search Console API and URL Inspection authenticate correctly, but recent `/blog/` Search Console performance rows are still empty. Rank history from GSC will remain sparse until Google produces impressions for those URLs.
- URL Inspection for `https://yeosonam.com/blog/bohol-weather` returned a valid response, but Google reported that the URL was not yet known.
