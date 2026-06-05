# Product Registration Accuracy Plan

Last updated: 2026-05-31

## 2026-06-05 Current Operational Contract

The current source of truth for upload registration, customer mobile landing, and A4 readiness is `docs/product-registration-current-ssot.md`.

This plan remains a supporting evidence/accuracy strategy. Do not use it as the execution playbook when it overlaps with the current SSOT.

## Goal

Travel product registration must preserve the supplier source exactly, then generate mobile landing pages and A4 posters from a single verified render contract. The target is not a nominal 100% AI confidence score. The target is that every customer-visible claim is either:

- copied from the original source with traceable evidence,
- deterministically derived from copied source data, or
- explicitly labeled as a platform standard fallback such as standard cancellation terms.

Anything else must stay in review and must not become customer-visible.

## Preferred Input: Supplier Raw Text

For customer-ready automation, the operator-facing preferred source is the supplier raw text exactly as received.
`YSN-PRODUCT-MD v1` is an internal normalization/debug format, not an operator workload.
When the upload text already contains this marker, `/api/upload` bypasses LLM parsing and uses a deterministic parser.
For ordinary supplier PDFs/HWP/text, the path is:

`raw supplier source -> NormalizedIntake/YSN-style canonical sections -> deterministic write -> source evidence -> render audit -> publish gate`.

Required sections:

```markdown
YSN-PRODUCT-MD v1

## 기본정보
- 상품명:
- 목적지:
- 국가:
- 상품타입: 패키지
- 여행스타일: 3박5일
- 출발공항:
- 항공:
- 출발편: LJ115 21:35 부산 -> 00:25 나트랑
- 귀국편: LJ116 01:00 나트랑 -> 06:40 부산
- 출발요일:
- 최소출발:
- 발권마감:
- 랜드사:
- 커미션:

## 가격
| 라벨 | 날짜 | 성인 | 아동 | 상태 | 비고 |
| --- | --- | --- | --- | --- | --- |
| 기본 | 전 출발일 | 619,000원 | 619,000원 | 가능 | |

## 포함
- 왕복항공권

## 불포함
- 가이드/기사 경비

## 선택관광
- 관광명 | $30/인 | 현지결제

## 일정
### DAY 1 | 부산, 나트랑 | 호텔명(5성) | 조:X / 중:X / 석:X
- 21:35 | LJ115 부산 출발 | flight
- 00:25 | 나트랑 도착 | flight
```

Operational rule:
PDF/HWP/text remains supported, and the operator must not be required to rewrite it by hand.
The system performs the normalization step and stores the raw source as the immutable evidence base.
This reduces token usage and gives exact line-level source text for customer-facing landing pages.

Approval rule:
The package approval API recomputes final render claim coverage at the moment of approval.
Even if an earlier async audit was clean, approval is blocked when a mobile landing/A4 claim has no source evidence.
This makes `active` mean customer-deliverable, not merely parsed.

## Current Failure Pattern

The Nha Trang/Dalat upload exposed a structural issue:

- `raw_text` and `raw_text_hash` were saved, but extracted fields did not carry source spans.
- `ai_quality_log.failed_checks` contained V3/CoVe failures, while `upload-verify` could still write `audit_status=clean`.
- A late CoVe failure could arrive after an earlier clean audit signal.
- Upload and CLI audit paths could auto-promote clean packages to `active` before a human review.
- DAY5 return arrival could be typed as `normal`, so flight normalization missed the inbound flight.

The visible symptom was misleading: UI could show source comparison passed while confidence and quality logs still had real render risks.

## Non-Negotiable Invariants

1. `raw_text` is immutable source evidence. It must not be summarized, reformatted, translated, or merged with inferred text.
2. `raw_text_hash = sha256(raw_text)` must be stored with every package and every normalized intake snapshot.
3. Mobile landing and A4 poster must consume `renderPackage(pkg)` or a successor Canonical Render Contract only.
4. `audit_status=clean` is allowed only when upload verify, V3 quality checks, CoVe, and mobile QA have no failed customer-visible checks.
5. `status=active` must require explicit approval. Clean audit means approve-able, not auto-approved.
6. A customer-visible field without source evidence must be downgraded to review unless it is a clearly labeled standard fallback.
7. Sensitive/internal values such as land operator commission, net price, supplier memo, or B2B terms must never reach render fields.

## Target Architecture

### 1. Raw Source Layer

Store exactly what arrived:

- original file/text bytes or extracted text,
- `raw_text`,
- `raw_text_hash`,
- source filename,
- extraction engine version,
- normalized intake IR snapshot.

This layer is never edited after insert. Corrections create a new version.

### 2. Evidence-Aware IR

Before writing `travel_packages`, convert source into an intermediate representation:

```ts
type EvidenceSpan = {
  rawTextHash: string;
  start: number;
  end: number;
  quote: string;
  confidence: number;
};

type EvidenceValue<T> = {
  value: T;
  source: 'raw' | 'deterministic' | 'standard_terms' | 'manual';
  evidence?: EvidenceSpan[];
};
```

Required evidence fields:

- title, destination, duration, nights,
- departure dates and day-of-week,
- adult/child prices,
- flight numbers and times,
- ticketing deadline,
- min participants,
- inclusions/excludes/surcharges,
- itinerary schedule items,
- hotels,
- optional tours,
- cancellation/refund terms.

### 3. Deterministic First, LLM Last

Use cheap deterministic parsers before LLM calls:

- filename rule parser for land operator/commission,
- price table parser,
- day table parser,
- flight segment normalizer,
- notices/terms extractor,
- sensitive-field sanitizer,
- attraction matcher.

LLM should only receive unresolved sections or ambiguous candidates. Full raw text should not be sent repeatedly.

### 4. Single Publish Gate

Create one publish decision object:

```ts
type PublishGate = {
  status: 'clean' | 'warnings' | 'blocked';
  checks: GateCheck[];
  sources: {
    uploadVerify: string;
    qualityLog: string;
    cove: string;
    mobileQa: string;
    renderContract: string;
  };
};
```

`travel_packages.audit_status` must be the merged result of this object. No separate subsystem may overwrite it with a weaker status.

### 5. Canonical Render Contract

Mobile and A4 should render from the same `CanonicalView`:

- flight header and per-day flight cards,
- hotel cards,
- inclusion/exclusion/surcharge sections,
- optional tours,
- notices and standard fallback terms.

Renderers must not re-parse raw package fields. Any new display rule goes into `render-contract.ts` or a shared helper.

## Token-Saving Strategy

Accuracy and token saving come from reducing LLM scope, not from weaker verification.

1. Exact raw/section cache first. If `normalized_intakes.raw_text_hash` matches and the previous IR is not rejected, reuse the IR and skip LLM.
2. Chunk by section: prices, itinerary, notices, terms, hotels, flights.
3. Hash every section. If a section hash is unchanged, reuse prior parse.
4. Run deterministic parsers first. Send only unresolved deltas to LLM.
5. Use similar-product retrieval only as guidance/few-shot examples, never as direct evidence for price/date/flight fields.
6. Use small models for classification and extraction; reserve stronger models for conflict resolution.
7. Use CoVe only on high-risk claims, not the whole package:
   - prices,
   - dates,
   - flights,
   - cancellation/refund,
   - customer-visible notices,
   - claims not backed by evidence spans.
8. Cache attraction matching by normalized activity and destination.
9. Store successful examples as few-shot retrieval snippets, but include only the closest section-level examples.
10. Never ask an LLM to rewrite the full customer page. Ask it to produce structured fields with evidence.
11. For supplier formats whose deterministic preflight extracts title, departure dates, prices, both flights, inclusions, exclusions, and day blocks, skip the upload LLM normalizer entirely.
12. CoVe should not re-check PAYMENT notice bullets that already have exact raw-text evidence; exact source coverage is stronger and cheaper than a second LLM judgment.

Expected impact:

- Lower prompt size by avoiding full raw re-processing.
- Fewer hallucinations because the model cannot invent unsupported fields silently.
- Faster reprocessing because unchanged source spans are reused.

### Similar Product Reuse Matrix

Similar products can save time and tokens, but only inside the right trust boundary.

| Reuse case | Current/target behavior | Can populate customer facts? |
|---|---|---|
| Identical raw text | `normalized_intakes.raw_text_hash` and upload duplicate handling reuse the prior result and skip re-parsing. | Yes, because the source is identical. |
| Identical section text | Target: section cache keyed by `{section_exact_hash, parser_version}` reuses only that section parse. | Yes for that unchanged section only. |
| Same supplier format, different facts | Current: `formatFingerprint`/`sectionFingerprints` guide the normalizer; deterministic preflight can skip the LLM when required fields are fully extracted. | Yes only when the new raw text itself supplies evidence. |
| Similar destination/itinerary | Retrieval may provide examples, supplier habits, and correction memories. | No. Similarity is guidance only, never proof. |
| Similar attraction names | Existing `attractions`/aliases can match and queue unmatched activities. | Yes only for existing DB matches; never auto-insert new attractions. |

Operational rule: a similar product may reduce prompt size, model choice, and verification scope, but it must not silently copy high-risk facts such as price, departure date, flight, minimum participants, cancellation/refund, or customer-visible notices.

Implementation rule: `sectionFingerprints[].hash` is a masked format hash and must never be used as a cache key for customer facts. Only `sectionFingerprints[].exactHash`, which preserves fact values before hashing, can drive exact section reuse.

## Research-Informed Operating Model

Use retrieval, caching, and verification in different trust zones:

- Retrieval/RAG is for pattern guidance only: supplier profiles, previous successful examples, and correction memories can shape prompts, but they are not proof for customer-visible facts.
- Exact cache is trusted only when raw text or section hash is identical and the cached IR was not rejected.
- Semantic similarity cache must not directly populate high-risk facts such as price, dates, flights, cancellation rules, or min participants.
- Structured output with schema validation is mandatory for LLM steps. A schema-valid result is still not publishable until source evidence and render coverage pass.
- Verification is claim-level and post-render. A correct DB row can still become a wrong mobile/A4 page if render logic transforms it.

This follows the practical lesson behind RAG-style retrieval, DSPy-style typed pipelines, GPTCache-style caching, DocETL-style document decomposition, and Chain-of-Verification style checking: use model calls to propose structure, then let evidence, schemas, deterministic code, and gates decide whether it can ship.

Reference anchors:

- Retrieval-Augmented Generation: https://arxiv.org/abs/2005.11401
- DSPy typed/self-improving LM pipelines: https://arxiv.org/abs/2310.03714
- Chain-of-Verification: https://arxiv.org/abs/2309.11495
- GPTCache-style LLM response caching: https://github.com/zilliztech/GPTCache
- DocETL-style document decomposition/ETL: https://github.com/ucbepic/docetl

## Phased Implementation

### Phase 0 — Already Applied

- Upload UI now displays final V3 confidence, not the early parser confidence.
- `upload-verify` merges `ai_quality_log.failed_checks` before writing `audit_status`.
- CoVe failures now downgrade `travel_packages.audit_status`.
- Upload and post-register audit no longer auto-promote clean packages to `active`.
- Flight normalization now coerces timed `normal` return-arrival rows into `flight` when source meta contains return flight information.
- Auto mobile QA checks the same origin as the upload request instead of a stale environment default.
- Standard markdown deterministic path can produce customer-deliverable mobile/LP output with source/render coverage 100%.
- Raw supplier upload now routes through the IR normalizer by default unless `RAW_UPLOAD_NORMALIZER_ENABLED=0`.
- Exact normalized-intake cache reuse is added for identical raw/section text via `normalized_intakes.raw_text_hash`.
- Forward IR extraction enriches required source evidence from the authoritative raw chunk before conversion.
- Section fingerprints now separate masked format guidance (`hash`) from exact fact-preserving reuse keys (`exactHash`), preventing similar-format products from borrowing price/date/flight facts.
- `src/lib/intake-section-cache.ts` defines the reusable section-cache entry boundary: label + `exactHash` + `normalizerVersion` must all match before a parsed section patch can be reused.
- `RAW_UPLOAD_SECTION_CACHE_ENABLED=1` gates the optional Supabase section-cache storage path. With the flag off, uploads compute candidates but do not touch storage.
- Cache writes are awaited within `RAW_UPLOAD_CACHE_STORE_TIMEOUT_MS` (default 1500ms, max 10000ms), so the next similar upload can reliably benefit from exact section reuse without letting a slow cache write block registration indefinitely.
- `applyIntakeSectionCacheEntries()` can merge exact cache hits back into an IR, but each label is confined to its own surface: price cannot alter itinerary, itinerary cannot alter price, and terms cannot alter flights.
- `evaluateSectionCacheCoverage()` maps exact cache hits to required customer fields and marks LLM input reduction ready only when every required field is covered.
- `RAW_UPLOAD_SECTION_CACHE_REDUCE_INPUT=1` can replace exact-hit sections with compact cache-hit markers before the LLM call. The cached patches are merged back into the IR afterward, and only when `evaluateSectionCacheCoverage()` says all required customer fields are covered.
- Section-cache telemetry is written to `ai_quality_log` via migration `20260531140353_ai_quality_section_cache_telemetry.sql`: hit count, reduced character count, reduce-ready flag, and replaced labels.
- `evaluateSectionCacheCanary()` turns reduce-ready sample count plus registration quality incidents into an operator-facing recommendation: collect more data, investigate quality, enable input-reduction canary, or continue canary.
- `/admin/registration-monitor` now surfaces both section-cache production telemetry and the offline golden-corpus eval, so input reduction is promoted only when runtime quality and fixture quality are visible together.
- Supplier raw deterministic preflight can now parse common free-form land-operator text directly:
  title, trip style, departure airport, airline, outbound/inbound flights, departure dates, adult/child prices,
  inclusions, exclusions, notices, and `1일차` day blocks.
- When deterministic preflight is complete, `/api/upload` skips the LLM normalizer. Verified sample:
  a Tourcoconut Nha Trang/Dalat variant registered in 6.65s with final confidence 94%, source coverage 100%,
  render coverage 100%, and `customer_deliverable=true`.
- Exact duplicate raw text is rejected/reused before reprocessing. Verified sample duplicate returned in 3.73s.
- CoVe skips PAYMENT notice bullets that are exact raw-text copies, avoiding false-positive warning escalation and saving verifier tokens.
- Middleware now allows service-role Bearer API calls before page-login redirects, so server-to-server upload verification exercises the actual API route.
- Regression coverage now pins the fast path:
  - Shared golden raw fixtures live in `src/lib/product-registration-golden-fixtures.ts`.
  - `src/lib/product-registration-evaluator.ts` converts the golden corpus into measurable gates: field pass rate, deterministic LLM-skip rate, duplicate second-pass skip rate, section-cache reduce-ready rate, reusable character count, and supplier-format scenario coverage.
  - `npm run eval:product-registration` prints the same metrics locally; `npm run eval:product-registration:ci` fails when any default gate is below 100%, including supplier-format scenario coverage.
  - The same command now also runs the customer-deliverability golden corpus from `src/lib/product-registration/golden-corpus/evaluator.ts`.
  - Customer-deliverability gates fail strict mode on any non-zero `priceRowsZeroCount`, `priceDatesZeroCount`, `destinationUnkCount`, `optionalTourPricePollutionCount`, or `deliverabilityBlockedCount`.
  - Current evaluator output: supplier raw fixtures 5/5 pass, customer deliverability corpus 12/12 pass, deterministic skip rate 100%, duplicate second-pass skip rate 100%, section reduce-ready rate 100%, scenario coverage 100%, and 3,049 reusable section characters across the seed corpus.
  - Current customer-deliverability corpus includes Cebu, Phu Quoc, Fukuoka, four Clark multi-product variants, and the supplier raw fixtures.
  - Current scenario coverage includes free-text itinerary, alternate labels, table-heavy price, multi-departure price, optional-tour-heavy, and noisy OCR samples.
  - `supplier-raw-deterministic-facts.test.ts` verifies the Nha Trang/Dalat raw format is LLM-skippable and produces a 5-day customer itinerary.
  - The same test also covers common alternate supplier labels such as `행사명`, `출발지`, `이용항공`, `가는편/오는편`,
    `출발일자`, `대인/소아`, `포함내역/불포함내역`, and `DAY 1`.
  - `customer-delivery-check.test.ts` verifies the same raw-derived package reaches `customerDeliverable=true` / `decision=allow`.
  - `tests/unit/cove_audit.test.ts` verifies exact raw PAYMENT bullets are not sent back through CoVe, while unsupported PAYMENT claims still are.

### Phase 1 — Evidence Spans

- Expand `normalized_intakes.ir.sourceEvidence` to all high-risk fields, not just the current publish-gate minimum.
- Backfill evidence spans from current `raw_text` where exact substring matching is possible.
- Keep the validator rule: customer-visible claim without evidence becomes `blocked` unless source is `standard_terms` or `manual`.

### Phase 1-B — Raw Supplier Standardizer

Build a visible internal standardization artifact for each upload:

1. `raw_text` stays immutable.
2. `NormalizedIntake` is generated from raw supplier text.
3. A YSN-style canonical markdown preview is generated from the IR for admin diff/debug only.
4. The operator sees only three states: ready, needs review, blocked.
5. Similar prior products appear as suggestions, never as silent facts.

### Phase 2 — Publish Gate Unification

- Introduce `src/lib/product-publish-gate.ts`.
- Move status merge logic out of individual routes.
- Require gate completion before `/api/packages/[id]/approve` accepts approval.
- Show gate sources and failed evidence in admin review.

### Phase 3 — Render Contract Lock

- Add tests that compare mobile LP and A4 output claim sets from the same `CanonicalView`.
- Block renderer code from importing parser-only helpers directly.
- Add fixture tests for recent incidents: Nha Trang/Dalat, Fukuoka, Danang, Bohol.

### Phase 4 — Token Budget Controls

- Add parse cache keyed by `{raw_text_hash, section_exact_hash, parser_version}`.
- Promote current `sectionFingerprints[].exactHash` into a measured section-cache lookup. Keep `sectionFingerprints[].hash` for prompt guidance and supplier-format analytics only.
- Persist `buildIntakeSectionCacheEntries()` output into the service-role-only `normalized_intake_section_cache` table from migration `20260531134441_normalized_intake_section_cache.sql`.
- Cache table shape: `normalized_intake_section_cache(label, exact_hash, normalizer_version, format_hash, char_length, raw_text_hash, patch jsonb, hit_count, created_at, updated_at)` with unique `(label, exact_hash, normalizer_version)` and service-role-only RLS.
- Use section cache hits for LLM input reduction only after the required field coverage matrix proves all omitted customer-visible facts have exact cache evidence.
- Keep `RAW_UPLOAD_SECTION_CACHE_REDUCE_INPUT` disabled until production telemetry confirms section-cache hit quality and customer-delivery gates remain clean.
- Tune `RAW_UPLOAD_CACHE_STORE_TIMEOUT_MS` only after measuring registration latency; the cache store is reliability work for future uploads, not a reason to slow down the current upload path.
- Watch `ai_quality_log.section_cache_reduced_chars` against customer-delivery failures before promoting input reduction beyond canary.
- `/admin/registration-monitor` shows section-cache hit, reduce-ready, reduced-char, and canary recommendation cards alongside existing registration quality metrics.
- Add LLM budget telemetry to `ai_quality_log`.
- Add a hard rule: if deterministic confidence is high and evidence spans are complete, skip LLM verification except high-risk CoVe spot checks.

### Phase 5 — Accuracy Dashboard

Track:

- source-backed field ratio,
- hallucinated claim count,
- render mismatch count,
- manual correction rate,
- token cost per successful product,
- time to approve.

### Phase 6 — Golden Supplier Corpus

The current deterministic fast path is proven for the Tourcoconut-style Nha Trang/Dalat sample.
Near-100% automation requires a maintained corpus, not a single success case.

Current seed corpus:

- `tourcoconut-nha-trang-dalat-free-text` — normal supplier labels, Korean day headers, LLM-skippable.
- `alt-label-phu-quoc-day-format` — alternate labels (`행사명`, `출발지`, `이용항공`, `가는편/오는편`) and `DAY 1` headers, LLM-skippable.

Add at least 3-5 real samples per high-volume land operator:

- compact free-text itinerary,
- table-heavy PDF/HWP extraction,
- multiple departure-date price variants,
- optional-tour heavy products,
- cancellation/refund special-term variants,
- noisy OCR samples.

Fixture format coverage should explicitly include label variants:

- product title: `상품명`, `상품명칭`, `행사명`,
- departure: `출발공항`, `출발지`,
- airline: `항공`, `이용항공`,
- flight legs: `출발편/귀국편`, `가는편/오는편`, `출국편/복편`,
- departure dates: `출발일`, `출발일자`, `출발날짜`, `출발일정`,
- prices: `성인/아동`, `대인/소아`,
- included/excluded: `포함사항/불포함사항`, `포함내역/불포함내역`,
- days: `1일차`, `DAY 1`, `제1일`,
- notices: `공지`, `비고`, `안내사항`, `주의사항`.

Each corpus item must assert:

- expected internal code parts,
- price row count and lowest price,
- outbound/inbound flight codes,
- day count and first/last flight rows,
- attraction matched/unmatched counts,
- source evidence ratio,
- evaluator metrics from `evaluateProductRegistrationCorpus()`:
  - `passRate`,
  - `deterministicSkipRate`,
  - `duplicateSecondPassSkipRate`,
  - `sectionReduceReadyRate`,
  - `sectionReusableChars`,
  - `scenarioCoverageRate`,
  - `missingRequiredScenarios`,
- render claim ratio,
- customer delivery decision,
- processing time bucket,
- whether LLM was skipped, exact-cache hit, section-cache hit, or LLM fallback used.

## Definition Of Done

The registration pipeline is considered near-100% ready only when:

- Every mobile/A4 customer-visible claim has evidence or an explicit fallback source.
- A package with any critical quality failure cannot be approved.
- A package cannot auto-activate immediately after upload.
- Mobile and A4 claim sets match for the same package.
- The Nha Trang/Dalat fixture passes with inbound return flight recognized.
- The Nha Trang/Dalat raw supplier fixture passes the deterministic LLM-skip fast path and customer delivery gate.
- Exact raw PAYMENT notice bullets do not trigger CoVe false-positive warnings.
- Identical raw text returns through duplicate/cache handling without re-parsing.
- Type-check and targeted regression tests pass.
