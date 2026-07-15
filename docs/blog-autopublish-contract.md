# Blog Autopublish Contract

Last updated: 2026-07-15

This document defines the required contract for automatic blog generation, publishing, and indexing. It exists because one-off repairs to already published rows do not prevent the same defect from recurring in live autopublishing.

## Evidence Base

Official and implementation references:

- Google sitemap guidance: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Google sitemap ping deprecation: https://developers.google.com/search/blog/2023/06/sitemaps-lastmod-ping
- Google URL Inspection API: https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- Google Search Console API limits: https://developers.google.com/webmaster-tools/limits
- IndexNow protocol documentation: https://www.indexnow.org/documentation
- Vercel Cron duration guidance: https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Server-side sitemap implementation reference: https://github.com/iamvishnusankar/next-sitemap
- IndexNow batch/retry/cache implementation reference: https://github.com/viv1/indexnow-submitter
- Free search-intent fallback: Google Suggest autocomplete via `suggestqueries.google.com` is allowed as keyword/intent guidance when paid or keyed SERP providers are unavailable. It must not be represented as ranking proof.

Local code references:

- Live publisher: `src/app/api/cron/blog-publisher/route.ts`
- Topic fit gate: `src/lib/blog-topic-fit-gate.ts`
- Content brief gate: `src/lib/blog-content-brief.ts`
- Information intent/required-slot contract: `src/lib/blog-information-contract.ts`
- Information planner: `src/lib/blog-information-planner.ts`
- Human review workflow: `src/lib/content-review-workflow.ts`
- SERP/free intent analyzer: `src/lib/serp-analyzer.ts`
- Shared publish evaluator: `src/lib/blog-publish-quality.ts`
- Customer-facing quality evaluator: `src/lib/blog-customer-quality.ts`
- Final customer-surface repair: `src/lib/blog-final-customer-surface.ts`
- Final rendered SEO gate: `src/lib/blog-rendered-seo-quality.ts`
- Public render normalizer: `src/lib/blog-public-render-normalizer.ts`
- Reading-time SSOT: `src/lib/blog-reading-time.ts`
- Named fixture evaluator: `src/lib/blog-informational-engine-v2-eval.ts` (`npm run eval:blog-info-v2`)
- Existing-post dry-run auditor: `src/lib/blog-informational-existing-audit.ts` (`npm run audit:blog-info-v2`)
- Owner handoff: `docs/blog-informational-engine-v2-owner-runbook.md`
- Editorial/structure repair: `src/lib/blog-editorial-repair.ts`
- SEO scorer: `src/lib/blog-seo-scorer.ts`
- Indexing client: `src/lib/indexing.ts`
- Blog canonical URL helper: `src/lib/blog-canonical-url.ts`
- Backfill/audit tool: `scripts/backfill-blog-quality.ts`
- Manual indexing worker runner: `scripts/run-blog-indexing-worker.ts`
- Publish preflight evaluator: `src/lib/blog-publish-preflight.ts`
- Canary candidate preflight evaluator: `src/lib/blog-canary-preflight.ts`
- Generated canary quality evaluator: `src/lib/blog-canary-generated-quality.ts`
- Fleet phrase-drift evaluator: `src/lib/blog-fleet-phrase-drift.ts`
- Product dry-run generated canary builder: `src/lib/blog-product-generated-canary.ts`
- Current-day publisher health evaluator: `src/lib/blog-current-day-publisher-health.ts`
- Slug redirect map: `src/lib/blog-slug-redirects.ts`
- Slug migration dry-run/write tool: `scripts/migrate-blog-slugs.ts`

## Required Publish State Machine

Every automatic blog must follow this state machine:

1. `queued`
2. `generating`
3. `generated_draft`
4. `prepared_for_publish`
5. `quality_checked`
6. low-risk: `published` or `gate_failed`; human-review-required information: private `draft` + queue `pending_review`
7. `indexing_queued`
8. `indexing_submitted`
9. `visibility_observed`

No path may write `status='published'` unless it has current evidence for:

- `quality_gate`
- `generation_meta.content_brief`
- `seo_score`
- `readability_score`
- `readability_issues`
- final `slug`
- final `seo_title`
- final `seo_description`
- final `blog_html`

## Required Pre-Publish Pipeline

Before the first publish gate:

1. Run `evaluateBlogTopicFit()` before inserting any automatic topic into `blog_topic_queue`.
2. Build `generation_meta.content_brief` with `buildBlogContentBrief()` before LLM writing. The information planner must resolve `intent`, `destinationId`, `audience`, `locale`, `primaryQuestion`, `requiredSections`, `requiredFacts`, `plannedTables`, `faqQuestions`, `riskLevel`, and `missingInputs` before the writer is called. Any non-empty `missingInputs` list blocks generation.
3. For information posts, build the explicit intent contract (`food_budget`, `monthly_weather`, `airport_transport`, `hotel_areas`, `family_budget`, `family_itinerary`, `entry_requirements`, `travel_insurance`, `currency_payment`, or `general`). Persist the planner-selected intent and reuse it at the final required-slot gate so title repair cannot silently change the contract.
4. Treat raw queue topics as seeds only. The brief is the source of truth for final title, primary keyword, secondary keywords, search intent, required sections, forbidden angles, source policy, and human-review policy.
5. Run `analyzeSerp()` for eligible keywords. If Naver keys are missing or no results are returned, use the free Google Suggest fallback only as keyword/search-intent guidance.
6. Build the LLM prompt from the same visual/content contract used by gates: no `==...==`, no `<mark>`, no highlight-style emphasis, and tables must be valid GitHub Flavored Markdown with a separator row and no blank lines inside table rows.
7. Normalize or reject the slug.
8. Ensure internal CTA links.
9. Ensure official reference links.
10. Insert or verify inline images.
11. Run `repairBlogEditorialQuality()`.
12. Run `repairBlogStructureQuality()`.
13. Run `runQualityGates()`, including `topic_fit`, `editorial_quality`, `accent_density`, `table_integrity`, and `cta_destination_integrity`.
14. Run `inspectBlogCustomerQuality()` through `evaluateBlogPublishQuality()` so customer-visible writing defects are scored with the same publish decision as render/SEO gates.
15. Run `computeSeoScore()`.
16. Run `computeReadability()` on the final post-gate body.
17. Render information Markdown through the public renderer and sanitizer. Block publication unless the final surface has exactly one page H1, aligned title/H1/description intent, no raw Markdown or literal `\n`, valid non-empty headings and tables, no placeholder, self-consistent canonical/index state, valid JSON-LD, answer-first CTA placement, and no duplicate CTA.
18. Persist `quality_gate.rendered_reading_time_minutes` from that final rendered body. Public list and detail views must read the same persisted value; legacy rows may use the existing fallback calculation.

Entry/visa/immigration and travel-insurance information always require human review. Even after automated gates pass, the publisher must store these candidates as `content_creatives.status='draft'`, set `review_status='pending_review'`, enqueue a high-risk review with no timed auto-approval, and set `blog_topic_queue.status='pending_review'`. This branch must return before public cache revalidation, advertising mapping, publish logging, sitemap/indexing enqueue, or any public count increment. Human approval only unlocks a later explicit publish action; that action must rerun current publish QA.

If a repair mutates body content after any gate failure, `repairBlogStructureQuality()` must run again before the next gate check.

`engine_v2` must expose category scores, not just a single average. Required categories are search/reader task completion, customer language, AI-template naturalness, evidence/faithfulness, sales-pressure control, and for product-backed posts product decision helpfulness. A post is not a true 100-point candidate unless every category passes. Weak category scores must feed `repairBlogEngineCategoryGaps()` before publish: information posts get answer-first/source support repairs, product posts get missing decision blocks from product evidence, and naturalness/customer-language/sales-pressure issues go through the editorial repair path before the next gate check. Category repair must re-evaluate and retry up to three rounds or until every category reaches 100, and write repair round evidence when it mutates the post. If `official_sources_required=true`, information posts need an external source link; SERP intent or internal notes alone are not enough.

The live publish gate must use the same 100-point category definition. Do not allow near-pass exceptions for `ai_naturalness` or `sales_pressure`: if any `engine_v2.category_scores` item is below 100 after repair rounds, the candidate remains a repair/fallback candidate and must not be written as `published`.

`evaluateBlogEngineV2()` itself must use the same 100-point contract as the publish gate. A score in the 80-99 range is repairable evidence, not a pass. `engine_v2` failures caused by reader-task incompleteness, customer-language defects, AI-template naturalness, sales-pressure control, or product decision helpfulness are self-heal eligible because the current category repair loop can mutate and re-evaluate them. Evidence insufficiency, product open-contract failure, topic-fit failure, and candidate pre-publish contract failure remain non-self-heal blockers.

Daily quota recovery must distinguish repairable post defects from unsafe seeds. Deterministic quality failures such as `length`, `links`, `keyword_density`, `structure_integrity`, `table_integrity`, `render_integrity`, `intent_quality`, `seo_score`, and `engine_v2` are self-heal candidates after the shared repair path is deployed. They should be retried without an artificial two-hour delay and, after the normal attempt limit, routed to the editorial recovery backlog instead of hidden terminal failure. Unsafe seeds still do not self-heal: duplicate content, missing context, insufficient evidence, product open-contract failure, topic-fit failure, candidate pre-publish contract failure, and invalid linked drafts must be skipped, quarantined, or repaired at the source before requeueing.

Product-open blockers must not reduce the daily publish target. If product-backed rows are blocked by `pending_review`, customer-open contract failure, stale mobile proof, or missing product evidence, the scheduler/publisher must exclude them from `publishable_candidate_count` and refill or claim information candidates instead. Commercial posts may wait for source repair; the day still needs enough safe information candidates to meet the target without inventing product facts.

Deterministic information fallback is an operational recovery artifact, not publishable content. It may be used to diagnose missing slots or prepare a private repair draft, but it must never be written as `published`, revalidated as public, added to sitemap, or enqueued for indexing. A quota miss is preferable to publishing a generic fallback that does not satisfy the promised intent.

Extra recovery claims must use the shared time-budget plan in `src/lib/blog-publisher-time-budget.ts`. When normal generation time remains, the publisher may claim the mixed publishable pool. When there is not enough time to complete research, generation, repair, and all gates, it must stop claiming publish candidates or keep the result private for later repair. Time pressure must not downgrade the information-content contract.

Information-writer prompts must not receive internal product inventory, active-product counts, booking counts, consultation signals, or internal price ranges. These operational values are neither research evidence nor customer-facing content. Product-backed writing remains governed by the separate product evidence contract and is outside this information-content rule.

## Informational Source, Evidence, And Claim Contract

Informational research uses the dedicated `blog_information_*` namespace. It must never write into or reinterpret product registration evidence, product snapshots, package parsers, or package publication tables.

- `blog_information_sources` stores the source type, HTTPS URL or internal identifier, publisher, retrieval time, validity window, destination/country, supported claim types, risk, and optional paired reviewer/review time.
- `blog_information_evidence` stores the captured source locator or excerpt for one information candidate. `content_key` allows research to exist before a `content_creatives` row is created; `creative_id` is attached when a draft exists.
- `blog_information_claims` stores normalized customer-visible claims and their validation state.
- `blog_information_claim_evidence` links each claim to supporting, contradicting, or contextual evidence.

The four tables are server-only: RLS is enabled, browser roles have no grants, and only the service role policy may access them. Application inputs must pass `validateBlogInformationResearchBundle()` before `persistBlogInformationResearch()` writes anything. Source and evidence keys make retries idempotent.

Migration order is additive: apply `20260715082549_blog_information_evidence_model.sql` before enabling the claim validator. Existing blog rows require no backfill and remain readable. Before production data exists, rollback may drop the four new tables in reverse dependency order. After any data exists, do not drop them; use a forward-only follow-up migration that disables the validator while preserving the audit trail. This goal creates and statically validates the migration only and does not apply it to the operating database.

`extractBlogInformationClaims()` distinguishes ordinary travel narration from publish-verifiable claims. It extracts currency/price, movement time, percentages, climate values, customs/duty-free limits, entry/visa rules, insurance coverage/exclusions, policy statements, and measurable superlatives. Every extracted fingerprint must have a persisted claim row in `supported` or `approved` state and at least one current, same-type evidence link. Explicit `valid_until` is authoritative; otherwise the claim-type freshness window applies to the source retrieval time.

Customs, entry/visa, insurance, and policy claims require both an official source authority and `review_status='approved'`. Missing evidence, unsupported status, expired/revoked evidence, non-official high-risk sources, or missing human approval keeps the article private in draft/review. The same `evaluateBlogInformationClaimPublishGate()` runs for automatic publishing, direct blog POST/PATCH, content-hub publication, content-queue approval, force reindexing, and zero-click body replacement. Product-backed content exits this information-only gate unchanged.

## Informational Representative And Canonical Contract

Every new information article has one stable representative key: `destination_id + intent + audience + locale`. Title year, slug year, campaign wording, and publication date are deliberately absent from the key. `blog_information_representatives` owns the unique reservation and canonical creative/slug for that key.

Automatic publishing reserves the key before creating a `content_creatives` row. An existing active representative returns `UPDATE_EXISTING`; a reservation owned by another candidate returns `WAIT_FOR_EXISTING`; neither path creates another public URL. A private review draft keeps its reservation and attaches the draft creative ID. The registry becomes `active` only when the corresponding creative passes every gate and is explicitly published. Direct POST uses a private insert then activates the representative before changing the row to `published`; manual approval routes enforce the same registry.

New information rows persist `generation_meta.information_representative`. Sitemap inclusion requires that metadata to be `active` and its `canonical_slug` to equal the stored slug. Legacy rows without representative metadata and product-backed rows remain compatible. Existing duplicates are never redirected, merged, deleted, or rewritten automatically; `buildBlogInformationDuplicateDryRun()` only proposes the earliest published member as canonical and labels the others `MERGE_REVIEW` for M11 operator review.

If the publisher claims queue rows but exits for time budget before attempting all of them, every unattempted row must be released back to `queued` with an immediate `target_publish_at`. A claimed-but-unattempted row must not remain stuck in `generating`, because that silently removes publishable inventory from the next recovery run and can cause the daily target to miss again.

The final customer-surface pass must run after all structure, CTA, FAQ, and readability repairs. Both the live publisher and the backfill/audit tool must call the same `repairBlogFinalCustomerSurface()` implementation so a defect fixed in recent published rows cannot recur in new automatic posts. The same applies to `repairBlogEngineCategoryGaps()`: live publishing, shared publish preparation, and recent-post backfill/audit must use the category repair path so 100-point category weaknesses are fixed consistently before final evaluation. It must keep the H1 lead to one answer-first paragraph, split only true mobile paragraph walls, remove generated residue, deduplicate hashtags, repair broken Markdown URL fragments, convert destination placeholders such as `현지 날씨` to the concrete destination, and treat whitespace-only storage differences as audit-equivalent so fixed posts do not keep reappearing as changed.

Public customer-quality audit must evaluate the customer article body, not table-of-contents or related-post UI. Numbered itinerary headings such as `1일 차`, `2일 차`, and `3일 차` are distinct headings and must not be normalized into one duplicate signature. True repeated headings remain a major issue; slightly high heading counts are a warning unless they are clearly excessive or duplicate.

The daily publisher schedule must include a final same-day catch-up slot before the daily summary close window. With the current 22:45 KST summary, the required publisher slots are 12:05, 15:05, 18:05, 21:05, and 22:05 KST. The 22:05 run is a quota recovery run: it no-ops when the day has already reached target, and it must attempt safe publishable information candidates when quota remains. The external 22:07 publisher retry, pre-summary publisher catch-up, 22:27 indexing-worker backup, final 22:40 indexing drain, and pre-summary indexing drain must finish before the daily summary closes, so late recovery posts and indexing outbox evidence are counted in the same operating day.

## Publish Preflight Contract

Before expanding or manually forcing automatic publishing, the operator-facing preflight must pass:

- enough actually publishable candidates for the remaining daily slots;
- no evidence-insufficient or product-open-contract candidates blocking the ready pool;
- no actionable failed queue rows or stale `generating` rows;
- recent indexing outbox coverage at 100%;
- at least three recent published samples passing quality gate, content brief, SEO, and readability evidence.

The preflight may pass when overdue queued rows exist if the publishable candidate buffer is sufficient and publisher preflight can reschedule them. It must block when the issue changes publish safety, not when the row is harmless queue history.

## Current-Day Publisher Health Contract

Before the daily close window, reports may intentionally evaluate the previous KST day. That must not hide a current-day publisher failure.

- If the latest `blog-publisher` run is inside the current KST day and ran with remaining quota but published `0`, diagnostics must expose `current_day_publisher_failure`.
- The admin health summary must mark this as an active operating issue even when the closed-day SLA was already met.
- A quota-reached no-op with `remaining=0` remains healthy.

## Canary Candidate Contract

Before widening automatic publishing after engine changes, `diagnose:blog-autopublish` and admin health must be able to identify at least three low-risk queued candidates without claiming or publishing them.

- The preferred canary set includes both `info_writer` and `product_consultant_writer`.
- `info_writer` canaries require a concrete destination unless the candidate is explicitly marked `intentionally_generic`.
- Product canaries require a durable product dedup key using product, departure date, duration, and supplier evidence.
- Broad pillar rows, evidence-insufficient rows, duplicate rows, and topic-fit failures must be rejected before they consume publisher claim slots.
- Candidate topics that already violate the pre-publish title/slug contract must also be rejected before they consume publisher claim slots. Current blockers include banned editorial cliches such as `총정리` and `완벽 가이드`, machine separators such as `|`, month/year-leading topics that generate numeric slugs, weak expected slugs, and destinationless broad recommendation topics without a concrete comparison brief.
- Queue/admin operational health must use the same candidate pre-publish contract. A blocked queued row must be counted as `candidate_pre_publish_contract` / `quarantine_candidate_contract`, not as `publish_ready` or merely overdue inventory. Broad `pillar` rows are separate planning inventory and must be counted as `pillar_deferred`, not as candidate-contract failures.
- Editorial cliche blockers are `총정리`, `완벽 가이드`, `완벽 정리`, and similar title templates. If older mojibake text appears in historical evidence, interpret it as one of these Korean cliche blockers and do not use it as a literal prompt phrase.
- Candidate pre-publish contract failures are unsafe seeds, not manual rewrite backlog. Cleanup and publisher preflight should move them to `skipped` with durable `candidate_pre_publish_contract` metadata so they stop inflating failed/manual-review queue counts.
- Each selected canary must expose `quality_contract='customer_surface_100'` and writer-specific expectations. `info_writer` must prove answer-first Korean intent, official source support when changeable, valid table/checklist rendering, bottom-only soft CTA, and no AI-cliche opening. `product_consultant_writer` must prove product DB-only claims, price/departure/duration opening, included/excluded blocks, fit/not-fit blocks, risk notes, consult questions, no hard booking pressure, and clean rendered tables.
- Candidate canary is not enough after writer or repair changes. At least one generated canary sample must also pass `evaluateBlogGeneratedQualityCanary()`, which combines `evaluateBlogEngineV2()`, `inspectBlogCustomerQuality()`, and `inspectRenderedBlogIntegrity()`. A generated sample is pass only when all three are clean and the combined score is exactly 100.
- Generated canary proof must cover both writer paths. If recent published rows do not include a product-backed post, diagnostics and admin health must build a non-publishing dry-run sample from `blog_topic_queue.product_id` + the registered `travel_packages` row and run the same engine/customer/render checks. This prevents the system from claiming overall blog quality when only information posts have been proven.
- Generated canary volume should track the daily target, capped at five samples per run. For the current 4/day policy, diagnostics and admin health must request four generated samples rather than stopping at the old three-sample minimum.
- Product writer templates use `product-template-v4`. Customer-facing copy must be natural Korean, not prompt residue or encoded text. The product dry-run canary is expected to include price/from-city/duration opening, included/excluded, fit/not-fit, price-change risk, consult questions, official links, and bottom consultation links without inventing facts outside the product DB.
- Generated canary quality must include fleet phrase-drift checks across the selected recent/dry-run samples. Individual posts can pass engine/customer/render checks and still warn or block if the fleet repeats the same opening signature, H2 order, CTA sentence, or generic "first check budget/movement/local condition" formula. Repeated generic opening formulas are a block because they make the whole blog read like automated SEO copy.

## Blocking Rules

The post must not be published when any of these are true:

- The quality gate fails after repair rounds.
- `customer_quality` fails because the post still has AI-like generic openings, weak answer-first paragraphs, duplicated product price suffixes such as `원부터부터`, repeated consultation placeholders, placeholder destination copy, unsupported internal data claims, early hard CTA in information posts, or table render risk.
- `generation_meta.content_brief` is missing, failed, or contradicts the raw topic/search intent.
- The information intent contract has an invalid destination entity, a missing required slot, or customer-visible internal operational data.
- `generation_meta.content_brief.requires_human_review=true` and the item has not completed human review and a fresh explicit publish action.
- SERP/free-intent evidence is presented as ranking proof when it came from autocomplete fallback.
- `topic_fit` fails because the topic is a machine slug, placeholder, weak travel intent, or bad destination/intent combination.
- `editorial_quality` fails because the article contains placeholder text, visible prompt/writing-rule residue such as `규칙 A (감각 디테일)`, broken Korean particles, excessive highlights, generic image context, or machine-looking slug/title.
- SEO score fails after metadata repair.
- The slug is weak, generated-looking, numeric-leading, or hash-suffixed.
- Render integrity fails.
- Structure integrity fails.
- `accent_density` fails because highlight markup exists, numeric emphasis is excessive, heading counts are excessive, or paragraph walls remain.
- `table_integrity` fails because a Markdown table is missing a separator row, has inconsistent cells, or is too short to be useful.
- `cta_destination_integrity` fails because a package CTA has an empty or mismatched destination parameter.
- A product-backed post references a package whose unified `customer_open_contract` fails or whose `registration_evidence_pack_v1.downstream_eligibility.blog_publish` is false.
- Readability has repeated phrase spam that cannot be repaired.
- The article has no usable image path or missing image alt evidence.
- The article has no internal CTA and no official external reference.
- The candidate was produced by deterministic information fallback.
- Customer-visible copy contains active-product counts, product inventory counts, booking/consultation signals, or other internal operating values.
- Canonical URL, sitemap URL, and stored slug disagree.
- Public article links contain localhost, 127.0.0.1, 0.0.0.0, or any non-public HTTP origin. Product CTA links must use the blog canonical public origin.

SEO score alone is not a publish success signal. A post is complete only when topic fit, editorial quality, render integrity, image quality, SEO, readability, indexing enqueue, and later visibility observation all have durable evidence.

## Customer Writing Contract

Automatic publishing must optimize for a reader who is deciding what to do next, not for a template that only looks SEO-complete.

Required writer split:

- `info_writer`: answer the reader's search intent first. The first 120-200 characters must contain a concrete answer, question, comparison, price/time/weather/document trigger, or checklist direction. Product or consultation CTA appears only near the bottom and must be soft.
- `product_consultant_writer`: help the customer make a pre-inquiry decision. The post must show price/from-city/duration, included/excluded items, fit/not-fit, risk notes, price-change conditions, and questions to ask before consultation.
- Public-render table contract: information posts whose public title/body implies cost, budget, weather, itinerary, checklist, visa, currency, or expense must contain at least one renderable Markdown table with a separator row and three or more body rows before publish. Pseudo-table prose such as `식사 종류 / 비용 / 특징` is not enough because the public renderer will expose it as plain text and fail the customer scan task.

Forbidden customer-visible patterns:

- Generic openings such as "답부터 말하면, 20XX년 X월 기준..." or "먼저 볼 것은 예산 범위, 이동 순서, 현지 확인 사항입니다."
- Product copy that says only "상담에서 최종 확인" repeatedly instead of giving a useful condition to check.
- Duplicate price suffixes such as `1,369,000원부터부터`.
- Broken Korean/encoding residue such as mojibake characters (`�`, `媛`, `諛`, `留`) in customer-visible body must fail customer quality. A post that customers cannot read is never a near-pass, even when SEO, headings, and links look complete.
- Weather or packing guides that open with cost/reservation copy instead of temperature, rain, clothing, and packing decisions.
- Product posts that invent hotel names, fixed benefits, scarcity, or confirmed schedules not present in product evidence.
- Repeated answer-first hooks, duplicated CTA/FAQ blocks, duplicate hashtags, generic customer labels such as `여행 정보를 볼 때` when a destination is known, and placeholder surfaces such as `현지 관련 상품` or `상품 가격 변동_PKG`.

Backfill and live publishing must use the same customer contract. `scripts/backfill-blog-quality.ts` should repair customer-visible copy and then run the full publish evaluator; a dry run with `qualityGateFailed=0`, `publishBlocked=0`, and `minorOnlyIssues=0` is the target for "100점" recent-post evidence.

For recent-post stabilization, the stronger target is `changed=0`, `qualityGateFailed=0`, `publishBlocked=0`, indexing worker success for every changed row in write mode, and diagnostics that still report publish preflight pass, publishable candidate inventory, and indexing outbox coverage.

## Informational Related-Link Contract

New informational-engine articles use their persisted destination, intent, audience, locale, and editorial-cluster metadata for both publish-time interlinks and public related-post surfaces.

Ranking priority is:

1. same destination with the same or an adjacent intent;
2. same country, then same region, with the same intent;
3. the same non-general audience;
4. an explicit editorial pillar/cluster relationship.

Candidates must be published, indexable, non-redirecting, self-canonical, locale-compatible, and different from the current URL. Duplicate slugs and repeated anchor text are removed. When no candidate meets the relevance threshold, the correct result is no related link; unrelated recent posts must not be used as filler. Product-backed and legacy posts retain their current link behavior unless they carry a valid informational representative identity.

## Informational CTA Contract

Informational writers must not generate CTA sections, package links, consultation links, community links, or external CTA URLs in article Markdown. Publish preparation and the public renderer both strip legacy sales CTA anchors. The public renderer owns CTA selection through the typed keys `NAVER_CAFE`, `DEAL_ROOM`, `CONSULTATION`, `RELATED_ARTICLES`, and `OFFICIAL_SOURCE`.

- One primary CTA is allowed, with at most one secondary CTA. Bottom placement is the default; a mid-article placement, if explicitly selected later, is limited to one CTA.
- Selection uses persisted intent, destination, risk level, and locale. Entry/visa and insurance content puts a pinned official-source URL first when available, may show a related article second, and never shows a sales-oriented external CTA.
- External URLs are disabled unless they are HTTPS and pass the centralized host/provenance allow policy. `NAVER_CAFE_ID` alone is not treated as a proven public CTA URL.
- When every external URL is missing or invalid, only a contextual internal related-article CTA may render. If that route is also invalid, the CTA hub is absent.
- External links open in a new tab with `noopener noreferrer`; all CTA links remain keyboard reachable and mobile-safe.
- Informational CTA `impression` and `click` events use a dedicated same-origin endpoint. The browser sends only an ephemeral idempotency key, `article_id`, `event_type`, `cta_key`, and `placement`; the database derives representative dimensions and stores only a hash of the key. No session/user/visitor ID, URL, UTM, free-form metadata, IP, user agent, booking data, or product repository data is stored. Events are deduplicated and rate-limited, and telemetry failure never blocks navigation.

Runtime settings are `BLOG_NAVER_CAFE_URL`, `BLOG_DEAL_ROOM_URL`, and optional `BLOG_CONSULTATION_URL`; consultation may reuse a valid existing `KAKAO_CHANNEL_ID`. Missing settings mean disabled, never a guessed or hardcoded fallback.

## Indexing Contract

Publishing and external indexing submission remain separate responsibilities. For informational content, the durable indexing outbox row is created atomically with the public article state and representative activation.

Correct sequence:

1. Publish only after all gates pass; for informational content, the article, canonical representative, publication audit, and indexing outbox commit in one transaction.
2. Revalidate `/blog`, `/blog/[slug]`, and the blog list tag.
3. Product/legacy paths enqueue a durable `blog_indexing_jobs` row through their existing flow; informational atomic publication already guarantees this row before the public transaction commits.
4. Blog indexing URLs must be canonical `https://www.yeosonam.com/blog/{slug}` URLs. `BLOG_CANONICAL_ORIGIN` is the first-choice origin, and queued job URLs are canonicalized again before provider submission.
5. The existing `/api/cron/blog-publisher` schedule drains due indexing jobs through `processDueBlogIndexingJobs()`, and the GitHub external cron fallback calls `/api/cron/blog-indexing-worker` independently after publisher slots. Indexing must not depend on a successful publish run.
6. The worker submits sitemap through Google Search Console API or keeps it discoverable in `robots.txt`.
7. The worker submits changed URLs through IndexNow batch endpoints when `INDEXNOW_KEY` is configured.
   The same key must be publicly verifiable at `https://www.yeosonam.com/{INDEXNOW_KEY}.txt`; the app serves this only when the requested root `.txt` path exactly matches the configured key.
8. The worker records provider-specific results in `indexing_reports` and visibility snapshots.
9. Observe Google status through URL Inspection within quota.

IndexNow submissions must be duplicate-aware and provider-safe:

- The runtime caches recently submitted update URLs for 10 minutes by default (`INDEXNOW_RECENT_TTL_MS`) so repeated publisher/worker runs do not burn provider quota on the same canonical URL.
- `URL_DELETED` notifications bypass the recent-submit cache and must still be sent.
- Batch submissions are split by `INDEXNOW_MAX_URLS_PER_REQUEST` and provider calls are spaced by `INDEXNOW_PROVIDER_MIN_INTERVAL_MS`.
- If IndexNow responds with `Retry-After`, the worker must persist that evidence in `indexnow_retry_after_ms` and schedule the next durable outbox attempt no earlier than the provider's requested backoff.
- When `INDEXNOW_KEY` is configured, a failed IndexNow provider submission must not be hidden behind a successful Google sitemap hint. The outbox job remains retryable until IndexNow succeeds, is cached from a recent successful attempt, or exhausts `max_attempts`.

The durable blog outbox worker must not depend on legacy unauthenticated sitemap ping or WebSub calls for success. Those calls may exist only as explicit manual/backfill compatibility behavior, not as the normal `/blog` indexing success path.

Google sitemap submission is a hint, not a guarantee of indexing. Google no longer supports the old unauthenticated sitemap ping as the core path. URL Inspection is for status visibility and troubleshooting, not bulk indexing guarantees.

URL Inspection sampling must be quota-aware:

- The sampling cron must cap per-run inspection volume and also look at recent `indexing_reports` evidence before calling Google.
- Default internal caps stay below Google's public Search Console URL Inspection quotas: 25 per run, 100 per 10 minutes, and 1,500 per 24 hours.
- If the rolling budget is exhausted, the cron must skip URL Inspection and return `inspection_skipped_quota=true` with `inspection_quota` details instead of treating the skipped sample as publish/indexing failure.
- If Google returns a quota or rate-limit response during a run, the cron must stop additional URL Inspection calls for that run and surface `inspection_stopped_by_quota=true`.

Publishing routes must not call external indexing providers directly. They may only enqueue `blog_indexing_jobs`; retries and evidence persistence belong to the worker.

Every published slug must be observable in the indexing outbox. Treat these as separate failure classes:

- `indexing_outbox_missing`: a published slug never reached `blog_indexing_jobs`.
- `indexing_queue_error`: a durable job exists, but the worker/provider submission is pending, retrying, or failed.

Outbox coverage checks must compare recent published `content_creatives` rows with recent `blog_indexing_jobs` rows by `content_creative_id`, `slug`, or canonical `/blog/{slug}` URL. Queries over `blog_indexing_jobs` must be ordered by newest `updated_at` before applying a limit, otherwise large historical success tables can hide fresh jobs and create false alarms.

## Public Section Contract

The public blog is a topical cluster, not just a chronological list.

Required public surfaces:

- `/blog`
- `/blog/[slug]`
- `/blog/destination/[dest]`
- `/blog/angle/[angle]`
- `/sitemap.xml`

Rules:

- All public blog surfaces must use the shared canonical origin helper, `resolveBlogCanonicalOrigin()`.
- `/blog` destination guide cards must link to `/blog/destination/{dest}`, not the general `/destinations/{dest}` page. General destination pages can still exist, but blog destination pages carry the blog topical cluster.
- `/blog` destination sections should use site-wide active destination evidence (`active_destinations`) and only fall back to current-page posts when DB reads are unavailable.
- Destination and angle pages must use the same image display helper as the main blog list, so Supabase/remote images are normalized consistently.
- Sitemap must include blog destination and blog angle collection URLs when corresponding published posts exist.
- `/blog` list cache revalidation must not turn a transient DB timeout into a production error log or a silent empty list. If the primary list query times out, the page should serve last-good or Korean fallback content and record the event as degraded telemetry, not as a published-post count of zero.

## Daily Verification

Run:

```bash
npm run audit:blog-quality -- --limit=50
npm run audit:blog-search-daily:strict
npm run audit:blog-render:browser -- --base=https://www.yeosonam.com --json --strict
npm run audit:blog-public-customer-quality -- --base=https://www.yeosonam.com --limit=10 --strict
npm run audit:blog-images -- --base=https://www.yeosonam.com --json
npm run audit:blog-seo -- --base=https://www.yeosonam.com --json
npm run audit:blog-public-surfaces -- --base=https://www.yeosonam.com --strict
npm run diagnose:blog-autopublish -- --json
```

Failure policy:

- Any non-slug quality failure blocks the “healthy” status.
- Any public customer-quality failure blocks healthy status even when DB quality, render integrity, SEO, and public URL checks pass. This audit catches reader-visible defects such as broken table surfaces, generated instruction residue, duplicate headings/sections, early hard CTA in information posts, unsupported internal-data claims, and AI-cliche tone.
- Any recent published post missing a durable indexing outbox job blocks healthy status as `indexing_outbox_missing`.
- Any public blog section with a missing/mismatched canonical URL, duplicate brand title, noindex, DB-unavailable fallback, or missing blog collection sitemap entry blocks healthy status.
- Indexing provider success below 80% creates an admin alert.
- `generating` rows older than 30 minutes must be recovered or quarantined.

## Remaining Hardening Work

Priority 1:

- Extract a shared `prepareBlogForPublish()` helper so every publish path uses the same repair/evaluation contract. Done for direct publish paths on 2026-06-15:
  - `src/app/api/blog/route.ts`
  - `src/app/api/content-queue/route.ts`
  - `src/app/api/content-hub/publish/route.ts`
  - `src/app/api/blog/mrt-hotel-ranking/route.ts`
  - `src/app/api/cron/blog-regenerate-zero-click/route.ts`
  - `src/lib/social-publishing/distribution-publisher.ts`
- Indexing outbox implemented on 2026-06-15:
  - Migration: `supabase/migrations/20260615150000_blog_indexing_jobs.sql`.
  - Enqueue helper: `src/lib/blog-indexing-outbox.ts`.
  - Worker core: `src/lib/blog-indexing-worker.ts`.
  - Independent endpoint: `src/app/api/cron/blog-indexing-worker/route.ts`.
  - Scheduler: existing `/api/cron/blog-publisher` drains due indexing jobs, and `.github/workflows/blog-external-cron.yml` runs `blog-indexing-worker` through the custom domain after publisher slots to avoid coupling indexing to publisher health.
- Slug migration and recent-post quality backfill completed on 2026-06-15 after redirects and indexing worker were live:
  - `npx tsx scripts/migrate-blog-slugs.ts --write`
  - `npm run audit:blog-quality -- --limit=50 --write`
  - `npm run audit:blog-quality -- --limit=50`
  - Final dry-run result: `changed=0`, `qualityGateFailed=0`.
  - Indexing outbox result: `active=0`, `succeeded=112`.
- Latest 10-post follow-up on 2026-06-15:
  - Five latest machine slugs were migrated to reader-facing slugs.
  - Nine repairable recent posts were backfilled and re-indexed.
  - `shijiazhuang-itinerary` was archived instead of repaired because `석가장 신혼여행` is a blocked destination/intent mismatch.
  - Final dry-run result: `changed=0`, `qualityGateFailed=0`.
  - Active indexing queue: `0`.

Priority 2:

- Split sitemap into blog/package/destination sitemap files if URL count or update cadence grows.
- Add canary generation: publish three low-risk topics to draft/preflight, verify gates, then publish.
- Add daily admin summary fields for non-slug failures, slug failures, indexing failures, and stuck queue rows.

Priority 3:

- URL Inspection sampling with quota-aware backoff was added on 2026-07-04:
  - Helper: `src/lib/gsc-url-inspection-quota.ts`.
  - Cron integration: `src/app/api/cron/gsc-index-rank/route.ts`.
  - Test: `src/lib/gsc-url-inspection-quota.test.ts`.
- IndexNow retry/cache/rate-limit behavior was hardened on 2026-07-04:
  - Runtime cache and provider spacing: `src/lib/indexing.ts`.
  - Provider `Retry-After` propagation: `src/lib/indexing.ts`.
  - Durable retry scheduling: `src/lib/blog-indexing-worker.ts`.
  - Tests: `src/lib/indexing.test.ts`, `src/lib/blog-indexing-worker.test.ts`.
- A dashboard card for publish health versus indexing health was added on 2026-07-04:
  - UI: `src/app/admin/blog/system/page.tsx`.
  - Contract test: `src/app/admin/blog/blog-admin-ops-ui-contract.test.ts`.
- Candidate pre-publish readiness was hardened on 2026-07-04:
  - Shared contract: `src/lib/blog-candidate-prepublish-contract.ts`.
  - Publishable inventory and canary preflight now exclude candidates with banned editorial cliches, machine separators, numeric-leading slug risk, weak expected slugs, or destinationless broad recommendation topics.
  - Publisher preflight can quarantine these rows with `failure_code='candidate_pre_publish_contract'` before claim.
  - Production-data dry run showed publishable candidates `67 -> 49`, `candidate_contract_blocked_count=18`, canary still mixed with one info writer and two product consultant writers, and indexing outbox coverage remained 100%.
