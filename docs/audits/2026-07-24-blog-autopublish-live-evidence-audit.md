# Blog Autopublish Live Evidence Audit

Date: 2026-07-24 KST

This is a one-time evidence record. Current rules live in `docs/blog-autopublish-contract.md` and operating steps live in `docs/blog-ops-runbook.md`.

## Scope

- Queue creation and candidate selection
- Informational and product content boundaries
- Research, source trust, evidence, claims, writing, repair, quality, images, SEO, publication, canonical ownership, indexing, and update publication
- Ten informational intents: food budget, monthly weather, airport transport, hotel areas, family budget, itinerary, shopping/souvenirs, currency/payment, entry requirements, and travel insurance
- Live Supabase data, production public surfaces, and official external documentation

## Live Baseline

- `content_creatives` for `naver_blog`: 217 total, 148 published, 24 draft, 45 archived.
- Published informational rows with a current `information_research_bundle`: 0/148.
- Public security-invoker view rows: 0. The public list, destination/angle collections, sitemap collections, SEO audit, image audit, and customer-quality audit therefore have no publishable target.
- Legacy editorial audit reports 148/148 at 100, but it does not prove current research, representative, claim, publication, or public-surface eligibility. The public customer-quality audit correctly reports 0/100.
- Evidence store: sources 1, source versions 21, evidence 147, claims 48.
- Trust registries: 12 active official hosts, 16 active intent-scoped official documents, and 6 active reviewed reputable hosts.
- Canonical/publication state before the canary: representatives 1, active representatives 0, informational publications 0, review cases 0.
- Queue diagnosis: current and closed KST day 0/4, 51 failed, 10 queued, 1 generating, 17 editorial-backlog rows, publish preflight 67/100 blocked. Product evidence recheck scanned 34 and kept all 34 blocked because every linked product was still `pending_review`.

## Root Cause

The old score could pass generic prose, generic government links, and three destination-labelled Pexels images without proving that the page content came from those sources. Twenty-one published rows labelled Pexels image URLs as `official_source`. Images and external links were being counted as evidence even though neither demonstrated a factual statement.

The replacement contract separates:

1. URL discovery through Google Search.
2. Exact trust approval by intent, hostname, and source type.
3. Direct bounded download of the approved HTML, text, JSON, XML, or PDF document.
4. Structured claims built only from downloaded extracts.
5. Stable source, version, evidence, claim, and evidence-link persistence.
6. Claim-count, freshness, source-diversity, scope, and human-review gates before writing.

Search snippets, model-generated research summaries, personal blogs, unregistered booking sites, redirects to unapproved hosts, private network URLs, credentialed URLs, oversized responses, and inaccessible pages do not become evidence.

## Ten-Intent Live Verification

| Intent | Result | Live evidence |
|---|---|---|
| Monthly weather | Automatic pass | WMO machine-readable Guam feed; 1 source, 12 climate claims, 100% claim coverage |
| Currency/payment | Automatic pass | USA.gov and Guam Visitors Bureau; USD plus card/denomination facts |
| Entry requirements | Evidence pass, human review required | eCFR API, CBP G-CNMI eTA PDF, Guam CQA; 3 sources, 8 claims, Republic of Korea/45 days/eTA supported |
| Airport transport | Block | Official airport and Kakao T pages supplied booking/operation facts but 0/2 required prices and 0/2 required journey durations; GRTA returned HTTP 403 |
| Hotel areas | Block | Booking.com supplied current area and price rows; other reviewed sources returned HTTP 429 or client-rendered short content; only 1/2 required source domains |
| Family budget | Block | Only HotelsCombined was directly usable; 0/4 supported price claims and 1/2 source domains |
| Itinerary | Block | Two official Guam tourism pages supplied prices and durations, but both share one domain; required diversity 1/2. A Unicode span-order defect found during the first run was fixed and retested |
| Shopping/souvenirs | Block | Official tourism/customs facts passed, but only 1/3 required shopping price claims |
| Food budget | Block | No intent-approved directly usable price source was found; no grounded evidence |
| Travel insurance | Block | No intent-approved insurer/regulator evidence was found; human review would still be mandatory |

The final expected outcome is 3/10 evidence-ready, with only 2/10 eligible for automatic publication. This is a safety result, not a quality target to weaken. Missing market data must be solved by reviewed source onboarding or structured operator feeds.

## Code And Data Changes

- Added reviewed official hosts and exact intent-scoped document URLs for Guam airport, transport, weather, tourism, immigration, customs, currency, and eCFR.
- Added a separate reviewed reputable-source registry for price and booking sources.
- Added direct fetch protections: HTTPS only, no credentials or private/local hosts, manual redirect validation, maximum three redirects, 8-second page timeout, 1.5 MB byte cap, 24,000-character extract cap, and content-type handling.
- Changed Gemini Google Search use to URL discovery only. The structuring call receives reviewed direct extracts, not search snippets.
- Added source-domain diversity minimums and intent-specific claim minimums.
- Fixed evidence span calculation so Unicode NFKC normalization occurs before snapshot offsets are stored.
- Added a protected `targetQueueId` publisher path that accepts only an informational queued row explicitly marked `controlled_publish_canary=true` and touches no unrelated queue item.
- Added research-backed citations with retrieval dates and improved article typography, contrast, heading rhythm, tables, captions, and legacy highlight rendering.

## External Standard Verification

- Google people-first content: original value, clear sourcing, demonstrated expertise, and content created primarily for people. Mass automation or broad topic production for search traffic is a warning sign.
- Google generative AI guidance: generated content is acceptable only when it adds value and complies with spam policies; scaled low-value generation is not.
- Google image SEO: use relevant high-quality images near relevant text, descriptive alt text, accessible image URLs, and consistent metadata.
- Naver SEO: unique title and description, a single clear H1, meaningful alt attributes, crawlable robots/sitemap, canonical consistency, and no assumption that a crawl request guarantees immediate reflection.

Primary references:

- https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- https://developers.google.com/search/docs/appearance/google-images
- https://developers.google.com/search/docs/fundamentals/ai-optimization-guide
- https://searchadvisor.naver.com/guide/seo-help
- https://searchadvisor.naver.com/guide/seo-basic-robots
- https://searchadvisor.naver.com/guide/request-crawl
- https://searchadvisor.naver.com/guide/faq-serpedit

## Release Gates

1. All migrations and focused tests pass in a clean branch.
2. Preview deployment passes type, route, public-surface, mobile, image, citation, canonical, and noindex checks.
3. One low-risk Guam weather queue row is explicitly flagged and published through `targetQueueId`.
4. Read back the queue, creative, sources, evidence, claims, active representative, publication record, indexing job, public API, sitemap, and rendered public page.
5. Update the same creative through authenticated PATCH with `status='published'`, then prove a second content fingerprint/publication and indexing job with no new canonical URL.
6. High-risk entry and insurance candidates remain private until current human approval.
7. Do not requeue the 34 product candidates until their product publication state is customer-visible and their open-contract evidence passes.

## Decision

Legacy published rows must remain excluded from the public view. Do not bulk repair prose, fabricate missing research, or lower category thresholds to restore volume. Release the new direct-source pipeline, prove one complete publish/update cycle, then onboard additional reviewed data sources category by category.
