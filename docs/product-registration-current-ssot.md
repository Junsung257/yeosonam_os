# Product Registration Current SSOT

Last updated: 2026-06-07

This is the current operating contract for supplier upload registration, customer mobile landing, and A4 poster readiness.

The priority is internal reliability first. Do not design the public API layer until this internal engine consistently registers our own supplier documents without customer-deliverable blockers.

## Research Recheck

The 2026-06-07 direction remains correct after rechecking document-AI and agent-learning references:

- Docling-style document IR uses structured document objects with provenance. Our source span, hash, section, and future table-row/cell evidence contract follows that direction without adding OCR/PDF dependencies to production text upload yet. Reference: https://docling-project.github.io/docling/concepts/docling_document/
- Unstructured-style partition/chunk pipelines keep documents as elements before chunking. Our product/section/table/day-row split is intentionally structural, not random text splitting. References: https://docs.unstructured.io/open-source/core-functionality/partitioning and https://docs.unstructured.io/open-source/core-functionality/chunking
- Structured LLM fallback must be schema-bound and eval-gated. Deterministic parser/IR still wins when source-backed extraction is complete. Reference: https://developers.openai.com/api/docs/guides/structured-outputs
- Agent memory systems such as Reflexion/Voyager are useful as inspiration for episodic learning, but production promotion must stay review-gated with fixtures and regression tests. References: https://arxiv.org/abs/2303.11366 and https://arxiv.org/abs/2305.16291

Therefore the correct architecture is still:

```text
micro event capture
  -> durable append-only ledger
  -> macro pattern mining
  -> review-required promotion work item
  -> fixture + deterministic parser rule
  -> regression/eval proof
  -> production behavior
```

## Document Hierarchy

This document is the single current SSOT for product upload registration.

General documentation automation rules live in `docs/ai-agent-doc-automation.md`. Use that document to decide whether a change needs a fixture, SSOT update, error-registry entry, audit note, or no document change.

Use the documents like this:

- `docs/product-registration-current-ssot.md`: current rules and completion contract.
- `db/error-registry.md`: append-only repeated mistake registry and active checklist.
- `docs/audits/README.md`: archive index for historical evidence, investigation notes, and completed audit reports.
- `.claude/commands/register-product.md` and `.claude/commands/assemble-product.md`: legacy/manual references only.
- `docs/registration-improvement-plan.md` and `docs/register-changelog.md`: historical planning/decision records, not the active upload registration playbook.

Do not create a new planning document for each registration failure. Add the failure to the golden corpus and, if it is a repeated process mistake, add one concise rule to `db/error-registry.md` or this SSOT.

When searching for current product-registration rules, exclude audit history first:

```bash
rg "keyword" docs AGENTS.md .claude --glob "!docs/audits/**"
```

## Current Direction

All supplier raw formats must converge into one registration object:

```text
upload route
  -> parse source
  -> split products
  -> registerProductFromRaw()
       -> deterministic fixes
       -> supplier raw facts
       -> recoverUploadPriceData()
       -> resolve destination/code
       -> normalize itinerary
       -> evaluateUploadDeliverability()
       -> StandardProductRegistrationObject
  -> persist products/product_prices/travel_packages
  -> audit customer mobile/A4 readiness
```

`src/app/api/upload/route.ts` is an HTTP adapter only. It must not contain supplier-specific regexes, price table rescue logic, destination rescue logic, itinerary normalization, or persistence decisions.

## Self-Improving Central Engine Contract

The upload engine has two learning loops under one central engine. This is not a free-running AI that rewrites production behavior by itself. It is a trace/eval/dataset/rule-promotion system:

```text
individual upload trace
  -> micro auto QA and deterministic repair
  -> improvement ledger event
  -> macro pattern mining after enough evidence
  -> reviewed parser-rule candidate
  -> golden fixture and regression gate
  -> deterministic central engine rule
```

The central engine owns both loops:

- Micro engine: improves one upload attempt by comparing source text, standardized registration data, persisted rows, `/packages` payload, and A4 payload.
- Macro engine: improves future uploads by mining repeated micro events, normalizing vocabulary/patterns, and promoting reviewed rules into deterministic parsers and golden corpus tests.

Never let the macro engine write production parser code, DB migrations, supplier dictionaries, or customer-visible copy directly. It may create candidates, reports, fixtures, and reviewed PR-ready patches only.

### Micro Auto QA Contract

Trigger the micro engine when any of these are true:

- upload registration fails.
- `publishable=false`.
- `deliverability.ok=false`.
- trust/confidence score is below the configured threshold.
- `product_prices` and `price_dates` disagree.
- positive `product_prices.net_price` lacks positive `adult_selling_price`.
- `removedPollutedScheduleItems.length > 0` and relocation evidence is incomplete.
- destination or internal code is `UNK`.
- mobile `/packages/{id}` payload audit fails.
- A4 payload audit fails.
- supplier/document format is new or unknown.

Micro engine stages:

```text
attempt 0: normal central registration
attempt 1: deterministic source re-compare and repair
attempt 2: render-payload audit and source-backed repair
attempt 3: final re-registration and customer deliverability audit
then PASS / AUTO_FIXED / REVIEW_NEEDED / BLOCKED
```

Automatic improvement is capped at three repair attempts. After three attempts, do not keep looping. Store `REVIEW_NEEDED` with the raw source, blockers, attempted fixes, before/after diffs, render audit results, and candidate parser-rule notes.

Every micro run must create an improvement ledger event with:

- `uploadId`, `productId`, `packageId`, `attemptNo`.
- `rawTextHash`, `sectionRawTextHash`, parser version, detected format.
- blockers before/after.
- source evidence spans and quotes.
- fields compared: title, destination, price rows, price dates, itinerary days, flights, hotels, meals, inclusions, exclusions, optional tours.
- auto fixes applied and whether they were deterministic, schema fallback, or manual-review candidates.
- `/packages` audit result and A4 audit result.
- final status: `PASS`, `AUTO_FIXED`, `REVIEW_NEEDED`, or `BLOCKED`.
- fixture candidate and parser rule candidate flags.

Implementation status:

- Shadow-mode micro QA runs in the central upload product runner, not in `/api/upload`.
- The runner collects improvement ledger events for deliverability-blocked, upload-gate-blocked, and successfully saved products.
- The runner persists shadow events to `product_registration_improvement_events` after the product loop. This is append-only and must not store supplier raw text, only hashes, blockers, evidence spans, render audit results, and rule/fixture candidate flags.
- Upload responses expose `learningEngine.mode = "shadow"` with captured/persisted micro event counts, latest statuses, persistence error, macro candidate preview, and scorecard blockers.
- The integration test `src/lib/product-registration/learning-engine-integration.test.ts` must prove persisted micro events can be loaded into a macro report, produce promotion work items, and score 100 only when full regression is marked verified.

### Macro Pattern Mining Contract

Run macro mining when one of these thresholds is reached:

- 50 new upload events.
- 10 new failed or `REVIEW_NEEDED` events.
- 5 repeated blockers with the same normalized signature.
- weekly scheduled review.
- supplier-specific failure rate exceeds 20% in the recent window.

Macro mining must produce candidates, not direct production changes:

- supplier format fingerprints.
- common section heading aliases.
- price table heading/column aliases.
- itinerary column aliases.
- optional-tour and surcharge phrase dictionaries.
- include/exclude/notice stop-heading candidates.
- hotel/room/grade expression aliases.
- flight/time/vehicle/region pollution signatures.
- parser-rule candidates with evidence count, success rate, false-positive risk, and fixture examples.

Implementation status:

- Macro candidate mining can run over improvement ledger events in memory.
- The durable event table exists as `product_registration_improvement_events`; scheduled macro jobs and operator reports must read from that table, not from request-local response objects.
- It groups blocker signatures, supplier formats, deterministic fixes, schedule-pollution fixes, and render failures.
- It marks candidates as promotion-ready only when enough evidence exists and risk is not high.
- A read-only operator report is available at `/api/admin/product-registration/learning-report`. It loads durable ledger events, produces macro candidates, returns the 100-point score, and confirms that production mutation is disabled.
- A weekly read-only cron is available at `/api/cron/product-registration-learning-report` and scheduled in `vercel.json`. It summarizes the last 30 days of durable events, macro run reasons, promotion-ready candidate counts, and score blockers.
- Promotion-ready candidates are converted into review-required promotion work items. Each item includes fixture assertions, target parser modules, safety checks, evidence hashes, and verification commands. It does not auto-edit production parser code.
- PR-ready patch file generation is still review-gated; the macro engine may propose work items, but an engineer/agent must add the fixture and deterministic rule through the normal regression gates.

Rule promotion order:

```text
candidate
  -> reviewed
  -> fixture added
  -> deterministic parser or dictionary update
  -> golden corpus regression
  -> product-registration eval
  -> production
```

Promotion requires:

- at least three independent source documents or one critical supplier format approved by review.
- source spans for every proposed mapping.
- auto-fix success rate at least 80% for the candidate pattern, when historical data exists.
- zero known customer-critical regressions.
- golden corpus fixture or assertion added.
- full required verification passes.

### 100-Point Learning Engine Score

The self-improving central engine is not ready unless both the micro and macro engines score at least 90, and the combined score is at least 95.

Micro engine score, 100 points:

- 15 trigger coverage: all failure/low-confidence/render-risk triggers are wired outside `upload/route.ts`.
- 20 source comparison: raw source, section raw text, evidence spans, and standardized fields are compared.
- 15 auto repair discipline: deterministic repairs run before LLM fallback, max three attempts, no unsafe direct DB mutation.
- 20 customer render audit: `/packages` and A4 payload audits run with customer-safe price and itinerary data.
- 15 improvement ledger: every attempt stores before/after blockers, fixes, evidence, status, and fixture/rule candidate flags.
- 15 safety gates: publish requires deliverability, price storage alignment, customer selling price, destination, itinerary, and render readiness.

Macro engine score, 100 points:

- 15 ledger coverage: enough micro events are captured with stable normalized blocker signatures.
- 20 pattern mining: headings, price tables, itinerary columns, optional-tour phrases, supplier formats, and pollution signatures are mined.
- 15 canonicalization: aliases are normalized into candidate dictionaries without overwriting existing parser rules.
- 20 promotion gate: candidate -> reviewed -> fixture -> parser rule -> eval -> production is enforced.
- 20 regression evidence: golden corpus and product-registration eval prove the candidate does not break existing formats.
- 10 operator visibility: admin/report output shows why a rule is recommended, evidence examples, risk, and next action.

Readiness levels:

- `0-59`: not usable for automation.
- `60-79`: internal diagnostic only.
- `80-89`: may run in shadow mode; no automatic repair publish.
- `90-94`: limited auto-fix for deterministic repairs; review remains required for macro promotion.
- `95-100`: production-ready self-improving central engine, subject to full verification.

## Catalog Split Contract

For `PKG`/catalog-style supplier text, parser or normalizer `multiProducts.length >= 2` is not sufficient by itself. Before saving, the preparation step must reconcile normalized products with deterministic raw `PKG` sections when the section count matches.

Required behavior:

- keep the original product title from the raw `PKG` section when the normalizer returns weak titles.
- keep each product's own `sectionRawText` for registration, audit, mobile landing, and A4 evidence.
- when explicit raw `PKG` block starts exist, they outrank variant labels or itinerary headers for product boundaries. Variant labels such as `[노팁/노옵션/노쇼핑]` can be shared prefixes and must not collapse earlier `PKG` products.
- if the parser collapses a multi-product source to one product, recover deterministic sections before raising `CATALOG_SPLIT_REQUIRED`.
- treat menu/cancellation appendices as shared evidence, not as extra products.

## Customer Page Audit Contract

상품 등록 완료 검수의 고객 화면 기준은 `/packages/{packageId}`다. `/lp/{packageId}`는 랜딩/디자인 실험면일 수 있으므로 상품 원문 대조, 모바일 상세, A4 readiness의 최종 기준으로 쓰지 않는다.

For pasted catalog itinerary tables (`일 자 / 지 역 / 교통편 / 시 간 / 주요 행사 일정 / 식 사`):

- standalone column values such as flight code, time, vehicle, region, meal token, `HOTEL:`, and URL must not be saved as normal schedule activities.
- Phu Quoc-style full upload tables are part of this contract: DAY schedule must not contain standalone `ZE981`, `18:55`, `22:25`, or destination-only tokens after registration normalization.
- Fukuoka spot-weekday price tables are part of this contract: DAY schedule must not contain cash-receipt title fragments, `스팟특가`, date ranges such as `6/8~7/16`, weekday labels such as `월,화,수`, shorthand prices such as `1,999,-`, hotel surcharge price-table notices, or standalone region tokens such as `유후인` and `도스`.
- hotel lines must populate `itinerary_data.days[].hotel`.
- meal tokens such as `조:호텔식`, `중:클럽식`, `석:불포함` must populate `itinerary_data.days[].meals`.
- outbound/inbound rows must populate `itinerary_data.flight_segments` and `meta.flight_out`/`meta.flight_in`.
- if LLM/normalizer itinerary data is polluted or misses hotels/meals while deterministic raw itinerary is complete, deterministic raw itinerary wins.
- schedule fragments removed during normalization must be recorded in `registration.itinerary.removedPollutedScheduleItems` so evals can prove the parser cleaned the source before render.
- `/packages/{id}` must keep detailed itinerary flight cards for outbound/inbound travel days. The top flight header and the DAY detail card serve different customer contexts.
- `/packages/{id}` must not render duplicate arrival-only flight cards when a departure/arrival pair has already been merged into one detailed DAY flight card.

## Price Success Definition

Old rule, now forbidden:

```text
price success = price_tiers exists
```

Current rule:

```text
price success =
  product_prices.length > 0
  AND price_dates.length > 0
  AND every price_dates.date has at least one product_prices.target_date
  AND the minimum product_prices.net_price for a date matches price_dates.price
  AND every positive product_prices.net_price has adult_selling_price
```

`price_dates` is the date-level minimum used for calendars and summary pricing.
`product_prices` is the customer option ledger used by mobile landing and A4. Hotel/grade columns, room choices, and other same-date price options must stay as separate `product_prices` rows.

Customer pages must never read or serialize internal `net_price` as the customer selling price. Customer-safe price payloads use `adult_selling_price`.

The central registration object must populate `product_prices.adult_selling_price` from `net_price` before the deliverability gate when no approved selling override exists. If a positive `product_prices.net_price` still has no positive `adult_selling_price` at gate time, customer deliverability is blocked.

For shared multi-column price tables, deterministic source-backed column selection must win over LLM/normalizer `price_tiers` when the raw table is recognized. This prevents product A from saving product B's same-date price options into `product_prices` or `price_dates`.

For any deterministic price IR where `source !== 'none'` and both `product_prices` and `price_dates` can be built, deterministic IR wins over LLM/normalizer `price_tiers`. LLM output is fallback evidence, not the first persistence source, when the raw table parser is complete.

LLM/Gemini price fallback must pass the strict fallback tier normalizer before it can be evaluated as a candidate. A fallback tier is ignored unless it has an integer KRW `adult_price` in the product price range and usable date evidence (`departure_dates`, `date_range`, or `departure_day_of_week`). Deterministic IR still outranks complete fallback tiers.

## Evidence Contract

`StandardProductRegistrationObject.evidence` is internal-only source evidence for evals and V3 draft ledgers. It includes:

- `rawTextHash`: sha256 of the exact product raw text.
- `spans[]`: `{ field, rawTextHash, start, end, quote, productIndex, sourceKind, sectionKey, lineIndex, rowIndex, columnIndex, confidence }`.

Line-level spans are the current minimum contract. Future PDF/OCR work should upgrade price and itinerary evidence to table row/cell spans inside the same ledger/audit contract.

The ledger persistence contract is now explicit: `product_registration_improvement_events` stores event-level evidence spans and hashes for learning/audit, while customer/source tables keep their existing raw/evidence fields. Do not add another evidence table unless the macro operator report or OCR benchmark proves this table is insufficient.

## Required Persistence Contract

Registration is not complete unless all three stores are consistent:

- `products`: internal ledger row with destination code and base price.
- `product_prices`: customer option rows with `target_date`, `net_price`, `adult_selling_price`, and option label/note when relevant.
- `travel_packages`: customer package row with `price_dates`, itinerary, raw evidence, render-ready fields, and review status.

`product_prices` insert failure is a blocker. It must not be downgraded to a warning after `travel_packages` is saved.

If `products` was newly inserted and `product_prices` persistence fails, delete that product row before returning the error. If an existing `products` row was updated and `product_prices` persistence fails, restore the pre-write product row before returning the error. Do not save `travel_packages` after `product_prices` failure.

The database guard from migration `20260605121000_product_prices_customer_selling_price_guard.sql` fills `adult_selling_price` from `net_price` when needed and prevents positive customer price rows from remaining customer-invisible.

## Customer Deliverability Gate

`evaluateUploadDeliverability()` is the final pre-persistence customer gate. It blocks before save when any of these are true:

- `product_prices` is empty.
- `price_dates` is empty.
- `product_prices` and `price_dates` disagree.
- destination is unresolved or internal code would become `UNK`.
- itinerary days are missing, duplicated, non-contiguous, or exceed the product duration.
- optional tour, entrance fee, surcharge, cancellation, or guide/tip amounts pollute product price candidates.
- A4/mobile render input cannot be built from the standardized object.

Failure messages should explain the root cause, such as price table type unrecognized, optional-tour-only amount detected, or date range not expanded. Do not return only generic phrases like "price rows missing".

## Golden Corpus Contract

Golden cases are full supplier raw texts, not shortened snippets.

Required current cases:

- Cebu hotel-column matrix.
- Phu Quoc full source.
- Fukuoka golf spot-special plus weekday period table.
- Clark multi-product split source.
- Narita/Chiba Joshi golf shared two-column table with dinner-menu appendix.
- Xian/Huashan BX four-`PKG` source with spaced headings (`출 발 일`, `판 매 가`), premium variant labels, and Chinese cancellation appendix.
- Existing supplier raw fixtures.

Each expected file should check the customer outcome, not only parser internals:

- title and destination.
- internal destination code is not `UNK`.
- minimum price.
- specific date prices.
- `price_dates.length > 0`.
- `product_prices.length > 0`.
- same-date hotel/grade options preserved when present.
- optional tour prices excluded from product price.
- itinerary days valid.
- customer mobile/A4 deliverability not blocked.

## Change Rule

Every new supplier failure must follow this order:

```text
fixture
  -> parser/IR or registration-object improvement
  -> recoverUploadPriceData verification
  -> evaluateUploadDeliverability verification
  -> persistence/audit verification
```

Do not patch new supplier cases directly into `upload/route.ts`.

Do not bypass the engine with one-off `db/insert_*.js` scripts unless the user explicitly asks for a manual legacy insert and accepts that it is outside the upload engine.

## A4/Mobile Contract

Mobile landing and A4 must share a customer-safe render contract. Renderers should consume standardized view/payload helpers rather than reparsing raw `travel_packages` fields.

Customer-visible fields must have one of these sources:

- copied from raw supplier evidence,
- deterministically derived from raw supplier evidence,
- manually approved,
- clearly labeled platform fallback.

Internal commission, supplier memo, net price, B2B terms, and land-operator-only notes must never enter customer render fields.

A4/mobile duration labels must use source-backed `nights` from the product title when the title states `N박M일`; do not infer nights only as `duration - 1` for overnight flights.

A4 price tables must consume persisted `travel_packages.price_dates` when present. Do not show internal tier labels such as `supplier_raw_departure_dates` as customer departure dates.

Catalog section parsing must stop inclusions/exclusions/optional-tour blocks at structural headings such as `룸타입`, `선택관광`, `쇼핑센터`, `비고`, `주의사항`, `일자`, and `PKG`; otherwise A4/mobile included/excluded/special-note sections become polluted.

Optional-tour lines with comma-separated entries must be split into individual customer options with their own price labels; never use the first price on the whole line as a shared representative price.

## Attraction Contract

Do not auto-seed attractions during product registration. If a tourism point is not matched, keep it as text and send it to the unmatched/review path. Attraction DB creation is a separate managed workflow.

## OCR/PDF Candidate Contract

Docling, Unstructured, Marker, MinerU, Camelot, PaddleOCR, Azure Document Intelligence, and similar tools are benchmark candidates only until text-upload golden corpus and source-span IR are stable. Do not add them as production dependencies in the upload route.

Any OCR/PDF benchmark must compare candidates offline using the same customer outcomes as the text corpus: product split count, price rows/dates, itinerary days, flight/hotel/meal relocation, evidence spans, and `/packages` + A4 render readiness.

## Required Verification

Before declaring the registration engine ready:

```bash
npx vitest run src/lib/product-registration/learning-engine-integration.test.ts
npx vitest run src/lib/parser/deterministic src/lib/product-registration src/lib/upload-validator.test.ts src/lib/price-dates.test.ts src/lib/upload-verify.test.ts
npm run type-check
npm run eval:product-registration:ci
node --check scripts/audit-product-mobile-landing-readiness.mjs
```

After deployment or remote DB/data changes, run the live readiness audit with `npx tsx scripts/audit-product-mobile-landing-readiness.mjs --public-only --strict` using the appropriate filters.

## Agent/Harness Setup

General AI harness and documentation automation rules live in `docs/ai-agent-doc-automation.md`.

This product-registration SSOT only records product-registration behavior. If a generic AI/prompt/eval/memory rule is needed, update `docs/ai-agent-doc-automation.md` instead of duplicating it here.
