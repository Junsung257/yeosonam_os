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
- Bounded concurrency 6 plus two transient retries reduced the full live audit
  from an unbounded serial run to 84 seconds.
- Verified category results at the 95 floor:
  - `itinerary`: 2/2, minimum 100
  - `preparation`: 30/36, minimum 71
  - `local_info`: 14/26, minimum 52
  - `pillar`: 3/8, minimum 52
  - `travel_tips`: 45/87, minimum 52
  - `visa_info`: 0/6, minimum 52
  - `card_news`: 0/1, minimum 83
- A same-renderer scan of all 166 stored bodies completed in 5.2 seconds, making
  it safe for the 55-second nightly recovery route. It found 70 stored-body
  failures; the live page audit found 72.
- The two-row gap exposed a separate availability defect: a stale detail cache
  could return HTTP 200 with only the table of contents after a fresh DB read
  failed. The detail cache is now versioned for full bodies, unusable cached
  bodies fail to the explicit unavailable surface, and low editorial quality no
  longer triggers a DB refresh on every reader request.
- Nightly recovery now records the rendered public score and issue codes and
  prioritizes the lowest public-quality failures before search and missing-
  research fallbacks. It still cannot rewrite a row without reviewed
  destination/intent evidence and every atomic publish gate.

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
