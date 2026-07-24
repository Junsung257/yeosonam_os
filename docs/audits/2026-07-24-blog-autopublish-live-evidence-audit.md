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

## Merged Release Chain

Every pull request below passed the repository's required GitHub checks, was merged to `main`, and received a production deployment.

| Pull requests | Released capability |
|---|---|
| #888 | Direct-source research, trust registries, persisted evidence/claims, citations, public rendering, migrations, and controlled canary path |
| #889 | Cron authorization hardening and secret rotation |
| #890-#897 | Deterministic WMO weather facts, intent coverage, tables, FAQ/structured data, image preservation, readability, and semantic SEO |
| #898-#899 | Update the queue-linked draft in place and detach superseded claim links without deleting history |
| #900-#902 | Scope claims to the current creative, preserve the canonical intent/brief on republish, and preserve a verified body during metadata-only publication |

The final republish fix was deployed as Vercel production deployment `dpl_HpttC81RogvPmzYVAoJJDTf1jNDy` from merge commit `7ceae0431157eef97641f3d698c8cb0ec5a327c4`.

## Live Create, Publish, Update, And Reindex Proof

The controlled low-risk canary used queue row `cf0bdf81-fe91-432e-a815-6ea8092fc7a1` and existing creative `fe73a1cd-3033-452c-ac2e-7723c30e6d8b`. It published at the canonical URL:

- https://www.yeosonam.com/blog/guam-weather-packing
- Representative key: `v1|괌|monthly_weather|general|ko-KR`
- Current claims: 12/12 supported and linked to the current creative
- Quality gate: passed; informational engine, intent, topic-fit, editorial, structure, readability, and image sub-gates each scored 100
- SEO audit: 91/100 after the final metadata update, above the 85-point informational threshold
- Render contract: three source-backed images with alt text, two tables, 12 rendered headings, and no render or table-integrity artifact
- Public contract: HTTP 200, exact canonical URL, exact updated description, and sitemap membership

The first atomic publication created fingerprint `128ca2ed1fa782948f52e91aa2f0e753cb8b8db246e47c3b30667c4075748ed5` and indexing job `85b10689-67f8-4bc3-bbc6-02e4352c144d`. The job succeeded on its first attempt.

The same creative was then updated through the authenticated production `PATCH /api/blog` route with `status='published'`. The update returned HTTP 200 with no quality warnings and proved that update publication is a revision, not a duplicate:

- Creative ID and slug stayed unchanged.
- The improved 67-character description was persisted and rendered publicly.
- Body SHA-256 stayed `e6b34259cdb9fd73e3b7742147298f8c472238bf3a791b4f7fe45356d2539798`.
- Body length stayed 3,785 characters; three Markdown images and two Markdown table separators stayed unchanged.
- A second immutable publication record was created with fingerprint `6bb51f0430af7df93df27629d551b7e9cef3caeef0c49a765dba7c7cce7e9054`.
- A second indexing job, `fd1a54c8-f4db-482b-b23b-f196013ed1ee`, succeeded on its first attempt with Google and IndexNow both reporting success.

Three failed live republish attempts were retained as defect evidence rather than hidden:

1. Superseded claims from the same content key were mixed into the current revision, and incidental body words changed the inferred intent.
2. The manual route lost the saved content brief and applied a generic quality repair.
3. The generic repair removed a valid clothing table during a metadata-only update.

PRs #900-#902 fixed those defects by scoping claims to the current creative, carrying the canonical content brief through every republish path, resolving the primary keyword from that brief, and evaluating an already-published body without mutating it when only metadata changes.

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

1. Passed: all migrations and focused tests passed in clean branches.
2. Passed: preview and production checks covered type, route, public surface, mobile, image, citation, canonical, noindex, readiness, security, and performance.
3. Passed: one low-risk Guam weather queue row was explicitly flagged and published through `targetQueueId`.
4. Passed: queue, creative, sources, evidence, claims, active representative, publication, indexing, sitemap, and rendered public page were read back from live systems.
5. Passed: the same creative was updated through authenticated PATCH and produced a second fingerprint, publication record, and successful indexing job without creating a new canonical URL or changing the body.
6. Enforced: high-risk entry and insurance candidates remain private until current human approval.
7. Enforced: the 34 product candidates remain blocked until their linked products are customer-visible and their open-contract evidence passes.

## Decision

The direct-source pipeline and one complete create/publish/update/reindex cycle are released and live. Automatic informational publication is approved only for `monthly_weather` and `currency_payment`; `entry_requirements` remains evidence-ready but requires current human approval. The other seven intents remain blocked until reviewed direct sources or structured operator feeds satisfy their category contracts.

The 148 legacy published rows remain outside the strict public eligibility view because none has a current research bundle. Twenty-one legacy rows also mislabel Pexels assets as official sources. Do not bulk repair prose, fabricate research, or lower thresholds to restore volume. Remediate legacy rows as separate researched revisions, and onboard missing category sources one intent at a time.
