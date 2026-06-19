# Product Registration Current SSOT

Last updated: 2026-06-20

This is the current operating contract for supplier upload registration, customer mobile landing, and A4 poster readiness.

The priority is internal reliability first. Do not design the public API layer until this internal engine consistently registers our own supplier documents without customer-deliverable blockers.

## Research Recheck

The 2026-06-08 direction remains correct after rechecking document-AI and agent-learning references:

- Docling-style document IR uses structured document objects with provenance. Our source span, hash, section, and future table-row/cell evidence contract follows that direction without adding OCR/PDF dependencies to production text upload yet. Reference: https://docling-project.github.io/docling/concepts/docling_document/
- Unstructured-style partition/chunk pipelines keep documents as elements before chunking. Our product/section/table/day-row split is intentionally structural, not random text splitting. References: https://docs.unstructured.io/open-source/core-functionality/partitioning and https://docs.unstructured.io/open-source/core-functionality/chunking
- Structured LLM fallback must be schema-bound and eval-gated. Deterministic parser/IR still wins when source-backed extraction is complete. Reference: https://developers.openai.com/api/docs/guides/structured-outputs
- Agent memory systems such as Reflexion/Voyager are useful as inspiration for episodic learning, but production promotion must stay review-gated with fixtures and regression tests. References: https://arxiv.org/abs/2303.11366 and https://arxiv.org/abs/2305.16291
- DSPy/LangGraph-style optimization and durable workflow ideas are useful only when their outputs remain testable artifacts. In this repo, optimization output becomes a ledger event, macro candidate, fixture plan, or review-required work item, not direct production mutation.
- OCR/PDF tools such as Marker, MinerU, PaddleOCR PP-StructureV3, and LayoutParser remain benchmark candidates. Their current public docs emphasize table/layout/document parsing, which matches our offline candidate harness, but not a reason to add them to production upload yet. References: https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-StructureV3/PP-StructureV3.html, https://mineru.net/doc/docs/index_en/, https://layout-parser.github.io/

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
- `docs/product-mobile-landing-quality-runbook.md`: mandatory customer mobile landing/A4 semantic quality proof before calling a product ready.
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

### YSN Standard Markdown Contract

`YSN-PRODUCT-MD v1` is a deterministic structured-input format. When this marker is present, the upload document parsing boundary must bypass LLM/legacy document parsing and call `parseStandardProductMarkdown()`.

The supported operator-facing schema is readable Korean, not mojibake/debug text:

- `## 기본정보`: `상품명`, `목적지`, `국가`, `상품타입`, `여행스타일`, `출발공항`, `항공`, `출발편`, `귀국편`, `출발요일`, `최소출발`, `발권마감`, `랜드사`, `커미션`.
- `## 가격`: table columns `라벨 | 날짜 | 성인 | 아동 | 상태 | 비고`.
- `## 포함`, `## 불포함`, `## 추가요금`, `## 선택관광`, `## 일정`, `## 공지`, `## 취소규정`.
- `## 일정` day rows use `### DAY N | 지역 | 호텔명(등급) | 조식 ... / 중식 ... / 석식 ...` and schedule rows use `시간 | 활동 | 타입 | 메모`.

This format may still be generated internally by a normalizer, but if an operator pastes it, the parser must treat it as structured source. Tests must use readable Korean fixtures and must prove `_llm_meta.provider = "standard-markdown"` with zero token usage.

Option/optional-tour prices in supplier shorthand such as `USD30`, `USD 30`, `$30`, `US$30/인`, `30000원`, and `KRW30000` must normalize into both customer display labels and structured currency fields before mobile/A4 validation. Example: `USD30` -> `price="$30/인"` and `price_usd=30`.

## Flight Evidence Contract

Customer-ready upload requires source-backed round-trip flight evidence to survive all the way to `itinerary_data.flight_segments`.

- If the supplier source contains two flight codes and at least four time tokens, saved segments must include complete outbound and inbound `flight_no`, `dep_time`, and `arr_time`.
- Korean catalog tables where return departure is on day N and arrival is on day N+1 must be paired as one inbound segment with `arr_day_offset=1`.
- Meeting, hotel pickup, or airport-transfer times must not be reused as flight departure times when a later source time is tied to an actual `... 공항 출발` activity.
- A row must not be called recovered only because `extractSupplierRawDeterministicFacts()` found partial flight facts. Replay verification must also accept complete `buildSupplierRawDeterministicItinerary(...).flight_segments`.
- Before marking an upload ready, the flow must validate the final customer mobile/A4 payload, not just parser output.

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
- actual mobile browser render contains wrong, cross-region, duplicate, internal, or source-unsupported attraction cards.
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

- `uploadId`, `productId`, `packageId`, `attemptNo`, `attemptPhase`.
- `rawTextHash`, `sectionRawTextHash`, parser version, detected format.
- blockers before/after.
- source evidence spans and quotes.
- fields compared: title, destination, price rows, price dates, itinerary days, flights, hotels, meals, inclusions, exclusions, optional tours.
- auto fixes applied and whether they were deterministic, schema fallback, or manual-review candidates.
- `/packages` audit result and A4 audit result.
- mobile browser proof result when a product is active/open or when the fix changes customer-visible landing content.
- final status: `PASS`, `AUTO_FIXED`, `REVIEW_NEEDED`, or `BLOCKED`.
- fixture candidate and parser rule candidate flags.

### Implementation Truth Status

The current codebase has the central registration runner, bounded micro QA, improvement ledger, macro mining report, and mobile/A4 audit scripts. It is not yet a fully autonomous parser-rewrite system.

Important implementation truth:

- `runMicroAutoQA()` records the four phases but does not re-run the entire parser three times for every blocker. It performs bounded deterministic repair for currently supported repair classes, then records phase evidence.
- The current deterministic auto-repair classes are intentionally narrow: customer selling price completion, date-level `price_dates` rebuild from existing `product_prices`, and schedule-pollution verification metadata.
- Catalog split, stacked flight recovery, ferry detection, destination aliases, attraction cards, hotel/meal promotion, and special price-table shapes are handled by parser/normalizer modules and regression fixtures, not by an unrestricted self-modifying micro loop.
- Upload failures must carry structured failure diagnostics in the upload response and `upload_review_queue.parsed_draft_json._product_registration_failure_diagnostics`.
- Pending `upload_review_queue` rows must be exportable as fixture candidate reports through `scripts/export-upload-review-fixture-candidates.ts`; the report is read-only and contains stable blocker codes, source hashes, safe excerpts, target modules, expected assertions, and verification commands.
- Fixture candidate scaffolds may be generated with `--scaffold`, but they are review artifacts only. They must not be treated as golden corpus fixtures until the safe excerpt is replaced by the full reviewed supplier source and exact expected customer output is filled.
- Any repeated failure must become a fixture candidate, regression test, or explicit error-registry entry before it can be called resolved.
- The final customer-ready claim still requires actual mobile landing and A4 proof according to `docs/product-mobile-landing-quality-runbook.md`.
- The learning-engine score must not become production-ready from event counts alone. It also requires persisted ledger parity, source evidence or compared-field evidence, passing `/packages` and A4 render audits, at least three independent raw-source hashes for macro promotion, full regression proof, price/date regression proof, and live-sample/mobile-A4 verification proof.
- A score below production-ready is not a failed engine. It means the engine may collect evidence, propose candidates, and run bounded repairs, but it must not claim autonomous completion or promotion safety.

Therefore, when a new supplier shape fails, the correct action is not to write another high-level plan. The agent must compare the failure against this SSOT, add or update the smallest durable artifact, patch the deterministic engine, and run the required verification.

Implementation status:

- Micro QA runs in the central upload product runner, not in `/api/upload`.
- The runner now applies a narrow deterministic pre-save repair loop for customer selling price completion and `price_dates` date-level minimum alignment when those fixes can be derived from existing `product_prices`. The repaired registration object is the one used for persistence and render audit when the deliverability gate becomes clean.
- The central registration object now includes an evidence-bound human-reader layer (`src/lib/product-registration/ai-human-reader.ts`). It reads source-backed price/date pairs and itinerary events from the original supplier text with evidence spans before customer render. This is not a free-running production parser rewrite; it is a source-evidence reader that the verifier can compare against saved rows.
- Product price recovery is now cross-checked by a price red-team audit (`src/lib/product-registration/price-red-team-auditor.ts`). If source-backed reader dates and recovered product prices overlap, every recovered same-date amount must exist in the source-backed price candidates for that date; `price_dates` minimum alignment is checked separately by the storage/render audit. If source-backed dates are completely disjoint from recovered dates, the customer publish gate receives a blocker. If recovery succeeds from `document_raw:*`, the evidence reader must audit the same document-level raw text, not only the product section. Gemini/LLM fallback can assist extraction, but model-derived prices (`gemini`, `llm_hydrated`) cannot publish without independent source-backed price/date evidence.
- The source-backed evidence reader must handle common supplier raw-text price shapes before accepting model-derived prices: vertical date/price tables, adjacent date-line plus following price rows, and monthly Korean weekday grids such as `6월 / 1~20 / 토 / 849,000 ...`. This is required because several suppliers mix explicit special-date blocks and month/weekday grids in one document.
- Single-departure supplier documents that provide a clear travel period plus a labeled product price such as `여행기간 2026년 5월 4일 ~ 5월 8일` and `상품가 ₩399,000원/인` are source-backed deterministic prices. They must recover one departure-date product price row and must not treat fuel surcharge, single charge, tip, visa, or option amounts as product prices.
- Micro QA writes the full four-phase ledger for every upload, including clean first-pass registrations. The phase names are `normal_registration`, `deterministic_source_recompare`, `render_payload_audit_repair`, and `final_reregistration_deliverability_audit`. Clean uploads use the last three phases as read-only verification passes; blocked or dirty uploads may apply deterministic repairs during the bounded repair phase. Attempt 0 must preserve the initial audit evidence, attempt 1 must carry deterministic fixes when any are applied, and later phases must be repaired-state audits without duplicating the same fix list.
- Saved-package re-extraction at `/api/packages/reextract` uses the same central parser, same bounded pre-save micro repair, and persists ledger attempts for both blocked and saved outcomes.
- The runner collects improvement ledger events for deterministic auto-fixed products, deliverability-blocked products, upload-gate-blocked products, and successfully saved products.
- The runner persists events to `product_registration_improvement_events` after the product loop. This is append-only and must not store supplier raw text, only hashes, blockers, evidence spans, render audit results, and rule/fixture candidate flags.
- Upload responses expose `learningEngine.mode = "shadow"` for macro promotion because production parser mutation remains disabled; micro deterministic repair can affect the current upload only inside the bounded pre-save loop.
- Post-save mobile/LP HTML QA is operationally separate from the pre-save payload render audit, but any detected mobile/LP incident must also be persisted to `product_registration_improvement_events` with `detected_format = "post_save_mobile_landing"`. A mobile QA incident that only demotes the package without entering the durable macro ledger is considered a learning-loop failure.
- The integration test `src/lib/product-registration/learning-engine-integration.test.ts` must prove persisted micro events can be loaded into a macro report, produce promotion work items, and score 100 only when full regression is marked verified.
- Attraction matching candidates for upload enrichment are all `attractions.is_active=true` masters, not only `customer_publishable=true` masters. `customer_publishable` controls rich customer rendering quality, not whether the engine can recognize a registered master. Mobile/A4 readiness must fail if a registered active attraction term appears in a customer-visible schedule line without saved `attraction_ids`, excluding pure transfer-only lines.

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
- It also classifies review candidates for section heading aliases, price table aliases, itinerary column aliases, optional-tour/surcharge phrases, include/exclude/notice stop-heading candidates, hotel/room/grade aliases, and flight/time/vehicle pollution signatures.
- It marks candidates as promotion-ready only when enough independent source evidence exists and risk is not high. Multiple repair attempts from the same raw-text hash count as one independent source for promotion.
- Candidate auto-fix success rate must be calculated over deterministic-fix events only and must stay in the 0..1 range.
- A read-only operator report is available at `/api/admin/product-registration/learning-report`. It loads durable ledger events, produces macro candidates, returns the 100-point score, and confirms that production mutation is disabled.
- `/admin/registration-monitor` surfaces the same learning report next to registration quality telemetry: micro ledger counts, `AUTO_FIXED` count, review/blocked queue size, macro candidate count, review-required promotion work items, score blockers, and next action.
- A weekly read-only cron is available at `/api/cron/product-registration-learning-report` and scheduled in `vercel.json`. It summarizes the last 30 days of durable events, macro run reasons, promotion-ready candidate counts, and score blockers.
- Promotion-ready candidates are converted into review-required promotion work items. Each item includes fixture assertions, target parser modules, safety checks, evidence hashes, and verification commands. It does not auto-edit production parser code.
- Non-promotion-ready macro candidates are still surfaced as a read-only `promotion.reviewQueue` with blocking reasons, fixture plans, target parser modules, evidence hashes, and verification commands. This prevents high-risk repeated blockers from disappearing just because they are not safe to promote yet.
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
- repeated attempts or phase events from the same `rawTextHash` do not satisfy the independent-source requirement.
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
- 15 improvement ledger: every attempt stores phase, before/after blockers, fixes, evidence, status, and fixture/rule candidate flags.
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
  AND every positive product_prices.target_date appears in price_dates
  AND every price_dates.date has at least one product_prices.target_date
  AND the minimum product_prices.net_price for a date matches price_dates.price
  AND every positive product_prices.net_price has adult_selling_price
```

`price_dates` is the date-level minimum used for calendars and summary pricing.
`product_prices` is the customer option ledger used by mobile landing and A4. Hotel/grade columns, room choices, and other same-date price options must stay as separate `product_prices` rows.
If a `product_prices` date is missing from `price_dates`, the registration is not customer-ready because the customer calendar can hide a sellable option.

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

`product_prices` persistence failure is a blocker. It must not be downgraded to a warning after `travel_packages` is saved.

All upload and re-extract paths must replace `product_prices` through `public.replace_product_prices_for_product(product_id, rows)` via `src/lib/product-registration/product-price-replacement.ts`. The function takes a per-product advisory transaction lock, row-locks the `products` ledger row, deletes prior price rows, and inserts the new customer option rows as one database statement. Do not reintroduce app-layer `delete().eq('product_id')` followed by `insert()` for this flow.

If `products` was newly inserted and `product_prices` persistence fails, delete that product row before returning the error. If an existing `products` row was updated and `product_prices` persistence fails, restore the pre-write product row before returning the error. Do not save `travel_packages` after `product_prices` failure.

The database guard from migration `20260605121000_product_prices_customer_selling_price_guard.sql` fills `adult_selling_price` from `net_price` when needed and prevents positive customer price rows from remaining customer-invisible.

The atomic replacement function is defined in migration `20260607053000_atomic_product_price_replacement.sql`.
Access is hardened by `20260607161500_harden_product_registration_learning_access.sql`: anon/authenticated execution is explicitly revoked, and only `service_role` keeps runtime execute access for the upload/re-extract server paths.

### Section Idempotency and Job Status

Multi-product uploads must claim each product section before expensive registration work. The claim key is:

```text
raw_text_hash + section_raw_text_hash + supplier_code + normalized_title
```

The durable ledger is `product_registration_section_jobs`, created by migration `20260607061000_product_registration_section_jobs.sql`. RLS is enabled, anon/authenticated table grants are revoked, and `20260607161500_harden_product_registration_learning_access.sql` adds the explicit `service_role` policy used by the server pipeline. The upload runner uses `src/lib/product-registration/upload-section-idempotency.ts` to:

- insert a `processing` job before `registerProductFromRaw()`.
- skip already `completed` jobs and non-stale `processing` jobs unless the request uses `force=1` / `reprocess=1`.
- reclaim `failed`, `blocked`, or stale `processing` jobs by incrementing `attempt_count` and resetting the row to `processing`; this keeps duplicate creation blocked while allowing automatic recovery after parser/QA improvements.
- mark jobs `completed` with persisted `product_id` and `package_id`.
- mark customer-deliverability or upload-gate failures as `blocked`.
- mark unexpected save exceptions as `failed`.

This is section-level idempotency. Document-level duplicate guards in `document_hashes` still run first and must not be removed.

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

Every raw-source upload investigation or parser fix must verify the complete customer path, not only extraction. The minimum acceptance path is:

```text
raw supplier text
  -> registerProductFromRaw
  -> deliverability gate
  -> renderPackage A4/mobile shared view
  -> mapTravelPackageToLandingData mobile payload
```

The work is not complete until the mobile payload has a positive `priceFrom`, non-empty source-backed `price_dates`, non-empty `itinerary.days`, and customer-readable schedule labels. Region-only fragments, meal connector fragments such as `중식 후`, transport/table columns, and supplier-only operational fragments must not appear as standalone sightseeing activities.

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

## Verified Master Candidate Automation Contract

The unmatched queue may be promoted into evidence-backed master candidates, but automation has two separate gates:

- internal candidate/master creation: allowed only for high-confidence structured candidates, stored as `auto_created=true`, `verification_status='auto_internal'`, and `customer_publishable=false`.
- customer-publishable master creation: allowed only after independent external identity evidence such as Wikidata plus official/OSM/Google/supplier verification, or explicit admin approval.

The queue table is `entity_master_candidates`. It groups `unmatched_activities` by category, normalized label, and regional scope, then records evidence counts, occurrence counts, source unmatched IDs, source context, suggested master data, confidence, and the recommended action.

The single itinerary entity resolution engine is `src/lib/itinerary-entity-resolution-engine.ts`. It is the shared path for current backlog cleanup and future cron automation:

```text
unmatched_activities
  -> entity_master_candidates
  -> Naver naming signal + external identity signal
  -> verification attempt log
  -> internal/publishable-ready/review/noise decision
```

Source roles are intentionally separated:

- Naver Search and SearchAd: Korean user-facing naming, alias popularity, and representative-name selection. SearchAd volume can choose the canonical display candidate, but it is not enough by itself to prove that a place exists.
- Wikidata/OSM/official/manual evidence: identity proof. A customer-publishable attraction candidate requires at least one identity source plus an independent supporting source.
- Supplier/internal evidence: occurrence and regional context. It can increase confidence but cannot bypass identity verification for new customer-visible master records.

The verification state is stored on `entity_master_candidates` as `auto_verification_status`, `verification_score`, `canonical_name`, `canonical_name_source`, `source_reliability_snapshot`, and `verified_at`. Each external lookup is logged in `entity_verification_attempts` so the engine learns from successful, empty, errored, and skipped checks.

Recommended actions:

- `reject_noise`: section headings, date/price fragments, movement tokens, URLs, and other non-entity scraps.
- `structure_non_master`: room types, golf fee fragments, table cells, and other useful structured data that should not become a master record.
- `create_internal_master`: probable attraction/hotel identity that can reduce future matching noise, but must remain hidden from customer payloads.
- `create_publishable_master`: only when the candidate has reliable independent external identity evidence and passes the publish gate.
- `needs_review`: shopping, optional tour, notice, unclear hotel, and any customer-visible phrase with insufficient evidence.

Run `npx tsx scripts/analyze-unmatched-master-candidates.ts --json` to inspect the queue. Add `--apply` to persist candidate groups. Add `--promote-internal` only after confirming the migration is applied; it may create internal non-customer-publishable attraction records, never public customer records.

Run `npx tsx scripts/verify-entity-master-candidates.ts --json --limit=20` to verify candidate names and identity evidence without writing. Add `--apply` to persist verification state and attempt logs. The scheduled path is `/api/cron/entity-resolution`, after `/api/cron/unmatched-auto-resolve`.

`needs_review` is not intended to mean "the owner must inspect every row." Use the automatic review audit first:

```bash
npm run audit:entity-review-candidates -- --json
npm run audit:entity-review-candidates:apply -- --json
```

This audit may automatically move terminal non-master patterns out of review while preserving source evidence in `suggested_master.auto_review`. Examples include airline/package tokens, date/price fragments, country-only tokens, generic attraction-type tokens, hotel operational fragments, and customer-disclosure fragments. It must not reject a safe canonical place name merely because the supplier source line also contains a date or price; the decision is based primarily on the canonical candidate name.

Low-risk repeated fragments can leave active review automatically when source evidence is preserved:

- standard schedule-change notices such as local/airline circumstances or weather/force-majeure schedule changes, unless they mention cancellation, refund, visa/passport/entry, insurance, payment, surcharge, price change, fuel, commission, or exchange-rate risk.
- option detail facts such as green fee, caddie/cart fee, caddie tip, tee time, course info, odd-person cart surcharge, club rental, locker use, on-site payment, golf-yard/par metrics, tee-up/through-play/self-rounding fragments, or source-backed golf round labels such as `CC 18홀 라운딩`.
- low-risk preparation/service fragments such as swimsuit, life jacket, bait, one-way lift, round-trip cable car, glass observatory, or one-way luge. These stay as source-backed structured facts, not attraction masters.
- hotel room/in-flight lodging fragments such as `2인실`, standard/deluxe/superior labels, room type labels, and `기내박`.

These are `structure_non_master` or `template_matched` outcomes, not new attractions/hotels and not customer-publishable master creation.

Customer-facing attraction APIs must hide `customer_publishable=false` records by default. Admin tools may request `include_unpublishable=1`.

## OCR/PDF Candidate Contract

Docling, Unstructured, Marker, MinerU, Camelot, PaddleOCR, Azure Document Intelligence, and similar tools are benchmark candidates only until text-upload golden corpus and source-span IR are stable. Do not add them as production dependencies in the upload route.

Any OCR/PDF benchmark must compare candidates offline using the same customer outcomes as the text corpus: product split count, price rows/dates, itinerary days, flight/hotel/meal relocation, evidence spans, and `/packages` + A4 render readiness.

Implementation status:

- `src/lib/product-registration/ocr-benchmark.ts` accepts OCR/PDF candidate extracted text and scores it through the same central registration engine and customer render checks.
- `npm run benchmark:product-ocr` runs the offline benchmark. With no input file, it uses the supplier raw golden fixtures, including the noisy OCR fixture, as the text-upload baseline.
- `npm run benchmark:product-ocr -- --input=path/to/candidates.json --json` can compare extracted text from Docling, Marker, MinerU, PaddleOCR PP-StructureV3, LayoutParser, Azure Document Intelligence, or any other candidate without adding that tool to production.
- `npm run benchmark:product-ocr:ci` is strict and fails when any candidate is not final-customer-outcome ready.

## Ignored Noise Audit Contract

`unmatched_activities.status='ignored'` is not a permanent delete bucket. It must be periodically audited because legacy ignores may contain reusable customer-facing or parser-training evidence.

The allowed final ignored categories are narrow:

- true noise: empty/symbol fragments, broken table labels, non-entity scraps.
- price/date evidence: shorthand prices, date ranges, age-price fragments, table cells. These stay out of the schedule render but keep `suggested_resolution.usable_signal=true` so price/date parsers and macro mining can reuse the evidence.
- free-time fragments that do not change customer notice copy.

Do not leave these as ignored when detected:

- customer notices: passport, entry, ticketing, cancellation, refund, payment, insurance, or price-change warnings.
- shopping phrases.
- optional tours, included services, golf tee/rounding/service details, massage/tip details.
- hotel, meal, transfer, ferry, airport, and flight-code events.
- possible attraction text. Move it back to review/new-master candidate. Automatic internal master records must stay `customer_publishable=false` until independently verified.

Use `npx tsx scripts/audit-ignored-unmatched-entities.ts --json` for a dry run and add `--apply` only after reviewing the summary. The script must preserve source context, raw hash, previous resolution metadata, and classification version.

## Required Verification

Before declaring the registration engine ready:

```bash
npm run verify:product-registration-learning
npm run verify:product-registration-live-samples:ci
npm run audit:drift:ci
npx vitest run src/lib/product-registration/learning-engine-integration.test.ts
npx vitest run src/lib/itinerary-schedule-compiler.test.ts src/lib/map-travel-package-to-lp.test.ts
npx vitest run src/lib/parser/deterministic src/lib/product-registration src/lib/upload-validator.test.ts src/lib/price-dates.test.ts src/lib/upload-verify.test.ts
npm run type-check
npm run eval:product-registration:ci
npm run benchmark:product-ocr:ci
node --check scripts/audit-product-mobile-landing-readiness.mjs
```

After deployment or remote DB/data changes, run the live readiness audit with `npm run verify:product-registration-learning:live`, `npm run verify:product-registration-live-samples:ci`, or `npx tsx scripts/audit-product-mobile-landing-readiness.mjs --public-only --strict` using the appropriate filters. Before release handoff, run `npm run verify:product-registration-learning:full` so the same regression gates, stored live-sample learning verification, live audit, and production build pass together.

The strict live audit must fail customer-visible samples when the latest V3 draft is `blocked`, `needs_review`, or missing. For attraction matching, the latest `product_registration_drafts.match_summary.attraction_unmatched_count` is authoritative; the legacy `unmatched_activities` queue is only a fallback when no draft summary exists, and only unresolved pending rows count.

When a live data sweep finds customer-invisible rows that fail mobile/A4 readiness, `npx tsx scripts/audit-product-mobile-landing-readiness.mjs --days=3650 --limit=2000 --json --archive-failed-nonpublic` may be used to quarantine those rows as `archived` with `audit_status=blocked` and an `audit_report`. This does not delete source data and must not be used to bypass the public V3 gate; public failures use `--demote-unsafe-public` instead.

## Agent/Harness Setup

General AI harness and documentation automation rules live in `docs/ai-agent-doc-automation.md`.

This product-registration SSOT only records product-registration behavior. If a generic AI/prompt/eval/memory rule is needed, update `docs/ai-agent-doc-automation.md` instead of duplicating it here.
