# Product Registration Errors

## ERR-duplicate-itinerary-day-range-phu-quoc@2026-06-16

- **Discovered**: 2026-06-16
- **Domain**: product registration | itinerary normalization | customer render gate
- **User-visible error**: `Customer landing/A4 blocked: itinerary duplicate day number ... itinerary duration overflow: product duration 6 days but itinerary has 12 days`
- **Source vs result**: A 4박6일 Phu Quoc upload produced twelve itinerary day rows because the same `DAY 1..6` range was present twice in the selected itinerary payload. The deliverability gate correctly blocked customer rendering, but the micro repair loop did not have a deterministic repair for duplicated day ranges.
- **Root cause**: `normalizeUploadItinerary()` pruned polluted schedule items and enriched attractions, but did not collapse exact duplicate day-number ranges before the customer render gate.
- **Fix**:
  - Added bounded duplicate-day collapse inside itinerary normalization.
  - The repair only runs when duplicate day numbers are within the product duration boundary; suspicious overlong schedules remain blocked.
  - Passed `durationDays` from the central registration runner into itinerary normalization.
  - Added a 4박6일 regression case where duplicated `DAY 1..6` becomes exactly six days before render.
- **Verification**:
  - `npx vitest run src/lib/product-registration/itinerary-normalization.test.ts src/lib/product-registration/deliverability-gate.test.ts src/lib/product-registration/register-product-from-raw.test.ts`
- **Status**: FIXED IN CODE
- **Prevention**: Duplicate day range repair belongs before mobile/A4 deliverability evaluation, not as a one-off review queue cleanup.

---

## ERR-mobile-qa-not-feeding-macro-ledger@2026-06-16

- **Discovered**: 2026-06-16
- **Domain**: product registration | post-save mobile QA | macro learning
- **Source vs result**: Post-save mobile QA could fetch the customer mobile/LP HTML, detect high/critical incidents, and demote the package to `pending_review`, but those incidents were only written to `ai_quality_log` and package audit fields. They were not persisted into `product_registration_improvement_events`, so the macro learning engine could not mine repeated real mobile landing failures.
- **Root cause**: The pre-save micro QA ledger and the post-save mobile QA were separate loops. The post-save loop was operationally useful, but not connected to the durable product-registration improvement ledger.
- **Fix**:
  - Added `buildMobileQaImprovementEvent()` so mobile/LP incidents become redacted learning events with raw-text hashes only.
  - Connected `runAutoMobileQA()` to `persistImprovementLedgerEvents()` when incidents are found.
  - Added regression coverage proving mobile incidents become `post_save_mobile_landing` ledger evidence without storing raw text.
- **Verification**:
  - `npx vitest run src/lib/auto-mobile-qa.test.ts src/lib/product-registration/upload-route-boundary.test.ts`
- **Status**: FIXED IN CODE
- **Prevention**: Customer mobile/LP failures must feed the same durable macro ledger as pre-save parser failures. Otherwise the system can block a bad page once but fail to learn from the repeated pattern.

---

## ERR-micro-ledger-and-standard-md-proof-gap@2026-06-16

- **Discovered**: 2026-06-16
- **Domain**: product registration | standard markdown | micro QA | regression proof
- **Source vs result**: The code had a `YSN-PRODUCT-MD v1` bypass and a four-phase micro QA ledger, but the proof was weaker than the operating promise. One upload-boundary test still used corrupted Korean fixture text, and the micro QA ledger repeated the repaired result across later phases instead of preserving phase-specific initial vs repaired audit evidence.
- **Root cause**:
  - The standard markdown unit parser had readable Korean coverage, but the upload boundary test still proved the bypass with mojibake text.
  - `runMicroAutoQA()` correctly performed bounded deterministic repair, but its ledger events did not clearly separate initial audit evidence, repair evidence, and final read-only re-audit evidence.
- **Fix**:
  - Replaced the upload-boundary standard markdown fixture with readable Korean `## 기본정보` / `상품명: 테스트 상품`.
  - Extended the product-registration contract checker so future standard markdown boundary tests fail if they regress to mojibake fixtures or stop proving zero token usage.
  - Updated `runMicroAutoQA()` ledger construction so attempt 0 records initial audit evidence, attempt 1 records deterministic fixes, and later phases record read-only repaired-state audits without duplicating the same fix list.
- **Verification**:
  - `npx vitest run src/lib/product-registration/upload-document-parsing.test.ts src/lib/product-registration/auto-qa.test.ts`
  - `npm run check:product-registration-contract`
- **Status**: FIXED IN CODE
- **Prevention**: A future claim that standard markdown bypasses AI parsing must be backed by readable Korean upload-boundary tests. A future claim about three micro verification passes must show phase-specific ledger evidence, not just repeated copies of the same result.

---

## ERR-YSN-standard-md-mojibake-and-option-price@2026-06-16

- **Discovered**: 2026-06-16
- **Domain**: product registration | standard markdown | option pricing | mobile landing
- **Source vs result**: The operating promise said `YSN-PRODUCT-MD v1` bypasses AI parsing and is treated as customer-landing-ready structured input. The implementation existed, but the parser/template/test fixtures used mojibake section names and keys, so a readable Korean YSN markdown source was not reliably parsed as the promised structured path. A separate upload showed option prices such as `USD30` flagged as invalid even though they are valid supplier shorthand for `$30/인`.
- **Root cause**:
  - The standard markdown parser had drifted around corrupted Korean text instead of the actual Korean operator schema.
  - Tests asserted mojibake samples, so they could pass while the human-usable template was broken.
  - Optional-tour normalization preserved some raw price strings without deriving both the customer display label and structured `price_usd`/`price_krw` fields.
- **Fix**:
  - Rebuilt `src/lib/standard-product-markdown.ts` around readable Korean sections and keys while keeping the same public parser API and `YSN-PRODUCT-MD` marker.
  - Replaced the standard markdown unit test with Korean source fixtures that prove LLM-free parsing, flight extraction, price extraction, itinerary extraction, attraction ID preservation, and source-backed render claim coverage.
  - Added option-price normalization coverage for `USD30`, `USD 30`, `$30`, `US$30/인`, `30000원`, `KRW30000`, and `30,000 KRW`.
- **Verification**:
  - `npx vitest run src/lib/standard-product-markdown.test.ts`
  - `npx vitest run src/lib/package-acl-optional-price.test.ts src/lib/standard-product-markdown.test.ts`
- **Status**: FIXED IN CODE
- **Prevention**: Any future YSN standard markdown change must use readable Korean fixtures, not mojibake fixtures. Any option price shorthand accepted from suppliers must normalize to both customer display text and structured currency amount before mobile/A4 verification.

---

## ERR-PRODUCT-REGISTRATION-SSOT-ENFORCEMENT-GAP@2026-06-15

- **Discovered**: 2026-06-15
- **Domain**: product registration | learning engine | documentation automation | mobile landing
- **Source vs result**: The active SSOT described a central self-improving registration engine with micro attempts, macro mining, fixtures, and mobile/A4 proof. In practice, several failures still reached the user as repeated upload/mobile issues because the implementation did not enforce the full contract on every failure path.
- **Root cause**:
  - The micro QA runner recorded four phase events, but did not re-run the entire parser three times for every blocker.
  - Failure rows were stored mostly as prose `error_reason`, making repeated blocker classes harder to query and promote.
  - Some recent fixes were reactive fixtures for individual supplier shapes instead of automatic failure-to-fixture ingestion.
  - Mobile landing proof was documented as mandatory, but not always enforced before a readiness/completion claim.
- **Fix**:
  - Added structured product-registration failure diagnostics with stable blocker codes.
  - Upload review queue rows now embed diagnostics under `_product_registration_failure_diagnostics`.
  - Upload responses now expose `failureDiagnostics` with codes, severity, next action, and per-product blockers.
  - Added read-only upload review fixture candidate export so pending failed rows can become regression work items without manual memory.
  - Added fixture scaffold generation for review artifacts (`raw-fixture.txt`, `expected.json`, `work-item.md`) without directly mutating golden corpus cases.
  - Added `check:product-registration-contract` and wired it into the learning-engine verification script.
  - Updated `docs/product-registration-current-ssot.md` with an explicit implementation truth status so future agents cannot treat documented intent as already fully enforced behavior.
- **Verification**:
  - `npm run check:product-registration-contract`
  - `npx vitest run src/lib/product-registration/failure-diagnostics.test.ts src/lib/product-registration/upload-review-queue.test.ts src/lib/product-registration/upload-response.test.ts src/lib/product-registration/auto-qa.test.ts`
  - `npx tsx scripts/export-upload-review-fixture-candidates.ts --limit=50`: classified 39 deduped pending candidates and reduced `UNKNOWN_BLOCKER` from 19 to 0 in the sampled queue.
- **Status**: FIXED
- **Prevention**: Any future claim that the learning engine is complete must pass the product-registration contract check and show actual mobile/A4 proof for customer-visible changes. New repeated blockers require structured codes, fixture candidates, and regression tests.

---

## ERR-NHA-TRANG-mobile-semantic-false-pass@2026-06-15

- **Discovered**: 2026-06-15
- **Domain**: product registration | mobile landing | itinerary semantics | publish gate
- **Product**: `70965e28-55f6-47c8-8a23-d87611847e49` / `PUS-ETC-CXR-05-0004`.
- **Source vs result**: Supplier raw text described a `3박5일` Nha Trang golf product. The customer mobile landing rendered the product as `4박 5일`, stored `호텔 미팅후 / 나트랑 공항으로 이동` in `day.hotel.name`, split excludes into broken fragments such as `석식 *토` and `일 주말...`, and exposed cart-fee surcharge rows as optional tours.
- **Follow-up source vs result**: After the first repair, `/lp/{id}` was mostly correct but `/packages/{id}` still had route-specific failures: no hero image, day-only duration display such as `#5일`, and a final-day arrival-only flight row rendered as `김해 출발`. This proved that checking only `/lp/{id}` or only DB readiness is insufficient.
- **Root cause**:
  - Persistence derived `nights` from `duration - 1` even when `trip_style='3박5일'` was available.
  - LP mapping rendered duration from `duration - 1` and ignored `trip_style`.
  - Schedule quality checks inspected `schedule[]` but not `day.hotel.name`.
  - Readiness audit did not block exclude fragment corruption or optional-tour arrays polluted by surcharge/cart-fee text.
- **Fix**:
  - `buildUploadPersistenceRows()` derives persisted `nights` from `trip_style` before falling back to `duration - 1`.
  - LP mapping formats duration from `trip_style`/metadata before using the old fallback.
  - `itinerary-normalizer` repairs movement text incorrectly placed in `day.hotel.name` by moving it back to schedule and clearing hotel.
  - `itinerary-quality-gate` and `deliverability-gate` block hotel-field schedule text.
  - `audit-product-mobile-landing-readiness.mjs` blocks duration/trip-style mismatch, hotel-field semantic mismatch, exclude fragment corruption, and optional-tour surcharge pollution.
  - `/packages/{id}` now receives the same destination fallback hero resolver used by LP.
  - `/packages/{id}` duration display now uses `trip_style` before day-count fallback.
  - `/packages/{id}` no longer renders arrival-only final-day flight rows as departure flight cards.
  - Post-save Auto Mobile QA now flags duration defaulting, day-only duration chips, final-arrival inversion, and missing hero images.
  - Existing Nha Trang row was demoted/kept `pending` + `audit_status=blocked` while repaired data and deployment are verified.
- **Verification**:
  - `npx vitest run src/lib/product-registration/persistence-rows.test.ts src/lib/map-travel-package-to-lp.test.ts src/lib/product-registration/deliverability-gate.test.ts`
  - `npx vitest run src/lib/customer-package-payload.test.ts src/lib/product-registration/upload-route-boundary.test.ts`
  - `npm run type-check`
- **Status**: FIXED IN CODE / CURRENT PRODUCT REQUIRES POST-DEPLOY `/packages` + `/lp` MOBILE VISUAL RECHECK
- **Prevention**: A product cannot be called ready from DB/API success alone. Final proof requires actual `/packages/{id}` and `/lp/{id}` mobile verification after deployment plus source-backed checks for duration, price, itinerary, hotel fields, excludes, optional tours, media, and A4/mobile readiness.

---

## ERR-BAEKDU-meal-hotel-schedule-leak@2026-06-12

- **Discovered**: 2026-06-12
- **Domain**: product registration | itinerary structuring | mobile landing | render contract
- **Products**: 11 active Yanji/Baekdu variants.
- **Source vs result**: Customer mobile landing showed meal-only tokens such as `꿔바로우`, `삼겹살`, and `매운탕` as plain timeline activities. Hotel stay names such as `풀만호텔 또는 동급 (5성)` also remained as plain schedule text instead of rendering through the hotel card. The page had passed previous readiness because the audit allowed `entity_kind=meal` in schedule and did not require promotion into `day.meals`/`day.hotel`.
- **Root cause**: The classifier tagged schedule items with `entity_kind=meal` or `entity_kind=hotel_stay`, but `normalizeUploadItinerary()` did not promote those tagged items into structured day fields. The mobile detail component also rendered from raw `normalizeDays(pkg.itinerary_data)` instead of the CRC `view.days`, leaving a render-contract bypass.
- **Fix**:
  - Added `normalizeStructuredItineraryEntities()` to promote standalone meal and hotel stay schedule tokens into `day.meals` and `day.hotel`.
  - Registration normalization now applies this promotion before saving customer itinerary data.
  - `renderPackage()` applies the same promotion defensively for existing data.
  - Mobile detail days now consume CRC `view.days` instead of raw schedule where possible.
  - Mobile meal UI hides unknown meal slots instead of labeling them `불포함`.
  - Existing 11 active Yanji/Baekdu products were repaired with `scripts/repair-structured-meal-hotel-schedule.ts --apply`.
- **Verification**:
  - `npx vitest run src/lib/product-registration/itinerary-normalization.test.ts src/lib/product-registration/register-product-from-raw.test.ts src/lib/product-registration/deliverability-gate.test.ts src/lib/product-registration-v3/product-registration-v3.test.ts src/lib/product-registration-v2/baekdu-v2.test.ts`
  - `npm run type-check`
  - `node scripts/audit-product-mobile-landing-readiness.mjs --public-only --strict --limit=200 --json`: `public_fail=0`, `itinerary_semantic_mismatch=0`.
  - Playwright mobile check on `/packages/06c8cb20-9257-4f58-b246-b3a5cc427d71`: meal tokens render under meal information, hotel names render under hotel cards, and the previous `꿔바로우 -> 풀만호텔` plain-text sequence is absent.
- **Status**: FIXED
- **Prevention**: Any meal-only or hotel-stay token left in `itinerary_data.days[].schedule` is now a strict mobile readiness failure. Customer mobile validation must check semantic rendering, not only token existence.

### Follow-up: raw meal table precedence

- **Discovered**: 2026-06-12, after mobile review.
- **Additional issue**: Standalone food lines can be continuation rows in the source meal table, not independent dinner events. Example: Day 1 source has `중:냉면+` then `꿔바로우`, and `석:샤브샤브` then `무제한`. Treating `꿔바로우` as dinner was wrong.
- **Fix**: Source meal table rows (`조:`, `중:`, `석:` plus continuation lines) now override inferred meal slots. Embedded phrases such as `중식 후 ...` and `호텔 조식 후 ...` still seed meals and clean the schedule sentence, but the explicit source meal table is authoritative.
- **Verification**: Product `06c8cb20` now renders Day 1 as `중식 냉면 + 꿔바로우`, `석식 샤브샤브 무제한`; Day 2 as `조식 호텔식`, `중식 비빔밥`, `석식 삼겹살 무제한`; Day 3 as `조식 호텔식`, `중식 산천어회 + 매운탕`, `석식 양꼬치 무제한`; Day 4 as `조식 호텔식`, `중식 김밥`.

---

## ERR-BAEKDU-flight-times-and-source-lines-missing@2026-06-12

- **Discovered**: 2026-06-12
- **Domain**: product registration | flight parsing | mobile landing | publish gate
- **Products**: 11 active Yanji/Baekdu variants:
  `06c8cb20`, `de1c3c29`, `4586930d`, `1d5776d4`, `063825a7`, `ab671acd`, `f0fe98e2`, `d29809e7`, `3c3ed200`, `64019572`, `1af1690c`.
- **Source vs result**: Supplier raw text contained source-backed flight times, for example `BX337 09:40 -> 11:30` and `BX338 12:30 -> 16:25`, but the customer mobile landing rendered flight cards without times. Some source itinerary lines such as Baekdu north/south-slope transfer and Jindallae Square were also missing from mobile text.
- **Root cause**: The previous verification treated flight-code existence as enough. Registration copied `flight_out` and `flight_in` into itinerary meta, but did not always preserve `flight_out_time`, arrival times, or explicit `flight_segments`. V3 gate and upload deliverability also did not fail when source-backed flight times were missing from the saved customer render payload.
- **Fix**:
  - `registerProductFromRaw()` now preserves source-backed outbound/inbound departure and arrival times in itinerary meta and `flight_segments`.
  - V3 gate now fails source-timed flight segments that have only partial times.
  - Upload deliverability now blocks when raw text has round-trip flight-time evidence but saved `itinerary_data.flight_segments` is missing or incomplete.
  - Existing Baekdu/Yanji active products were repaired with `scripts/repair-baekdu-flight-and-source-lines.ts --apply`.
- **Verification**:
  - `npx vitest run src/lib/product-registration/deliverability-gate.test.ts src/lib/product-registration-v3/product-registration-v3.test.ts src/lib/product-registration-v2/baekdu-v2.test.ts`
  - `npm run type-check`
  - Live mobile Playwright verification across all 11 `/packages/{id}` pages: HTTP 200, expected flight times visible, forbidden Xi'an/Huashan and Bohol terms absent, Jindallae Square visible.
- **Status**: FIXED
- **Prevention**: A mobile landing cannot be called ready unless source-backed flight times are visible in the actual mobile page. For supplier documents with flight-code/time tables, tests and live checks must assert departure and arrival times, not only flight numbers.

---

## ERR-BAEKDU-mobile-landing-semantic-gap@2026-06-12

- **Discovered**: 2026-06-12
- **Domain**: product registration | mobile landing | attraction enrichment | publish gate
- **Products**: 11 active Yanji/Baekdu variants:
  `06c8cb20`, `de1c3c29`, `4586930d`, `1d5776d4`, `063825a7`, `ab671acd`, `f0fe98e2`, `d29809e7`, `3c3ed200`, `64019572`, `1af1690c`.
- **Source vs result**: Products passed structural/open checks, but customer mobile pages could still show poor itinerary enrichment: duplicate Baekdu Heaven Lake cards, internal/non-publishable attraction IDs, wrong Heaven Lake cards on Akhwa waterfall text, and attraction cards attached to optional-tour/price/perk lines.
- **Root cause**: Verification was too structural. It checked saved rows, publishability blockers, itinerary existence, and page availability, but did not require mobile browser semantic proof. Early mitigation incorrectly treated `customer_publishable=true` as a matching prerequisite, which later hid registered-but-not-yet-rich-card-ready masters from the upload engine. Enrichment also trusted existing `attraction_ids` without enough stripping/deduplication for option/price/header/transfer lines.
- **Fix**:
  - `loadUploadRegistrationContext()` now loads all `is_active=true` attractions for upload enrichment. `customer_publishable` is enforced at customer render/readiness, not at semantic matching.
  - `enrichItineraryWithAttractionReferences()` strips attraction references from supplier commerce/header lines, optional tours, perks, and pure transfers without visit hints.
  - Enrichment deduplicates overlapping attraction concepts and blocks `악화폭포` from inheriting `백두산 천지`.
  - Saved Baekdu/Yanji products were repaired with `scripts/repair-baekdu-mobile-landing.ts --apply`.
  - `docs/product-mobile-landing-quality-runbook.md` now defines the required mobile browser proof.
- **Verification**:
  - 11/11 active Baekdu/Yanji `/packages/{id}` pages returned HTTP 200 in mobile Playwright verification.
  - Itinerary section rendered and required Baekdu/Yanji terms were present.
  - Forbidden Xi'an/Huashan and Bohol massage copy was absent.
  - Attraction photo coverage was 101/101.
  - `npx vitest run src/lib/itinerary-attraction-enricher.test.ts src/lib/product-registration/upload-route-boundary.test.ts --reporter=dot`
  - `npm run eval:product-registration:ci`
  - `npm run type-check`
  - `npm run build`
- **Status**: FIXED
- **Prevention**: Completion requires live/mobile render proof, not only DB/open gate success. Any customer-visible attraction enrichment change must update or satisfy `docs/product-mobile-landing-quality-runbook.md`. Post-save mobile QA high/critical incidents must block customer visibility instead of only writing logs or alerts.

---

## ERR-BAEKDU-cross-region-attraction-card@2026-06-10

- **Discovered**: 2026-06-10
- **Domain**: product registration | mobile landing | attractions
- **Source vs result**: A Baekdu/Yanji itinerary line containing `화산폭포` rendered a customer attraction card for Xi'an/Huashan `화산`; a massage service line could also attach a Bohol massage attraction card.
- **Root cause**: Attraction enrichment trusted existing `attraction_ids` and short substring matches too much. A two-syllable canonical name such as `화산` could match inside a different word such as `화산폭포`, and saved attraction IDs were not rechecked against the package destination/region before customer render.
- **Fix**: Short Korean substring matches now require term boundaries, no-space substring matching requires at least three characters, direct scan and alias matching are destination scoped, and existing `attraction_ids` are stripped when the attraction region does not fit the package destination. Baekdu transfer/massage lines are classified as transfer/perk, not attraction visits.
- **Verification rule**: Mobile/A4 readiness must fail on cross-region attraction cards. Regression fixtures must prove `화산폭포` does not match Xi'an `화산`, and service/perk lines such as massage do not produce attraction cards.
- **Status**: FIXED
- **Recurrence prevention**: Any future attraction card must be supported by a source phrase plus destination-compatible master data. If the region is ambiguous or mismatched, keep the phrase as itinerary text and send it to unmatched/review, never customer card render.

---

## ERR-itinerary-entity-attraction-card-contamination@2026-06-21

- **Discovered**: 2026-06-21
- **Domain**: product registration | mobile landing | itinerary semantics | attraction cards | learning engine
- **Source vs result**: Existing sample products showed rows such as `유리잔도,귀곡잔도,천문산사 $40`, `황룡동굴 VIP $40`, and `※현지지불옵션 : 백두산5D플라잉 체험 $40/인` carrying attraction references. These rows mention real places or experiences, but the customer meaning is paid optional-tour disclosure, not a normal included attraction card. Similar contamination can happen when meal rows (`꿔바로우`, `삼겹살`, `매운탕`), hotel/rest rows, shopping-center disclosure rows, or service rows (`전신+발마사지`, `온천욕`) retain `attraction_ids`.
- **Root cause**: The enrichment layer stripped many unsafe references before save, but the final customer landing/A4 gate mainly checked structural pollution. It did not independently fail when non-attraction schedule entities still had attraction references or when an `attraction_visit` kind contradicted the row text.
- **Fix**:
  - `findItineraryScheduleQualityIssues()` now fails customer render readiness when meal, hotel/rest, transfer, shopping, service, or paid optional-tour disclosure rows carry attraction references.
  - Paid optional-tour rows with price symbols are blocked even if they include real attraction names, because those belong in the optional-tour section with price text, not as included attraction cards.
  - New blocker codes are mapped to `ITINERARY_ENTITY_MISMATCH` so the review queue and macro learning loop can mine recurrence instead of treating the failure as unknown.
- **Verification**:
  - `npx vitest run src/lib/product-registration/deliverability-gate.test.ts src/lib/product-registration/failure-diagnostics.test.ts src/lib/itinerary-attraction-enricher.test.ts src/lib/itinerary-schedule-compiler.test.ts`
  - `npx vitest run src/lib/product-registration src/lib/product-registration-v3 src/lib/parser`
  - `npm run type-check`
  - Supabase targeted sample check: 80 issue-area products / 1,831 schedule rows / 656 attraction-referenced rows found 6 paid optional-tour contamination candidates; all are now covered by the new gate pattern.
- **Status**: FIXED IN ENGINE
- **Recurrence prevention**: Mobile landing completion requires semantic entity/card consistency, not just page render success. A row can mention a place and still be an option, meal, hotel, shopping, transfer, or service fact. The final gate must preserve that customer meaning before any attraction card or photo appears.

---

Last updated: 2026-06-21

상품 등록, A4, 모바일 렌더, 가격·날짜 복구, 일정 파싱, 관광지 매칭, `/register` 절차 반복 오류 상세.

## ERR-KWL-seed-fallback-and-stopwords@2026-05-15

> Source: `db/error-registry.md` active checklist before docs/errors split.

- **Discovered**: 2026-05-15
- **Domain**: 상품등록 / 관광지 매칭
- **Source vs result**: 계림/양삭 등록에서 자동 시드 14/15건이 실패했고, `"맛집"` 단독 시드가 생성됐으며, 17개 attraction이 미매칭으로 남았다. `"산수간쇼"`는 부적합 fuzzy match로 이어질 수 있었다.
- **Root cause**: V5 seeder의 최후 fallback이 부족했고, 단독 stop word와 fuzzy 길이 guard가 약해 관광지가 아닌 일반어 또는 짧은 토큰이 시드/매칭 후보로 남았다.
- **Fix**: V5 seeder에 최후 LLM 템플릿 fallback을 추가하고 `STANDALONE_STOP_WORDS`, fuzzy length guard, AutoMobileQA 매칭률 60% 미만 `admin_alerts`를 적용했다. 관련 수정은 PR #75, #76에 반영됐다.
- **Verification**: `src/lib/itinerary-attraction-candidates.test.ts` `[ERR-KWL]` 3건.
- **Status**: FIXED
- **Prevention**: 자동 시드는 일반어 단독 후보를 금지하고, 짧은 fuzzy 후보는 길이·의미 guard를 통과해야 한다. 관광지 매칭률이 낮으면 자동으로 운영 알림을 남긴다.

---

## ERR-PHU-itinerary-pollution@2026-06-07: Phu Quoc full upload DAY1 column fragments leaked into schedule

> Original source before 2026-06-07 split: `db/error-registry.md:1015`

- **Discovered**: 2026-06-07
- **Product**: `phu-quoc-full-upload`, ZE981 outbound table.
- **Source vs result**: source table has region, flight code, and time columns; registration result exposed standalone `푸꾸옥`, `ZE981`, `18:55`, and `22:25` as DAY1 schedule activities.
- **Category**: parsing | customer render | regression gate
- **Root cause**: itinerary fallback accepted day-table fragments as normal activities after extraction. The blocker existed in `itinerary-quality-gate`, but normalization did not prune the fragments before customer deliverability evaluation.
- **Fix**: `normalizeUploadItinerary()` now prunes schedule items classified by the quality gate before attraction enrichment and again before save. Deterministic price IR also wins over complete LLM tiers when it can build both `product_prices` and `price_dates`.
- **Verification**: `phu-quoc-full-upload` is customer deliverable in golden corpus; schedule activities no longer contain standalone `ZE981`, `18:55`, or `22:25`.
- **Status**: FIXED
- **Prevention**: New fixture assertions must check schedule pollution at registration level, not only after render.

---

## ERR-FUK-spot-weekday-title-itinerary@2026-06-07: Fukuoka spot price table and cash-receipt title leaked into itinerary/title

- **Discovered**: 2026-06-07
- **Product**: `PUS-ETC-FUK-03-0010`, Fukuoka/Yufuin golf, BX148/BX147, spot weekday price table.
- **Source vs result**: the source included a cash-receipt 안내 block and a weekday spot price table. The saved `travel_packages.title` kept `현금영수증 발급 안내 드립니다`, and DAY3 schedule contained price-table rows such as `스팟특가`, `6/8~7/16`, `월,화,수`, `1,999,-`, and hotel surcharge notices. Customer pages were not exposed because V3 draft status was blocked and the package stayed `pending/blocked`.
- **Root cause**: schedule pollution pruning covered flight/time/transport fragments and some price-table cells, but missed Fukuoka standalone region tokens (`유후인`, `도스`) and hotel price-table surcharge notices. Golden tests did not assert these final customer itinerary tokens.
- **Fix**: `itinerary-quality-gate` now classifies Fukuoka standalone region tokens and hotel date-specific surcharge notices as non-schedule pollution, and region-only tokens are pruned consistently. The golden Fukuoka fixture asserts that cash-receipt text, price-table headings, date ranges, weekday labels, shorthand prices, `유후인`, `도스`, and hotel date-surcharge notices do not survive into customer itinerary JSON.
- **Verification**: same live raw text re-run through `registerProductFromRaw()` returned clean title `후쿠오카 유후인 고원 골프`, 82 `product_prices`, 82 `price_dates`, zero duplicate activities, and zero forbidden mobile/A4 render tokens. `npx vitest run src/lib/product-registration/golden-corpus/golden-corpus.test.ts src/lib/product-registration/itinerary-normalization.test.ts src/lib/product-registration/deliverability-gate.test.ts`, `npm run eval:product-registration:ci`, broad product-registration vitest, `npm run type-check`, and public-only mobile readiness audit passed.
- **Status**: FIXED
- **Prevention**: A registration is not considered correct until `/packages`/LP/A4 render text is clean, not merely because DB insert succeeded or the admin confidence score is high. New supplier price-table formats must add a fixture or final customer-itinerary assertion.

---

## ERR-XIY-pkg-boundary-price-a4@2026-06-07: 서안/화산 BX 4개 PKG 원문이 2개 상품으로 붕괴되고 가격·A4 박수 표기가 깨진 문제

- **발견일**: 2026-06-07
- **발생 상품**: `[노팁/노옵션/노쇼핑] BX 서안/화산 품격 패키지 3박5일`, `[노팁/노옵션/노쇼핑] BX 서안/화산 품격 패키지 4박6일`, BX341/BX342
- **원문 vs 결과**: 원문에는 `PKG` 블록 4개가 있었지만 variant 라벨 2개가 더 강하게 잡혀 2개 상품으로만 분리됐다. 그 결과 앞 상품 일정까지 뒤 상품에 붙어 duplicate day/overflow가 발생했고, `출 발 일`/`판 매 가` 띄어쓰기 제목을 가격 파서가 못 읽어 `product_prices`/`price_dates`가 비었다. A4는 `duration - 1` 추론으로 3박5일을 4박5일처럼 표시할 수 있었고, `price_dates`가 있는데도 내부 tier label(`supplier_raw_departure_dates`)을 출발일로 보여줄 수 있었다.
- **카테고리**: 파싱 | 가격복구 | 렌더링 | 고객검수
- **근본 원인**:
  - catalog split과 V3 structure planner가 명시 `PKG` 시작점보다 variant 라벨/일정 헤더를 우선했다.
  - deterministic 가격·출발일 추출이 `출 발 일`, `판 매 가`, `7/1,8,29, 8/19(수)` 같은 compact 표기를 지원하지 못했다.
  - 표형 일정 parser가 중국 취소규정 부록 종료점을 모르고, A4 박수는 제목의 `N박M일`을 우선하지 않았다.
  - A4 print loader가 `travel_packages.price_dates`를 조회하지 않았고, section parser가 `선택관광`/`쇼핑센터`/`비고` 경계를 충분히 끊지 않아 포함/불포함/선택관광 표시가 오염될 수 있었다.
- **해결책**:
  - 즉시: parser와 V3 planner 모두 명시 `PKG` 경계를 최우선으로 사용.
  - 구조적: supplier raw deterministic facts에서 spaced heading/compact date list/next-line price를 복구하고, 일정 parser가 중국 취소규정 부록을 차단.
  - 구조적: 일정 meta의 `nights`는 제목의 `N박M일`을 우선해 A4/mobile 계약에 전달.
  - 구조적: A4 print loader가 `price_dates`를 직접 넘기고, 포함/불포함/선택관광 parser 종료 heading을 보강.
  - 회귀: `xian-huashan-bx-multiproduct.txt` golden corpus와 split/price/register/V3 planner 테스트 추가.
- **검증 규칙**: 해당 원문은 4개 상품으로 등록되어야 하며 premium 3박5일은 979,000원·출발일 4개·DAY 1~5, premium 4박6일은 1,049,000원·출발일 3개·DAY 1~6이어야 한다. `/packages/{id}`와 A4 모두 BX341/BX342 항공카드가 보여야 하고 취소규정 부록·일정 overflow가 없어야 한다.
- **상태**: FIXED
- **재발 방지**: 신규 카탈로그 장애는 variant 라벨 개수만 보지 말고 raw `PKG` 개수, `product_prices`, `price_dates`, A4 박수 라벨까지 함께 검증한다.

---


> Original source before 2026-06-07 split: `db/error-registry.md:31`

---

## ERR-itinerary-detail-flight-card-and-appendix@2026-06-07: DAY 상세 항공카드 누락 및 마지막 상품 부록 일정 유입

- **발견일**: 2026-06-07
- **발생 상품**: 죠시 골프 / 나리타노모리 골프 54H 3박4일, BX112/BX111
- **원문 vs 결과**: 원문 일정표에는 출국/귀국 항공 행이 있고 저녁 메뉴/취소규정은 일정 뒤 공유 부록이었으나, 고객 `/packages/{id}`에서는 DAY 상세 항공카드가 빠지거나 마지막 상품 DAY 4 schedule에 저녁 메뉴/취소규정이 붙을 수 있었다.
- **카테고리**: 렌더링 | 파싱 | 고객검수
- **근본 원인**:
  - 상단 `flightHeader` 중복 방지 로직이 DAY 상세 `type='flight'` item까지 숨겼다.
  - pasted catalog 마지막 상품의 day 범위가 다음 `PKG`까지만 끊겨, 뒤따르는 공유 부록을 마지막 day 본문으로 읽었다.
  - 고객 문장 품질 테스트가 없어 `라운딩 후`, `호텔 조식 후 체크아웃 후`, `셔틀탑승`, `출발 2시간 전 ...` 같은 원문 조각이 통과했다.
- **해결책**:
  - DAY 상세 항공카드는 유지하고, 출발/도착 pair 내부 중복만 제거한다.
  - `저녁 메뉴 안내`, `일본골프상품 취소규정`, `현금영수증` 등 공유 부록 시작점을 catalog itinerary 종료 지점으로 본다.
  - deterministic schedule 문장 보정과 fixture 테스트를 추가한다.
- **검증 규칙**: `/packages/{id}` 기준으로 DAY 1/마지막 DAY 항공카드가 각각 1개 보이고, `라운딩 후` 단독/반복 체크아웃/공유 부록 문구가 schedule에 없어야 한다.
- **상태**: FIXED
- **재발 방지**: 상단 항공 헤더와 DAY 상세 항공카드는 서로 다른 고객 맥락이다. 하나가 있다고 다른 하나를 숨기지 않는다.

---


> Original source before 2026-06-07 split: `db/error-registry.md:54`

---

## ERR-catalog-split-recovery@2026-06-06: PKG 다중 상품이 1개 처리 오류로 막히는 문제

- **발견일**: 2026-06-06
- **발생 상품**: 죠시 골프 / 나리타노모리 2색 골프 54H 3박4일, BX112/BX111, 저녁 메뉴 안내 부록 포함 원문
- **원문 vs 결과**: 원문에는 `PKG` 상품 블록 2개와 저녁 메뉴/취소규정 부록이 있었으나, 업로드 준비 단계에서 `multiProducts`가 비어 있으면 `CATALOG_SPLIT_REQUIRED` 422로 막히고 수동 분리 안내가 노출될 수 있었다.
- **카테고리**: 파싱 | 검증 | 프로세스
- **근본 원인**: parser가 일시적으로 1개 상품만 반환해도 저장 준비 단계가 원문 deterministic `PKG` 경계 복구를 재시도하지 않고 곧바로 split fallback 오류를 반환했다.
- **해결책**:
  - 즉시: `prepareUploadRegistrationProducts()`에서 `multiProducts`가 2개 미만이면 `recoverCatalogSplitFromRawText()`를 먼저 실행해 2개 이상 복구 가능한 경우 등록 러너에 넘긴다.
  - 구조적: `hasMultiProducts` 판단을 `Boolean(multiProducts)`가 아니라 실제 저장 대상 수 `productsToSave.length >= 2`로 판정한다.
  - 회귀: `src/lib/product-registration/golden-corpus/fixtures/joshi-golf-menu-multiproduct.txt` fixture와 preparation 테스트 추가.
- **검증 규칙**: 다중 상품 원문에서 parser가 1개로 축약되어도 저장 전 준비 단계가 원문 `PKG` 경계로 상품별 `sectionRawText`를 복구해야 한다. 복구 불가능할 때만 `CATALOG_SPLIT_REQUIRED`.
- **상태**: FIXED
- **재발 방지**: 신규 공급사 카탈로그 실패는 UI 안내/수동 분리로 우회하지 말고 `fixture -> split recovery -> preparation gate -> V3 product count` 순서로 고친다.


> Original source before 2026-06-07 split: `db/error-registry.md:74`

---

## ERR-catalog-table-itinerary-pollution@2026-06-06: 붙여넣기 일정표 열 값이 고객 페이지에 섞이는 문제

- **발견일**: 2026-06-06
- **발생 상품**: 죠시 골프 / 나리타노모리 2색 골프 54H 3박4일, BX112/BX111
- **원문 vs 결과**: 원문 일정표는 `일 자 / 지 역 / 교통편 / 시 간 / 주요 행사 일정 / 식 사` 표였지만 붙여넣기 과정에서 각 열 값이 줄 단위로 풀렸다. 기존 저장 결과는 `부산`, `나리타`, `치바`, `BX112`, `전용차량`, `07:50`, `10:00`, `중:클럽식`, `HOTEL: ...`, URL 등이 일정 본문 또는 고객 안내문으로 섞였다.
- **카테고리**: 파싱 | 렌더링 | 고객검수
- **근본 원인**:
  - supplier deterministic itinerary가 `제1일 + 제목 한 줄` 형식만 지원하고 표형 붙여넣기 일정을 인식하지 못했다.
  - LLM/normalizer가 만든 오염 일정이 있어도 원문 deterministic 일정으로 교체하지 않았다.
  - 포함사항/주의사항 추출이 일정표 시작점에서 끊기지 않아 안내문에 일정표 본문이 섞일 수 있었다.
  - 고객 검수 기준을 `/lp/{id}`로 오해하면 실제 고객 상세(`/packages/{id}`)의 렌더 중복을 놓친다.
- **해결책**:
  - 즉시: DB의 죠시/나리타노모리 `travel_packages`를 새 deterministic 일정/포함사항/주의사항으로 재계산해 반영.
  - 구조적 1: `buildSupplierRawDeterministicItinerary()`에 표형 일정 parser 추가. 지역/교통편/시간/식사/HOTEL/URL은 각각 regions/transport/flight/meals/hotel로 분리하고 schedule에는 실제 행사 문장만 남긴다.
  - 구조적 2: 등록 저장 시 LLM itinerary가 표 열 값 오염 또는 호텔/식사 누락 상태이고 원문 deterministic itinerary가 완전하면 원문 일정이 우선한다.
  - 구조적 3: 포함사항은 괄호 안 쉼표를 보존해 `식사(조식,중식)`을 쪼개지 않고, 비고/주의사항은 `일 자`/`PKG`/상품 섹션 시작에서 끊는다.
  - 구조적 4: `/packages/{id}` 상세는 정규 항공 헤더가 있으면 일정 리스트에서 `flight` 항목을 중복 렌더하지 않는다.
- **검증 규칙**: 고객 검수는 반드시 `/packages/{id}` 페이지 텍스트 기준으로 한다. `BX112`, `07:50`, `전용차량`, `도보`, `전 일`, `HOTEL:` 같은 표 열 값이 단독 일정 activity로 남으면 실패다.
- **상태**: FIXED
- **재발 방지**: 표형 카탈로그는 fixture를 먼저 추가하고, DB 저장값 + `/packages/{id}` 렌더 텍스트를 함께 대조한다. `/lp/{id}`는 디자인/랜딩 실험면일 수 있으므로 상품 등록 완료 검수 기준으로 삼지 않는다.

---


> Original source before 2026-06-07 split: `db/error-registry.md:89`

---

## ERR-shared-price-column-mix@2026-06-06: 공통 가격표 컬럼이 상품별 모바일랜딩에 섞이는 문제

- **발견일**: 2026-06-06
- **발생 상품**: 죠시 골프 / 나리타노모리 2색 골프 54H 3박4일, BX112/BX111
- **원문 vs 결과**: 원문 공통 가격표에는 `치바 죠시`와 `나리타노모리 2색` 두 컬럼이 있었다. 등록은 2개 상품으로 되었지만, 정규화/LLM 가격 tiers가 두 컬럼을 모두 담으면 각 상품의 `product_prices` 또는 `price_dates`에 다른 상품 가격이 섞일 수 있었다.
- **카테고리**: AI 파싱 | 데이터스키마 | 검증
- **근본 원인**: `recoverUploadPriceData()`가 완성된 `price_tiers`를 원문 deterministic 가격표보다 먼저 신뢰했다. 다중 컬럼 가격표에서는 LLM tiers가 "완성"으로 보여도 상품별 컬럼 선택 근거가 약하다.
- **해결책**:
  - 즉시: 원문에서 `hotel_column_matrix` 공통 가격표가 인식되면 상품 제목/숙소 기준 deterministic 컬럼 선택을 우선한다.
  - 구조적: `PKG` 원문 제목과 `sectionRawText`는 정규화 결과가 약해도 저장 준비 단계에서 원문 기준으로 복원한다.
  - 회귀: 죠시/나리타노모리 fixture로 `product_prices` 동일 날짜 행이 상품별 1개만 남는지 검사한다.
- **검증 규칙**: 죠시 상품 2026-06-18은 1,219,000원 1행, 나리타노모리 상품 2026-06-18은 1,279,000원 1행이어야 하며 서로 섞이면 실패다.
- **상태**: FIXED
- **재발 방지**: 모바일랜딩/A4 확인은 `price_dates`뿐 아니라 `product_prices` 동일 날짜 행까지 같이 본다.

---


> Original source before 2026-06-07 split: `db/error-registry.md:112`

---

## ERR-product-prices-customer-options@2026-06-05: product_prices/customer option readiness가 검증 밖에 있던 문제

- **발견일**: 2026-06-05
- **발생 상품**: 세부 호텔 옵션 가격표, 후쿠오카 골프 가격표, 공개 모바일/A4 readiness 감사 대상
- **원문 vs 결과**: 원문은 동일 날짜에 호텔/등급별 복수 가격 옵션이 있었으나, 과거 검증은 `price_dates` 최소가만 주로 확인해 고객 옵션 행 누락·고객가 누락을 늦게 발견할 수 있었음.
- **카테고리**: 데이터스키마 | 검증 | 렌더링 | 프로세스
- **근본 원인**: 문서와 감사 기준이 오래된 `price_tiers`/`price_dates` 중심 성공 정의에 머물러 있었고, `product_prices` 저장 실패가 warning으로 처리될 수 있었으며, 고객 화면이 쓰는 `adult_selling_price` 누락이 최종 blocker가 아니었음.
- **해결책**:
  - 즉시: `docs/product-registration-current-ssot.md`를 현재 SSOT로 지정.
  - 즉시: 성공 기준을 `product_prices.length > 0 + price_dates.length > 0 + adult_selling_price`로 격상.
  - 구조적: `product_prices` 저장 실패는 blocker/rollback.
  - 구조적: DB migration `20260605121000_product_prices_customer_selling_price_guard.sql`로 positive customer price row의 `adult_selling_price` 누락 방지.
  - 구조적: golden corpus expected에 product price row count와 same-date option prices 포함.
  - 구조적: `scripts/audit-product-mobile-landing-readiness.mjs` strict audit에 customer option mismatch와 price storage mismatch 포함.
- **검증 규칙**: `docs/product-registration-current-ssot.md` Required Verification.
- **상태**: FIXED
- **재발 방지**: 새 가격표 실패는 route 패치 금지. `fixture -> parser/IR or registration object -> recovery -> deliverability -> persistence/audit` 순서로만 처리.

---


> Original source before 2026-06-07 split: `db/error-registry.md:149`

---

### ERR-20260417-01: A4 포스터 요일 병합 환각 ("일-수")

- **발견일**: 2026-04-17
- **발생 상품**: 북해도 핵심알짜팩 2박3일 (투어폰)
- **원문 vs 결과**: 원문 일(0)+화(2) 요일 → 화면 "일-수" (연속 범위로 오표시)
- **카테고리**: 렌더링
- **근본 원인**: `groupForPoster()`의 sunToWed(0,1,2,3) 범위 내 2개 이상 요일 존재 시 무조건 "일-수" 라벨. 일(0)+화(2)만 있어도 "일-수"로 렌더링.
- **해결책**:
  - 구조적: `isConsecutive()` 헬퍼 추가 — 연속 요일이면 범위("일-화"), 불연속이면 열거("일,화")
- **검증 규칙**: 없음 (렌더링 로직)
- **상태**: FIXED (2026-04-17)
- **재발 방지**: `src/lib/price-dates.ts:194` `isConsecutive` 로직

---


> Original source before 2026-06-07 split: `db/error-registry.md:171`

---

### ERR-20260417-02: confirmed 플래그 하드코딩 false

- **발견일**: 2026-04-17
- **발생 상품**: 북해도 (투어폰)
- **원문 vs 결과**: 원문 "♥출확♥ 4/28" → DB `confirmed: false`
- **카테고리**: AI 파싱
- **근본 원인**: `tiersToDatePrices()`에서 `confirmed: false` 하드코딩. tier.note 정규식 매칭 없음.
- **해결책**:
  - 구조적: `tier.note`에 `/출확|출발확정/` 매칭 시 `confirmed: true` 설정
- **검증 규칙**: (향후 W 추가 검토)
- **상태**: FIXED (2026-04-17)
- **재발 방지**: `src/lib/price-dates.ts`, `db/templates/insert-template.js`의 `tiersToDatePrices()`

---


> Original source before 2026-06-07 split: `db/error-registry.md:186`

---

### ERR-20260417-03: 콤마 관광지 매칭 실패

- **발견일**: 2026-04-17
- **발생 상품**: 북해도 (투어폰)
- **원문 vs 결과**: "▶오타루운하, 키타이치가라스, 오르골당" → 첫 번째만 매칭, 나머지 미매칭
- **카테고리**: 매칭
- **근본 원인**: `matchAttraction()` 단일 활동만 처리. 콤마로 묶인 여러 관광지를 분리하지 않음.
- **해결책**:
  - 구조적 1: `splitScheduleItems()` — 등록 시 콤마 포함 activity를 개별 schedule item으로 분리
  - 구조적 2: `matchAttractions()` (복수형) 추가 — 렌더러에서도 콤마 분리 매칭
- **검증 규칙**: W12 (`splitScheduleItems` 필요성 경고)
- **상태**: FIXED (2026-04-17, 렌더러 전환은 P2c/P2d에서 진행)
- **재발 방지**: `db/templates/insert-template.js` `splitScheduleItems`, `src/lib/attraction-matcher.ts` `matchAttractions`

---


> Original source before 2026-06-07 split: `db/error-registry.md:201`

---

### ERR-20260417-04: 중복 감지 빈 배열 오판

- **발견일**: 2026-04-17
- **발생 상품**: 칭다오 쉐라톤 2박 3일 (투어폰)
- **원문 vs 결과**: 신규 상품(399,000원)이 기존 상품(269,000원)과 다른데도 SKIP 처리됨
- **카테고리**: 중복감지
- **근본 원인**:
  1. `isSamePrice()`가 `price_tiers: []` 빈 배열끼리 비교 시 `'' === ''` → true 오판
  2. `findDuplicate()`가 출발일 겹침을 확인하지 않아 다른 시즌 행사도 중복으로 처리
- **해결책**:
  - 구조적 1: `isSamePriceDates()` — price_dates 기반 비교 (date+price만, confirmed/note 무시)
  - 구조적 2: `findDuplicate()` 개선 — 출발일 집합 교집합 > 0일 때만 중복
  - 구조적 3: 로그에 겹치는 출발일 개수/목록 출력 (디버깅)
- **검증 규칙**: 없음 (중복감지 로직)
- **상태**: FIXED (2026-04-18)
- **재발 방지**: `db/templates/insert-template.js`, `db/assembler_xian.js`, `db/assembler_qingdao.js`의 `findDuplicate` + `isSamePriceDates`

---


> Original source before 2026-06-07 split: `db/error-registry.md:217`

---

### ERR-20260418-01: min_participants 10명 → 4명 조작

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이 단수이 3박 4일 — 투어폰)
- **원문 vs 결과**: 원문 "성인 10명 이상 출발 가능" → DB `min_participants: 4`
- **카테고리**: AI 파싱
- **근본 원인**: Sonnet Agent가 insert-template의 템플릿 기본값(4)을 원문 대신 사용. 원문 명시 값이 있어도 덮어씀.
- **해결책 (W3 2026-04-21 구조적 완료)**:
  - 즉시: DB UPDATE `min_participants = 10`
  - 구조적 1: `/register` 커맨드에 Zero-Hallucination 프로토콜 추가 — "숫자는 1:1 매핑, 템플릿 기본값 금지"
  - 구조적 2: `validatePackage` W13 추가 — 원문에서 "N명 이상" 추출 → min_participants 대조
  - 구조적 3 (W3): **CoVe E6** `extractClaims` 에 `min_participants` claim 자동 포함. Gemini가 원문 대조하여 근거 없으면 `audit_status='warnings'` 승격
  - 구조적 4 (W3): `llm-validate-retry.ts` 의 `callWithZodValidation` — Zod 검증 실패 시 피드백을 담아 재프롬프트 (LLM 자기수정 유도)
- **검증 규칙**: W13 + E6 (CoVe)
- **상태**: FIXED (2026-04-21, W3 Pivot C)
- **재발 방지**: W13 + Zero-Hallucination 체크리스트 + E6 CoVe claim 검증

---


> Original source before 2026-06-07 split: `db/error-registry.md:259`

---

### ERR-20260418-02: notices_parsed 육류 예시 축약

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 원문 "(라면스프, 소세지/햄, 육포, 소고기고추장볶음(튜브형 포함), 육류가 들어간 면 종류, 베이컨 등)" → DB "위반 시 벌금"으로 축약
- **카테고리**: AI 파싱
- **근본 원인**: Sonnet Agent가 "보기 좋게 정리"하려는 경향으로 구체 예시 5개를 한 단어로 압축. 대만은 라면스프 하나만 걸려도 수백만 원 벌금이 나오는 법적 리스크 직결.
- **해결책 (W3 2026-04-21 구조적 완료)**:
  - 즉시: DB UPDATE — notices_parsed[0].text에 원문 예시 복원
  - 구조적 1: `/register` 커맨드에 "예시 목록 축약 금지" 규칙
  - 구조적 2: `validatePackage` W14 — 원문 비고 길이 대비 notices_parsed 길이 비율 체크
  - 구조적 3 (W3): **E5 자동 트리거** — `notices_parsed.length >= 6` 시 AI cross-check 자동 ON. 축약/왜곡 발견 시 warnings 승격
  - 구조적 4 (W3): **E6 CoVe** — PAYMENT 타입 notices는 claim 검증 대상으로 포함 (원문 근거 확인)
- **검증 규칙**: W14 + E5 + E6
- **상태**: FIXED (2026-04-21, W3 Pivot C)
- **재발 방지**: W14 + Zero-Hallucination + E5 자동 AI 감사 + E6 CoVe

---


> Original source before 2026-06-07 split: `db/error-registry.md:278`

---

### ERR-20260418-03: A4 포스터 써차지 날짜 증발

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 원문 "청명절 4/3~6, 노동절 5/1~3, 단오절 6/19~21, 로타리 세계대회 6/10~20" → A4 포스터 "$10/인/박"만 표시, 기간 증발
- **카테고리**: 데이터스키마 + 렌더링
- **근본 원인**: DB에는 `pkg.surcharges` 객체 배열(start/end/name/amount)로 정상 저장됨. 그러나 A4 포스터는 `excludes` 문자열 배열에서 정규식으로 파싱 — 객체의 날짜 필드 사용 안 함 (이중 스키마).
- **해결책**:
  - 구조적: A4 포스터가 `pkg.surcharges` 객체 배열을 직접 사용 (P2a)
- **검증 규칙**: W15 (surcharges 기간 누락 의심)
- **상태**: IN_PROGRESS (P2a + P3)
- **재발 방지**: Single Source of Truth (surcharges 객체 직접 사용)

---


> Original source before 2026-06-07 split: `db/error-registry.md:297`

---

### ERR-20260418-04: A4 포스터 전신마사지 $50 가격 누락

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 원문 "전신마사지(1시간) $50/인" → A4 포스터에서 가격 미표시 (명칭만 나옴)
- **카테고리**: 데이터스키마
- **근본 원인**: DB에 `optional_tours[].price: "$50/인"` 문자열로 저장됨. A4 포스터는 `tour.price_usd: number` 숫자 필드 기대 — 필드명 불일치로 렌더링 누락.
- **해결책**:
  - 구조적: `optional_tours` 필드 통일 (문자열 `price` 또는 숫자 `price_usd` 중 하나로 표준화) — P2b
- **검증 규칙**: (향후 W 추가 검토)
- **상태**: IN_PROGRESS (P2b)
- **재발 방지**: 필드 스키마 통일

---


> Original source before 2026-06-07 split: `db/error-registry.md:312`

---

### ERR-20260418-06: 요일 강제 병합 환각 재발 ("일-수 2,9,10,...")

- **발견일**: 2026-04-18 (2차 검증)
- **발생 상품**: TP-TPE-04-01 (타이베이) — A4 포스터 6월 요금표
- **원문 vs 결과**: 6월 729,000원에 화(5건)+수(3건)+일(1건)+월(1건)이 있는데 "일-수 2, 9, 10, 16, 17, 23, 24, 28, 29, 30"으로 싹 묶임
- **카테고리**: 렌더링
- **근본 원인**: `groupForPoster()`의 `sunToWed = [0,1,2,3]` 자동 병합 로직이 남아 있었음. ERR-20260417-01의 `isConsecutive` 분기 수정은 병합 전략 자체를 제거하지 않음. 학술적으로 **Set Partitioning 위반** (서로 다른 속성을 같은 행에 두면 정보 손실).
- **해결책**:
  - 구조적: `sunToWed` 블록 **완전 삭제** — "1 요일 + 1 가격 = 1 행" Strict Grouping 적용
  - 결과 예시: "화 2,9,16,23,30" / "수 10,17,24" / "일 28" / "월 29" (개별 행)
- **검증 규칙**: 없음 (렌더링 로직)
- **상태**: FIXED (2026-04-18, `src/lib/price-dates.ts` 180~210행 교체)
- **재발 방지**: 요일 범위 라벨("일-수", "화-수") 생성 코드 없음. 각 요일은 반드시 개별 행.

---


> Original source before 2026-06-07 split: `db/error-registry.md:327`

---

### ERR-20260418-07: A4 포스터 일정 하단 잘림 (4일차 16:40 이후 증발)

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 4일차 "타이페이 공항 출발 16:40" 이후 "부산 도착 19:55" / 써차지 상세 / 육류 반입 안내 전체 증발
- **카테고리**: 렌더링
- **근본 원인**: `YeosonamA4Template.tsx`의 `estimateDayHeight()` 함수가 활동 높이를 `28px/활동`으로 과소 추정. 실제로는 관광지 매칭 시 short_desc/배지가 추가되어 40~45px/활동. + `PAGE_STYLE: { overflow: 'hidden' }` 조합으로 페이지 경계 초과 시 침묵 잘림.
- **해결책**:
  - 구조적: `actH = activities * 42` (보수적 실측), `routeH: 40`, `flightBarH: 50`, `hotelMealH: 45`
  - `PAGE_CONTENT_HEIGHT: 980 → 950` 안전 마진 확보
- **검증 규칙**: (향후 시각 검증 툴 추가 검토)
- **상태**: FIXED (2026-04-18, `src/components/admin/YeosonamA4Template.tsx` 197~207행)
- **재발 방지**: 보수적 높이 추정 + 페이지 분배 여유 공간

---


> Original source before 2026-06-07 split: `db/error-registry.md:343`

---

### ERR-20260418-08: OptionalTours Page 1 + 마지막 페이지 중복 렌더링

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 선택관광 3개 블록이 **Page 1과 마지막 페이지 두 곳**에 중복 노출 (하단 잘림과 겹쳐 한 번만 보이는 것처럼 보였음)
- **카테고리**: 렌더링
- **근본 원인**: `YeosonamA4Template.tsx` 279행(Page 1) + 325행(마지막 페이지)에 동일 `<OptionalTours />` 호출. 초기 설계에서 조건부 분기 누락.
- **해결책**:
  - 구조적: 마지막 페이지 호출 제거. Page 1에만 표시 (고객이 가장 먼저 보는 자리).
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 각 섹션은 단일 위치에서만 렌더링

---


> Original source before 2026-06-07 split: `db/error-registry.md:359`

---

### ERR-20260418-10: PACKAGE_LIST_FIELDS에 surcharges 누락 (써차지 기간 증발 근본 원인)

- **발견일**: 2026-04-18 (3차 검증, 사용자 스크린샷)
- **발생 상품**: TP-TPE-04-01 (타이베이) A4 포스터
- **원문 vs 결과**: 원문 "청명절 4/3~6, 노동절 5/1~3, 단오절 6/19~21, 로타리 6/10~20" / DB 정상 / A4 포스터에는 "• 써차지 ($10/인/박)" 껍데기만
- **카테고리**: 데이터스키마 + API
- **근본 원인**: `src/app/api/packages/route.ts`의 `PACKAGE_LIST_FIELDS` SELECT 문자열에 `surcharges` 필드가 **빠져 있었음**. DB 객체 배열이 있어도 API 응답에 포함되지 않아 `pkg.surcharges = undefined` → IncludeExcludeInfo가 `excludes` 문자열 fallback 사용 → "껍데기" 표시.
- **해결책**:
  - 구조적: `PACKAGE_LIST_FIELDS`에 `surcharges`, `country`, `nights`, `accommodations` 추가
- **검증 규칙**: (향후 API 응답 검증 레이어 검토)
- **상태**: FIXED (2026-04-18, `src/app/api/packages/route.ts:98~109`)
- **재발 방지**: DB 컬럼 추가 시 PACKAGE_LIST_FIELDS 동기화 원칙. 신규 필드는 반드시 API 노출.

---


> Original source before 2026-06-07 split: `db/error-registry.md:373`

---

### ERR-20260418-34: 🚨 신규 지역 어셈블러 자동 생성 누락 (register.md 경로 B 무시)

- **발견일**: 2026-04-18 (사용자 지적)
- **발생 상품**: 타이베이(TP-TPE-04-01), 쿠알라룸푸르(TP-KUL-05-01, TP-KUL-06-01)
- **증상**: 신규 지역 상품을 등록하고도 **지역 전용 어셈블러(`db/assembler_XXX.js`)를 생성하지 않음**
- **register.md 명시 지시**: "경로 B-2. 어셈블러 자동 생성 (다음부터 사용)"
- **내가 한 일**: Agent 프롬프트에 "어셈블러는 생성하지 않음 (생략 가능)" 임의 지시 → 프로세스 우회
- **근본 원인**: ERR-33과 동일 유형 — **기존 프로세스 지시 사항을 "이건 생략해도 되겠지"라고 추측 우회**
- **영향**:
  - 다음에 같은 지역 상품 등록 시 어셈블러 없어서 또 경로 B (insert-template) 사용 → 비효율
  - 지역별 BLOCKS/TEMPLATES 패턴이 축적되지 않음 → 품질 일관성 저하
  - 상품 2번째부터 자동 조립 불가
- **해결책 (확정)**:
  - **N=3 자동 트리거 규칙 도입**: 해당 지역 상품이 3개 이상 쌓였을 때만 어셈블러 자동 생성
  - 이유: 1~2개 상품만으로는 공통 블록 vs 차별 블록 구분 불가 → 과도한 엔지니어링
  - register.md Step 3-1에 COUNT 쿼리 기반 분기 추가
  - 타이베이(1개)·쿠알라(2개)는 현재 임계값 미달 → 다음 상품 등록 시 자동 생성
- **재발 방지**:
  - [ ] Step 3-0: 어셈블러 존재 여부 확인
  - [ ] Step 3-1: 없으면 COUNT 쿼리로 상품 수 확인
  - [ ] 상품 수 ≥ 3이면 B-1 + B-2, 미만이면 B-1만
  - [ ] "생략 가능" 임의 판단 금지
- **상태**: FIXED (2026-04-18, register.md Step 3 업데이트 + N=3 트리거 규칙)

---


> Original source before 2026-06-07 split: `db/error-registry.md:388`

---

### ERR-20260418-33: 🚨 기존 프로세스 무시하고 임의 구현 (메타 규칙 위반)

- **발견일**: 2026-04-18 (쿠알라룸푸르 상품 등록 중 사용자 지적)
- **발생 영역**: 관광지(attractions) 관리 파이프라인
- **증상**: Agent가 `db/seed_kul_attractions.js` 같은 **임시 시드 스크립트를 자동 생성**해서 18개 관광지를 마음대로 INSERT
- **기존 프로세스 (이미 완성되어 있던 것)**:
  1. `/admin/attractions` — 관광지 CRUD + CSV 업로드/다운로드 + Pexels 자동 수집
  2. `/admin/attractions/unmatched` — 미매칭 관광지 수동 처리 (별칭 연결, DB 추가, CSV export)
  3. `/api/attractions` — 완전한 API (GET/POST/PATCH/PUT/DELETE)
  4. `register.md` Step 5: "없으면 **시드 필요 플래그**" (플래그만, 자동 생성 아님)
- **근본 원인**:
  - **CLAUDE.md의 Zero-Hallucination Policy 직접 위반**
  - Agent가 작업 전 `src/app/admin/attractions/`, `/api/attractions` 등 **기존 구현을 탐색하지 않음**
  - "이렇게 하면 되겠지" 추측으로 신규 스크립트 생성
  - 세션 중 **"엑셀 업로드 기능 구현해드릴게요"** 제안도 같은 위반 (이미 있음)
- **피해**:
  - 18개 관광지가 AI 환각 설명(짧고 부정확)으로 시드됨
  - "마담투소 싱가포르", "포트캐닝 공원" 등 오매칭 유발 관광지 대량 생성
  - 이후 4회에 걸쳐 삭제 + STOP_WORDS 추가로 땜질
- **해결책**:
  - 구조적 1: `.claude/commands/manage-attractions.md` **신규 생성** (관광지 작업의 유일한 진입점)
  - 구조적 2: `register.md` Step 0에 "관광지 자동 시드 금지" 명시
  - 구조적 3: Agent 프롬프트에 "관광지 관련 작업 전 `manage-attractions.md` 필수 Read" 규칙
- **재발 방지 체크리스트**:
  - [ ] 관광지 관련 작업 시작 전 `manage-attractions.md`를 Read했는가?
  - [ ] 새 스크립트/코드 만들기 전 기존 `/admin/attractions` 및 `/api/attractions`를 확인했는가?
  - [ ] AI로 short_desc/long_desc 자동 생성해서 INSERT하려 하는가? → 중단, 사용자 CSV 편집으로 남겨둘 것
  - [ ] "이 기능 제가 구현해드릴게요" 말하기 전 Glob/Grep으로 기존 코드 확인했는가?
- **상태**: FIXED (2026-04-18, `.claude/commands/manage-attractions.md` + register.md Step 0)
- **영구 방지**: Zero-Hallucination Policy 적용 + 메타 규칙 "기존 프로세스 탐색 후 구현"

---


> Original source before 2026-06-07 split: `db/error-registry.md:414`

---

### ERR-20260418-14: 가이드경비 $40 증발 (surcharges 병합 로직 부재)

- **발견일**: 2026-04-18 (4차 검증, 사용자 A4 포스터 확인)
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: excludes에 "기사/가이드경비 $40/인 (현지지불)" 정상 저장 / A4 포스터 추가요금 섹션에 **증발**
- **카테고리**: 렌더링 + 병합 로직
- **근본 원인**: `IncludeExcludeInfo`에서 `surcharges` 객체 배열이 있으면 `excludes`에서 추출한 문자열을 **완전히 무시**. "써차지 4건"만 표시되고 "가이드경비 $40"은 사라짐.
  - **수익 누수 리스크**: 고객이 "안내 못 받음"며 현지 가이드경비 지불 거부
- **해결책**:
  - 구조적: 객체 배열 + excludes 문자열을 **병합**. 단, 객체 배열에 이미 있는 일반 "써차지" 단순 문구만 중복 제거. 가이드경비/싱글차지 등 구체적 항목은 유지.
- **상태**: FIXED (2026-04-18, `YeosonamA4Template.tsx` IncludeExcludeInfo)
- **재발 방지**: 데이터 병합 시 "Subset 삭제"가 아닌 "Union" 원칙

---


> Original source before 2026-06-07 split: `db/error-registry.md:447`

---

### ERR-20260418-15: 요금표 페이지 낭비 (4개월 상품이 4페이지로 분산)

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (4개월, 31행)
- **원문 vs 결과**: Page 1 요금표 6행 고정 → 타이베이 4달치가 **4개 페이지**로 분산. Page 1 하단 빈 공간 낭비 + 추가 페이지 헤더 반복 스팸.
- **카테고리**: 렌더링 + 알고리즘
- **근본 원인**: Gemini 기여 임계값(6/16)이 과도하게 보수적. 핵심특전+선택관광이 차지하는 공간을 과대평가. 실제로 Page 1 main 영역은 18행까지 안전 수용 가능.
- **해결책**:
  - 구조적: `PRICE_ROWS_PAGE1: 6 → 18`, `PRICE_ROWS_OTHER: 16 → 24`
  - 타이베이 재분배 결과: Page 1(4+5월=18행) + Page 2(6+7월=17행) = **2페이지**
  - "(계속)" 라벨 제거 — 월 헤더가 자동 분리 역할
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 페이지 용량 실측 확인 필요 시 A4 고정 높이(1131px) 기준으로 재튜닝

---


> Original source before 2026-06-07 split: `db/error-registry.md:462`

---

### ERR-20260418-16: 월 헤더 단일 월 청크에서 미표시

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 추가 요금표 페이지
- **원문 vs 결과**: Page 2가 "5월 전용"일 때 월 헤더 없이 날짜만 나와 몇 월인지 불명
- **카테고리**: 렌더링
- **근본 원인**: `PriceTable`이 `monthGroups.length > 1`일 때만 월 헤더 렌더. 청크 필터 후 단일 월이면 헤더 사라짐.
- **해결책**:
  - 구조적: 월 헤더 항상 표시 (단일/다중 무관)
- **상태**: FIXED (2026-04-18, `PriceTable` price_dates + tiers 모드)

---


> Original source before 2026-06-07 split: `db/error-registry.md:478`

---

### ERR-20260418-17: 항공 배지 괄호 중복 "BX793(BX(에어부산))"

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 일정 페이지 헤더
- **원문 vs 결과**: `pkg.airline = "BX(에어부산)"` → 헤더 "BX793(BX(에어부산)) 부산 → BX793 부산(김해) 출발 → 타이페이"
- **카테고리**: 렌더링 + 정규식
- **근본 원인**: 
  1. `getAirlineName`이 "BX(에어부산)" 같이 괄호 있는 값을 코드로 parse 못해 null 반환 → fallback으로 airline 원본 노출
  2. `arrivalCityName` 추출 정규식 `^(.+?)\s*(국제)?공항?\s*(도착|입국)`가 greedy하게 전체 문자열 매칭 → "BX793 부산(김해) 출발 → 타이페이"가 arrivalCity로 설정
- **해결책**:
  - `getAirlineName`: 괄호/공백/파이프로 split, 맨 앞 단어만 코드로 처리. 괄호 안 한글은 fallback.
  - `arrivalCityName`: "→ X 도착" 패턴 우선, fallback으로 단어 경계 제한
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 정규식은 항상 non-greedy + 단어 경계 명시. 필드 포맷 다양성 고려.

---


> Original source before 2026-06-07 split: `db/error-registry.md:491`

---

### ERR-20260418-13: A4 포스터 항공 표기 장황함

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이) 일정 페이지 헤더
- **원문 vs 결과**: "✈️ BX(에어부산) | 부산출발 ↔ BX793 부산(김해) 출발 → 타이페이" (장황)
- **카테고리**: 렌더링
- **근본 원인**: `ItineraryPageHeader` 컴포넌트가 airline/depCity/directCity만 나열. 항공편 번호(flight_out) 미활용.
- **해결책**:
  - 구조적: `flightOut` prop 추가. 표기: `"BX793(에어부산) 부산 → 타이페이"`
- **상태**: FIXED (2026-04-18, `src/components/admin/YeosonamA4Template.tsx:1306,1326`)
- **재발 방지**: 간결한 항공 헤더 표기 원칙

---


> Original source before 2026-06-07 split: `db/error-registry.md:508`

---

### ERR-20260418-12: 요금표 적응형 청크 분할 (Universal 알고리즘)

- **발견일**: 2026-04-18 (4차 검증)
- **발생 상품**: TP-TPE-04-01 (31행) — 별도 페이지로 옮겼으나 그 페이지에서도 4월 779원/799원+7월 잘림 재발
- **카테고리**: 렌더링 + 알고리즘
- **근본 원인**: 이전 ERR-20260418-11 해결책("요금표 전용 페이지")이 임계값(15행) 단일 분기로 **한 페이지에 모든 행 몰아넣기** 시도 → 또 초과. "어떤 크기 상품이든" 대응하는 알고리즘 부재.
- **해결책 (3단 방어)**:
  1. **Page 1 예산(12행)** + **이후 페이지 예산(22행)**로 적응형 청크 분할
  2. 월 그룹 단위로 누적, 예산 초과 시 새 청크 시작
  3. 극단 케이스(단일 월 > 22행)에서는 해당 월을 **가격 그룹별로 재분할** (fallback)
- **결과**: 짧은 상품(5-10행) → Page 1 내 완성. 중간 상품(20-30행) → Page 1 + 추가 페이지. 초대형 상품(50+행, "매일 출발") → 가격별 쪼개기로 안전.
- **상태**: FIXED (2026-04-18, `src/components/admin/YeosonamA4Template.tsx:260~320`)
- **재발 방지**: 데이터 크기 독립적 렌더링. 시각 테스트 시 극단 케이스 (1개월 30행+ 상품) 검증 필수.

---


> Original source before 2026-06-07 split: `db/error-registry.md:522`

---

### ERR-20260418-11: A4 포스터 Page 1 요금표 공간 초과로 일부 잘림

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이) — 요금표 31행 (4/5/6/7월)
- **원문 vs 결과**: 4월 "수 22,29 / 화 28" 이후 중단. 4월 779원(토 25), 4월 799원(목 23), 7월 전체 증발
- **카테고리**: 렌더링 + 페이지 레이아웃
- **근본 원인**: A4 Page 1에 핵심특전+요금표+선택관광을 모두 넣음. 요금표가 15행을 넘으면 Page 1 크기(1131px) 초과 → `PAGE_STYLE.overflow: hidden`에 의해 하단 잘림.
- **해결책**:
  - 구조적: 요금표 행 수가 15 초과면 **별도 전용 페이지**에 요금표 렌더링. Page 1에는 핵심특전+선택관광만.
  - 구현: `usePriceTableOwnPage = priceRowCount > 15` 플래그 + 조건부 `<article>` 추가
- **검증 규칙**: 없음 (렌더링 계산 기반)
- **상태**: FIXED (2026-04-18, `src/components/admin/YeosonamA4Template.tsx:260, 286~316`)
- **재발 방지**: 요금표 길이 동적 분배. 향후 35+ 행이면 추가 페이지 분할 필요.

---


> Original source before 2026-06-07 split: `db/error-registry.md:538`

---

### ERR-20260418-09: optional_tours 타입 스키마 불일치 (price vs price_usd)

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: DB `price: "$35/인"` 문자열 저장 / `YeosonamA4Props`는 `price_usd: number`만 허용 / `OptionalTours` 컴포넌트는 `price` 문자열도 지원. 타입 간 불일치로 렌더링 불확실성.
- **카테고리**: 데이터스키마
- **근본 원인**: `optional_tours` 필드 스키마가 3곳(Props 타입 / TravelItinerary 타입 / 렌더 컴포넌트)에서 제각각.
- **해결책**:
  - 구조적: `YeosonamA4Props.optional_tours` 타입을 `{ name, price?: string, price_usd?: number, price_krw?: number | null, note?: string | null }`로 통일.
- **상태**: FIXED (2026-04-18, YeosonamA4Template.tsx 101행)
- **재발 방지**: Props/TravelItinerary/Component 타입 일치

---


> Original source before 2026-06-07 split: `db/error-registry.md:554`

---

### ERR-20260418-05: 타이베이 관광지 매칭 100% 실패

- **발견일**: 2026-04-18
- **발생 상품**: TP-TPE-04-01 (타이베이)
- **원문 vs 결과**: 일정 13개 관광지 (국립고궁박물관, 야류, 지우펀, 스펀, 진리대학, 홍마오청, 단수이, 화산1914, 서문정거리, 중정기념당, 사림관저 등) → A4/모바일 매칭 0/13
- **카테고리**: 매칭 + 마스터데이터
- **근본 원인**: `attractions` 테이블에 타이베이/대만 관광지 **0건**. 매칭 함수가 아무리 정교해도 DB에 데이터가 없으면 매칭 불가.
- **해결책**:
  - 즉시: 타이베이 관광지 13개를 `attractions` 테이블에 시드 + Pexels 사진 수집
  - 구조적: 신규 지역 등록 시 미등록 관광지 감지 → 자동 시드 파이프라인 (P5)
- **검증 규칙**: (향후 W 추가 검토)
- **상태**: IN_PROGRESS (P5)
- **재발 방지**: 자동 시드 파이프라인 + `matchAttractions` (복수형) 사용 (P2c/P2d)

---


> Original source before 2026-06-07 split: `db/error-registry.md:568`

---

### ERR-KUL-01: A4 포스터 `출발: ["금"]` JSON 배열 문자열 노출

- **발견일**: 2026-04-18
- **발생 상품**: 쿠알라룸푸르 4박6일 (TP-KUL-06-01)
- **원문 vs 결과**: 원문 "(금)" / DB `departure_days: '["금"]'` → A4 배지 `"출발: ["금"]"` JSON 배열 그대로 노출
- **카테고리**: 렌더링 + 데이터스키마
- **근본 원인**: `departure_days` 가 JSON 배열 문자열로 저장됨. A4 템플릿이 문자열을 그대로 렌더 → 고객 신뢰도 저하.
- **해결책**:
  - 구조적 1: `src/lib/admin-utils.ts` `formatDepartureDays()` 헬퍼 — JSON 배열 / 배열 / 평문 모두 슬래시 구분 평문으로 정규화
  - 구조적 2: `src/lib/parser.ts` 양쪽 return 사이트에서 저장 시점에 `formatDepartureDays` 호출 → DB 평문 저장
  - 구조적 3: `YeosonamA4Template.tsx` 배지 렌더에 `formatDepartureDays` 적용 (레거시 데이터 방어)
- **검증 규칙**: W16 (JSON 배열 포맷 감지)
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 저장/렌더 2단 방어 + W16 validator 경고

---


> Original source before 2026-06-07 split: `db/error-registry.md:584`

---

### ERR-KUL-02: 4박6일 DAY 4 "메르데카 광장" 오삽입 (교차 오염)

- **발견일**: 2026-04-18
- **발생 상품**: 쿠알라룸푸르 4박6일 (TP-KUL-06-01)
- **원문 vs 결과**: 원문 4박6일 4일차 "왕궁/국립이슬람사원/KLCC" 3개 / A4·모바일 "왕궁/국립이슬람사원/**메르데카 광장**/KLCC" 4개 (원문에 없는 랜드마크 삽입)
- **카테고리**: AI 파싱 (DAY 교차 오염)
- **근본 원인**: 같은 원문에 3박5일과 4박6일이 공존. AI가 3박5일 4일차의 "메르데카 광장"을 4박6일 4일차에 **복사**. "공통으로 있을 법한" 관광지 임의 추가 패턴.
- **해결책**:
  - 즉시: DB UPDATE — `itinerary_data.days[3].schedule` 에서 "메르데카 광장" 항목 제거
  - 구조적 1: `register.md` "§6. DAY 교차 오염 방지" 섹션 추가 — 원문 대조 필수 규칙
  - 구조적 2: W18 validator — 원문에 없는 랜드마크가 schedule에 있으면 경고 (whitelist 기반)
- **검증 규칙**: W18 (랜드마크 원문 부재 감지)
- **상태**: FIXED (2026-04-18, register.md + W18)
- **재발 방지**: 상품별 독립 파싱 컨텍스트 원칙 + 랜드마크 whitelist

---


> Original source before 2026-06-07 split: `db/error-registry.md:601`

---

### ERR-KUL-03: 4박6일 DAY 1 "쿠알라 야경투어" 오삽입 (교차 오염)

- **발견일**: 2026-04-18
- **발생 상품**: 쿠알라룸푸르 4박6일 (TP-KUL-06-01)
- **원문 vs 결과**: 원문 4박6일 1일차에는 추천선택관광 없음 / A4 "추천선택관광: 쿠알라 야경투어 $50/인" 삽입
- **카테고리**: AI 파싱 (DAY 교차 오염, ERR-KUL-02와 동일 패턴)
- **근본 원인**: 원문 3박5일 1일차에만 있는 야경투어 추천을 4박6일 1일차에 복사.
- **해결책**: ERR-KUL-02와 동일 구조적 방어 (register.md §6 + W18)
- **검증 규칙**: W18
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 동일

---


> Original source before 2026-06-07 split: `db/error-registry.md:618`

---

### ERR-KUL-04: optional_tours "(싱가포르)" 지역 라벨 A4/모바일 불일치

- **발견일**: 2026-04-18
- **발생 상품**: 쿠알라룸푸르 3박5일 (TP-KUL-05-01)
- **원문 vs 결과**: 원문 `[싱가포르 선택관광]` 섹션에 "2층버스 US$45/인" / A4 "2층버스 ($45/인)" (지역 라벨 없음) / 모바일 "2층버스" (지역 라벨 없음) — 고객이 말레이시아 2층버스와 혼동 가능
- **카테고리**: 파싱 + 렌더링 (계약 분리)
- **근본 원인**:
  1. `optional_tours` 스키마에 `region` 필드 없음 → AI가 섹션 헤더 정보 유실
  2. A4와 모바일이 각자 이름만 렌더 → 라벨 일관성 부재
- **해결책**:
  - 구조적 1: `OptionalTour` 타입에 `region?: string | null` 필드 추가 (`src/lib/parser.ts`)
  - 구조적 2: AI 프롬프트에 "[X 선택관광]" 섹션 헤더 → region 주입 규칙 명시
  - 구조적 3: `src/lib/itinerary-render.ts` 신규 — `normalizeOptionalTourName()` 공통 헬퍼 (region + 괄호 추론 포함)
  - 구조적 4: A4 `OptionalTours` + 모바일 선택관광 렌더 둘 다 공통 헬퍼 사용
  - 구조적 5: 저장 시점 `enrichOptionalToursRegion()` — AI가 region 누락해도 이름에서 자동 추론
- **검증 규칙**: W17 (모호 이름 + region 누락)
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 스키마 + 프롬프트 + 정규화 + 공통 헬퍼 4단 방어

---


> Original source before 2026-06-07 split: `db/error-registry.md:632`

---

### ERR-KUL-safe-replace: 중복 감지 시 자동 아카이브의 사일런트 사고 위험

- **발견일**: 2026-04-18 (Gemini 아키텍처 리뷰)
- **증상**: 기존 findDuplicate 로직은 가격/기한 변경 감지 시 기존 상품을 **무조건** archived + 신규 insert. AI가 필드를 대량 누락한 상태로 재등록되면 정상 라이브 상품이 죽고 불량 상품이 노출됨.
- **카테고리**: 아키텍처 + 안전장치
- **근본 원인**: Zod는 shape만 검증(숫자가 숫자?), content 퇴화(필드 누락) 감지 불가. audit_render_vs_source는 INSERT 후 실행 → 이미 늦음.
- **해결책**:
  - 구조적 1: `calcCompletenessScore(pkg)` 함수 도입 — 0~100점 (title/destination/duration/price/일정/포함/불포함/옵션/유의사항 가중치 합)
  - 구조적 2: 중복 감지 시 `degradationPct = ((dupScore - newScore) / dupScore) * 100` 계산
  - 구조적 3: `degradationPct > 20%` 이면 기존 **라이브 유지** + 신규는 `status='pending_replace'` 보류
  - 구조적 4: 새 status `pending_replace` 스키마(Zod + audit CLI)에 추가
- **검증 규칙**: 없음 (런타임 조건부 분기)
- **상태**: FIXED (2026-04-18, `db/templates/insert-template.js` `calcCompletenessScore` + 조건부 toArchive)
- **재발 방지**: 완전성 20%+ 하락 시 자동 교체 차단. 어드민에서 pending_replace 검수 후 수동 승인 필요.

---


> Original source before 2026-06-07 split: `db/error-registry.md:674`

---

### ERR-FUK-customer-leaks: 내부 메모 고객 화면 노출 + 숫자 콤마 split + 항공편 파싱 실패 (복합 4건)

- **발견일**: 2026-04-18 (FUK 골프 2건 등록 후 사장님 대조)
- **증상**:
  1. A4 "🛍️ 쇼핑센터" 섹션에 `[랜드사 커미션] ... commission_rate=0 저장은 스키마 제약 *...` 전체 노출 — **심각한 고객 신뢰 손실**
  2. A4 "불포함 사항"에 "본관 숙박 시 2,000엔" → "본관 숙박 시 2|000엔" (콤마 split)
  3. A4 "추가 요금 안내"에 surcharge 중복 6개 (객체 + excludes 문자열)
  4. 모바일 가는편 도착 시간 "—" / 오는편 출발지 "BX143 후쿠오카" (flight code 혼입)
- **카테고리**: 렌더링 + 데이터/코드 복합
- **근본 원인**:
  1. A4 템플릿이 `special_notes`를 `shoppingInfo` 폴백으로 사용. 내부 메모를 special_notes에 저장한 것이 잘못된 선택.
  2. `flattenItems()` 가 모든 top-level 콤마를 항목 구분자로 사용. "2,000엔"의 숫자 콤마까지 분리.
  3. surcharges 객체 배열이 있어도 excludes의 중복 문자열을 별도 표시.
  4. `parseCityFromActivity` 가 flight code prefix("BX143")를 도시명에 포함. `parseArrivalTime` 정규식이 "도착 HH:MM"만 처리하고 "HH:MM 도착" 못 잡음.
- **해결책**:
  - 즉시: DB 3건 수정 (special_notes=null / highlights.shopping 명시 / excludes surcharge 중복 제거)
  - 구조적 1: `YeosonamA4Template.tsx` `flattenItems()` 숫자 콤마 보호 — prev `\d` + next `\d{3}` 이면 split skip
  - 구조적 2: `DetailClient.tsx` `parseCityFromActivity` flight code prefix 사전 제거, `parseFlightActivity` 로 히어로 섹션 통합
  - 구조적 3: `parseArrivalTime` 정규식 "HH:MM 도착" 양방향 지원
  - (향후): A4 템플릿의 special_notes → shopping 폴백 제거. `itinerary_data.highlights.shopping` 만 사용.
- **상태**: FIXED (2026-04-18)
- **재발 방지**:
  - Insert 시 **운영 메모는 절대 special_notes에 저장 금지** — 해당 용도 컬럼 없음. 별도 DB 메모/주석 시스템 필요 시 신규 필드.
  - 숫자 형식(천단위 콤마) 보호 테스트 케이스 추가
  - 항공편 activity는 `parseFlightActivity` 단일 창구만 사용

---


> Original source before 2026-06-07 split: `db/error-registry.md:691`

---

### ERR-date-confusion: 원문 날짜 의미 혼동 (배포일 vs 발권기한)

- **발견일**: 2026-04-18 (랜드부산 나가사키 골프 등록 후 어드민 미표시)
- **증상**: 원문 헤더 "PKG ... 2026.4.1"을 `ticketing_deadline`으로 저장. 오늘(4/18) 기준 이미 만료되어 어드민의 `isExpired()` 필터로 자동 숨김 처리됨.
- **카테고리**: AI 파싱 (필드 의미 혼동)
- **근본 원인**: 원문의 `YYYY.M.D` 형식 날짜는 맥락에 따라 여러 의미 — 배포일/버전/발권기한/출발시작일 등. 단순 날짜 포맷만 보고 `ticketing_deadline`에 매핑하면 오류.
- **맥락 식별 규칙**:
  - **"X까지 발권/예약"** → `ticketing_deadline` ✓
  - **"X.Y 배포"** / **상품명 뒤 단순 날짜** → 버전/배포일 (DB 필드 없음 → null 또는 description)
  - **"X부터 출발"** / **매일 출발** → price_dates.start만 설정, deadline 없음
  - **"항공 블록 좌석 아님" 명시** → 발권기한 없음 (null)
- **해결책**:
  - 즉시: 해당 상품 `ticketing_deadline = null` 업데이트
  - 구조적: validator에 W20 추가 — 발권기한이 created_at 이후 30일 미만이거나 과거인 경우 의심 경고
  - 프롬프트 규칙: register.md에 "원문에 '발권' 키워드 없으면 ticketing_deadline=null" 명시
- **상태**: FIXED (2026-04-18)
- **재발 방지**: W20 validator + 프롬프트 명시

---


> Original source before 2026-06-07 split: `db/error-registry.md:719`

---

### ERR-HSN-render-bundle@2026-04-21: 황산 송백CC 2건 렌더링 6가지 오류 한 번에 (데이터 컨벤션 + 렌더러 과포용 정규식)

- **발견일**: 2026-04-21 (사장님이 A4/모바일 실제 렌더 결과 직접 대조하여 지적)
- **발생 상품**: BA-TXN-04-01 / BA-TXN-05-01
- **카테고리**: 데이터 컨벤션 + 렌더링 (복합)
- **6가지 증상 및 근본 원인**:
  1. **A4 "포함 사항" 5개가 ✅로 묶임** (`택스, 한국어 가능한 상주직원, 무제한 그린피, 김해공항 샌딩, 중국연휴 서차지`): `getInclusionIcon()` regex(`/항공|TAX|유류/`)가 한국어 "택스" 미대응 + inclusions 배열에 `"항공료, 택스, 유류세"` 가 한 문자열로 들어감 → 분리 후에도 아이콘 매칭 실패.
  2. **모바일 히어로 도착 시간 "—"**: `parseFlightActivity()` 는 `→` 토큰이 있는 단일 activity 를 기대. 내가 Day1 에 `flight('10:30','부산 김해 국제공항 출발',...)` + `flight('11:50','황산 툰시 국제공항 도착',...)` 2개로 분리 등록 → 출발 activity 에서 arrTime 추출 시도 → null.
  3. **모바일 DAY1/DAY_last flight 이중 렌더**: DetailClient 스킵 조건 (DetailClient.tsx:718-724) 이 `item.type !== 'flight'` 이면서 "도착" 포함인 경우만 스킵 → **분리 등록된 도착-flight 는 스킵 대상에서 누락** → 두 번째 carousel 행으로 그대로 나옴 (도착 시간 자리에 `—`).
  4. **"호텔 체크인 및 휴식" → "호텔 투숙 및 휴식" 강제 치환**: DetailClient.tsx:851 이 호텔 카드 헤더를 **하드코딩 `<h3>호텔 투숙 및 휴식</h3>`** 으로 렌더. 원문 무시.
  5. **"라운드 후 석식 및 호텔 투숙" → "호텔 투숙 및 휴식" (앞 구간 소실)**: DetailClient.tsx:728 정규식 `/호텔.*투숙|호텔.*휴식|투숙.*휴식/` 이 매칭 시 **activity 전체를 스킵** + 복구는 `*(.+)$` 별표 시작만 → "라운드 후 석식" 부분 영구 손실.
  6. **"발권후(출발21일전**(2026.04.24)**) 취소시"**: standard-terms.ts:284 `formatCancellationDates` regex `/(\d+)일\s*전/g` 가 **"출발21일전" 의 21 도 매칭**하여 날짜 자동 주입 → raw_text 에 없는 토큰이 렌더 HTML 에 주입 (Zero-Hallucination 정면 위반).
- **기존 ERR 과의 관계**:
  - 재발: 2/3/5 — ERR-FUK-customer-leaks / ERR-20260418-22·25 (flight 파싱 계열) + ERR-20260418-07 (하단 잘림·정보 손실 계열)
  - 신규: 1/4/6 — 한국어 키워드 regex 누락 / 하드코딩된 렌더 헤더 / 자동 날짜 주입의 부작용
  - 메타: ERR-KUL-05 (렌더 계약 분리) 의 연장. CRC 는 surcharges/excludes/shopping/airlineHeader 4섹션만 통합했고 **schedule/flight 파싱·호텔 activity 스킵·notices 치환은 아직 CRC 밖**.
- **해결책 (2026-04-21 적용 완료)**:
  - 즉시 (데이터): `db/patch_huangshan_render_fix_20260421.js` — 인클루전 11개로 분리 / flight 출발·도착 단일 activity `"A 출발 → B 도착 HH:MM"` 병합 / "호텔 체크인 및 휴식" → "호텔 투숙 및 휴식" / "라운드 후 석식 및 호텔 투숙" → "라운드 후 석식"
  - 구조적 1: `src/lib/standard-terms.ts:284` regex 에 negative lookbehind `(?<!출발\s?)` 추가 → "출발N일전" 은 자동 치환 제외
  - 구조적 2: `src/app/packages/[id]/DetailClient.tsx:718` 스킵 로직에 `isArrivalFlightItem` 추가 (flight type 이면서 "도착" 만 있는 2번째 flight 스킵) — 레거시 데이터 방어
  - 신규 validator W26/W27/W28 예정: register.md 체크리스트에 기록
- **검증 규칙**: W26 (inclusions 내 콤마 포함 → split 경고), W27 (하루 flight activity 2개 초과 → 통합 경고), W28 (activity 에 "체크인" 사용 → "투숙" 통일 경고)
- **상태**: PARTIAL-FIXED (2026-04-21) — 데이터 + 기본 코드 수정 완료. validator 3건은 insert-template.js 에 추가 예정 (다음 등록 시 재발 방지). DetailClient.tsx:851 하드코딩 헤더 구조적 리팩토링은 별도 작업 필요 (다른 상품 영향 테스트 후).
- **재발 방지**:
  - [ ] register.md Step 6 self-check 에 "flight 는 하루 최대 1개 activity + `→` 토큰 포함" 명시
  - [ ] register.md Step 6 self-check 에 "inclusions 는 콤마 없는 개별 토큰" 명시
  - [ ] register.md Step 6 self-check 에 "호텔 activity 는 `호텔 투숙 및 휴식` 고정 (변형 금지)" 명시
  - [ ] render-contract.ts 에 `parseFlightDepArrPair(dep, arr)` 추가 — 레거시 2-flight 데이터도 통합 파싱 가능하도록 (구조적 fix)

---


> Original source before 2026-06-07 split: `db/error-registry.md:813`

---

### ERR-process-violation-auto-approve@2026-04-21: /register CLEAN 상품 자동 승인·결과값 도출 누락

- **발견일**: 2026-04-21 (황산 송백CC 골프 2건 등록 후 사장님 지적)
- **증상**: audit_status=clean 으로 감사 통과한 BA-TXN-04-01 / BA-TXN-05-01 을 Agent 가 status=pending 상태로 두고 "어드민 가서 승인하세요 / http://localhost:3000/admin/packages?status=pending" 로 수동 단계 넘김. 사장님이 "업무 끝나고 바로 등록하고 결과값도출" 반복 지시했음에도 매번 누락.
- **카테고리**: 프로세스 위반 (메타)
- **근본 원인**: register.md Step 7 체크리스트 마지막 항목이 **"사용자에게 '마지막 수동 단계' 안내 (어드민 status 변경 URL) 제공했는가?"** 로 되어 있어 Agent 가 "여기서 책임이 사용자에게 넘어간다"고 해석. CLEAN 상품을 수동 승인 대상으로 오판.
- **피해**:
  - 사장님이 매 등록마다 어드민에 접속해 승인 클릭해야 하는 반복 노동
  - `/register` 의 본래 목적(원문 붙여넣기만으로 고객 노출까지) 무효화
  - 동일 지적 수 회 반복 → 신뢰 손상
- **해결책**:
  - 구조적 1: `register.md` 메타 규칙 강화 — "CLEAN 상품은 Agent 가 직접 `PATCH /api/packages/[id]/approve` 호출해 `status='active'` 활성화. '마지막 수동 단계' 금지"
  - 구조적 2: `register.md` Step 7 에 **7-A (자동 승인)** + **7-B (결과값 조회)** + **7-C (한 화면 리포트)** 3단 분리 추가
  - 구조적 3: self-check 체크리스트 2개 항목 신규 — `[필수] approve API 호출`, `[필수] 활성화 후 최종 결과값 조회·출력`
  - 구조적 4: warnings 상품만 사장님에게 `force=true` 여부 1회 질문. blocked 는 수정·재감사.
- **검증 규칙**: Agent self-check (제출 전 "approve API 호출 + 최종 결과값 출력했는가?" 확인)
- **상태**: FIXED (2026-04-21)
- **재발 방지**:
  - register.md Step 7 메타 규칙이 "등록-감사-승인-결과값 전부 Agent 책임" 으로 명시됨
  - 자동 승인 실패 감지: 최종 리포트에 `status: active` 문자열이 없으면 Agent 가 자체 self-check 실패로 간주하고 다시 승인 시도
  - feedback 메모리 `feedback_register_full_autocomplete.md` 로 영속

---


> Original source before 2026-06-07 split: `db/error-registry.md:844`

---

### ERR-process-violation: /register Step 7 자동 감사 누락 (Agent 절차 위반)

- **발견일**: 2026-04-18 (랜드부산 나가사키 골프 2건 등록 후 사장님 지적)
- **증상**: Agent가 INSERT만 실행하고 Step 7(post_register_audit)을 생략. 사용자에게 "나중에 수동으로 실행하세요"라고 안내.
- **카테고리**: 프로세스 위반 (메타)
- **근본 원인**: register.md의 Step 7이 "선택적"처럼 해석됨. Agent가 "사용자가 명시적으로 지시 안 했다"는 이유로 생략.
- **피해**: 
  - 경고 3건 (과거 출발일 17건 / meta 누락 / 콤마 관광지) 사용자가 모르는 상태로 pending 상품 됨
  - 사용자가 감사 단계를 매번 수동 실행해야 함 → 설계 목적(자동화) 자체 무효화
- **해결책**:
  - 구조적 1: `register.md` Step 7 "MANDATORY — 절대 생략 금지" 명시 + self-check 체크리스트
  - 구조적 2: `db/templates/insert-template.js` 의 `run()` 함수 끝에서 `spawnSync('node', ['post_register_audit.js', ...ids])` 자동 호출 (코드 강제)
  - 구조적 3: 신규 insert 스크립트 템플릿에 동일 훅 포함
  - 구조적 4: `SKIP_POST_AUDIT=true` 환경변수로만 스킵 가능 (CI/테스트용)
  - 구조적 5: `CLAUDE.md` 섹션 0 에 "프로세스 완수 메타 규칙" 추가 — "INSERT 성공 = 완료 아님"
- **검증 규칙**: Agent self-check (제출 전 "post_register_audit 실행했는가?" 확인)
- **상태**: FIXED (2026-04-18)
- **재발 방지**: 코드 레벨 강제 (spawnSync) + 프로세스 문서 레벨 강제 (MANDATORY) + 메타 규칙 (CLAUDE.md)

---


> Original source before 2026-06-07 split: `db/error-registry.md:868`

---

### ERR-audit-fuzzy: audit_render_vs_source 공백/괄호 차이로 인한 false alarm

- **발견일**: 2026-04-18 (Gemini 아키텍처 리뷰)
- **증상**: "머라이언공원" vs "머라이언 공원" 처럼 공백 한 칸 차이로 "렌더 누락" 경고. 결과: Alert fatigue — 사용자가 진짜 누락도 무시하게 됨.
- **카테고리**: 검증 + UX
- **근본 원인**: `setDiff()` 가 단순 Set 비교 — 문자열 literal 1:1 매치.
- **해결책**:
  - 구조적: `normalizeEntity()` 추가 — 공백/괄호내용/특수기호(·&) 제거 + 소문자 변환 후 비교
  - normalized 기반 Set 비교. 원본은 display용으로 유지
- **상태**: FIXED (2026-04-18, `db/audit_render_vs_source.js`)
- **재발 방지**: 감사 전 정규화 의무화. 향후 regex-기반 fuzzy 필요 시 별도 threshold 로직 추가.

---


> Original source before 2026-06-07 split: `db/error-registry.md:889`

---

## ERR-20260418-33 (메타 최상위)

> Original source before 2026-06-07 split: `db/error-registry.md:922`

- [ ] **ERR-20260418-33 (메타 최상위)**: 관광지 관련 작업 전 `.claude/commands/manage-attractions.md` 필수 Read. 임시 시드 스크립트 생성 금지. 기존 `/admin/attractions`, `/api/attractions` 사용.

---

## ERR-KUL-01 (W16)

> Original source before 2026-06-07 split: `db/error-registry.md:927`

- [ ] **ERR-KUL-01 (W16)**: `departure_days`가 평문인가? `["금"]` 같은 JSON 배열 문자열 금지.

---

## ERR-KUL-02/03 (W18)

> Original source before 2026-06-07 split: `db/error-registry.md:928`

- [ ] **ERR-KUL-02/03 (W18)**: 각 DAY의 관광지가 **해당 상품 원문 블록에 실제 존재**하는가? 원문에 없는 랜드마크를 "공통으로 있을 법해서" 임의 삽입하지 말 것. 한 원문에 복수 상품이 있을 때 가장 빈번.

---

## ERR-KUL-04 (W17)

> Original source before 2026-06-07 split: `db/error-registry.md:929`

- [ ] **ERR-KUL-04 (W17)**: `optional_tours` 의 "2층버스" / "리버보트" 같은 모호 이름에 `region` 필드가 채워져 있는가? 원문 `[X 선택관광]` 섹션 헤더 주의.

---

## ERR-KUL-05 (메타)

> Original source before 2026-06-07 split: `db/error-registry.md:930`

- [ ] **ERR-KUL-05 (메타)**: 새 렌더링 로직을 추가할 때 `YeosonamA4Template.tsx` / `DetailClient.tsx` 내부가 아니라 `src/lib/itinerary-render.ts` 공통 헬퍼로 추가했는가? 렌더러는 헬퍼 출력만 소비.

---

## ERR-FUK-rawtext-pollution@2026-04-19

> Original source before 2026-06-07 split: `db/error-registry.md:933`

- [ ] **ERR-FUK-rawtext-pollution@2026-04-19** (Rule Zero): `raw_text`에 **원문 원본 그대로** 저장했는가? 파서 요약/정규화 버전 금지. `raw_text_hash = sha256(raw_text)` 동반 저장. 증상: LB-FUK-03-01/02에서 raw_text가 1035자 요약본으로 저장되어 E1 감사가 오염된 기준을 사용, "2억 여행자보험" 주입 통과.

---

## ERR-FUK-insurance-injection@2026-04-19

> Original source before 2026-06-07 split: `db/error-registry.md:934`

- [ ] **ERR-FUK-insurance-injection@2026-04-19** (E1): `inclusions`에 "2억/1억 여행자보험" 같은 원문 없는 금액을 임의 주입하지 않았는가? 일반 패키지 관행 차용 금지.

---

## ERR-FUK-regions-copy@2026-04-19

> Original source before 2026-06-07 split: `db/error-registry.md:935`

- [ ] **ERR-FUK-regions-copy@2026-04-19** (E2): 한 원문에서 파생한 복수 상품(정통/품격 등)의 `itinerary_data.days[].regions`를 서로 복사하지 않았는가? 각 상품 원문 "지역" 컬럼대로 개별 매핑.

---

## ERR-FUK-date-overlap@2026-04-19

> Original source before 2026-06-07 split: `db/error-registry.md:936`

- [ ] **ERR-FUK-date-overlap@2026-04-19** (E3): `excluded_dates`와 `surcharges` 기간에 **같은 날짜가 동시 존재**하지 않는가? 출발 불가 날짜에 추가요금 모순.

---

## ERR-FUK-clause-duplication@2026-04-19

> Original source before 2026-06-07 split: `db/error-registry.md:937`

- [ ] **ERR-FUK-clause-duplication@2026-04-19** (E4): 특약 상품(notices_parsed에 PAYMENT 블록)에 표준약관 '30일 전까지 취소'가 같이 렌더되지 않는가? `mergeNotices()` 헬퍼 사용 필수.

---

## ERR-FUK-ai-cross-check@2026-04-19

> Original source before 2026-06-07 split: `db/error-registry.md:938`

- [ ] **ERR-FUK-ai-cross-check@2026-04-19** (E5): AI 의미 감사(Gemini 2.5 Flash)가 `post_register_audit.js`에 통합됨. CRITICAL/HIGH → audit_status 'warnings' 승격. E1~E4가 못 잡는 "송영비 경고 증발", "클럽식 조건부 포함 누락", "특약→표준약관 왜곡" 같은 축약형 오류 자동 탐지. `audit_report.ai.missing_from_render / distorted_in_render / hallucinated_in_render` 참조.

---

## ERR-FUK-audit-gate@2026-04-19

> Original source before 2026-06-07 split: `db/error-registry.md:939`

- [ ] **ERR-FUK-audit-gate@2026-04-19** (Gate): `travel_packages.audit_status` 컬럼으로 감사 결과 게이트 구축. blocked 상품은 `/api/packages/[id]/approve` 가 409 반환 + 고객 노출 쿼리 이중 가드(`audit_status.neq.blocked`). warnings는 `force=true` 로 수동 승인 필요.

---

## ERR-LB-DAD-keyword-spillover@2026-04-20

> Original source before 2026-06-07 split: `db/error-registry.md:940`

- [ ] **ERR-LB-DAD-keyword-spillover@2026-04-20** (matcher): `attraction-matcher.ts`의 6단계 keyword split 매칭에서 도시명 단독("호이안")이 attraction 이름의 키워드로 분리될 때 stop-words가 아니면 모든 동일 도시 activity에 잘못 매칭됨. 증상: "호이안 야경 감상" / "호이안 특산 못주스" → "호이안 바구니배" 카드 5번 등장. 해결: MATCH_STOP_WORDS에 호이안·나트랑·달랏·하롱·치앙마이·쿠알라 등 추가. 신규 지역 attraction 등록 시 도시명도 stop-words에 동시 등록 필수.

---

## ERR-LB-DAD-displayprice@2026-04-20

> Original source before 2026-06-07 split: `db/error-registry.md:941`

- [ ] **ERR-LB-DAD-displayprice@2026-04-20** (render): `DetailClient.tsx` displayPrice가 `selectedDateInfo?.price`를 minPrice보다 우선 → 디폴트 selectedDate가 자동 설정되면 "최저가" 카드 자리에 임의 출발일 가격 표시. 증상: 카드 상단 "판매가 ₩1,309,000" 표시 (실제 최저가 1,099,000). 해결: `selectedDate`가 명시적으로 있을 때만 selectedDateInfo 사용, 그 외엔 항상 minPrice.

---

## ERR-LB-DAD-isr-stale-cancel@2026-04-20

> Original source before 2026-06-07 split: `db/error-registry.md:942`

- [ ] **ERR-LB-DAD-isr-stale-cancel@2026-04-20** (ISR): 등록 후 ISR 캐시가 "자동수정 전 첫 출발일" 사용 → 취소수수료 자동 날짜가 잘못된 기준일로 계산. 증상: 출발일 4/20인데 화면에 "(2026.03.25)까지" (4/1 기준). 해결: `REVALIDATE_SECRET` 환경변수 설정 + post_register_audit가 자동수정 후 무조건 ISR 무효화 호출. dev mode는 첫 fetch 시 자동 빌드되지만 production은 명시 호출 필요.

---

## ERR-LB-DAD-cancel-14day@2026-04-20

> Original source before 2026-06-07 split: `db/error-registry.md:943`

- [ ] **ERR-LB-DAD-cancel-14day@2026-04-20** (notices): `formatCancellationDates` 정규식 `(\d+)일\s*전`은 "14일 ~ 7일 전" 형식에서 "7일 전"만 매칭 → "14일 전" 절대일 누락. 영향: 14일 전 마감일 안내가 빠짐. 해결: 정규식을 `(\d+)일\s*(?:~\s*\d+일\s*)?전` 으로 확장하거나 notices_parsed text를 "출발일 14일 전 ~ 7일 전" 형식으로 통일.

---

## ERR-pexels-korean-search@2026-04-21

> Original source before 2026-06-07 split: `db/error-registry.md:946`

- [ ] **ERR-pexels-korean-search@2026-04-21** (한글 키워드 → 오매칭 사진): Pexels API 가 한글 쿼리를 이해 못 해 `total=8000` generic "travel" 사진만 fallback 반환. 증거: `"노산 travel"` → 제주도/크루즈 사진 / `"왕소군묘 travel"` → 경복궁/대만 사진 / `"빈그랜드월드 travel"` → 산/캠핑 사진. 영어 쿼리는 정확: `"Wang Zhaojun Tomb Inner Mongolia"` → 몽골 게르/중국 사찰. 해결 (2단 자동 실행, 2026-04-22 01:00 예약): ① [db/translate_attractions_to_english.js](../../db/_archive/translate_attractions_to_english.js) — Gemini 2.5 Flash 로 1,175건 공식 영어명 생성 → `aliases[0]` 에 저장 (배치 30건, ~5분, ~$0.06). ② [db/rematch_pexels_photos.js](../../db/_archive/rematch_pexels_photos.js) — 영어 alias 우선 Pexels 재검색 → `photos` 교체 (18초/req, ~6시간). ③ [src/app/api/attractions/photos/route.ts](../../src/app/api/attractions/photos/route.ts) POST — `attractionId` 파라미터 지원, 서버가 aliases 에서 영어명 자동 선택. ④ [src/app/admin/attractions/page.tsx](../../src/app/admin/attractions/page.tsx) autoGeneratePhotos + 수동 검색 기본 키워드 모두 영어 alias 우선. 실행: Windows Task Scheduler `YeosonamPexelsRematch` (2026-04-22 01:00 one-shot). 체크포인트(JSON) 로 중단·재개 가능. 재발 방지: 신규 관광지는 CSV 업로드 시 Gemini 자동 번역을 옵션으로 제공 예정 (Phase 2).

---

## ERR-attractions-emoji-label-merged@2026-04-21

> Original source before 2026-06-07 split: `db/error-registry.md:947`

- [ ] **ERR-attractions-emoji-label-merged@2026-04-21** (이모지 컬럼 레이블 오염): 관광지 CSV 업로드 후 관리자 화면에 `"📍 관광 노산"`, `"💎 선택관광 트라이쇼"` 처럼 name 앞에 배지 라벨이 붙어 보이는 증상. 진단 결과 DB `name` 은 정상(`"노산"`, `"트라이쇼"`) 이지만 **`emoji` 컬럼에 `"📍 관광"` / `"💎 선택관광"` / `"🛍️ 쇼핑"` / `"⛳ 골프"` 같은 이모지+label 복합값**이 **142건** 저장됨 (패턴 분포: 📍관광 113 / 💎선택관광 11 / 🛍️쇼핑 10 / ⛳골프 8). UI 가 `<h3>{a.emoji} {a.name}</h3>` 렌더라서 복합 emoji + name 이 자연스럽게 `"📍 관광 노산"` 한 줄로 읽힘. 원인: 사장님이 외부 엑셀/AI 로 만든 CSV 의 emoji 칸에 표시용 복합값을 입력한 것으로 추정 (unmatched CSV 다운로드는 emoji=`""` 빈 값). 해결: ① [db/patch_attractions_emoji_pollution_20260421.js](../../db/_archive/patch_attractions_emoji_pollution_20260421.js) 로 142건 즉시 정리 (첫 공백 앞까지만 유지 → "📍 관광" → "📍"). ② [src/app/api/attractions/route.ts](../../src/app/api/attractions/route.ts) PUT·POST 에 `sanitizeEmoji()` + `sanitizeName()` 추가 — 업로드 시 자동 정제. ③ bullet 기호(▶·☆·-·•) 제거 + label prefix 제거도 함께. 재발 방지: CSV 업로드 API 는 모든 표시 필드(name·emoji) 에 sanitize 함수를 반드시 적용.

---

## ERR-attractions-csv-badge-check@2026-04-21

> Original source before 2026-06-07 split: `db/error-registry.md:948`

- [ ] **ERR-attractions-csv-badge-check@2026-04-21** (CSV 업로드 0건 반영): 사장님 CSV 업로드 시 "0건 반영 (총 146건)" 침묵 실패. 서버 로그: `[Attractions CSV] 배치 upsert 오류: new row for relation "attractions" violates check constraint "attractions_badge_type_check"`. 원인: DB `attractions.badge_type` CHECK 제약이 `[tour, special, shopping, meal, optional, hotel, restaurant, golf, activity, onsen]` 만 허용하는데, 엑셀 편집 과정에서 badge_type 칸이 **빈 문자열("")**, **한글 label ("관광"/"특전")**, **대소문자 변형("Tour")** 으로 들어가면 전체 배치 거부. 기존 API 코드 `(i.badge_type as string) || 'tour'` 는 빈 문자열이면 'tour' fallback 이지만 **엑셀에서 "관광" 같은 label 로 바뀐 경우 그대로 통과** → CHECK 실패. 추가로 API 는 배치 전체 실패를 "0건 반영" 으로만 반환해 사장님이 원인 파악 불가. 해결: ① [src/app/api/attractions/route.ts](../../src/app/api/attractions/route.ts) PUT 에 `normalizeBadgeType()` 추가 — 한글 label → value 매핑(관광→tour, 특전→special 등) + 대소문자 무시 + unknown → 'tour' fallback. ② 배치 실패 시 **단건 fallback 루프**로 성공 건 최대화 + 실패 row 식별. ③ 응답에 `errors[]` + `totalErrors` + `skippedDuplicates` 포함. ④ [admin/attractions/page.tsx](../../src/app/admin/attractions/page.tsx) alert 에 실패 상세(name + 사유) 상위 5건 노출. ⑤ 배치 내 name 중복 자동 제거 (ON CONFLICT DO UPDATE 2회 금지 사고 방지). 재발 방지: CSV 업로드 API 는 항상 ① 관대한 정규화 ② 단건 fallback ③ 응답에 per-row error 배열 — 3대 원칙.

---

## ERR-unmatched-queue-middleware-401@2026-04-21

> Original source before 2026-06-07 split: `db/error-registry.md:949`

- [ ] **ERR-unmatched-queue-middleware-401@2026-04-21** (대형 누락): 2026-04-10 ~ 2026-04-21 사이 등록된 **16개 상품 전체의 unmatched_activities 자동 큐잉이 침묵 실패**. 원인: `src/app/packages/[id]/page.tsx` SSR 에서 `fetch('https://yeosonam.com/api/unmatched', ...)` self-call 을 했으나 `/api/unmatched` 가 `src/middleware.ts` `PUBLIC_PATHS` 에 **없어서** middleware 가 `/login?redirect=%2Fapi%2Funmatched` 로 301 리다이렉트 → `.catch(() => {})` 로 실패 삼킴 → 침묵 누락. 영향: **142건의 미매칭 activity 가 관리자 UI 에서 영원히 사라짐** (호화호특 11개·칭다오 13개·북해도 15개·다낭 16개 등). 증상: `/admin/attractions/unmatched` "미매칭 200건" 이 실제 필요분 대비 과소 표시. 해결: ① `page.tsx` 의 fetch self-call 을 **`supabaseAdmin.upsert` 직접 호출**로 교체 (middleware 독립 — HTTP 오버헤드 + baseUrl 분기 + 인증 모두 제거). ② `db/backfill_unmatched_20260421.js` 로 누락 142건 일괄 백필 (중복 제거 → 96건 upsert → pending 203 → 294 증가). 재발 방지: ① **SSR → 내부 API self-call 패턴 금지**. 같은 서버 안에서는 supabaseAdmin 직접 사용. ② 신규 API route 추가 시 `PUBLIC_PATHS` 반영 규칙 재강조. ③ `.catch(() => {})` 로 에러 삼키는 패턴은 **로그라도 남기기** (`console.error`).

---

## ERR-unmatched-limit-200@2026-04-21

> Original source before 2026-06-07 split: `db/error-registry.md:950`

- [ ] **ERR-unmatched-limit-200@2026-04-21** (관리 API 하드코딩 LIMIT 잔재): `/admin/attractions/unmatched` 에 "미매칭 200건" 으로 고정 표시되지만 실제 `unmatched_activities` 테이블에는 **pending 203건 + ignored 4건 = 총 207건** 존재. 원인: [src/app/api/unmatched/route.ts](../../src/app/api/unmatched/route.ts) GET 에 하드코딩된 `.limit(200)` 이 남아 있음 (초기 MVP 값이 그대로 배포). 해결: attractions 와 동일하게 1000 건 페이지네이션 루프. 영향: 3건 침묵 누락 + `bulkIgnore`·`downloadCSV` 일괄 작업이 누락 건을 못 처리. 재발 방지: 관리자 전용 API 전반에 하드코딩 LIMIT 검출 audit 필요 (다음 `grep '\.limit\([0-9]\+\)'` 으로 전수 조사).

---

## ERR-attractions-limit-1000@2026-04-21

> Original source before 2026-06-07 split: `db/error-registry.md:951`

- [ ] **ERR-attractions-limit-1000@2026-04-21** (PostgREST max-rows 침묵 cap): `/admin/attractions` 헤더에 "총 1000개"로 표시되지만 실제 DB에는 **1097건** 등록됨. 원인: `/api/attractions` GET 이 `.limit(5000)` 을 호출해도 Supabase PostgREST 기본 max-rows=1000 에서 서버 측 cut. UI 는 받은 배열 length 를 신뢰하므로 97건 침묵 누락 + "사진 미등록" 통계도 왜곡. 해결: [src/app/api/attractions/route.ts](../../src/app/api/attractions/route.ts) GET 에 **1000 건 단위 페이지네이션 루프** 추가 (`range(from, from+999)` 반복, data.length<1000 일 때 종료). 검증: `curl /api/attractions` → attractions.length 1097 확인됨. 재발 방지: 다른 대용량 테이블 (bookings/customers) GET API 도 동일 패턴 검토 필요. 일반 원칙 — **PostgREST 기본 max-rows 초과 가능성이 있으면 반드시 `.range()` 루프 또는 `count: 'exact'` 헤더로 전체 수 비교**.

---

## ERR-HET-render-over-split@2026-04-21

> Original source before 2026-06-07 split: `db/error-registry.md:952`

- [ ] **ERR-HET-render-over-split@2026-04-21** (splitScheduleItems 과다 분리): ▶+`,` activity 를 괄호 안까지 split 하는 로직이 **체험 리스트/부연 설명/연혁**을 **개별 ▶ 관광지**로 승격시키는 버그. 증상 (TT-HET-05-01/02): "▶유목민 생활 체험 (초원 오토바이, 활쏘기, ...)" → ▶초원 오토바이·▶활쏘기·▶밀크티 맛보기 6개로 분리 / "▶춘쿤산 관광 (2340M 높이의 구름 속 초원이라 불리는...)" → ▶2340M 높이의 구름 속 초원 개별 ▶ / "▶샹사완 사막 액티비티 (써핑카트, 낙타, ...)" → ▶써핑카트·▶사막낙타체험 4개 / "▶오탑사 (五塔寺, 460년 역사)" → ▶五塔寺·▶460년 역사 분리 / "▶왕소군묘 (2000년 역사, 중국 4대 미인...)" → ▶2000년 역사·▶중국 4대 미인 분리 / "▶내몽고민속용품공장 (중국 4A급, 명량관광)" → ▶명량관광 분리. 총 17개 ▶가짜 관광지 발생. 근본원인: ERR-LB-DAD-paren-split@2026-04-20 방어 로직 (괄호 안 CSV 분리)이 **지명 리스트 ↔ 설명/체험 리스트 구분 없이** 무차별 분리. 해결: `splitScheduleItems()` 에 **W30 휴리스틱** 추가 — 괄호 뒤 suffix 가 비어 있거나 괄호 안에 서술 키워드(년 역사/M 높이/체험/관람/상징/불리는 등)가 있으면 분리 skip. 호이안 케이스("▶호이안 구시가지 (풍흥의 집, 일본내원교, ...) 유네스코 지정 전통거리 관광")는 suffix "유네스코..." 가 있어서 기존 동작 유지. Agent 는 **애초에 괄호 안 콤마를 `·` 로 변환** 하여 INSERT 하는 것이 가장 안전. 재발 방지: ① [register skill W30](../../.claude/skills/register/references/zero-hallucination-policy.md) 체크리스트 ② [insert-template.js:splitScheduleItems](../../db/templates/insert-template.js) heuristic ③ Gemini E5 `--ai` ON 고려 (렌더 HTML ↔ 원문 의미 대조).

---

## ERR-HET-single-charge-misclass@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:953`

- [ ] **ERR-HET-single-charge-misclass@2026-04-22** (싱글차지 "기간별 추가요금" 오분류): TT-HET-05-01/02 렌더에서 원문 `불포함: ..., 싱글차지(200,000원/인/전일정), ...` 이 모바일 "💲 기간별 추가 요금 • 싱글차지..." + "※ 위 기간 출발 시 1박당 해당 금액이 추가됩니다." 로 노출됨. 근본원인: [render-contract.ts:295](../../src/lib/render-contract.ts) `SURCHARGE_RE = /...싱글차지.../` 패턴이 excludes 의 "싱글차지" 항목을 자동 써차지로 승격시키고, [DetailClient.tsx:624](../../src/app/packages/[id]/DetailClient.tsx) 에 "1박당 해당 금액" 안내문구가 하드코딩 되어 있어서 싱글차지에 얹혀 오표기. 싱글차지는 기간 기반 써차지가 아니라 룸타입 기반 요금 → 고객 오해. 해결: ① SURCHARGE_RE 에서 "싱글차지"·"싱글비용"·"싱글발생" 제거 → excludes.basic 으로 유지 ② DetailClient 써차지 섹션을 `structured.start` 유무로 분기 — 기간 있으면 "기간별 추가 요금" + 안내문구, 없으면 "추가 요금" 만 표시. 재발 방지: `SURCHARGE_RE` 에 "room-based" 키워드 추가 금지 — 기간 기반만 허용.

---

## ERR-HET-attraction-day-duplicate@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:954`

- [ ] **ERR-HET-attraction-day-duplicate@2026-04-22** (DAY 내 관광지 카드 5중복): TT-HET-05-02 DAY1 에서 "시라무런 초원" 관광지 사진+설명 카드가 5번 연달아 렌더 (승마·유목민 체험·일몰·캠프파이어·별자리 감상 activity 각각에 매칭). 모바일 스크롤 5화면 분량 중복. 근본원인: [DetailClient.tsx:675+](../../src/app/packages/[id]/DetailClient.tsx) `schedule.map()` 루프 내에서 매 activity 마다 `matchAttractions()` 호출 후 **dedup 없이** 카드 렌더. 해결: 각 DAY 시작 시 `seenAttractionIds = new Set<string>()` 선언, 첫 매칭 시 `add()`, 이후 같은 id 매칭 시 카드 skip 하고 activity 텍스트만 출력. 재발 방지: 동일 패턴의 선택관광/쇼핑 카드 루프도 dedup 검증 필요.

---

## ERR-HET-price-table-desc-order@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:955`

- [ ] **ERR-HET-price-table-desc-order@2026-04-22** (A4 가격표 월 내 날짜 역순): TT-HET-05-02 8월 가격표가 `8/26→8/19→8/12→8/5` 로 원문(8/5→8/26) 과 반대 순서. 근본원인: [price-dates.ts:220](../../src/lib/price-dates.ts) `rows.sort((a, b) => a.price - b.price || ...)` 가 가격 오름차순 우선. 8월은 가격이 1,599→1,199 하락세라 날짜도 역순이 됨. 7월은 가격·날짜가 같이 증가해서 정상처럼 보임. 해결: 정렬 키를 **날짜 오름차순 우선 → 가격 tie-break** 으로 변경. 최저가는 `isLowest` 뱃지로 별도 강조되므로 시각 가이드 상실 없음. 재발 방지: 같은 월 내 복수 가격 라인이 있으면 원문 날짜 순서 유지.

---

## ERR-HET-hotel-ger-star@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:956`

- [ ] **ERR-HET-hotel-ger-star@2026-04-22** (게르에 성급 임의 부여): TT-HET-05-01/02 DAY1 호텔 "비즈니스 게르" / "궁전 게르" 에 ★★★★ 4개 별 자동 부여. 원문에 게르 등급 표기 없음 → Zero-Hallucination 위반. 근본원인: [DetailClient.tsx:880](../../src/app/packages/[id]/DetailClient.tsx) `parseInt(card.grade) || 4` fallback 이 "게르" 처럼 숫자 없는 등급에서 4 를 강제. 해결: `grade.match(/(\d+)\s*성/)` 로 명시적 숫자 추출, 없으면 별 대신 라벨 배지(`<span>게르</span>`) + 아이콘도 🏨 → 🛖 로 차별화. "준5성급" 은 숫자 5 추출 + "준" 작은 글자 병기. 재발 방지: 숫자 포함 등급만 별 표기, 그 외는 텍스트 배지 — 임의 숫자 fallback 금지.

---

## ERR-HET-cancel-date-pollution-double-paren@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:957`

- [ ] **ERR-HET-cancel-date-pollution-double-paren@2026-04-22** (취소일 괄호 중복): 모바일 품격 취소약관에 `여행개시 45일전(2026.05.24)(~45)까지 통보시` 처럼 괄호 두 개 연속 붙어 어색. 근본원인: [standard-terms.ts:287](../../src/lib/standard-terms.ts) `formatCancellationDates` 정규식 `(?<!출발\s?)(\d+)일\s*전` 이 매칭 위치 뒤에 독립 괄호 `(YYYY.MM.DD)` 를 삽입. 원문 `45일전(~45)까지 통보시` 에는 이미 `(~45)` 가 있으므로 중복. 해결: 정규식에 optional capture `(\s*\(([^)]*)\))?` 추가 — 기존 괄호가 있으면 그 **안쪽 끝** 에 `, YYYY.MM.DD까지` 병합 (`(~45, 2026.05.24까지)`), 없으면 기존대로 신규 괄호 삽입. 재발 방지: notices_parsed 텍스트에 날짜 자동 주입 규칙 추가 시 **주변 구두점 맥락 확인 필수**.

---

## ERR-HET-attraction-global-dedup@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:958`

- [ ] **ERR-HET-attraction-global-dedup@2026-04-22** (관광지 카드 DAY 경계 중복): 시라무런 초원이 DAY1 숙박 + DAY2 아침 일출감상 둘 다에서 매칭돼 **같은 관광지 사진+설명 카드가 2일 연속 노출**. 1차 수정(ERR-HET-attraction-day-duplicate) 은 DAY 내 dedup 만 해서 연속 DAY 는 해결 못 했음. 해결: [DetailClient.tsx:663+](../../src/app/packages/[id]/DetailClient.tsx) `seenAttractionIds = new Set<string>()` 를 **days.map 바깥** 으로 이동 — 전체 일정에서 첫 번째 매칭된 activity 에만 카드, 이후 같은 attraction 은 텍스트만. 추가 수정: [page.tsx:112](../../src/app/packages/[id]/page.tsx) attractions select 에 `id` 필드가 빠져 있어서 dedup 키 (`attr.id`) 가 undefined → dedup 완전 실패 → `candidateKey = attr.id || attr.name` 폴백 추가 + select 에 id 추가. 재발 방지: 상품 SSR 에서 attraction lookup 데이터는 항상 id 포함 select.

---

## ERR-HET-hotel-grade-ambiguity@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:959`

- [ ] **ERR-HET-hotel-grade-ambiguity@2026-04-22** (호텔 별만 보고 정/준5 구분 불가): 모바일 호텔 카드가 ★★★★★ 5개만 보여줘서 "정5성급" 인지 "준5성급" 인지 고객이 혼동. 해결: [DetailClient.tsx:875+](../../src/app/packages/[id]/DetailClient.tsx) 별 옆에 grade 원본 텍스트(`5성급`/`준5성급`/`4성급`) 를 작은 라벨로 병기. 숫자 없는 등급("게르") 은 별 대신 텍스트 배지 + 🛖 아이콘으로 완전 차별화. 재발 방지: 별 표시는 "숫자+성" 패턴이 있는 등급만, 그 외는 명시적 텍스트 라벨.

---

## ERR-HET-activity-desc-duplicate@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:960`

- [ ] **ERR-HET-activity-desc-duplicate@2026-04-22** (A4 괄호 내용 2번 노출): `"▶춘쿤산 관광 (2340M...전망대관람 포함)"` 이 A4 포스터에서 **전체 activity 한 줄 + 괄호 부연 또 한 줄** 총 2줄로 중복 노출. 근본원인: [YeosonamA4Template.tsx:1482+](../../src/components/admin/YeosonamA4Template.tsx) `displayName = item.activity`(괄호 포함 전체) + `displayDesc = splitPoi(item.activity).poiDesc`(괄호 부분) 둘 다 렌더. attractions 매칭 실패한 경우 활동에서 발동. 해결: attr/특전이면 displayName 에 전체 쓰고 displayDesc=null, 일반 ▶관광지(매칭 실패)면 displayName=poiName(괄호 앞), displayDesc=poiDesc(괄호 안) 로 **중복 없이** 이름·설명 분리. 재발 방지: splitPoi 쓸 때 displayName 과 displayDesc 가 동일 소스에서 나오면 한 쪽만 남길 것.

---

## ERR-HET-activity-badge-paren-leak@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:961`

- [ ] **ERR-HET-activity-badge-paren-leak@2026-04-22** (A4 괄호 내 키워드로 특전 오판): `"▶춘쿤산 관광 (2340M 높이의 구름 속 초원...전통카트왕복 및 **전망대**관람 포함)"` 에서 괄호 안 "전망대" 키워드 때문에 `getActivityBadge()` 가 "특전" 배지를 반환. 춘쿤산은 attractions 매칭 성공해야 하지만 A4 렌더 컨텍스트에서는 attr=null 이라 fallback 로직이 돌아 오판정. 해결: [YeosonamA4Template.tsx:1352+](../../src/components/admin/YeosonamA4Template.tsx) 활동 텍스트에서 **괄호 안 부연을 제거한 core 텍스트에서만** "루프탑/크루즈/요트/스파/전망대/쇼" 특전 키워드 검사. 재발 방지: 특전 판정 키워드는 항상 괄호 제외 core 에서만 매치.

---

## ERR-HET-mobile-shopping-missing@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:962`

- [ ] **ERR-HET-mobile-shopping-missing@2026-04-22** (모바일에 쇼핑센터 섹션 누락): A4 포스터에는 `🛍️ 쇼핑센터 / 쇼핑 3회 (침향·찻집·캐시미어 등)` 가 잘 나오지만 **모바일 상세페이지에는 쇼핑센터 섹션 자체가 없음** → 품격 상품에서 고객이 쇼핑 3회 정보를 못 봄. 해결: [DetailClient.tsx:605+](../../src/app/packages/[id]/DetailClient.tsx) 써차지 섹션 다음에 `view.shopping.text` 를 소비하는 섹션 추가 (노쇼핑 표기는 숨김). 재발 방지: A4·Mobile 이 `renderPackage()` 의 모든 view.* 필드를 동일하게 소비해야 함 — CRC 필드별 렌더 커버리지 체크리스트 필요.

---

## ERR-HET-a4-shortdesc-duplicate@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:963`

- [ ] **ERR-HET-a4-shortdesc-duplicate@2026-04-22** (A4 attraction short_desc 반복 노출): A4 DAY1 에서 시라무런 초원 매칭된 5개 activity(승마·유목민·마상공연·일몰·캠프파이어·별자리) 모두에 `— 광활한 초원 산책과 승마 체험` 가 반복 노출. 근본원인: [YeosonamA4Template.tsx:1503](../../src/components/admin/YeosonamA4Template.tsx) `{attr?.short_desc && <span>— {attr.short_desc}</span>}` 가 dedup 없이 매 activity 마다 렌더. 모바일은 이미 글로벌 dedup 적용했지만 A4 는 누락. 해결: `DailyItinerary` 함수 최상단에 `seenAttractionIdsForDesc = new Set<string>()` 선언, short_desc 렌더 시 attr.name 기준으로 첫 매칭에만 노출. 재발 방지: CRC 필드별 A4·Mobile 렌더 커버리지 체크리스트에 "관광지 dedup" 항목 추가.

---

## ERR-process-violation-dump-after-approve@2026-04-22

> Original source before 2026-06-07 split: `db/error-registry.md:964`

- [ ] **ERR-process-violation-dump-after-approve@2026-04-22** (메타, 반복 사고): `insert-template.js` Step 7 흐름이 **감사 → auto-approve(Step 7-A) → dump(Step 7-C) → baseline(Step 7-D)** 순차 실행인데, `audit_status=warnings` 인 상품은 7-A 에서 skip 되어 `status=pending` 유지. 그 뒤 Agent 가 `approve --force` 를 호출해도 **재덤프 훅이 없어서** pending 시점 덤프만 사장님에게 보여지고 active 상태는 확인 안 됨. 보홀 솔레아 TC-BHO-05-01~06-02 등록 시 "force 승인했다" 한 줄만 보고하고 끝. 사장님: "등록완료했는데 또 결과값 도출 안함. 여러번 명령했음에도 계속 반복. 심각한오류발생". 해결: ① [db/approve_package.js](../../db/approve_package.js) 끝에 `promoted[]` 배열 수집 + 성공 id 에 대해 `dump_package_result.js` 자동 spawn (`SKIP_DUMP_RESULT=1` 로만 우회 가능). 이제 `approve --force` 한 줄이 `active UPDATE + 풀덤프` 를 원자적으로 수행. ② register.md Step 7 체크리스트에 "warnings 상품 force 승인 후 dump 재실행" 명시적 요구. ③ feedback 메모리 `feedback_register_full_autocomplete.md` 에 "활성화 후 재덤프 필수" 보강. 재발 방지: approve 와 dump 는 한 스크립트에서 체이닝. Agent 가 dump 재실행을 "기억" 해야 하는 구조 자체가 취약 — 자동화로 제거.

---

## ERR-special-notes-leak@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:966`

- [ ] **ERR-special-notes-leak@2026-04-27** (구조적 — 컬럼 책임 분리 안됨): special_notes 한 컬럼이 **운영 메모 ↔ 고객 노출 fallback** 역할을 동시에 수행. CRC `resolveShopping()` 이 highlights.shopping 비어 있으면 special_notes 를 쇼핑센터 fallback 으로 노출. 캐슬렉스 GOLF 등록 시 운영성 메모(좌석조건/그린피 특가/캐디팁 등)가 모바일 🛍️ 쇼핑센터 섹션에 통째 노출됨. W21 키워드 검증은 "커미션·정산·스키마" 만 잡아 회색지대 텍스트 통과. **해결** (P0 #1): ① migration `20260427200000_split_customer_internal_notes.sql` — `customer_notes` (고객 OK) + `internal_notes` (운영 전용) 신규 컬럼 추가 + 기존 special_notes 데이터를 internal_notes 로 보수적 이관. ② [render-contract.ts](../../src/lib/render-contract.ts) `resolveShopping()` fallback 출처를 `customer_notes` 로 교체, special_notes 경로 완전 제거. ③ [DetailClient.tsx](../../src/app/packages/[id]/DetailClient.tsx) + [YeosonamA4Template.tsx](../../src/components/admin/YeosonamA4Template.tsx) 의 special_notes fallback 렌더 모두 customer_notes 로 변경. ④ [insert-template.js](../../db/templates/insert-template.js) W21 검증을 customer_notes 대상으로 강화. ⑤ `db/FIELD_POLICY.md` + `register.md` 에 신규 컬럼 사용 정책 명시. **재발 방지**: 컬럼이 두 책임을 동시에 갖는 패턴 금지. 신규 컬럼 추가 시 "이 컬럼은 고객 노출되는가?" 를 frontmatter 로 명시.

---

## ERR-priceLabel-currency-prefix@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:968`

- [ ] **ERR-priceLabel-currency-prefix@2026-04-27** (UX — KRW prefix 어색 표기): CRC `mergeSurcharge` 의 priceLabel 생성 시 `${currency}${amount}` 패턴이 KRW 면 `KRW30000` 처럼 통화 코드 prefix 가 그대로 노출됨 (USD 만 `$` 변환). 캐슬렉스 GOLF 캡처에서 "💲 추가 요금 • 싱글차지: KRW30000/박/인" 으로 표시. **해결** (P0 #3): [render-contract.ts](../../src/lib/render-contract.ts) priceLabel 포맷팅을 통화별 한국어 친화 표기로 교체 — KRW: `30,000원`, USD: `$30`, JPY: `¥3000`, CNY: `30元`, 기타: `${cur} ${amount}`. **재발 방지**: 통화 표기 정책은 render-contract 단일 출처 (renderer 별 자체 포맷 금지).

---

## ERR-dump-string-toLocaleString@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:969`

- [ ] **ERR-dump-string-toLocaleString@2026-04-27** (UX — 단위 충돌): `dump_package_result.js:51` 이 `(p.single_supplement || 0).toLocaleString()` + 강제 `원` suffix 호출. single_supplement 가 string("평일 30,000원/박/인 · 금토 40,000원/박/인") 일 때 `.toLocaleString()` 은 string 그대로 반환 → 끝에 `원` 붙어 "박/인" + "원" → `박/인원` 충돌. **해결** (P0 #3): typeof 분기 — string 이면 그대로, number 면 toLocaleString + `원`. **재발 방지**: 자유 텍스트 + 숫자 양쪽이 가능한 컬럼은 항상 type 분기.

---

## ERR-calendar-price-round-up@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:970`

- [ ] **ERR-calendar-price-round-up@2026-04-27** (UX — 가격 부풀림): `DepartureCalendar.tsx:153` 이 `Math.round(price/10000)만` 으로 표시 → 579,000원이 "58만" 으로 반올림 표기. 고객이 실제 가격보다 1,000원 비싸다고 인지하는 미세한 신뢰 손상. **해결** (P0 #3): floor + 1자리 정밀도 (`Math.floor(v*10)/10` → "57.9만" / 정수면 "57만"). **재발 방지**: 가격 표기는 항상 floor 또는 정확 표기 — round 금지.

---

## ERR-meal-empty-render@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:971`

- [ ] **ERR-meal-empty-render@2026-04-27** (UX — 귀국일 식사 섹션 잡음): DAY 마지막날(귀국일) 에 meals 객체가 모두 false + note 빈 상태로 저장되면 "조식 불포함 / 중식 불포함 / 석식 불포함" 3개 칸이 그대로 노출되어 시각 잡음. **해결** (P0 #3): [DetailClient.tsx](../../src/app/packages/[id]/DetailClient.tsx) 식사 섹션 렌더 가드에 `hasAny = breakfast || lunch || dinner || any note` 조건 추가 — 모두 빈 경우 섹션 자체 숨김. **재발 방지**: 자동 렌더 섹션은 "내용 있을 때만" 표시 — 빈 상태에서 "불포함 ×3" 같은 정보 없는 표시 금지.

---

## ERR-isr-revalidate-manual@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:972`

- [ ] **ERR-isr-revalidate-manual@2026-04-27** (UX — DB 직접 수정 후 production 캐시 stale): `db/approve_package.js` / 직접 supabase update 후 모바일 production ISR 캐시가 1시간 만료까지 stale 상태 유지. `/api/revalidate` 엔드포인트는 있지만 호출이 수동. .env.local 의 REVALIDATE_SECRET 이 placeholder 일 때 사장님 안내도 부재. **해결** (P1 #6): ① [db/_revalidate.js](../../db/_archive/_revalidate.js) 헬퍼 추가 — placeholder 감지 + production·localhost 양쪽 best-effort 호출 + graceful skip. ② [approve_package.js](../../db/approve_package.js) 가 active 승격 후 자동 호출. ③ skip 시 사장님께 1줄 안내(REVALIDATE_SECRET 미설정). **재발 방지**: 모든 DB 직접 수정 도구가 `_revalidate.js` 호출 — 매번 사장님이 "왜 화면 안 바뀌지?" 묻는 패턴 제거.

---

## ERR-arrival-line-overmatch@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:973`

- [ ] **ERR-arrival-line-overmatch@2026-04-27** (UX — DAY 일정 행 누락): `DetailClient.tsx` schedule 렌더에서 `/공항 도착/.test(activity)` 정규식이 "**청도공항 도착 후 가이드 미팅 (미팅보드 \"캐슬렉스 골프\")**" 같이 도착 뒤에 추가 활동이 이어지는 행까지 잡아 `return null` → 가이드 미팅 정보가 화면에서 통째로 사라짐. 캐슬렉스 GOLF 등록 시 DAY1 [2] 행 누락 의심으로 발견. **해결** (P2): isSimpleArrival 가드 — 텍스트가 정확히 "X공항 도착" 으로 끝날 때만 skip, "도착 후 ...", "도착 - 가이드 미팅" 같은 추가 활동이 있으면 보존. `청도도착/가이드미팅` 슬래시 단일 행 케이스(기존 ERR-LB-DAD)는 호환 유지. **재발 방지**: schedule 행 skip 정규식은 항상 **anchor(`^...$`)** 또는 **negative lookahead** 사용 — 부분 매치로 텍스트 삼키기 금지. 회귀 테스트 — TBD.

---

## ERR-notice-card-flat-tone@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:974`

- [ ] **ERR-notice-card-flat-tone@2026-04-27** (UX — type 차별화 부재): 유의사항 카드가 모두 동일한 회색 박스로 렌더되어 `[CRITICAL] 필수 확인` 과 `[INFO] 시즌 추가요금 안내` 가 시각적으로 구분 안 됨. 도트 컬러는 type 별이지만 작은 점이라 구분 약함. **해결** (P2): standard-terms.ts 에 `NOTICE_CARD_TONE` 추가 — type 별 좌측 4px border + 살짝 입힌 배경 색상. CRITICAL=red-50/border-l-red-500, PAYMENT=orange, POLICY=blue, INFO=white 등. 아코디언 닫혀 있어도 한눈에 우선순위 인지. DetailClient.tsx 적용. **재발 방지**: 신규 notice type 추가 시 NOTICE_CARD_TONE 에도 항목 추가 필수.

---

## ERR-calendar-month-discoverability@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:975`

- [ ] **ERR-calendar-month-discoverability@2026-04-27** (UX — 다음 달 출발일 인지 부재): DepartureCalendar 가 가장 빠른 출발월에 자동 진입하지만, 그 이후 다음 달에 더 많은 출발일이 있어도 사장님/고객이 "다음 달" 버튼을 눌러야만 인지. 캐슬렉스 케이스(5월 3건 + 6월 6건)에서 5월 화면만 보고 6월 더 많다는 걸 못 봄. **해결** (P2): 캘린더 상단에 출발 가능 월 chip row 추가 — `5월(3) | 6월(6)` 같이 클릭 한 번에 점프. 2개월 이상 분포가 있을 때만 표시. **재발 방지**: 시간 분포 데이터는 항상 "현재 뷰 + 분포 미리보기" 동시 노출.

---

## ERR-fixed-commission-column@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:976`

- [ ] **ERR-fixed-commission-column@2026-04-27** (구조적 — 정액 마진 워크어라운드 정리): 랜드부산(9만원/건) · 후쿠오카(10만원/건) 등 정액 마진 랜드사 정산 시 `commission_rate=0` + `special_notes`/`internal_notes` 메모 워크어라운드 사용. 메모 텍스트 누출 위험(ERR-special-notes-leak 트리거) + 정산 자동 합산 불가. **해결** (P1 #5, 사장님 명시 승인 후): ① migration `commission_fixed_amount` (NUMERIC) + `commission_currency` (TEXT default KRW) 추가. ② 기존 정액 4건(LB-FUK 2 + LB-TAO 2) 백필 — FUK 100,000원, TAO 90,000원. ③ `createInserter()` 에 `commissionFixedAmount`/`commissionCurrency` 파라미터 추가, 정액 모드 시 `commission_rate=0` 자동. ④ `dump_package_result.js` 가 정액일 때 "commission: 90,000원/건 정액" 통화별 한국어 표기. ⑤ FIELD_POLICY + register.md 사용 가이드 갱신. **재발 방지**: 신규 등록에서 정액 마진은 항상 컬럼에 명시 — `internal_notes` 에 메모 중복 기재 불필요. 회귀 — TBD.

---

## ERR-bootstrap-manual-toil@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:977`

- [ ] **ERR-bootstrap-manual-toil@2026-04-27** (구조적 — 어셈블러 신규지역 수기 생성): 신규 지역의 3번째 등록 시점에 Agent 가 수기로 어셈블러를 생성(BLOCKS 추출 + TEMPLATES + parseRawText 작성)해야 했음. 매번 60~120분 토큰·시간 소비 + Agent 가 BLOCKS 누락하거나 keywords 단순화로 향후 매칭 정밀도 손상. **해결** (P3 #1): [db/auto_bootstrap_assembler.js](../../db/auto_bootstrap_assembler.js) 추가 — 등록된 N개 상품의 `itinerary_data` 에서 `▶...` 마커 활동 빈도 추출 → BLOCKS 자동 생성, accommodations → hotel_pool, airline → AIRLINES, 절반 이상 등장 inclusions/excludes → 공통 패턴. 출력은 `assembler_<slug>.stub.js` (덮어쓰기 방지) 로, Agent/사장님이 keywords 정제 + TEMPLATES 작성 + parseRawText 구현 후 `.js` 로 rename. register.md B-2 에 호출 명시. **검증**: 장가계 (DYG, 6건) 로 테스트 → BLOCKS 20개 / 호텔 3개 / 항공사 1개 / 공통 inclusions 8개 / excludes 2개 자동 추출 성공. **재발 방지**: 신규 지역 N>=3 도달 시 항상 부트스트랩 스크립트 우선 사용 — 처음부터 수기 작성 금지.

---

## ERR-hotel-grade-roomtype-mixed@2026-04-27

> Original source before 2026-06-07 split: `db/error-registry.md:985`

- [ ] **ERR-hotel-grade-roomtype-mixed@2026-04-27** (구조적 — 컬럼 책임 분리 안 됨): `itinerary_data.days[].hotel.grade` 컬럼 한 개에 **호텔 등급 + 룸타입 + 호텔종류 + 호텔명 + 숙박정보** 가 섞여 저장됨. 사장님이 "디럭스룸/슈페리어룸은 룸타입이지 호텔등급이 아님" 지적. DB 분포 조사 (710건 기준): ✅ 진짜 등급 629건(13종 표기 변동: 5성/5성급/5+/정5성 등 → 정형화 필요) / 🛏️ 룸타입 35건(디럭스룸 21·슈페리어룸 14) / ❓ 비표준 숙박 28건(게르·크루즈·선실·"비지니스급"·"시외4성급") / 🏨 호텔종류 18건("리조트" 단독). 추가로 grade 에 호텔명("Vansana LPQ"·"Grand riverside")·숙박정보("3박"·"2인1실"·"5성급, 2인1실")까지 들어감. 영향: ① 모바일 별 표시 오작동 (ERR-HET-hotel-grade-ambiguity@2026-04-22 / ERR-HET-hotel-ger-star@2026-04-22 와 같은 패턴 — 별 4개 vs 5개 차이로 고객 혼동) ② 등급 필터/검색 결과 왜곡 ③ 신규 등록 시 어떤 값을 넣을지 컨벤션 부재 → AI 추측 → 환각. **해결**: ① register.md `Step 1.5-E` 에 표준 매핑 표 신설 — `hotel.grade` (3성·준3성·4성·준4성·5성·준5성·null 7종) / `hotel.room_type` (디럭스룸·슈페리어룸·스위트·가든뷰·시티뷰·오션뷰 — 신규 필드, 임시 note) / `hotel.facility_type` (resort·ger·cruise·cabin — 신규 필드). 비표준 숙박은 grade=null + facility_type. ② 원문 표기 정형화 매핑: "5성특급/5성+/정5성/5+/5성급" → "5성", "4.5성/준5성급" → "준5성", "시외4성급/비지니스급" → "4성"+note. ③ 결정 이력에 사장님 정책 명문화. ④ 백필 백로그: `db/backfill_hotel_grade_split.js` — 81건 분리 + 629건 정형화 (사장님 명시 승인 후). **재발 방지**: ① 신규 등록부터 Step 1.5-E 룰 자동 적용 (Agent self-check) ② 컬럼이 두 책임을 동시에 갖는 패턴은 ERR-special-notes-leak 와 같이 분리 필수 ③ 신규 컬럼 추가 시 "이 컬럼은 어떤 의미만 받는가?" frontmatter 명시.

---

## ERR-unmatched-stale-auto-trigger@2026-04-29

> Original source before 2026-06-07 split: `db/error-registry.md:988`

- [ ] **ERR-unmatched-stale-auto-trigger@2026-04-29** (인프라 — alias 적립 후 자동 sweep 자동화): ERR-unmatched-stale-after-alias@2026-04-29 의 sweep 스크립트가 사장님 수동 실행 의존. alias 적립할 때마다 사장님이 `node db/resweep_unmatched_activities.js` 실행해야 → 부담. **해결** (2026-04-29): ① [src/lib/unmatched-resweep.ts](../../src/lib/unmatched-resweep.ts) 신규 — `resweepUnmatchedActivities(attractionIds?)` 헬퍼. attractionIds 명시 시 좁은 sweep (해당 attraction(s) 만 매칭, ~50ms), 미명시 시 전체 sweep. ② [PATCH /api/attractions](../../src/app/api/attractions/route.ts) hook — name/aliases 변경 시 즉시 좁은 sweep 자동 트리거. 응답에 `sweep` 필드 포함 (matched 카운트). ③ [POST /api/attractions](../../src/app/api/attractions/route.ts) hook — 신규 attraction 추가 시 같은 sweep. ④ [GET /api/cron/resweep-unmatched](../../src/app/api/cron/resweep-unmatched/route.ts) 신규 cron — 매일 01:30 UTC 전체 안전망 sweep (Supabase 대시보드 직접 편집·hook 실패 케이스 보강). [vercel.json](../../vercel.json) crons 등록 + [middleware.ts](../../src/middleware.ts) PUBLIC_PATHS 등록. ⑤ [db/resweep_unmatched_activities.js](../../db/_archive/resweep_unmatched_activities.js) 수동 CLI 도 유지 (긴급 정리용). **재발 방지**: ① alias 적립 → 자동 sweep → 사장님 수동 단계 0 ② Supabase 대시보드 직접 편집은 cron 이 일일 catch-up ③ TS 모듈로 추출 → 신규 호출처 (예: 어드민 일괄 alias import) 도 동일 함수 재사용. type check 통과.

---

## ERR-DAD-excludes-dot-separator@2026-05-01

> Original source before 2026-06-07 split: `db/error-registry.md:989`

- [ ] **ERR-DAD-excludes-dot-separator@2026-05-01** (W32 위반 — excludes 구분자 원문 불일치): TB-DAD-05-04~07 (투어비 다낭 4건) 의 `excludes[1]` 가 `마사지팁 60분 $2·90분 $3·120분 $4` 로 중간점(`·`) 사용. 원문은 `마사지팁 60분 $2, 90분 $3, 120분 $4` (쉼표+공백). W32 는 schedule·inclusions 를 검사하지만 **excludes 는 대상 외** 라서 자동 감지 안 됨. 원문 대조 수동 감사에서 발견. **근본 원인**: 작성 시 콤마 구분 항목을 W26(depth-0 콤마 금지)을 의식해 `·` 로 변환했으나 이 항목은 단일 텍스트이므로 변환 불필요 + 비verbatim. **해결**: ① DB 즉시 수정 — `array_replace(excludes, '마사지팁 60분 $2·90분 $3·120분 $4', '마사지팁 60분 $2, 90분 $3, 120분 $4')` 4건. ② 레거시 DAD 등록 스크립트의 `EXCLUDES[1]` 를 원문 verbatim 으로 수정. **재발 방지**: W26(depth-0 콤마 금지) 은 배열 **분리 기준**이 되는 콤마만 금지. 단일 항목 내 설명용 콤마(`60분 $2, 90분 $3`)는 허용. 혼동 방지 — excludes/notices 작성 시 "이 쉼표가 항목을 나누는가?"를 체크. 추후 W32 를 excludes 까지 확장 검토.

---

## ERR-DAD-highlights-inclusions-hardcode@2026-05-01

> Original source before 2026-06-07 split: `db/error-registry.md:990`

- [ ] **ERR-DAD-highlights-inclusions-hardcode@2026-05-01** (구조적 — itinerary highlights 호텔별 특전 누락): `makeItinerary()` 팩토리 함수가 `highlights.inclusions` 를 항상 `INCLUSIONS_BASE` (22개 공통 항목만)로 하드코딩. 호텔별 특전 (`신라모노그램 망고빙수·미니바` / `메리어트 4인+ 풀빌라 업그레이드`) 이 `highlights` 에 포함 안 됨 → 모바일 핵심 노출 섹션에 호텔 차별화 포인트 누락. DB 는 `jsonb_set` 사후 수정으로 이미 보정됨. **근본 원인**: 팩토리가 "호텔 비종속 공통 정보" 만 반환하도록 설계됐으나 `highlights.inclusions` 가 마케팅 노출 SSOT 이므로 호텔별 전체 목록이 필요. **해결**: ① `makeItinerary()` 에 `highlightsInclusions` 파라미터 추가 — 미전달 시 `INCLUSIONS_BASE` fallback. ② 4개 call site 에 각각 `INCLUSIONS_신라`/`INCLUSIONS_메리어트` 전달. **재발 방지**: 복수 상품을 생성하는 팩토리 함수는 "상품별 가변 데이터를 파라미터로 명시 수신" 원칙. highlights 같은 마케팅 노출 필드는 절대 공통 BASE 하드코딩 금지.

---

## ERR-unmatched-stale-after-alias@2026-04-29

> Original source before 2026-06-07 split: `db/error-registry.md:992`

- [ ] **ERR-unmatched-stale-after-alias@2026-04-29** (인프라 — alias 적립 후 기존 unmatched 큐 stale): 사장님이 attractions.aliases 적립 또는 신규 attraction 등록해도 그 이전에 적재된 unmatched_activities 항목은 stale 상태로 남음. 다자이후텐만구 aliases 8개 추가 후에도 시내 패키지 등록 시 적재된 "▶학문의 신을 모신 다자이후 천만궁" 이 unmatched 큐에 그대로. 사장님이 어드민 unmatched 페이지에서 "이미 처리된 항목" 을 또 보게 됨. **해결** (2026-04-29): ① [db/resweep_unmatched_activities.js](../../db/_archive/resweep_unmatched_activities.js) 추가 — resolved_at IS NULL 인 unmatched 전체 fetch + Step 7-F 와 동일한 매칭 로직으로 재매칭 + 매칭 성공 항목 resolved_at/resolved_kind='auto_resweep'/resolved_attraction_id set. ② attractions 전수 fetch (Supabase 기본 limit 1000 우회 — range pagination 으로 1187개 모두). ③ status 컬럼은 그대로 유지 (check constraint 호환 — 'pending'/'ignored' 만 허용). 어드민 페이지가 resolved_at IS NULL 로 필터링하므로 처리 큐에서 자동 제외. ④ DRY_RUN=1 옵션 — 미리보기 가능. **결과** (2026-04-29 1차): 454건 → 275건 (39% 일괄 정리 / 179건 매칭 성공). 카멜리아 4건 미매칭은 29 → 23 (7건 정리, 잔량 19건은 attractions 테이블에 없는 신규 명소 — 사장님 어드민 처리 대상). **재발 방지**: ① alias 적립 후 sweep 자동 트리거 (PATCH /api/attractions 에 hook 추가, P3) ② 또는 cron 으로 일일 sweep 자동화 (현재는 수동 실행). 자동 시드는 안 함 (ERR-20260418-33 정책 준수).

---

## ERR-PackageCard-ferry-airline@2026-04-29

> Original source before 2026-06-07 split: `db/error-registry.md:994`

- [ ] **ERR-PackageCard-ferry-airline@2026-04-29** (UX — 페리 패키지 카드에 "선박" 만 노출): [getAirlineName](../../src/lib/render-contract.ts#L287) 가 "카멜리아 (선박)" 입력 시 AIRLINE_MAP 매칭 실패 (카멜리아 미등록) → parenMatch fallback 으로 괄호 안 텍스트 "선박" 반환. PackageCard 가 항공사 자리에 "선박" 만 표시 (회사명 누락). 4건 카멜리아 후쿠오카 패키지 등록 후 사장님이 PackageCard.tsx 를 IDE 로 열어 확인 → 잠재 이슈 발견. **해결** (2026-04-29): [render-contract.ts:271](../../src/lib/render-contract.ts) AIRLINE_MAP 에 페리 회사 3개 추가 — `'카멜리아': '카멜리아', '부관훼리': '부관훼리', '뉴카멜리아': '뉴카멜리아'`. 검증: "카멜리아 (선박)" / "카멜리아" / "카멜리아 페리" 모두 "카멜리아" 정상 매핑, 기존 BX781 (에어부산) 회귀 통과. **재발 방지**: 신규 운항 회사(페리·기차·전세버스) 추가 시 AIRLINE_MAP 등록 — 한글 키 허용. parenMatch fallback 은 정말 필요한 case 외엔 신뢰하지 말 것 (괄호 안에 "선박" 같은 일반명사가 자주 들어감).

---

## ERR-FUK-render-audit-falsepos@2026-04-28

> Original source before 2026-06-07 split: `db/error-registry.md:996`

- [ ] **ERR-FUK-render-audit-falsepos@2026-04-28** (UX — 신규 등록 직후 production ISR 미완료가 audit 실패로 오인): post-audit 가 yeosonam.com production HTML 을 fetch 해 "최저가 표시" / "호텔명 표시" / "항공편 표시" 검사. 신규 등록 직후엔 production ISR 가 on-demand 빌드 전이라 폴백 HTML(2~3KB)로 응답 → "❌ 최저가 표시" 경고가 사장님께 잘못된 신호 전달. 데이터 자체는 정상이나 환경 의존 false-positive. TB-FUK-04-02 (소도시+후쿠오카) 등록 시 발견 — 이전 3건 (TB-FUK-03-01/02, 04-01) 도 동일 패턴이었으나 우연히 ISR 시점 통과. **해결** (2026-04-28): [post_register_audit.js:601+](../../db/post_register_audit.js) HTML 길이 < 5000 bytes 면 "⏳ 렌더 검증 SKIP — production ISR 빌드 미완료로 추정 (신규 등록 직후) / 5~30초 후 정상 노출. 데이터 자체는 정상." 친화적 메시지로 출력. errors/warnings 추가 안 함 (이미 그러했으나 표시만 잘못 — "❌" 가 시각적으로 BLOCKED 처럼 보임). **재발 방지**: production HTML 검증은 항상 페이지 빌드 시점 의존성을 인지 — 짧은 HTML 은 audit fail 이 아니라 "검증 미실시" 로 분류. 정확한 검증은 ISR revalidate 후 retry 또는 dev 서버에서만.

---

## ERR-BHO-TB-01@2026-04-30

> Original source before 2026-06-07 split: `db/error-registry.md:1006`

- [ ] **ERR-BHO-TB-01@2026-04-30** (verbatim — inclusions 항목 AI 자동 변환): 투어비 보홀 10개 패키지 INSERT 시 inclusions 두 항목이 원문 verbatim이 아닌 AI 재표현으로 저장됨. ① `유류할증료(5월기준)` → `유류할증료(2026-05-31 발권 기준)` (발권기한 날짜로 대체). ② `한국인 매니저 안내(상시 카톡연결-현지맛집, 차량렌탈, 마사지샵, 해양스포츠 등 예약대행)` → `한국인 매니저 안내(상시 카톡연결)` (뒷 절 절단). 두 항목 모두 W32 verbatim 게이트에서 `audit_status=warnings` 로 정상 탐지됨. **해결**: 등록 후 Supabase MCP SQL `array_replace()` 로 10개 패키지 일괄 수정. **근본 원인**: AI가 inclusions 작성 시 "자연스럽게 의미를 보완"하는 패턴 — 발권기한과 유류할증료 적용 시점을 혼동, 긴 텍스트를 축약. **재발 방지**: ① `register.md Step 1-b` 신규 섹션에 금지 변환 예시 표 추가 (2026-04-30). ② BHO 어셈블러(`assembler_bho.js`) 사용 시 activityNote + inclusions 를 원문 verbatim으로 전달하는 패턴 강제. ③ W32 게이트가 INSERT 전 차단하므로 자동 탐지는 보장됨.

---

## ERR-BHO-TB-02@2026-04-30

> Original source before 2026-06-07 split: `db/error-registry.md:1008`

- [ ] **ERR-BHO-TB-02@2026-04-30** (코드 — insert-template.js helpers 잘못된 import 패턴): `flight`, `normal`, `optional` 등 helpers 함수를 `require('./templates/insert-template')` 에서 module-level export 로 구조분해 시도. 해당 함수들은 `createInserter()` 가 반환하는 객체 내부에만 존재함 (`{ run, helpers: { flight, normal, ... } }`). **해결**: `const { helpers: { flight, normal } } = inserter;` 패턴 사용. **재발 방지**: ① `register.md Step 1-b` 에 올바른 helpers destructuring 예시 추가. ② BHO 어셈블러가 내부에서 `inserter.helpers` 를 받으므로 랜드사 스크립트에서 직접 접근 불필요 (어셈블러가 캡슐화).

---

## ERR-BHO-TB-03@2026-04-30

> Original source before 2026-06-07 split: `db/error-registry.md:1010`

- [ ] **ERR-BHO-TB-03@2026-04-30** (코드 — computeRawHash module.exports 미포함): `insert-template.js` 에 `computeRawHash` 함수가 정의되어 있으나 `module.exports` 에 포함되지 않아 `require()` 로 import 불가. 매 스크립트마다 `crypto` 로 중복 정의 필요. **해결**: `module.exports` 에 `computeRawHash` 추가 (2026-04-30). BHO 어셈블러는 `rawText` 를 받아 내부에서 hash 자동 계산하므로 외부 노출 불필요. **재발 방지**: insert-template.js 신규 유틸 함수 추가 시 반드시 exports 동반.

---

## ERR-BHO-TB-04@2026-04-30

> Original source before 2026-06-07 split: `db/error-registry.md:1012`

- [ ] **ERR-BHO-TB-04@2026-04-30** (데이터 — 원문 날짜 표기 OCR/인쇄 오류로 월 잘못 기재): 투어비 보홀 원문 가격표의 `8/2,3,9,10,16 수목` 행이 실제로는 **9월** 날짜 (2026-09-02=수, 09-03=목 ... 확인). 원문에 "8"로 인쇄되어 있으나 2026년 8월 2일=일요일로 수요일과 불일치. 요일 대조 결과 9월로 교정. **해결**: 날짜-요일 불일치 탐지 후 인접 월 탐색으로 교정. 9월로 정정하여 PRICES_3D5 행렬 구성. **재발 방지**: `db/lib/parse-price-table.js` 신규 유틸 — `parsePriceRows()` 가 날짜-요일 불일치 자동 탐지 + 인접 월 교정 + anomaly 보고 (2026-04-30). 앞으로 BHO 어셈블러 가격표 파싱 시 이 유틸 사용 권장.
