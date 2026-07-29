# Blog Full-Process 95 Audit

Date: 2026-07-29 KST

This is a point-in-time evidence record. Current rules remain in
`docs/blog-autopublish-contract.md` and `docs/blog-ops-runbook.md`.

## Scope

- Production publication count, daily five-slot execution, future queue, failures, and atomic upgrades
- Full public-render customer audit, technical SEO audit, category coverage, images, evidence, and claim validation
- Production deployment/runtime logs, public route probes, database query plan, and crawler fan-out
- Google people-first, generative-AI, image, Article structured-data, and Search Console guidance

## Verified Baseline

- Published public articles: 166
- 2026-07-29 new publications: exactly five, spaced across the 09:00, 12:00, 15:00, 18:00, and 21:00 KST cumulative slots
- New evidence-backed sample: 10/10 publish-ready; monthly-weather category floor 97
- Technical SEO audit: 166/166 passed, score 100/100, one authority-link warning
- Public-render customer audit: 94/166 passed at 95, average 86, 72 failed
- Public-render issue counts: mechanical structure 74, broken table surface 32, duplicate public section 29, answer mismatch 21, short body 13, unsupported internal claim 10
- Verified research/claim-validation coverage: 27/166; 139 legacy articles remain without the current research proof
- Safe automatic legacy-upgrade candidates after representative, intent, and destination-source checks: 0

Persisted SEO/readability fields therefore did not prove that the public body was
95-ready. The public-render result is the release truth.

## Root Causes

1. The common publish evaluator checked stored source quality but did not make the
   actual public-render customer inspector a mandatory 95 gate.
2. List, category, destination, API, and sitemap requests repeated full-corpus
   reads and exact counts. A crawler burst produced many cold cache keys at once.
3. Direct database execution was about 30 ms, while production logs repeatedly
   timed out the list read after 3.5 seconds. The dominant failure mode was
   concurrent request fan-out and response payload/count overhead, not a slow
   database plan.
4. Legacy bodies contain both presentation defects and factual defects. A sampled
   hotel-area article included a malformed `000원` row and unsupported current
   price, visa, transport, and lodging claims. Presentation cleanup alone cannot
   safely certify such a body.
5. Corpus recovery correctly rejects ambiguous/general topics, missing
   destinations, unsupported intents, duplicate representatives, and missing
   destination-scoped research. This prevents invented replacements but leaves a
   visible research backlog.

## Implemented Prevention

- Added one compact cached public catalog shared by blog list, destination, angle,
  public API, and sitemap consumers.
- Removed repeated collection exact-count queries and large `quality_gate` /
  `generation_meta` payloads from those collection reads.
- Added a mandatory `public_customer_quality` gate at 95 to the shared publish
  evaluator after rendering the candidate through the production renderer.
- Extended the live public audit to fetch every API page and report category
  minimum, average, pass rate, and issue counts.
- Kept factual legacy replacement fail-closed: the existing public row changes
  only after destination/intent research, claim validation, rendering, SEO,
  image, representative, and atomic publication gates all pass.

## Remaining Release Proof

- Deploy the prevention changes and verify the production catalog no longer emits
  clustered database-unavailable errors during sitemap and destination crawling.
- Run the full public audit against the new deployment. No corpus-wide 95 claim is
  allowed until 166/166 and every category minimum are at least 95.
- Expand reviewed destination/intent source coverage, then process bounded atomic
  upgrades. Ambiguous, high-risk, or unsupported legacy topics require manual
  editorial review or an explicit unpublish decision.

## Production Reverification And Feedback Loop

- The post-deploy audit initially reported 184 rows because sitemap Korean slugs
  were URL-encoded while API slugs were decoded. After identity normalization,
  the verified corpus returned to 166 unique rows; there was no hidden 18-row
  category.
- Bounded concurrency 6 plus two transient retries reduced the full static
  transport audit from an unbounded serial run to 84 seconds. The authoritative
  166-page browser audit completed in 114 seconds.
- Post-deploy investigation proved that two apparent title/TOC-only pages had
  5,421 and 5,634 stored body characters and rendered 3,470 and 3,539 visible
  body characters in Chrome. The static audit was reading the pre-materialized
  Next.js Flight response. Release and corpus classification now requires
  `--browser`; HTML mode remains a transport smoke check.
- Browser-verified category results at the 95 floor after table-signal precision
  and exact-block cleanup (108/166 passed, average score 90):
  - `itinerary`: 2/2, minimum 100
  - `preparation`: 32/36, minimum 71
  - `local_info`: 17/26, minimum 59
  - `pillar`: 3/8, minimum 76
  - `travel_tips`: 54/87, minimum 59
  - `visa_info`: 0/6, minimum 59
  - `card_news`: 0/1, minimum 83
- Browser-visible issue counts are: mechanical structure 88, broken tables 20,
  duplicate sections 33, unsupported internal claims 13, answer mismatch 9, and
  placeholder copy 2. Fourteen of the previous table findings came from parent
  container duplication, ordinary numeric prose, or horizontal rules rather
  than broken customer-visible tables. Browser mode found no genuinely
  body-empty article.
- A stored-body preflight of all 166 rows completed in 5.2 seconds, making it
  safe for the 55-second nightly recovery route. It is intentionally a fast
  prioritization signal, not a replacement for the browser release audit. After
  sharing the public sanitizer, title deduplication, and corrected table
  evidence, it matched the browser headline exactly: 108 passed, 58 failed,
  average 90.
- A forced production recovery proof completed the 166-row audit in 6.6
  seconds with no runtime errors and queued no unsafe upgrade. Rejections were
  high-risk review 9, representative conflict 17, missing destination 11,
  research coverage missing 42, ambiguous/general topic 48, and
  comparison/listicle review 10. The route had previously been skipped by
  resource-saver mode, so it is now included in the explicit critical blog cron
  allowlist while retaining the two-upgrade cap.
- The cache hardening remains valid defense in depth: the detail cache is
  versioned for full bodies, a genuinely unusable cached body fails to the
  explicit unavailable surface, and low editorial quality no longer triggers a
  DB refresh on every reader request. The two investigated pages were not cache
  failures; Chrome rendered their complete streamed bodies.
- Nightly recovery now records the rendered public score and issue codes and
  prioritizes the lowest public-quality failures before search and missing-
  research fallbacks. It still cannot rewrite a row without reviewed
  destination/intent evidence and every atomic publish gate.
- A follow-up representative audit found 18 published weather URLs that resolve
  to an active representative for the same destination and intent. Every target
  was fetched from production, was still published, and scored 100. Six of the
  source URLs were below 95; the other twelve were already 95-100 but still
  split crawl and performance signals. The prepared consolidation keeps the
  stored rows, sends each public source directly to the terminal representative,
  and removes sources from the catalog, API, sitemap, and recovery pool.
- The same audit exposed a producer mismatch: a specific-month title could wrap
  the deterministic 1-12 month article even though the representative identity
  is destination-wide. Future weather briefs now use a `월별` canonical title
  and primary keyword while preserving the requested month only as a secondary
  long-tail. The pre-deploy recalculation is 96/148 active canonical rows passed,
  52 failed, average 90; this is not yet a production release claim.

## External Evidence

- Google requires helpful, reliable, people-first content with original value,
  clear sourcing, and no easily verified factual errors:
  https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Google says generated content must prioritize accuracy, quality, relevance,
  metadata, structured data, and image alt text; scaled pages without added value
  may violate spam policy:
  https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- Image guidance:
  https://developers.google.com/search/docs/appearance/google-images
- Article structured data:
  https://developers.google.com/search/docs/appearance/structured-data/article
- Search performance interpretation:
  https://support.google.com/webmasters/answer/7576553
- Google treats a permanent server-side redirect as a strong canonical signal
  and recommends using it for deprecated duplicates:
  https://developers.google.com/search/docs/crawling-indexing/301-redirects
- Google recommends combining canonical signals by linking internally to the
  representative and listing only representative URLs in the sitemap:
  https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls
