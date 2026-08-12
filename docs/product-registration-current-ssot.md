# Product Registration Current SSOT

Last updated: 2026-08-12

## Registration Kernel authority convergence (production schema hardened, 2026-08-12)

The product-registration authority is now defined by role, not by the historical V2/V3/V4/V5/V6 names. File parsers remain adapters, while canonical fact commit and customer publication have one authority boundary.

Implemented in branch `codex/product-registration-engine-v6-20260811`:

- The durable workflow interprets each source once. It no longer downloads the source and invokes `runUploadRegistrationPipeline()` again after canonical normalization.
- A canonical immutable revision is committed first. `products` and `travel_packages` are generated afterward by `project_product_registration_compatibility_atomic()` and are compatibility projections only.
- `catalog_products` is the tenant-scoped stable identity. Source blobs are deduplicated only inside `(tenant_id, sha256, byte_size)`, while every upload remains an append-only `source_document_uploads` event.
- `kernel` mode installs a database trigger boundary. Direct fact mutations to `products`, `travel_packages`, canonical revisions, and publication pointers are rejected unless the transaction is an approved registration, projection, or publication RPC. View/inquiry counters remain operationally writable.
- Correction requests require a replacement source document, reason, and requested-change ledger. They enter the same workflow, preserve the catalog identity, and create a new revision that supersedes the selected base revision; no mutable package patch is accepted as a correction.
- Explicit source flight times are never silently overwritten. If current OAG and Cirium observations independently agree on a different schedule, the registration is blocked. Published departures are rechecked at publish, D-90, D-30, and D-7; confirmed drift writes a `suspended` availability overlay before cached customer content can be served.
- Terms, hotel observations, golf observations, media rights, supplier profiles, cohort quality, availability overlays, proof, pointer CAS, and outbox records are revision/catalog/tenant scoped. Hotel, golf, and attraction masters are never auto-created from candidates.
- Customer/B2B/partner snapshot publication is channel-pointer based. Snapshot/proof/revision hashes and renderer build must match exactly, and proof no longer temporarily activates a package.
- IR, Band, reextract, and correction inputs use one tenant-scoped source store and one durable workflow in `shadow`/`kernel` mode. Supplied IR/preview data is candidate metadata, not evidence. Scan remains preview-only, while old stub/review/CRUD/approval mutation endpoints fail closed in `kernel` mode.
- Customer `/api/packages`, home, destination, and sitemap discovery resolve exact publication pointers and immutable snapshots regardless of the configured writer-authority mode. Mutable `travel_packages` rows can no longer become customer-visible through these catalog paths merely because their legacy status says active/published. Remaining blog/recommendation consumers must use the same channel reader before they are treated as publication surfaces.
- A schedule-drift suspension can be cleared automatically only after every transport segment is independently reverified by current OAG and Cirium consensus. The clear operation is compare-and-set and only removes an overlay whose reason starts with `FLIGHT_SCHEDULE_DRIFT:`; it cannot remove a manual suspension.

Deployment truth:

- Eighteen product-registration migrations from `20260808172425` through `20260811121526` were applied to the linked production Supabase in repository order and recorded as applied without rewriting unrelated historical migration entries. The production database was not reset or rolled back.
- Tenant/catalog/revision/snapshot/pointer null-or-placeholder blockers are now zero. The explicit schema finalizer passed as `product-registration-authority-hardened-1`, all tenant foreign keys are validated, and legacy publication RPC execution has been revoked.
- Production remains `authority_mode=shadow` with `publication_freeze=true`. This separates schema hardening from customer release: no new automatic pointer may be published while the freeze remains active.
- The pre-migration baseline was `travel_packages=989`, `products=862`, V5 revisions `2`, snapshots `14`, and publication pointers `1`, with four duplicate/ambiguous package-code groups and one unbound revision. These rows are preserved for shadow classification; they were not bulk-published.
- The old code-only identity backfill would have linked 813 product/package pairs across different tenants. `20260811115754_product_registration_tenant_identity_reconciliation.sql` now rejects those links, matches only same-tenant unique identities, and creates quarantined separate identities instead of guessing.
- Registration completion and customer publication are separate state axes. A source can remain `verified` or `degraded` while publication is `frozen`; freeze is no longer recorded as a false analysis failure.
- OAG/Cirium calls are protected by a durable operation ledger, request-hash conflict checks, a ten-minute lease, stored-result reuse, and a three-attempt ceiling. Reuse is scoped to one registration or one schedule checkpoint, so D-90 data is never reused as D-30/D-7 freshness evidence. Provider charging is recorded only for the call that owns the reservation.
- Existing inventory backfill is now a feature-flagged shadow workflow. It claims at most 25 packages, binds each run to the existing tenant/catalog identity, never publishes, and automatically heals a lost follow-up bind from a deterministic operation key. It is disabled unless `PRODUCT_REGISTRATION_V6_BACKFILL_ENABLED=1`.
- Runtime authority defaults to `legacy` unless `PRODUCT_REGISTRATION_AUTHORITY_MODE` is explicitly set. The V6 branch preview is explicitly scoped to `shadow`, platform tenant `00000000-0000-0000-0000-000000000001`, shadow enabled, publish disabled, backfill disabled, and publication frozen.
- The current authority scan is `authorized=1 legacy=143 unapproved=0`. The 143 legacy writers are a measured retirement ledger, not extra authorities: kernel database guards prevent them from changing canonical facts or publication.
- The latest verification passes TypeScript, authority/registration contracts, the full 684-file/5,154-test suite, and a production Next.js build with 389 static pages. The local build took about 14 minutes 38 seconds; when Supabase/blog build-time credentials are absent, sitemap generation returns no package/blog entries rather than falling back to mutable rows.
- The live mobile-readiness audit now treats an authoritative customer pointer as the definition of public. Two legacy active/published samples both failed: the pointerless Kota Kinabalu row, and the Fukuoka row whose 85 saved price dates disagree with its 84-date snapshot and whose mobile proof/customer-open contract are stale or blocked.
- A real Matsuyama HWP canary now reaches terminal `published_degraded` in shadow. Its 10 date-price pairs, 3-day/2-night itinerary, BX134/BX133, 7 inclusions, 5 exclusions, and customer-safe cancellation notice match the source; 8/8 critical/high claims are evidence-backed. Its exact snapshot passed real 390x844 serverless-Chromium `/packages` and `/lp` rendering, CTA interaction, snapshot/build lineage, required/forbidden-text, image-integrity, and hydration checks. Publication remained frozen and no pointer was created.
- The canary is safe degraded, not premium visual-ready: it has only a brand fallback image and its two flight times remain hidden until two current independent schedule sources corroborate them. Broad customer opening still requires representative-cohort error-budget evidence, media policy/provider completion, provider-backed schedule verification when exact times are promised, and shadow classification of the remaining 989 legacy rows.
- Full-page proof PNGs are stored only in tenant-scoped private Storage with SHA-256 and private artifact location in the proof result. Immutable snapshots can be re-proved after a deployment; a proof still passes only when its observed renderer build matches that proof run's expected build.

Safe deployment order:

1. Keep production publication frozen and the legacy backfill disabled.
2. Expand the successful shadow HWP path across representative supplier/layout cohorts and confirm terminal verified/degraded/blocked outcomes without moving customer pointers.
3. Complete media and schedule-provider policy, then pass live tenant/RLS, private Chrome proof, and bounded pointer/surface-convergence tests for the exact revision/snapshot hashes.
4. Reprocess the existing 989 rows in bounded shadow batches and retain duplicate/ambiguous identities in quarantine.
5. Promote one bounded cohort to `kernel`; remove the freeze only for an exact canary operation, then re-enable it until its error budget holds.
6. Retire remaining legacy writers and direct readers only after the authoritative reader and rollback-pointer path are proven in production.

## V6 통합 자동화 계약 (2026-08-11)

V6의 유일한 종료 결과는 `published_verified`, `published_degraded`, `blocked_action_required`이다. 완전 자동화는 모든 문서를 억지로 공개하는 것이 아니라, 모든 업로드가 검증된 공개·안전 축약 공개·안전 차단 중 하나로 자동 종결되는 상태를 뜻한다.

표준 흐름은 `source blob → EvidenceIR → segment → immutable V5 revision → typed facts → shared facts → policy → copy revision → immutable snapshot → private Chrome proof → CAS pointer → outbox convergence`이다.

- `travel_packages`는 호환 projection이며 신규 공개의 권위 원천이 아니다.
- 고객 목록·상세·LP·OG·제휴는 같은 publication pointer의 immutable snapshot을 읽어야 한다.
- proof를 위해 상품을 임시 `ACTIVE`로 바꾸지 않는다. proof는 signed private URL과 `snapshot_hash + renderer_build_id + route + viewport + locale`에 귀속된다.
- 항공 시간 누락은 두 독립 출처가 일치할 때만 보완하고, 충돌하면 숨기고 최종 확인 문구로 `published_degraded` 처리한다.
- 가격·출발일 연결, 통화, 취소조건, tenant/source hash가 불명하면 자동 공개하지 않는다.
- 관광지 master를 자동 생성하지 않으며, 미매칭 원문 일정은 일반 text로만 표시한다.
- V6 공개 기본값은 OFF다. 40개 HWP corpus, 실제 Chrome proof, 운영 pointer 수렴, 외부 provider 비용·보존 정책을 통과한 cohort만 점진적으로 연다.
- 운영 readiness는 관리자 전용 `GET /api/admin/product-registration/v6/readiness`에서 확인한다. 이 응답은 flag·proof·Chrome·provider·DB 계보를 비밀값 없이 판정하며, `readyForCanary`, `readyForPublication`, `readyForFullCohort`를 분리한다.

## V4 실행 기준 (2026-08-06)

상품등록은 `docs/product-registration-engine-v4-plan.md`의 V4 엔진을 기준으로 확장한다. 업로드 원문은 `product_source_documents`의 비공개 Storage에 먼저 보존하고, `upload_jobs`의 lease 가능한 단계 머신으로 추출·정규화·검수·고객 proof를 이어간다. HWP/HWPX는 구조 보존 `DocumentIR`로 변환하며, parser 버전·추출 hash·evidence를 저장한다.

고객 발행은 `/packages`와 `/lp`가 같은 public snapshot을 사용해야 하며, 카드/랜딩의 상품 ID·제목·목적지·가격·기간·대표 이미지가 다르면 publish gate가 차단한다. V4는 자동 저장과 자동 추출을 제공하지만, source evidence·customer-open contract·실제 모바일 proof가 없는 상품을 고객 공개 상태로 승격하지 않는다.

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

### V5 canonical entity-master requirement (2026-08-10)

The canonical worker must load the active attraction master before running V3/V5 matching and pass the same snapshot to every product section. An empty attraction array is not a valid fallback: it converts ordinary source-backed attraction lines into false unmatched blockers. If the master cannot be loaded, the job must fail closed with `ATTRACTION_MASTER_UNAVAILABLE`/`ATTRACTION_MASTER_EMPTY`, retain the source evidence, and create a review task. Matching may only resolve existing SSOT records; it must not auto-create attraction rows.

The attraction snapshot version/hash belongs in normalization lineage so that a master update creates a reproducible new revision instead of silently changing an old one.

### V5 strict readiness and price safety (2026-08-10)

- A normalization is `complete` only when every section is `ready_to_publish` and every completeness field is `confirmed` or `not_applicable`. A V3 `needs_review` result must never be promoted merely because it has no critical failure.
- Comma-formatted million prices are parsed as one token (`1,299,000` → `1_299_000`). Suffix matches (`299,000`) are invalid, and itinerary elevations, foreign-currency options, and local fees must not become base prices.
- When deterministic price IR yields a dated or ranged calendar, it is authoritative for the V3 ledger; the free-form line scanner is a guarded fallback for explicitly labelled single prices.
- V5 typed price projections preserve `specific_departure`, `date_range`, `weekday`, and `always` scopes without guessing a missing year.
- Price freshness and price integrity are separate gates: C14 blocks all-expired departure dates, while C12 still compares every source-backed row (including historical rows) against the DB so a stale product cannot hide a price mismatch behind `skip`.
- The admin upload queue surfaces V5 completeness counts (`confirmed`, `pending_supplier`, `conflicting`, `unavailable`, and publish-ready sections) beside the shadow status; “registered” is not presented as “customer-openable”.

### Customer Open Operational Gate

New supplier uploads are not "auto published." They become automatic customer-open candidates only after the same repeatable gate passes: registration schema, customer copy V2 safe repair, source-backed date-level price or source-backed applicable-period price/flight/hotel/entity checks, `/packages/{id}` proof, `/lp/{id}` proof, and `customer_open_contract`.

Customer exposure is decided by publication state and public snapshots, not by `status` or `audit_status` alone. `status` remains the sales/operations state, while `publication_state` is the customer-public state. Customer routes must prefer `public_package_snapshots` and must fail closed when a row has `publication_state in ('approved','published')` but no approved/published snapshot exists. The publish gate writes `package_publish_decisions`; hidden DB pollution, stale proof, broken attraction IDs, risky CTA copy, and unsupported title claims remain blockers even when the renderer can hide the affected section.

Final approval must not mark a package customer-active before the immutable public snapshot and publish decision are saved. The approval API must assemble final title/copy/repair data in memory and send it to `publish_package_snapshot_atomic()` as the package patch; the success path must not stage a separate `travel_packages` update before publication. `public_package_snapshots` upsert, `package_publish_decisions` insert, and the final `travel_packages.status='active'`/`publication_state` update happen inside one database RPC transaction. RPC persistence failure must return `PUBLIC_SNAPSHOT_SAVE_FAILED`, record `audit_report.public_snapshot_error`, and move or keep the package at `status='draft'` with `publication_state='blocked'`.

The operational gate is scripted so release readiness does not depend on memory or one-off audits:

```bash
npx tsx scripts/run-customer-open-operational-gate.ts --base=https://www.yeosonam.com
```

For process-level public snapshot generation auditing, use the read-only field classifier. It must report title, summary, price, itinerary, terms, optional tours, attractions, images, and customer copy as `generated`, `repairable`, or `blocked`, with repair actions that explain what source-backed generation step is missing:

```bash
npm run audit:public-snapshot-generation -- --json --limit=500
```

For a newly saved pending package rehearsal, run:

```bash
npx tsx scripts/rehearse-customer-open-candidate.ts --code=<INTERNAL_CODE> --base=https://www.yeosonam.com --json
```

The rehearsal must run with `autoOpen:false`. A pass means `customer_open_candidate`; a fail must end as `needs_human_source_review` with attempted repairs, remaining blockers, and next action. Do not expose the product to customers from a rehearsal result alone.

Saved package rehearsal includes the final re-proof step by default: after bounded repairs, if the only remaining blockers are `/packages` or `/lp` mobile proof blockers, it must regenerate real `hwp-mobile-browser-proof` evidence and reload `customer_open_contract` before reporting the final state. Use `--skip-proof-refresh` only for a dry diagnostic run where browser proof is intentionally deferred.

Stored mobile proof freshness is part of the same operational contract. A public screen audit can prove the current customer page is clean, but approval, blog, and marketing gates still require non-stale stored `/packages` and `/lp` proof hashes. Use the refresh selector before release work:

```bash
npm run refresh:customer-mobile-proofs -- --summary-only --json
npm run refresh:customer-mobile-proofs:apply -- --base=https://www.yeosonam.com --limit=50 --batch-size=10
```

The dry run must list only packages whose stored proof is missing, stale, hashless, surface-incomplete, or source-invalid. The apply run reuses the internal mobile proof renderer and must not publish or unpublish products by itself; it only refreshes `audit_report.mobile_browser_proof` and clears proof-required audit markers when the proof passes.

For upload-to-open preparation, pending rows can require the same real browser proof before they are opened. Use the explicit pending selector instead of trusting fetch-only AutoQA output:

```bash
npm run refresh:customer-mobile-proofs:pending -- --summary-only --json --status=pending_review
npm run refresh:customer-mobile-proofs:pending -- --apply --base=https://www.yeosonam.com --status=pending_review --limit=20 --batch-size=5
```

`auto-mobile-fetch-proof` is diagnostic evidence only. It must not satisfy `customer_open_contract`; customer-open proof must be stored with `source='hwp-mobile-browser-proof'` and include `/packages` and `/lp` CTA interaction checks.

Customer title claims are checked again at the public snapshot gate, even when the title generator already cleaned the copy. The same claim policy applies to subtitle, card badges, and LP summary copy so raw supplier title claims cannot re-enter through secondary surfaces. `출발확정` is never allowed in a customer title. `온천` may be a title theme or badge only when source evidence shows a real onsen-themed trip, such as an onsen town/ryokan/hotel/stay/theme, not a single included `온천욕` service. `5성`, `준5성`, or `특급호텔` may appear in customer title/subtitle/badges only when hotel-grade evidence exists in the source hotel/accommodation facts.

If a live sweep finds `active`/`approved` rows that fail `customer_open_contract` or stored mobile proof, treat that as a publication-state drift, not a copy-only issue. First audit, then demote unsafe public statuses so no raw status/API/listing path can treat them as customer-open:

```bash
npx tsx scripts/audit-package-public-eligibility.ts --status=active,approved --limit=5000 --json
npx tsx scripts/audit-package-public-eligibility.ts --status=active,approved --limit=5000 --demote-unsafe-public --json
```

The blog engine depends on the same proof. The `Blog Product Proof Refresh` GitHub Actions workflow runs daily before blog scheduling, refreshes active product proof, and requeues recovered product-backed blog candidates. This is the preferred recovery path for blog product posts blocked only by stale mobile proof; archiving the blog post is the fallback after proof refresh fails or the linked product is no longer customer-openable.

Baseline refresh is also part of this gate. `scripts/refresh-baselines.js` must use environment variables first, load `.env.local` only as a local fallback, accept `SUPABASE_SERVICE_KEY` when `SUPABASE_SERVICE_ROLE_KEY` is absent, and fail during preflight before Playwright when Supabase URL/key values are missing or invalid:

```bash
node scripts/refresh-baselines.js --dry-run
```

Golden paste E2E currently starts at 15 source shapes, not 10. The additional stress cases cover monthly weekday price grids, mixed multi-product catalogs, NET/selling-price lines, ticketing-deadline offers, and multi-currency local/optional expenses. New supplier formats that fail review must be promoted into this corpus or the upload review fixture-candidate report before being called resolved.

Schedule HWP batch learning from 2026-07-04 is now part of the same engine contract:

- If raw text contains source-backed departure weekdays but `travel_packages.departure_days` is empty, `upload_to_open_autopilot` may fill only that weekday label. It must not invent new departure dates.
- If raw text or saved accommodations contain hotel/resort/equivalent hotel lines but itinerary day `hotel.name` is empty, the autopilot may fill overnight days with the source-backed hotel candidate and record the repair. Surcharge, movement, check-in/out, breakfast, room-assignment, and hotel-policy lines are not hotel evidence.
- Ferry/ship products such as Tsushima Link departures are non-air transport packages. A missing `airline` must not block the quality scorecard when the source text proves ferry/ship transport; normal air packages still require airline evidence.
- Expired source products whose every departure date is before the current KST date are not customer-openable. They should be archived/saved with an audit reason instead of forced open.

### Text Paste Upload Contract

`admin/upload` treats supplier pasted text as the primary input path. File, HWP, OCR, and PDF parsing are helper paths that must produce text for the same central engine; they must not become a separate registration engine.

Normal pasted-text uploads must be allowed to complete inside the long-running upload route envelope. Do not send ordinary short supplier text to `upload_review_queue` only because it exceeds a short UI comfort timer. The replay queue is for heavy or likely multi-product inputs, unrecoverable validation failures, or true background recovery. When replaying a timeout row, a duplicate response that proves the package was already saved must resolve the queue row instead of leaving it as a failed or pending registration.

If an upload is deferred for replay, the admin upload UI must treat it as an active background registration, not a terminal failure. The UI should poll the replay-status endpoint by `queueId` or `uploadRequestId`, recover saved package IDs or duplicate internal codes, and immediately run the normal upload verification once replay resolves. Replay failures must surface the specific remaining blocker instead of a generic timeout message.

The original supplier text must never be overwritten during preprocessing. The intake layer may create a normalized analysis snapshot for broken line breaks, tabs, bullets, currency tokens, date tokens, and itinerary/table-like lines, but the snapshot is QA evidence only. Persist or return hashes, metrics, and change counts, not a second mutable source of truth.

Evidence is multi-source. `evidence.rawTextHash` remains the legacy representative hash, but `evidence.sourceDocuments[]` must carry the distinct source records used by registration: `original_raw`, `parser_raw`, `document_raw`, `section_raw`, and `analysis_normalized` when available. Evidence spans with `sourceId` must match the same source document's hash; sourceId/hash cross-wiring is invalid. Legacy spans without `sourceId` may still use the legacy representative hash or any registered source document hash for backward compatibility.

Before any product reaches DB persistence, the result of `registerProductFromRaw()` and bounded micro QA must satisfy `src/lib/product-registration/standard-registration-schema.ts`. The gate is both a Zod runtime validator and a JSON Schema contract for structured-output/eval tooling. A customer-deliverable registration requires source hash evidence, source-backed customer price evidence, and itinerary days. Date-level prices require non-empty `product_prices` and `price_dates`; supplier documents that only provide an applicable-period price such as `전 출발일` must carry source-backed `price_tiers` with a matching amount and period/departure-day basis. Schema failures are not partial successes; they must go to `upload_review_queue` with the preprocessing snapshot and structured diagnostics.

LLM or structured-output repairs may propose fields, but deterministic validation owns the final decision. Price/date/itinerary evidence that is weak, contradictory, or missing must stay `needs_review`; it must not be saved as a customer-openable package.

`product_prices.note` by itself is not price provenance. Price/date source evidence may be accepted only when the row carries an allowed provenance cue such as `source_`, `pdf_date_price_table`, `human_reader`, `document_raw`, `evidenceSpanId`, `evidenceHash`, or `sourcePriceIrId`, or when the original source text itself contains matching date/amount evidence. Option-sized, local-expense, golf-option, and optional-tour prices must not be promoted into `product_prices`; they should be preserved as excluded price candidates for later structured option handling.

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
- Korean catalog tables where return departure is on day N and arrival is on day N+1 must be paired as one inbound segment with `arr_day_offset=1`. Keep `day_pair` inside the itinerary day range, e.g. `[lastDayIndex, lastDayIndex]`, and let renderers show `익일 도착` from `arr_day_offset`.
- Meeting, hotel pickup, or airport-transfer times must not be reused as flight departure times when a later source time is tied to an actual `... 공항 출발` activity.
- A row must not be called recovered only because `extractSupplierRawDeterministicFacts()` found partial flight facts. Replay verification must also accept complete `buildSupplierRawDeterministicItinerary(...).flight_segments`.
- Before marking an upload ready, the flow must validate the final customer mobile/A4 payload, not just parser output.

## Customer Render Contract

Upload verification must fail before customer opening when the saved data would produce a broken mobile landing or A4 render.

LP date fallback must not invent a departure date. If no valid departure date exists, landing data must use `departureFullDate=null` and `departureDateLabel='미정'`; proof, lead forms, and cancellation-date formatting must handle the unknown date explicitly.

The customer LP must expose enough server-rendered product context to be audited without relying only on deferred lead UI. When source-backed `price_dates` exist, `/lp/{id}` must render a visible departure-date summary near the price block. Public HTML readiness must fetch and validate both `/packages/{id}` and `/lp/{id}`; if local env points `NEXT_PUBLIC_BASE_URL` to localhost, production public audits must use `NEXT_PUBLIC_SITE_URL` or an explicit `--base` value instead of treating localhost fetch failures as product failures.

The upload verify layer owns these customer-render gates:

- `C15 entity review gate`: unresolved customer-visible unmatched entities block clean verification. This includes pending attraction, optional_tour, notice, unknown rows, and shopping rows that are not confidently structured. Meal, transfer, confidently structured shopping, free_time, price_noise, and resolved hotel rows may pass only when they are non-blocking and not marked `needs_review`.
- Shopping review blockers must use the live pending unmatched queue, not stale V3 draft summary counts, because resolved shopping rows are structured schedule facts and must not require attraction master creation.
- `C16 customer render duration contract`: saved itinerary day count, duplicate day numbers, `itinerary_data.meta.days`, `itinerary_data.meta.nights`, `duration`, `nights`, and `trip_style` must agree. A product such as `2박 3일` must not carry `itinerary_data.meta.nights=1`.
- `C17 customer render entity contract`: schedule rows that are meals, shopping, options, notices, hotels, transfers, free time, or price noise must not carry attraction cards/photos. Meal-only tokens such as `꿔바로우`, shopping rows such as `면세점 1곳`, and hotel/service rows must not render as normal attraction timeline cards.
- Attraction enrichment must not stop just because a saved `attraction_query` fails to match. The engine must fall back to the full customer-visible schedule text before creating an unmatched review row, so registered attractions embedded inside a longer activity sentence are not missed. Broad DB repair runs must use additive-only mode first; any removal or metadata-only rewrite remains a review item unless explicitly approved.
- Mobile/A4 readiness audits must evaluate both `type` and `entity_kind` before reporting an unlinked registered attraction. Transfer, meal, shopping, optional tour, notice, free-time, hotel, flight, and price-noise rows are not attraction visits even when a destination or attraction name appears in the sentence.
- Mobile/A4 readiness audits must treat the live `unmatched_activities` queue as the current source of truth. `product_registration_drafts.match_summary` may be stale after repair/backfill jobs, so draft unmatched counts are allowed only when the live queue lookup fails, and that lookup failure must be recorded as a data query error. A resolved live queue must not keep products warning-blocked through stale draft counts.
- The mobile quality engine must run `auto-audit-entity-review-candidates` before final readiness auditing. This step may deterministically reject supplier tokens, price-table fragments, policy notices, and other non-master candidates, but must not create customer-publishable attraction records. Remaining review candidates continue to block or warn through the publish gate.
- Shopping, optional-tour, notice, and other customer-disclosure candidates are not attraction master candidates. Deterministic rules may mark source-backed shopping stops, option/activity descriptions, hotel-equivalent notes, photo disclaimers, holiday surcharge notices, personal-expense/tip notes, and standard schedule-change notices as `structured_non_master`/`rejected_noise` for master-candidate purposes. This must not invent public option pricing or hide unsupported paid-option claims; optional-tour public rendering remains governed by the source-backed optional-tour contract.
- V3 entity normalization must keep meal/menu fragments and flight-operation labels out of the attraction review queue. Standalone menu labels such as local dish names, buffet/seafood/lobster/set labels, and flight-operation labels such as regular/extra-flight markers are meal or notice facts, not unresolved attractions. Explicit shopping-stop count disclosures such as known shop categories plus "3 stops/visits" are customer disclosure facts, not attraction master candidates. Real place names that remain unmatched still go to the existing review queue; do not auto-create attraction masters.
- `C18 customer visible copy V2`: customer-visible DB fields and actual `/packages/{id}` plus `/lp/{id}` body text must be checked with the same deterministic copy-quality rules. Safe repairs include HTML entity decode, RMK/P.P/backslash price cleanup, `OR` -> `또는`, `월기준` spacing, `기사가이드경비` wording, `바나산 정산` -> `바나산 정상`, and low-information action sentences such as `OO로 이동합니다` -> `OO 이동`. Unsafe issues such as mojibake, internal/operator terms, and unresolved attraction placeholders remain blocking. Duplicate checks must target real customer-section duplication such as optional tour vs inclusion/highlight, not internal render helper fields such as `entity_kind`, `attraction_query`, `a4_sentence`, or `landing_sentence`.
- Public snapshots and customer payloads must recursively strip internal nested keys before rendering or storage. `랜드사`, `거래처`, `공급가`, `원가`, `마진`, `커미션`, `정산`, `관리자노트`, `내부메모`, `supplier`, `operator`, `commission`, and equivalent internal price/operator fields are never customer-visible, even when hidden inside `itinerary_data`, `optional_tours`, or nested product objects. Customer-facing fee lines such as guide expense remain allowed when they do not expose internal settlement or margin information.

These gates are not optional advisory checks. If any fail, the product can be saved for review, but it is not customer-openable and must not be described as mobile-landing-ready.

Approval requires a separate actual mobile browser proof. A clean source/render-contract audit is not final completion. Before any package can move to `active` or another customer-visible status, `audit_report.mobile_browser_proof.status` must be `pass`, the proof must include both `/packages/{id}` and `/lp/{id}` surfaces, and the proof must have been produced by the internal render-proof path. The proof payload must include `source='hwp-mobile-browser-proof'`, top-level `screen_hash` and `customer_visible_hash`, and the same hashes for each required surface result. The proof must also exercise the customer CTA path enough to confirm the reservation/lead sheet opens with customer-safe context. If this proof is missing, hashless, non-internal, or stale, approval must return `MOBILE_BROWSER_PROOF_REQUIRED` and leave the product non-public/blocked for review.

The internal render-proof path may use the `x-yeosonam-render-proof` header with a server-side secret to render a non-public `/packages/{id}` page for QA only. This does not make the product public to customers. It exists so AutoQA can inspect the exact customer page before approval instead of activating first and demoting after damage.

Customer opening also requires the unified registration quality scorecard. `src/lib/product-registration/registration-quality-scorecard.ts` scores ten domains: raw source preservation, structured JSON, price/date storage, itinerary/air/hotel parsing, attraction/hotel entity matching, customer copy cleanup, DB consistency, `/packages` mobile render, `/lp` mobile render/CTA, and learning ledger safety. Every domain must score at least 95, the average must be at least 97, blockers must be zero, customer-forbidden text must be zero, and `product_prices` must align with `price_dates`. `runUploadVerify()` persists the scorecard into `audit_report.quality_scorecard`; the package approval API re-evaluates the same scorecard and returns `QUALITY_SCORECARD_BELOW_95` instead of opening the product when the threshold is not met.

The customer-open contract also emits `registration_evidence_pack_v1`. This pack is the compact operational proof for approval, blog, and marketing handoff: raw source hash/length, price-date/product-price counts, mobile proof surfaces and staleness, scorecard failure domains, V3 status, source verify status, and downstream eligibility. Approval responses must expose `evidence_pack_status`, `stale_or_missing_proof`, and `downstream_blockers` so an operator sees repair/re-proof work instead of a vague block.

Scorecard failure is not a final outcome by itself. The central open path must first apply bounded deterministic repairs for safe issues, such as syncing `price_dates`, `price_tiers`, `products.net_price`, and `product_prices` from source-backed or saved price evidence, then regenerate mobile proof and re-score. Only non-repairable issues, stale/missing browser proof after retry, unsafe customer text, unresolved entity candidates, or V3 customer notice blockers may remain as review reasons.

`upload_to_open_autopilot` must also persist a repair-first summary. Its final customer-opening state is one of `openable`, `auto_fixed_openable`, or `needs_human_source_review`. `openable` means no repair was needed, `auto_fixed_openable` means deterministic repairs were applied and the customer-open contract passed after re-proof, and `needs_human_source_review` means the engine already attempted supported repairs but unresolved source/proof/entity/V3 blockers remain. This is the operator-facing status; do not leave a package at a vague blocked state without the repair summary, applied repair list, unresolved reasons, and next actions.

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
- Offline source audit is not customer-open proof. The 2026-06-20 upload-inbox audit improved price/date and flight recovery, but still had `customerReadyOffline=0` because itinerary/media/review blockers remained. Do not call a batch complete until the latest source audit, mobile landing payload, A4 payload, and browser/mobile render checks all pass.
- If the human-reader layer finds source-backed price/date evidence that the price recovery layer does not save, that is an engine wiring failure. Price recovery may use human-reader price pairs only when the date is tied to departure/price context; bare document issue dates such as standalone `2026.3.1` must not become departure dates.
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

The current customer page audit contract covers both `/packages/{packageId}` and `/lp/{packageId}`. `/packages` remains the full product detail/A4 semantic reference, but `/lp` is also a customer-visible surface and must pass public HTML and mobile proof checks before a product is treated as open-ready.

상품 등록 완료 검수의 고객 화면 기준은 `/packages/{packageId}`와 `/lp/{packageId}` 양쪽이다. `/packages`는 상품 원문 대조, 모바일 상세, A4 readiness의 상세 기준이고, `/lp`는 고객 유입 랜딩 surface이므로 가격, 출발 가능일, 일정, CTA, 고객 금지문구, broken text를 별도로 통과해야 한다.

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
Public snapshots must derive representative customer price from the minimum positive `product_prices.adult_selling_price` first, then `price_dates`. If the source explicitly provides an applicable-period basis such as `전 출발일` plus a matching adult selling price and departure-weekday/period evidence, source-backed `price_tiers` may provide the representative price even when exact `price_dates` are unavailable. A stale or internal top-level `price` must not override customer option rows and must never be used alone.
For the same `target_date` and same customer option/variant, conflicting positive `adult_selling_price` values are blocking. If `adult_selling_price` is absent, the gate may fall back to `net_price` for conflict detection, but customer-ready rows still require a positive `adult_selling_price`.

The central registration object must populate `product_prices.adult_selling_price` from `net_price` before the deliverability gate when no approved selling override exists. If a positive `product_prices.net_price` still has no positive `adult_selling_price` at gate time, customer deliverability is blocked.

For shared multi-column price tables, deterministic source-backed column selection must win over LLM/normalizer `price_tiers` when the raw table is recognized. This prevents product A from saving product B's same-date price options into `product_prices` or `price_dates`.

For any deterministic price IR where `source !== 'none'` and both `product_prices` and `price_dates` can be built, deterministic IR wins over LLM/normalizer `price_tiers`. LLM output is fallback evidence, not the first persistence source, when the raw table parser is complete.

LLM/Gemini price fallback must pass the strict fallback tier normalizer before it can be evaluated as a candidate. A fallback tier is ignored unless it has an integer KRW `adult_price` in the product price range and usable date evidence (`departure_dates`, `date_range`, or `departure_day_of_week`). Deterministic IR still outranks complete fallback tiers.

### Price Source Evidence Repair Contract

The mobile-readiness audit may run bounded source-evidence repairs for already saved packages, but only to make persisted rows match source-backed evidence that is already present in the package or product-price ledger. It is not a second parser and must not invent prices, dates, hotels, flights, or package availability.

Allowed repair classes:

- `--repair-price-storage`: rebuilds mismatched `product_prices`/`price_dates` alignment from existing saved price evidence.
- `--repair-price-tiers`: rebuilds `travel_packages.price_tiers` and summary price from valid saved `price_dates`.
- `--repair-price-source-evidence`: removes unsupported `price_dates` only when the audit can identify a concrete date that lacks source-backed amount evidence, at least one valid source-backed departure date remains, and replacement `product_prices`, `price_dates`, `price_tiers`, `travel_packages.price`, and `products.net_price` can be synchronized from the remaining evidence.

Forbidden outcomes:

- A date must not survive customer readiness because it merely exists in `price_dates`; the audit must be able to tie it to source-backed amount evidence or an approved saved product-price row.
- If pruning unsupported dates would leave no valid departure date, the package remains `needs_human_source_review`; do not replace the missing evidence with a guessed lowest price.
- Repair outputs are audit evidence, not final customer-open proof. Customer-ready still requires the registration quality scorecard, `/packages` and `/lp` mobile browser proof, and no unresolved entity/V3 blockers.

Attraction reference repair in this audit may only attach references to already registered active attraction masters. It may use explicit `--codes=` or `--status=` scope filters and may widen destination matching only when the itinerary row text itself contains the attraction region/context. It must not create, auto-seed, or customer-publish attraction masters; unmatched or ambiguous entities remain in the review path.

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
- Wikidata/OSM/official/manual evidence: free/open identity proof. A customer-publishable attraction candidate requires at least one identity source plus an independent supporting source.
- Google Places: optional paid place identity evidence for place id, address, region/country fit, maps URL, and place type. It is disabled by default even when a key exists. Calls require `GOOGLE_PLACES_ENABLED=true`, positive `GOOGLE_PLACES_DAILY_LIMIT`, and the per-candidate cap from `GOOGLE_PLACES_MAX_QUERIES_PER_CANDIDATE` (default 1). Use it only as a premium check for ambiguous attraction/hotel candidates after Naver, Wikidata, OSM, and supplier corpus evidence are insufficient.
- Supplier/internal evidence: occurrence and regional context. It can increase confidence but cannot bypass identity verification for new customer-visible master records.

The verification state is stored on `entity_master_candidates` as `auto_verification_status`, `verification_score`, `canonical_name`, `canonical_name_source`, `source_reliability_snapshot`, and `verified_at`. Each external lookup is logged in `entity_verification_attempts` so the engine learns from successful, empty, errored, and skipped checks.

Recommended actions:

- `reject_noise`: section headings, date/price fragments, movement tokens, URLs, and other non-entity scraps.
- `structure_non_master`: room types, shopping visits, golf product tags, golf fee fragments, table cells, and other useful structured data that should not become a master record.
- `create_internal_master`: probable attraction/hotel identity that can reduce future matching noise, but must remain hidden from customer payloads.
- `create_publishable_master`: only when the candidate has reliable independent external identity evidence and passes the publish gate.
- `needs_review`: optional tour, notice, unclear hotel, ambiguous shopping, and any customer-visible phrase with insufficient evidence.

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

## HWP Inbox Automation

For local batches of supplier `.hwp` files, prefer Hancom Office text extraction over adding a production HWP parser to the upload route. The local workflow is:

```text
data/product-registration/hwp-inbox/raw/*.hwp
  -> scripts/extract-hwp-inbox.ps1 using installed Hancom Office
  -> extracted/*.txt and prepared/*.txt
  -> offline source audit
  -> existing upload-inbox central registration scripts
  -> mobile/A4/browser proof gates before any customer-visible status
```

The raw HWP files, extracted text, prepared text, and reports are local-only and git-ignored. If operator cleanup is needed, edit the `prepared/` copy, not the `extracted/` source copy. The upload API remains an HTTP adapter; HWP-specific extraction must stay in local inbox tooling or the existing document parsing boundary, not in `src/app/api/upload/route.ts`.

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
npm run repair:product-mobile-readiness -- --status=pending,pending_review,draft --limit=200 --days=365
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

After deployment or remote DB/data changes, run the live readiness audit with `npm run verify:product-registration-learning:live`, `npm run verify:product-registration-live-samples:ci`, or `npm run audit:product-mobile-readiness:public` using the appropriate filters. Public release handoff must include the public HTML proof path (`--verify-public-html`) so a stale or broken `/packages/{id}` customer page cannot be reported as ready from DB/V3/A4 checks alone. Before release handoff, run `npm run verify:product-registration-learning:full` so the same regression gates, stored live-sample learning verification, live audit, and production build pass together.

The strict live audit must fail customer-visible samples when the latest V3 draft is `blocked`, `needs_review`, or missing. For non-public rows, stale V3 draft `needs_review` may be downgraded only when the current live unmatched/entity queues are clean, the draft gate has no explicit reasons, all remaining failed checks are stale match-summary queue checks, the live queue lookup succeeded, and the row has no current mobile/A4 readiness blockers. Flight, price, render, inclusion, option-publication, and other non-queue failed checks still block. This is a stale-state classification, not customer approval; a fresh V3 draft, public snapshot, and mobile proof are still required before publication. For attraction matching, the live `unmatched_activities` queue is authoritative because it reflects current repair/backfill state. `product_registration_drafts.match_summary.attraction_unmatched_count` is a fallback only when the live queue lookup itself fails, and that failure must keep the audit from reporting a fully clean data surface.

Non-public readiness warnings must name the real hold state. `needs_human_source_review` is reserved for rows that genuinely require a human to inspect the source; expired ticketing-deadline offers are `source_offer_expired_nonblocking`, and rows that need deterministic reprocessing or a fresh publish-gate pass but explicitly do not require human source review are `nonpublic_repair_review_required`. These labels do not make a product customer-openable; they prevent operators and agents from treating expired or repair-pending rows as manual content cleanup work.

When a live data sweep finds customer-invisible rows that fail mobile/A4 readiness, `npx tsx scripts/audit-product-mobile-landing-readiness.mjs --days=3650 --limit=2000 --json --archive-failed-nonpublic` may be used to quarantine those rows as `archived` with `audit_status=blocked` and an `audit_report`. This does not delete source data and must not be used to bypass the public V3 gate; public failures use `--demote-unsafe-public` instead.

## 2026-08-06 V4 하드닝 계약

V4는 원문 저장 뒤 파서 직전에 SHA-256과 파일 매직 바이트를 재검증한다. 불일치 원문은 `quarantined`로 닫고 고객 표면으로 진행하지 않는다. `DocumentIR` 구조 검증, 구형 `/api/upload`의 원문 보관 강제, 파이프라인 예외의 `failed` 종료, bounded retry(최대 5회), 승인 후 `published/done` lifecycle 동기화를 포함한다.

## Agent/Harness Setup

General AI harness and documentation automation rules live in `docs/ai-agent-doc-automation.md`.

This product-registration SSOT only records product-registration behavior. If a generic AI/prompt/eval/memory rule is needed, update `docs/ai-agent-doc-automation.md` instead of duplicating it here.

## 2026-08-07 V4 canonical normalization and OCR status

- Canonical normalization is now persisted append-only in `product_registration_v4_normalizations`, keyed by source document, extraction, normalization version, and raw-text hash. The record contains deterministic itinerary sections, the V3 customer payload, source evidence references, quality diagnostics, and the gate status.
- The V4 cron runs the extraction worker and then the canonical segmentation/normalization worker. Extraction completion queues the job at `extracted`; normalization claims it at `segmented` and advances it to `normalized` or `needs_review`/`failed`.
- The extraction worker is race-safe with the compatibility registration path: once a job has reached a later stage, a late extraction can only attach its extraction lineage and cannot rewind the customer/public lifecycle.
- Image OCR is supported only through the explicit `PRODUCT_REGISTRATION_V4_OCR_ENABLED=1` profile. The default is disabled; disabled or too-short OCR is fail-closed to `needs_review`, with no automatic customer publication.
- The canonical snapshot is production-auditable, but the existing package/public-snapshot writer remains the compatibility persistence adapter until a separate rollout gate switches final writes to the V4 canonical payload.
- V4 lineage packages are now blocked at admin approval unless their job has a complete canonical normalization pointer (`v4_canonical_normalization_id`) whose source/job/extraction lineage matches. The existing writer still formats the final public snapshot, but it can no longer publish a V4 package before the canonical snapshot gate passes.
- The same gate is enforced inside the central public-snapshot writer and customer readers. Direct `/packages`/`/lp` fetches, list projections, catalog siblings, sitemap candidates, affiliate cards, and affiliate OG details fail closed when a V4 lineage job is incomplete or its canonical sections are empty. A compatibility/legacy package with no V4 lineage keeps the existing contract.
- Post-registration proof cannot advance a V4 job to `published/done` until the canonical pointer exists. If proof finishes first, the job remains `normalized/processing` so the cron can backfill canonical normalization; approval lifecycle sync accepts `normalized`, `verified`, and `proofed` jobs after the gate passes.

## 2026-08-08 V5 immutable revision shadow foundation

- V5 shadow schema adds immutable `product_registration_v5_revisions` and `product_registration_v5_segments`, with source/extraction/normalization lineage hashes. A correction is represented by a new revision; existing rows are rejected on update/delete.
- `product_registration_v5_claims` and `product_registration_v5_claim_evidence` keep critical field paths linked to private source nodes. Missing or conflicting evidence remains a publication blocker; no LLM output is promoted by this migration.
- `product_registration_v5_proof_runs`, `product_registration_v5_publication_pointers`, `product_registration_v5_publication_outbox`, `product_registration_v5_job_stage_runs`, and `product_registration_v5_idempotency_ledger` establish the proof-bound publication and effectively-once foundation. Existing public snapshot/RPC writes remain the compatibility path until dual-write diff and CAS publication are verified.
- `product_registration_v5_price_rules` and `product_registration_v5_itinerary_items` are append-only typed projections for dated prices, optional charges, ordered days, transport, attractions, meals, lodging, and other source-backed events. They are derived from the revision and never edited as independent truth.
- `publish_product_registration_v5_snapshot_atomic` is the narrow CAS publication contract. It requires matching revision/snapshot/proof lineage, a passed proof, an expected pointer version, and an idempotency key before it changes the pointer and enqueues surface invalidation.
- Publication pointers also have a database-level positive allow-list guard: `candidate`, `needs_review`, `blocked`, and `superseded` revisions cannot become current even if a future caller omits an application-level status check.
- `product_registration_v5_kill_switches`, `product_registration_v5_cache_convergence_runs`, and `product_registration_v5_publication_policies` provide product/supplier/parser/global fail-closed controls, per-surface cache convergence tracking, and versioned publication policy. They are operational controls only; enabling automatic publication still requires the canary gates below.
- After migration apply, run `npm run verify:product-registration-v5:strict` to confirm every V5 table, critical column set, and CAS RPC lineage guard are reachable through the service-role path. The check intentionally fails when Supabase admin credentials are unavailable; it never treats a missing database as a successful rollout.
- The canonical worker uses the V4 job's `packageIds` state to attach one revision per package when section/package counts match; otherwise it keeps one document-level revision without guessing package identity. This prevents a multi-product source from silently binding the wrong package.
- `scripts/prove-hwp-mobile-render.ts` records one immutable V5 proof run per `/packages` and `/lp` surface only when the tested snapshot already points to a V5 canonical revision. Legacy/V4 snapshots continue using the existing audit report until the V5 snapshot writer is enabled.
- In shadow mode, a successfully published compatibility snapshot is best-effort linked only through the package's explicit `canonical_revision_id` pointer. This enables real proof-run validation without guessing across multiple uploads; the link is skipped when the pointer is missing or review-blocked, and is not authoritative publication.
- `/api/admin/product-registration/v5/publish` is the controlled canary entrypoint. It defaults to dry-run, requires an enabled publication policy plus exact revision/snapshot/proof/pointer-version lineage, and only calls the CAS RPC when `PRODUCT_REGISTRATION_V5_AUTHORITATIVE=1`; the normal approval route is unchanged.
- `/api/cron/product-registration-v5-outbox` claims pointer-commit outbox events with a lease, revalidates customer routes, and records each `/packages`, `/lp`, OG, and affiliate surface as `pending` convergence work. It never marks a surface `converged` without a later observation/proof.
- `/api/cron/product-registration-v5-convergence` performs the later observation with a cache-busting, no-store request. `/packages` and `/lp` expose the immutable snapshot hash only as a technical `<meta>` marker, while the OG route returns the same marker as a response header. The observer records `converged`, `stale`, or `failed`; missing/mismatched markers fail closed and never alter customer copy.
- `GET /api/admin/product-registration/v5/audit` is a read-only service-role audit surface for convergence, outbox, publication-pointer, and revision status. It returns explicit blockers such as pending/stale/failed surfaces, dead-letter events, non-public pointers, and non-publishable revisions; it never exposes source blobs or raw document text.
- The remote Supabase project has now applied the V5 foundation, CAS publication, typed projections, fail-closed revision guard, and foreign-key index migrations. A live read-only audit verified 14/14 V5 tables with RLS enabled, the publication RPC, and the proof-snapshot FK index. One real operational HWP shadow sample now exists as a candidate revision, blocked snapshot, and two passed mobile proofs; no pointer or outbox event was created and no customer publication was attempted.
- `PRODUCT_REGISTRATION_V5_SHADOW=1` enables shadow revision persistence from the canonical worker. The default is off so the current V4/V3 customer behavior remains unchanged during rollout.

## 2026-08-10 V5 customer-open canary completion

The first real HWP sample completed the authoritative V5 path: source/job/extraction/normalization lineage, package-bound immutable revision, claims/evidence, typed price and itinerary projections, public snapshot, browser proof, CAS pointer, outbox delivery, and surface convergence. The current customer pointer is the only health authority; immutable convergence rows for superseded snapshots remain audit history and do not block the current pointer.

The verified sample has one `approved` revision, one `published` customer pointer, and four current converged surfaces (`/packages`, `/lp`, OG, affiliate). Direct mobile browser checks without an internal proof header returned HTTP 200 with the same snapshot marker and customer CTA. New uploads remain fail-closed until they independently satisfy this same contract; “registered” is never treated as “customer-openable”.
