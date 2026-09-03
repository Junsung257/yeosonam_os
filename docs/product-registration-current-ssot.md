# Product Registration Current SSOT

Last updated: 2026-09-04

## V6 evidence recovery PR-V6-04 human review boundary (2026-09-04, backend code-ready / runtime OFF)

- 모호한 복구 건은 `product_review_cases` → short-lived reviewer session → append-only first/second Receipt → 필요 시 adjudicator Receipt 순서로 종결한다. 기존 `upload_review_queue`는 terminal alert 용도로 유지하고, 두 개 이상의 불변 판정을 표현할 수 없어 새 내부 review ledger를 추가했다.
- 모든 케이스는 source document SHA-256, parent extraction UUID/hash, candidate-axis-set hash, packet hash를 고정한다. 서버 RPC는 원문·추출본·정규화 계보가 일치하지 않으면 거부하며, 고객 Snapshot·Revision·Publication Pointer를 만들거나 바꾸지 않는다.
- 검수 결과는 실제 인증된 Supabase 사용자 UUID와 세션 UUID를 요구한다. first/second는 서로 다른 사용자여야 하고, 불일치하면 자동 선택 없이 `adjudication_required`로 보낸다. 동일 결정·payload·evidence가 이중으로 일치할 때만 `accepted`, `source_insufficient`, `system_quarantined` 중 하나로 종결한다.
- 검수 완료 이벤트는 append-only 내부 outbox로 기록하며 Receipt·원문·PII·signed URL을 고객 경계로 전달하지 않는다. PR-V6-05 UI와 PR-V6-06 파생 추출본 재개 연결 전까지 runtime과 publication freeze는 유지한다.

## V6 evidence recovery PR-V6-05 review UI (2026-09-04, code-ready / runtime OFF)

- `/admin/product-registration/reviews`는 인증된 `tenant_staff` 이상만 접근하는 3-pane 검수 화면이다. 왼쪽은 본인이 아직 처리하지 않은 케이스 대기열, 가운데는 lineage가 다시 확인된 원문 텍스트와 복원 표, 오른쪽은 후보 상품축·판정·근거 이유를 보여준다.
- UI는 `GET /api/admin/product-registration/reviews/[caseId]`로 source IR을 읽고 `session → receipt` 또는 `adjudicate` API만 호출한다. 브라우저에서 Supabase를 직접 조회하지 않으며, 원문 storage path·signed URL·다른 검수자의 Receipt를 받지 않는다.
- 판정 제출 전 서버가 실제 사용자 UUID와 단기 세션을 확인하고, Receipt hash/evidence를 다시 계산한다. 조정 화면은 서버에서 adjudicator slot을 강제한다. 이 단계도 Derived Extraction·Revision·Snapshot·Publication Pointer를 만들거나 변경하지 않는다.
- 새 read RPC와 migration은 아직 운영 Supabase에 적용하지 않았다. migration 적용 및 UI runtime 활성화 전까지 전역 publication freeze는 유지한다.

## V6 evidence recovery PR-V6-03 derived extraction boundary (2026-09-04, code-ready / runtime OFF)

- Recovery or review corrections now have an immutable `DerivedDocumentExtractionV1` contract. It applies only an explicitly addressed table cell, updates the matching IR node and quote hash together, and rejects stale evidence, duplicate cell patches, no-op patches, or ambiguous repeated text.
- The child extraction keeps `parentExtractionId`, `parentExtractionHash`, `supersedesExtractionId`, `patchHash`, `contentHash`, source hash, derivation type, and reviewer/worker identity. It reuses the existing append-only `product_document_extractions` ledger through `quality_diagnostics.derivedExtraction`; the persistence helper verifies the source and parent before insert and never updates the parent row.
- `normalizeDerivedExtraction` re-runs the canonical compiler against the child IR under `analysis_only`. It returns a shadow normalization for validator/recovery comparison and has no Revision, Snapshot, Publication Pointer, or customer authority.
- This change does not connect OCR/reviewer decisions to automatic publication. Provider consensus, human receipts, dual review, mobile proof, and source-lane canary gates remain required; global `publication_freeze=true` remains mandatory.

## V6 evidence recovery PR-V6-01 analysis boundary (2026-09-03, code-ready / runtime OFF)

- Workflow `product-registration-v6-workflow-24` gives the first canonical pass an explicit `analysis_only` execution policy. It persists under a separate `:analysis-only-1` normalization record version, so a later Revision-commit run cannot overwrite its evidence. It has no authority to create an immutable product Revision, Snapshot, compatibility projection, mobile proof, or Publication Pointer. A job already linked to a Revision fails closed instead of being reused as an analysis-only job.
- `RecoveryTargetV1` preserves the source/extraction hash lineage, zero-based page/section/table/cell coordinates, cell quote evidence, candidate source axes/values, reason codes, a deterministic business idempotency key, and the required surrounding render context. A normal native merged cell is authoritative and does not trigger OCR by itself; invalid coordinates, grid overlap, evidence-hash mismatch, parser structural warnings, canonical conflicts, and ambiguous/unbound price ownership do.
- Canonical required fields with a source signal but no safe normalized value become recovery targets. Required fields with no signal in the source are kept separately as `sourceInsufficientFields`; image/OCR recovery must not invent them.
- Source price axes bind to canonical variants only through complete compatible price-fact sets and a one-to-one relationship. Equal values in different source tables, grades, carriers, or durations remain ambiguous.
- `PRODUCT_REGISTRATION_V6_ANALYSIS_RECOVERY_PREVIEW_ENABLED` defaults to `0`. When explicitly enabled, the current PR-V6-01 branch records analysis and recovery targets, then terminates `blocked_action_required` before the existing Revision normalization path. It suppresses review-alert/correction side effects in this preview. PR-V6-02 now supplies the local OCR provider boundary, but the feature remains runtime-off until the derived-extraction, review, proof, and canary gates are complete.
- This change adds no Supabase migration and performs no production database, deployment, Revision, Snapshot, or customer pointer write. Global `publication_freeze=true` remains mandatory.

## V158 customer read-boundary convergence and production mobile proof (2026-09-01, latest)

- Production customer preflight for `/packages/{id}` and `/lp/{id}` now uses one service-role-only RPC over the current immutable publication pointer and active sale overlay. It returns only `PUBLIC`, `SALE_UNAVAILABLE`, `NOT_FOUND`, or `UNAVAILABLE` plus minimal identity; anon/authenticated execution, raw internal rows, revision/snapshot hashes, and anon fallback are forbidden.
- Production migration `20260901082833_product_registration_customer_read_boundary.sql` was applied with `publication_freeze=true`. The publication-pointer invariant stayed at 26 rows with digest `2fb009f264901afeaa78152407c719c4`; no pointer changed. Exact resolver/wrapper grants and secure search paths were verified, and the four new functions produced no new Supabase advisor findings.
- Deployment `dpl_C6mcuLnq5PiqUUwFNDTN8w6yTQBQ`, built from source `1da8914a3b6a38ba0421da29535e7c7960f31d93` on top of main `0eedb00339fca3a4198c42ebcab60ebc275ae4ca`, was promoted only after production-environment staged checks. Production routes return 200 for a published detail/LP, 410 for an active sale suspension, and hard 404 for an unknown UUID. Historical golden fixtures use an explicit pinned inventory date; production callers must continue to default to the current KST business date.
- At 390×844 on the public domain, package `fbca42ad-50cd-4622-bde0-5dc13009e833` rendered the same title, LJ111/LJ112 flights, five-day itinerary, inclusions/exclusions, and terms on detail and LP with no horizontal overflow. Its only dated prices were 2026-08-25/31, so the LP now preserves those rows only in the immutable source snapshot and displays `현재 요금 상담 확인`; it does not expose the past dates or KRW 539,000/499,000 as current inventory.
- The LP inquiry CTA opened the `상담 신청 (1/3)` dialog with an empty KST-minimum desired-date input, party size, name, phone, and required consents. No past departure or price was preselected and no customer inquiry was submitted. The mapped LP cache contract is `lp-package-v4-current-inventory-source-notices`; changing renderer inventory semantics without bumping this key is forbidden.
- The first detail snapshot captured the Next.js streaming loading shell; after five seconds the complete source-backed product DOM was present. This was not a hydration data loss. Future browser evidence must wait for product-specific facts rather than treating the route loading shell as final content.
- This proves the production customer read and render boundary for one existing published sample, not arbitrary supplier-source accuracy. Global publication freeze remains mandatory. At least 10 supplier/document cohorts and 100 reviewed sources must still pass zero critical false publication, exact price/date pairing, source-bound facts, deterministic replay, and 1→5→20→100 canary gates. Evidence: `docs/audits/2026-09-01-product-source-mobile-convergence-v2/report.md`.

## V157.1 DeepSeek live sample replay hardening (2026-08-17, latest verification)

- A real private HWP sample was extracted with rhwp 0.8.2 (2,296 characters) and sent through the pinned `deepseek-v4-flash` pass-a/pass-b path. Both passes agreed on two source-backed price rules: KRW 499,000 for 2026-09-13..17 with the source's August ticketing condition, and KRW 579,000 for 2026-09-21..22. Replay passed, including shorthand date lists such as `9/13, 14, 15, 16, 17`.
- Candidate evidence is now canonicalized deterministically to the amount/date/condition rows before comparing the two passes. A real value or scope disagreement remains `human_required`; no majority or neighboring-product value is selected. Pinned registration calls disable DeepSeek V4 thinking mode and allow one bounded retry for an empty response.
- The legacy direct-Gemini itinerary extractor is removed: text itinerary extraction uses the same pinned DeepSeek gateway, while image-only itinerary input is explicitly blocked as outside the HWP/text cohort. A direct Gemini/Claude call scan over registration paths returns zero runtime calls.
- This smoke run used the preview key only. The local process had no Supabase service-role key, so it could not create durable provider-call IDs or cost-ledger rows. The production env file still contains a placeholder DeepSeek key; publication freeze must remain until the production secret is replaced and a shadow run persists both calls.

## V157 single DeepSeek + independent source-replay automation (2026-08-17, latest)

- Normalization `v6-canonical-2026-08-17.57`, workflow `product-registration-v6-workflow-23`, and policy `product-registration-v6-policy-10-deepseek` now execute the previously disabled critical-fact stage. Only sections unresolved by the deterministic price graph are sent to two independently prompted DeepSeek pass-a/pass-b calls. An override is persisted only when both answers match, cite the same source anchors/quote hashes, pass source replay, and retain both durable provider-call IDs.
- AI never writes customer facts directly. The canonical compiler replays the original evidence again, rejects same-scope price collisions, and preserves existing human evidence selections. Disagreement, provider failure, and invalid replay become terminal review/blocked states; publication freeze remains active.
- This change has not written the production database, deployed code, or customer pointers. Local corpus figures below are the previous deterministic shadow baseline; actual automatic recovery requires a private shadow run with the configured DeepSeek key and at least 400 blind dual-reviewed frozen sections.

## V155 single Kernel candidate graph and customer-reader convergence (2026-08-17, historical baseline)

- Normalization `v6-canonical-2026-08-17.55`, workflow `product-registration-v6-workflow-21`, and policy `product-registration-v6-policy-8` replayed 1,171 private HWP files, 1,047 unique sources, 895 travel sources, and 1,698 product sections on the pinned lineage split and simulated upload date `2026-08-16`. All 961 attempted extractions succeeded. More explicit hotel, grade, and duration boundaries account for the higher section count. This is a historical deterministic baseline; it is not the V156 provider-automation result.
- 751 past-only sections and 27 source-sale-absent sections terminate without a product or customer URL. Of 920 publication-eligible sections, 759 are structurally safe verified/degraded candidates (82.50%) and 161 remain blocked. Development is 546/633 (86.26%), calibration 77/103 (74.76%), and frozen remains aggregate-only at 136/184 (73.91%).
- Price parsing no longer lets the first successful extractor discard the other interpretations. All extractors emit amount/date/weekday/hotel/grade/duration/evidence candidates, and deterministic source authority plus hard constraints select only a unique solution. Korean HWP layouts with amount-before-date, date-before-amount, grouped dates followed by one amount, and one price column reused across explicit duration blocks are supported. `별도문의` and `마감` dates never receive an invented amount.
- Equal-count table boundaries replace flattened boundaries only when a shared price table proves partial assignments. This preserves independently blocked, unpriced sibling products and prevents `요금표참조` products from borrowing a neighbouring hotel's, grade's, or duration's amount. The lower structural-candidate rate versus V154 is therefore partly a deliberate safety tightening and partly newly recognized independent product sections; it is not reviewed accuracy evidence in either direction.
- The role-based boundary is now `RegistrationKernelInput → KernelFinding → PublicationDecision`. Replay/retry and IR/Band/scan adapters start the same V6 workflow. Unsigned raw `travel_packages` proof and temporary activation are forbidden. Customer list/detail/LP/channel readers consume only the immutable snapshot selected by the current publication pointer and do not re-run mutable V4 or attraction gates during a customer request.
- The strict Kernel-only authority boundary passes at `authorized=1`, `legacy=0`, `unapproved=0`. Focused verification passes 26 files/270 tests with 7 conditional skips, the 89-test candidate/Kernel suite, TypeScript, the production build, postbuild output checks, and pinned native/WASM rhwp tracing. The local build logged fail-closed sitemap data warnings because production secrets were not present, but completed successfully. No production database, deployment, or customer pointer changed.
- This 82.50% is a structural candidate rate, not reviewed accuracy. There are zero double-reviewed benchmark labels. Reaching a 95% point estimate on the current structural denominator needs 874/920 safe sections (115 more); a one-sided 95% Wilson lower bound needs 885/920 (126 more). Customer launch additionally requires at least 400 blind dual-reviewed frozen eligible sections, observed safety at least 97%, critical exact match at least 99.5%, zero critical false publications, and two identical final-build runs. `publication_freeze=true` remains mandatory.

## V147 duration-scoped shared price axes (2026-08-17, historical baseline)

- Normalization `v6-canonical-2026-08-17.47` and workflow `product-registration-v6-workflow-13` replayed 1,171 private HWP files, 1,047 unique sources, and 1,673 travel-product sections on the pinned lineage split and simulated upload date `2026-08-16`. All 961 attempted HWP extractions succeeded. Date-range suffixes such as `~7/22일` can no longer become a false 22-day trip-duration axis.
- 754 past-only sections and 31 source-sale-absent sections overlap in four cases and terminate without a product. Of 892 publication-eligible sections, 721 are structurally safe verified/degraded candidates (80.83%) and 171 remain blocked. Development is 509/617 (82.50%), calibration 83/100 (83.00%), and frozen aggregate-only 129/175 (73.71%).
- A real Yanji source contains four independent products (`4-day regular/no-shopping` and `3-day regular/no-shopping`) but only two policy price columns per relevant duration block. The engine now scopes each shared price table by its effective duration rows, maps the policy column independently within each duration cohort, and fails closed if the one-to-one axis cannot be proven. The source resolves into four separately titled degraded candidates with no cross-duration or cross-policy price contamination.
- Quantity and measurement expressions such as `3,400여개` cannot become KRW sale prices. A schedule-only source now terminates as source-incomplete and creates an idempotent admin review alert instead of a fabricated KRW 3.4M product.
- Direct CRUD, source-free stub/clone, mutable copy/notices, forced approval/review actions, direct archive status, mutable dynamic pricing, and package-row embedding writes are retired. Auto-archive writes the availability overlay; search vectors are a service-role-only projection bound to the current immutable snapshot hash. The static boundary is now `authorized=1`, `legacy=114`, `unapproved=0`; this is progress, not Kernel-only completion.
- Structural candidate rate is not independently reviewed accuracy. There are still zero double-reviewed benchmark labels. Publication remains frozen until at least 400 publication-eligible frozen sections pass blind dual review twice with observed safety at least 97%, one-sided Wilson lower bound at least 95%, critical exact match at least 99.5%, and zero critical false publications. No production migration, deployment, or publication pointer was changed by this replay.

## Real HWP exact-hash customer proof (2026-08-17, latest)

- A private Phu Quoc HWP completed the production V6 workflow as `ready_degraded_not_published`: source → EvidenceIR → immutable canonical revision → typed facts → immutable snapshot → signed private `/packages` and `/lp` previews → 390×844 mobile-Chrome proof. The sole publication blocker is `PUBLICATION_FREEZE_ACTIVE`; no public pointer or customer exposure was created.
- Revision `efe5d3fa-47d8-472b-bbad-6198d0debdb5`, snapshot `e43d3a66-5c18-438d-b400-6aa4edc0306c`, and proof `35930571-6736-4171-bcaa-82ffc7cbeff5` are bound to snapshot hash `6aac1ba2af63b6dcaec6e9deec0d00f2440cfab5934e3eb0d2aa9d63a1af3630`. Both surfaces returned HTTP 200 with the same hash/build; CTA, Korean font, media, hydration, and customer text checks passed.
- The snapshot exposes 2026-09-10 KRW 799,000 and 2026-09-18 KRW 699,000 without false confirmation badges; source-backed inclusions/exclusions, USD 50 guide/driver expense, two shopping visits, alternative-hotel pool, standard-terms fallback, and the free reference-image attribution are preserved. LJ119/LJ120 times remain safely hidden for final confirmation rather than being borrowed from another product.
- Proof mode writes no review-score, user-action, engagement, or web-vital analytics and renders no unrelated review digest. Test-only analytics created during diagnosis were removed. Four historical/test stale jobs were terminally quarantined through the normal terminal/dead-letter contract; the current stale V6 job count is zero.
- Full Vitest passed 738 files and 5,661 tests with 7 existing conditional skips. TypeScript, production build, and the authority contract (`authorized=1`, `legacy=136`, `unapproved=0`) passed. Supabase product-registration advisors have zero WARN/ERROR after fixing two internal function search paths and removing one duplicate catalog index.
- This live result validates the end-to-end contract for one real source, not the 95% target. Normalization `v6-canonical-2026-08-17.47` must replay the pinned private corpus and then pass at least 400 independently reviewed publication-eligible frozen sections twice before publication freeze can be relaxed by cohort. Detailed evidence is archived in `docs/audits/2026-08-17-product-registration-real-hwp-mobile-proof.md`.

## Free-first media provenance and customer surfaces (2026-08-16, latest)

- Registration media has one authority path. Revision-linked supplier/operator media with verified rights wins; otherwise the engine reuses an exact tenant/destination pool asset, tries an exact Wikidata entity plus a safe Wikimedia Commons license, then a relevance-scored Pexels result, and finally the neutral brand image. Provider failure never turns an otherwise safe product into a blocked product.
- Wikimedia candidates require exact destination label/alias equality and Commons metadata classified as CC0, Public Domain, or CC-BY. Pexels candidates require a destination-supported alt value plus landscape and resolution checks. A first search result is never accepted merely because it returned a URL.
- `media_assets` records provider, provider asset ID, source page, photographer page, license snapshot, subject key, dimensions, quality, relevance and content-safety states. Exact safe assets are reused before external calls. The lookup and linking RPCs are service-role only, tenant scoped, and require immutable revision/catalog lineage.
- The legacy `auto-photo-match` writer no longer mutates `products.thumbnail_urls`. Revision aggregate, immutable public snapshot, card, package detail, and mobile LP preserve the same structured `hero_media`; customer surfaces use `reference_only` and the stored customer label instead of inferring provenance from a Pexels/Unsplash URL. Attribution links remain visible.
- The broad attraction resolver is allowed only for legacy raw admin proof. It cannot replace immutable public snapshot media. Missing media falls back to the brand image without pretending it is a hotel, room, golf course, or actual included experience.
- Migration `20260816112631_product_registration_free_media_provenance.sql` and the preceding terminal-outcome, catalog-route-alias, and legacy-publication-RPC retirement migrations were applied to production only after all four executed successfully inside one rollback-only transaction on the production-equivalent current schema. Post-apply verification confirmed the migration history, public licensed-media bucket contract, six provenance columns, service-role-only RPC grants, `authority_mode=shadow`, and `publication_freeze=true`; no publication pointer was changed. The full Vitest suite, production build, TypeScript, touched-file lint, and authority contract pass. A clean local database replay remains blocked by the repository's historical baseline: the first 2026-03-31 migration references `customers` before the baseline creates it. This predates V6 and does not invalidate the four current-schema migration checks, but it remains a repository reproducibility debt.

## Actual-source V138 guide-fee commercial scoping (2026-08-16, latest)

- Normalization `v6-canonical-2026-08-16.38` replayed 1,171 private HWP files, 1,047 unique sources, 895 travel sources, and 1,711 product sections on the pinned lineage split. All 961 attempted extractions succeeded.
- 754 past-only sections and 10 genuinely source-incomplete sections terminate without a product, snapshot, or customer URL. Of 947 publication-eligible sections, 730 are structurally safe verified/degraded candidates (77.09%) and 217 remain blocked. Safe terminal handling including past/source-incomplete outcomes is 1,494/1,711 (87.32%).
- Development is 508/649 (78.27%), calibration is 87/103 (84.47%), and frozen remains aggregate-only at 135/195 (69.23%). No individual frozen case was inspected. Compared with the pinned V119 baseline, 757 active non-frozen sections were comparable and there were zero recoveries and zero regressions.
- Guide-fee parsing is commercial-section and clause scoped. Spaced headings such as `포 함 사 항` are valid headings; a nearby exclusion heading cannot invert an amount-less included benefit; an amount-bearing fee immediately before a reversed exclusion heading remains local payment; and `▶`-separated guide service and etiquette-tip clauses cannot be joined. Thousands separators are preserved and unrelated single-room or massage-tip amounts cannot be borrowed.
- A genuine included/no-tip versus excluded/local guide-payment contradiction is a hard blocker. The engine does not remove that contradiction merely to increase the structural candidate rate. Product-local facts remain isolated when sibling products in the same source have different guide-tip policies.
- Full Vitest passed 734 files and 5,626 tests, with 7 existing conditional skips. The learning-engine verification, TypeScript, golden corpus, OCR/PDF candidate proxy, product-registration contract, authority boundary (`authorized=1`, `legacy=137`, `unapproved=0`), and migration-prefix baseline passed. The Supabase-dependent live upload-review replay was skipped because this worktree has no configured Supabase environment.
- This is structural shadow evidence, not reviewed exact-match accuracy. The promotion gate remains blocked by `REVIEWED_BENCHMARK_EVIDENCE_MISSING`. At least 300 independently reviewed frozen sections, two consecutive benchmark passes, a live upload/snapshot run, exact-hash mobile Chrome proof, and cohort convergence remain mandatory. Production stays `publication_freeze=true`; no deployment, production DB write, pointer change, or customer exposure occurred.
- Detailed evidence is archived in `docs/audits/2026-08-16-product-registration-v138-guide-commercial-scope.md`. Private source and replay artifacts remain outside the repository.

## Actual-source V95 grade/duration identity and customer-fact isolation (2026-08-16, historical baseline)

- Normalization `v6-canonical-2026-08-16.27` replayed 1,171 private HWP files, 1,047 unique sources, 895 travel sources, and 1,641 product sections on the pinned lineage split. All 961 attempted extractions succeeded.
- 737 past-only sections and 10 genuinely source-incomplete sections terminated without a product, snapshot, or customer URL. Of 894 publication-eligible sections, 797 are structurally safe verified/degraded candidates (89.15%) and 97 remain blocked. Total automatic safe-terminal handling is 1,544/1,641 (94.09%).
- Publication-eligible structural safety is development 567/615 (92.20%), calibration 89/103 (86.41%), and frozen aggregate-only 141/176 (80.11%). No individual frozen case was inspected. V95 versus V94 has 723 comparable non-frozen sections, 0 recoveries, 0 regressions, and 0 safety-tightened transitions. Promotion remains blocked solely by missing independently reviewed benchmark evidence.
- A real Xian catalog with `[Economy]/[Premium] × 3-night/5-day or 4-night/6-day` now resolves into four product identities. The source may have a blank departure header and date rosters with attached status text; calendar rows remain bound to their month, weekday, duration, and grade columns. Long merged ticketing/terms footer cells cannot become grade headers.
- Table itinerary headings containing a bracketed grade and duration are product identity even when they omit `PKG`. Customer titles use that local heading, and selected typed calendars propagate the source-backed grade. This eliminates the previous fallback title and wrong-duration contamination.
- Shared prefixes remain available to the legacy compatibility parser for document-level price tables, but customer-visible notices, structured facts, options, shopping, and matching summaries are projected from exactly one local product section. This preserves shared price extraction while preventing Economy guide-fee exclusions from mixing with Premium guide-included/no-option/no-shopping facts. A local-only replacement of the entire compatibility parse was tested and rejected after causing 285 regressions.
- Narrative durations such as `37년에 걸쳐` are no longer accepted as departure-year evidence. Two-digit years require filename/title/date/price commercial context. Ticketing deadlines prefer the first active/future departure when a source contains retained historical rows, preventing `7/30` from being assigned to the prior year.
- Publication hard-blocks contradictory customer facts: guide fee both included and locally payable, `no optional tours` with customer-visible options, or `no shopping` with shopping visits. The four real Xian products now retain their own duration, itinerary, date-price calendar, guide/option/shopping facts, and ticketing deadline; they are structurally degraded only for source-stated `hotel or equivalent` lodging.
- The full Vitest run passed 734 files and 5,590 tests, with 7 existing conditional skips. TypeScript, the product-registration contract check, the authority contract (`authorized=1`, `legacy=137`, `unapproved=0`), and whitespace checks passed. No production Supabase change, deployment, publication-pointer change, or live Chrome mobile proof occurred.
- This is structural shadow evidence, not independently reviewed field accuracy. Calibration and frozen performance remain well below the launch target; the double-reviewed frozen corpus of at least 300 sections, zero critical false publications, live upload-to-snapshot proof, surface parity, and legacy-writer retirement remain mandatory. Production stays `publication_freeze=true`.
- Detailed evidence is archived in `docs/audits/2026-08-16-product-registration-v95-grade-duration-customer-facts.md`. Private source and replay artifacts remain under `C:\Users\admin\Downloads\코덱스테스트` and must not be committed.

## Actual-source V82 full error audit (2026-08-16, historical baseline)

- Normalization `v6-canonical-2026-08-16.17` replayed 1,171 private HWP files, 1,047 unique sources, 895 travel sources, and 1,632 product sections on the unchanged lineage split. All 961 attempted extractions succeeded.
- 717 past-only sections and 10 genuinely source-incomplete sections terminated without a product, snapshot, or customer URL. Of 905 publication-eligible sections, 768 are structurally safe verified/degraded candidates (84.86%) and 137 remain blocked. Total automatic safe terminal handling is 1,495/1,632 (91.61%).
- Development is 538/622 (86.50%), calibration is 90/104 (86.54%), and frozen remains aggregate-only at 140/179 (78.21%). No individual frozen case was inspected. Among 726 comparable non-frozen sections, 9 recovered and 3 became blocked.
- The three newly blocked sections are intentional safety corrections, not candidates for rollback. They previously risked treating a KRW 300,000 reservation deposit as an adult sale price or attaching September grade prices to July/August products whose local hotel/grade axis was unresolved. The current generic learning counter does not yet distinguish this semantic safety tightening from an ordinary regression, so promotion remains false.
- A Qingdao golf source that was falsely split into a price-only product and an itinerary-only product now replays as one product with 128 uniquely dated prices, zero date-price conflicts, nine inclusions, eleven exclusions, four itinerary days, and two flights. An exact special-date row overrides its broad weekday range.
- A Chengdu source now resolves the Cartesian product of Premium/Crown and 3-night/5-day versus 4-night/6-day into four source-backed products. Every product has seven unique prices and zero conflicts. This matrix resolver is limited to the proven English grade layout; it does not generalize arbitrary Korean grade labels across unrelated products.
- A Bali source with a shared commercial prefix now keeps one local product per explicit pre-split section: the 3-night/5-day product has 40 prices and the 4-night/6-day product has 10. Shared-prefix pseudo-variants are removed, and a missing local calendar may be replayed only from exactly one same-duration, non-deposit, source-backed candidate.
- Reservation money, contract deposits, and similarly labelled amounts can never establish an adult sale price. A local product that cannot uniquely identify its own hotel/grade/duration price remains blocked; prices are never copied from a sibling product merely to improve automation rate.
- A fuel surcharge simultaneously stated as included and excluded is `conflicting`. The customer budget is not calculated and publication is hard-blocked with `commercial_terms_conflict`. Guide/driver fees stated as excluded remain excluded and are never added to the product sale price or expected budget.
- The largest remaining blocker families are price/date scope ambiguity (36 findings across 24 sources), variant price/scope attribution (34/23), missing adult sale price (30/19), source sale price requiring resolution (32/20), lodging (13), exclusions (11), exact price evidence (11), inclusions (10), itinerary (10), and flight (7). These counts overlap and must be recovered through source ownership/evidence rules, not weaker gates.
- Product-registration Vitest passed 167 files and 1,253 tests. TypeScript, targeted lint, the complete learning-engine verification, the strict authority contract (`authorized=1`, `legacy=140`, `unapproved=0`), and whitespace checks passed. The Supabase-dependent live upload regression was skipped because its environment was unavailable; no live Chrome mobile proof ran in this local replay.
- This remains structural shadow evidence, not independently reviewed field accuracy. A 95% point estimate needs 860/905 safe sections, 92 more than the current 768. The one-sided 95% Wilson lower-bound gate needs 871/905, 103 more independently reviewed safe sections. Production remains `publication_freeze=true`; no deployment, production migration, pointer change, or customer exposure occurred.
- Detailed evidence is archived in `docs/audits/2026-08-16-product-registration-v82-full-audit.md`. Private aggregate artifacts remain under `C:\Users\admin\Downloads\코덱스테스트` and must not be committed.

## Actual-source V80 customer budget and duration-pattern replay (2026-08-16, historical baseline)

- Normalization `v6-canonical-2026-08-16.15` replayed 1,171 private HWP files, 1,047 unique sources, 895 travel sources, and 1,636 product sections on the unchanged lineage split. All 961 attempted extractions succeeded.
- 723 past-only sections and 10 genuinely source-incomplete sections terminated without a product or customer URL. Of 903 publication-eligible sections, 761 are structurally safe verified/degraded candidates (84.27%) and 142 remain blocked. Total safe terminal handling is 1,494/1,636 (91.32%).
- Development is 532/619 (85.95%), calibration is 86/104 (82.69%), and frozen remains aggregate-only at 143/180 (79.44%). No frozen individual case was inspected. Compared with V79 on 728 comparable non-frozen sections, two recovered and zero regressed.
- Customer expected budget has one authoritative formula: adult base product price plus only a fixed, source-backed, separately excluded fuel surcharge. An included fuel surcharge is not added again. An excluded but variable/unpriced fuel surcharge produces no invented total and is shown as confirmation required.
- A guide/driver fee stated under exclusions remains an exclusion with its source amount, currency, and charge basis. It is never added to the product sale price, fuel surcharge, or expected budget. A source example of KRW 599,000 product price, KRW 126,000 separate fuel surcharge, and KRW 40,000 excluded guide fee therefore exposes KRW 725,000 expected budget, not KRW 765,000.
- Public terms preserve numeric thousands separators and prefer amount-bearing fuel/guide exclusions over generic duplicate wording. The immutable snapshot, card, LP projection, package detail, and mobile landing share the same `customer_budget` contract; hard-coded `유류세 포함` copy was removed.
- A broad row-spanned range is only visual context when a closer exact-date roster is adjacent to the amount. Exact special dates override that local roster and no phantom dates are expanded. Conversely, a table explicitly shaped as `출발일 | 패턴 | 상품가` binds each spanned range row to its own duration: `3박5일` and `4박6일` are separate products and neither can lose the other's future price.
- Actual HWP rechecks found one section and one variant for `★[중중 더블온천팩] 7월 ~ 10월일정표.hwp`, `[BX 3박4일 실속비에이PKG] ...hwp`, and `[BX 3박4일 품격비에이PKG] ...hwp`. The first two price grids had zero duplicate dates and zero conflicting date prices. The premium Biei source is now past-only and therefore has no customer price rows, but it still remains one section/one variant. The apparent duplicate-product result was a range-expansion defect, not a second source product.
- The two true V79 active regressions were row-spanned Kota Kinabalu duration rows. V80 restores future 3-night/5-day and 4-night/6-day prices in both Grandis and Hyatt sources; the complete replay reports two recoveries and zero regression.
- Product-registration Vitest passed 153 files and 1,034 tests. TypeScript, targeted lint, and the strict authority contract (`authorized=1`, `legacy=140`, `unapproved=0`) passed.
- This is structural shadow evidence, not reviewed exact-match accuracy. A 95% point estimate needs 858/903, or 97 further safe sections; the one-sided 95% Wilson lower-bound gate needs 869/903, or 108 further independently reviewed safe sections. Production remains `publication_freeze=true`; no deployment, migration, pointer change, or customer exposure occurred. Private aggregate artifacts remain under `C:\Users\admin\Downloads\코덱스테스트` and must not be committed.

## Actual-source V78 owner decisions and full replay (2026-08-15)

- Normalization `v6-canonical-2026-08-15.13` replayed 1,171 private HWP files, 1,047 unique sources, 895 travel sources, and 1,636 product sections. All 961 attempted extractions succeeded.
- 713 past-only sections and 10 genuinely source-incomplete sections terminated without a product or customer URL. Of 913 publication-eligible sections, 760 are structurally safe verified/degraded candidates (83.24%) and 153 remain blocked. Total safe terminal handling is 1,483/1,636 (90.65%).
- Development is 533/625 (85.28%), calibration is 85/106 (80.19%), and frozen remains aggregate-only at 142/182 (78.02%). No frozen individual case was inspected. Compared with V77 on 736 comparable non-frozen sections, three recovered and zero regressed.
- A numeric exception/exclusion date is an exact-date override of the surrounding range/weekday price. An inquiry-only date or range with no numeric amount inherits no base price and emits no customer price. Exact-date overrides, inquiry suppression, row spans, and sequential cross-year ranges retain physical table-cell evidence.
- An explicit equivalent-hotel pool such as `A, B 또는 동급` is one product with unresolved lodging alternatives. Distinct resort-hotel axes such as Henann Alona Beach versus Premier Coast remain separate products even with the same itinerary. A USJ upcharge is an option on the same product, not a new product.
- A real Jin Air Osaka/Nara/Kyoto itinerary contains price, flight, lodging, and itinerary facts but no saleable departure date. It remains blocked; the engine cannot invent or borrow a date. A truly missing adult sale price terminates as source-incomplete and retains only the private source.
- A single-product document may inherit its authoritative cross-year period from a document header/table value such as `2026년 8월 ~ 2027년 3월`, including when the label and value are extracted into adjacent cells. Multi-product catalogs continue to resolve year evidence per section.
- Actual replay recovered Narita, Osaka, and Fukuoka golf sections without any comparable-section regression. The Danang exception source now applies 9/22 KRW 869,000, 9/23 KRW 1,599,000, and 9/24 KRW 1,169,000, while 9/25 inquiry-only has no numeric price.
- Product-registration Vitest passed 141 files and 911 tests; the focused regression suite passed 74 tests. TypeScript, targeted lint, and the strict authority contract (`authorized=1`, `legacy=140`, `unapproved=0`) passed.
- This is structural shadow evidence, not reviewed exact-match accuracy. A 95% point estimate requires 868/913, or 108 further safe recoveries. The one-sided 95% Wilson lower-bound gate requires 879/913, or 119 further independently reviewed safe recoveries. Production remains `publication_freeze=true`; no deployment, migration, pointer change, or customer exposure occurred.
- Private aggregate artifacts remain under `C:\Users\admin\Downloads\코덱스테스트` and must not be committed.

## Actual-source V75 table binding and sale-context replay (2026-08-15)

- Normalization `v6-canonical-2026-08-15.12` was replayed against the unchanged private split: 1,171 HWP files, 1,047 unique sources, 895 travel sources, 1,636 product sections, and 961/961 attempted extractions succeeded.
- Past-only schedules safely terminated 713 sections and 10 genuinely source-incomplete sections retained only their private source. Of 913 publication-eligible sections, 755 are structurally safe verified/degraded candidates and 158 remain blocked. Publication-eligible structural safety is 755/913 (82.69%); safe terminal handling including past-only and source-incomplete outcomes is 1,478/1,636 (90.34%).
- Development is 528/625 (84.48%), calibration is 85/106 (80.19%), and frozen remains aggregate-only at 142/182 (78.02%). No individual frozen case was inspected. Compared with V74 on 736 comparable non-frozen sections, 1 recovered and 0 regressed.
- Row-spanned multi-product tables now preserve the product axis while binding each departure roster to its local sale-price column. A base date-range price and narrower exception range coexist with deterministic precedence; different hotels, durations, airlines, and golf variants never merge merely because dates or itineraries overlap.
- A single table containing row-spanned 3-night/4-day and 4-night/5-day monthly rosters now creates separate duration calendars with physical table-cell evidence. Flight-schedule numbers and foreign-currency per-person fees cannot become KRW adult sale prices.
- HWP flattened reading order no longer breaks a multiline shared departure roster followed by one adult sale price. Every bound date and amount must remain inside the same product-local table context. Non-sale business amounts such as guide fees, single supplements, deposits, and commission override a broad `per person` cue unless an explicit sale label exists.
- Product-registration Vitest passed 141 files and 907 tests; the full regression suite passed 732 files and 5,544 tests. TypeScript, targeted lint, the strict authority contract (`authorized=1`, `legacy=140`, `unapproved=0`), and `git diff --check` also passed. The reextract route has no direct `products` or `travel_packages` writer; its stale entries were removed from the measured legacy-retirement baseline.
- This remains a structural shadow result, not reviewed field accuracy. A 95% point estimate needs 868/913 safe sections, 113 more than the current 755. The one-sided 95% Wilson lower-bound gate needs 879/913, 124 independently reviewed recoveries. Double-reviewed frozen ground truth and customer mobile proof for a representative launch cohort remain mandatory, so production publication stays frozen.
- Private aggregate artifacts remain under `C:\Users\admin\Downloads\코덱스테스트` and must not be committed. No deployment, production migration, publication-pointer change, or customer exposure was performed in this replay.

## Actual-source V68 policy and table replay (2026-08-15)

- Normalization `v6-canonical-2026-08-15.8` was replayed against the unchanged private split: 1,171 HWP files, 1,047 unique sources, 895 travel sources, 1,636 product sections, and 961/961 attempted extractions succeeded.
- Past-only exclusion terminated 709 sections, 1 source-incomplete section remained private, and 927 sections were active. Of the active sections, 760 are structurally eligible for verified/degraded publication and 166 remain blocked. Active structural safe-publication is 760/927 (81.98%); automatic safe terminal handling including past-only and source-incomplete outcomes is 1,470/1,636 (89.85%).
- Development is 535/638 active sections (83.86%), calibration is 86/106 (81.13%), and frozen is aggregate-only at 139/183 (75.96%; 139/182 publication-eligible, 76.37%). No individual frozen case was inspected. Compared with V66 on comparable sections, 1 section recovered and 0 regressed.
- A 95% point estimate now requires 881/927 safe active sections, 121 more than the current 760. The one-sided 95% Wilson lower-bound gate requires 892/927 (96.22% observed), 132 independently reviewed recoveries. No completed double-reviewed frozen ground truth exists, so exact-match accuracy and critical false-publication remain unknown and production publication stays frozen.
- An actual BX northern Kyushu source using `2026년 5월 MAY`, full weekday labels, bare itinerary day cells `1일·2일·3일`, and filename duration `2박3일` now replays as one product with 77 exact departure-price rows and exactly 3 itinerary days. At an intake date of 2026-04-08 it is `ready_to_publish/degraded` only because the source says hotel `동급`; at 2026-08-15 its departures are past and are not reopened.
- Exact bare `N일` is accepted only in the itinerary date column. Prose such as `2일차 중식` cannot become a duration or an additional DAY. English month suffixes and full Korean weekday headers in calendar grids are recognized, and a single table itinerary may supply a missing duration to its own price grid.
- Supplier price typos such as `539,0000` retain the exact evidence cell and normalize to the valid KRW amount. `기사&가이드경비 ￦30,000` is treated as an excluded local fee; the substring `포함` inside `불포함` can no longer invert it into an included benefit.
- Unmatched attraction text remains in the source-backed itinerary and is queued for existing-attraction alias/new-attraction review, but it no longer blocks a safe product by itself. It never receives an attraction card, description, image, link, or automatic attraction INSERT.
- Ticketing deadlines are immutable source-backed conditions. An expired deadline keeps the product facts but makes it consultation-only and ineligible for normal marketing; lifecycle archive occurs only when every trustworthy departure/range end is past.
- Cross-file price/itinerary pairing requires the same authenticated upload batch, same supplier identity, exact duration/flight/destination/hotel compatibility, and a mutual-best result. Otherwise an itineraryless price sheet remains hidden.
- Source cancellation terms override the pinned approved standard policy. Missing source terms use the approved hash-pinned standard; contradictory source penalty rates for the same deadline block publication instead of falling back silently.
- The production workflow now hard-disables AI authority over customer facts regardless of environment flags. AI output may assist structure/meaning candidates in development, but prices, dates, flights, hotels, inclusions, exclusions, and terms require deterministic source evidence or remain blocked.

## Prior V60 product-axis and price binding verification (2026-08-15)

- The latest private current-upload simulation uses normalization `v6-canonical-2026-08-15.5` and date policy `source-departure-date-policy-4`. It processed 1,171 HWP files, 1,047 unique sources, 895 travel sources, and 1,636 product sections. Extraction completed for 961/961 attempted sources.
- A yearless schedule is inferred only inside a 184-day selling horizon. For an August 15 intake, September remains in the current year and January may roll to the next year, while already-past May-July rows are removed instead of being manufactured as next-year inventory. Explicit source years still override this policy.
- Of 1,636 sections, 694 were safely terminated because every departure was past, 1 was retained privately as source-incomplete, and 942 remained active. Of those active sections, 746 were structurally eligible for verified/degraded publication and 195 were blocked. The active structural safe-publication rate is 79.19%; total automatic safe termination including past/source-incomplete outcomes is 1,441/1,636 (88.08%).
- Development is 524/648 active sections (80.86%), calibration is 86/106 (81.13%), and frozen remains aggregate-only at 136/188 (72.34%). No individual frozen case was inspected. Reaching a 95% point estimate on the current 942 active-section denominator requires at least 895 safe sections, so 149 additional active sections must be recovered without weakening blockers. The stricter one-sided 95% Wilson lower-bound gate requires 906/942 (96.18%), or 160 additional independently reviewed safe sections at the same denominator.
- An explicit duration or hotel axis now creates separate products. A 3-night/5-day and 4-night/6-day schedule never share one product, and different hotels on the same date remain separate products even when their itineraries are otherwise identical.
- Date rosters and a final discounted price written in the same HWP cell are bound only to that physical row. Actual-source replay recovered the Danang LJ and Phu Quoc ZE sources with zero non-frozen regression. The Danang source now produces 14 exact date-price pairs; the Phu Quoc source preserves all five explicit list-price-to-final-sale relationships.
- Actual-source spot checks also replayed the Bohol duration split, Bohol hotel variants, Songbaek golf special dates, Ulaanbaatar 3-night/5-day versus 4-night/6-day prices, and Shizuoka multi-itinerary variants against their source rows. These are targeted source checks, not a statistically valid exact-match benchmark.
- Structural publication eligibility is not accuracy. There are still zero completed, independently double-reviewed frozen ground-truth sections, so critical-field exact match and critical false-publication rate remain unmeasured. Production publication stays frozen.
- This V60 finding was resolved in V68: an expired source ticketing deadline is retained in canonical customer data as `발권기한 경과 · 현재 좌석과 요금 상담 확인`. It cannot silently archive the product or disappear from customer copy; only fully past departures trigger lifecycle archive.
- The largest non-frozen blocked families are price/departure scope (85 of 144 blocked sections, overlapping other findings), unresolved adult sale price (55), departure year (20), inclusions/exclusions (16), itinerary (15), lodging (14), and transport (7). The next recovery work must prioritize row/column scope and product ownership before AI fallback.
- Private evidence artifacts are stored under `C:\Users\admin\Downloads\코덱스테스트` as the V60 corpus, V19 learning-cycle report, and targeted inspection files. They contain private supplier source paths and must not be committed.

## Registration Kernel authority convergence (production schema hardened, 2026-08-12)

### Automation readiness update (2026-08-15)

- The actual-source 95% program now inventories 1,171 local HWP files, 1,047 unique source hashes, 895 travel-product sources, and 1,634 product sections. All 961 sources that reached extraction completed extraction; 86 obvious non-travel filenames were classified before parser execution. Three false sections disappeared after conservative same-document price-card/itinerary-card continuation matching. These are private local corpus measurements, not production customer-open evidence.
- The current operational-upload date policy is `source-departure-date-policy-3`. Every job pins one Korea date (`Asia/Seoul`) and policy version at intake. A yearless month/day normally resolves to its nearest non-past occurrence, but a supplied weekday that matches the already-past intake-year occurrence proves that expired schedule and prevents next-year rollover. An upcoming candidate whose weekday conflicts with the source is blocked. Retries reuse the pinned date and version; only an explicit reprocess receives the current policy.
- Rolling inference is allowed only for a current operational upload. Archive and legacy backfill never receive this clock-based authority. Explicit source years and entry-local year evidence always win; explicit past dates are removed and are never rolled. A source whose saleable departures are all past creates no revision, snapshot, or customer URL and ends safely as `ALL_DEPARTURES_PAST`.
- Departure-year context now distinguishes sale/departure phrases from unrelated informational years. For example, `26년 3~6월 출발` remains authoritative even when a shared notice says `25년부터 전자담배 반입 금지`. Genuine multi-year departure conflicts remain blocked, and a price row with its own explicit year is evaluated independently.
- The latest private full-source simulation contains 1,634 sections: 472 past-only sections were safely excluded, leaving 1,162 active sections. Of those, 933 are terminal verified/degraded candidates, 1 is a source-incomplete discard candidate, and 228 are blocked. Development is 657/802 active sections (81.92%), calibration is 96/119 (80.67%), and the frozen split remains aggregate-only at 180/241 active sections. Safe publication candidate, completed past exclusion, or source-incomplete discard is 1,406/1,634 (86.05%). Compared with the preceding run on the same corpus, safe publication candidates increased by 25 and blockers fell by 24.
- A source section is terminal `discarded_source_incomplete` only when the adult selling price is absent from both canonical facts and the complete source context. The private source remains retained for audit, but the workflow creates no product revision, compatibility package, snapshot, proof, pointer, or customer URL. A parser miss is never a discard: explicit amounts, `799 특가`/`499 특가` shorthand, a `요금표`/price-table marker, or a possible shared price table in a multi-product source becomes `SOURCE_SALE_PRICE_REQUIRES_RESOLUTION` and remains blocked for engine improvement.
- The discard contract is independently review-gated. Every reviewed section must carry a blinded, double-reviewed `sourceSalePricePresent` boolean. Missing decisions or a false-discard mismatch invalidate the benchmark. Customer opening requires zero false source-incomplete discards and zero invalid-source publications. The conservative actual-source rerun reduced raw discard candidates from 31 sections to 1; the other 30 returned to safe publication or explicit improvement/blocking paths instead of being silently discarded.
- Supplier files are not manually rewritten. The shared deterministic money parser normalizes sale-context `899,`, `699,---`, and `999,-` to full KRW thousands, `399 특가` to KRW 399,000 only when the sale cue is explicit, and `839.000` to KRW 839,000. An explicit `839,000 → 599,000` relation retains list price 839,000 and final sale price 599,000; customer discount copy is allowed only for that same-row source-proven relationship. Foreign currency, fuel, local fee, guide fee, option, commission, capacity, and other non-sale amounts cannot become the adult sale price.
- The separate non-frozen audit extracted 731/731 actual travel HWP sources after this normalization. Trailing-comma sources fell from 7/7 price-blocked to 3/7, bare-special sources from 24 to 21 blocked, and split-label sources from 22 to 20 blocked. Remaining failures stay blocked for structural price/date scope, product attribution, or evidence replay; operators are not asked to repair supplier documents.
- Raw source bytes and raw filenames are immutable audit evidence. Corrupted filename characters or decomposed Hangul do not block registration by themselves; a normalized derived label may assist routing but never overwrites the original name. Missing commission defaults to 9% for product-registration internal calculations, while a valid explicit source commission wins. Commission is never customer-visible and never proves a sale price.
- These are structural policy measurements, not reviewed field accuracy. The frozen split still has zero completed independent double-reviewed ground-truth sections, so critical exact match remains unmeasured and no 95% or customer-open claim is allowed.
- The approved customer-visible cancellation-policy snapshot remains pinned by immutable hash. The largest measured development blockers are price/departure applicability (35 sources), missing adult sale price (32), exact amount evidence (16), exclusions (14), itinerary (12), and inclusions (11). Many are historical companion price/itinerary documents without authenticated upload-batch lineage. The resolver does not weaken identity requirements or join files by directory/name similarity.
- The trusted upload-envelope four-digit year remains an optional authenticated override, but normal operational uploads no longer require that click for yearless dates. It is stored in lineage and never overrides explicit source evidence.
- Workflow-safe source classification now runs inside a durable step. This keeps Node-only hashing and input inspection out of the workflow interpreter while preserving automatic `travel_product`, `non_travel`, `unsupported`, and `corrupt` terminal handling. The production build completes with 21 workflow steps and 389 static pages.
- Price evidence now binds to the actual amount line, including Korean dot-thousands (`399.000원`) and explicit supplier shorthand (`1,159,-`). A generic `상품가` heading cannot prove a price. Vessel specifications such as `총 탑승객 5,655명` are explicitly excluded from selling-price extraction.
- Valid compact source dates such as `260417` may prove year 2026, but current date, file modification time, legacy product values, and AI guesses never do. Year evidence is evaluated per product section, so unrelated years elsewhere in a multi-product catalog cannot authorize a section.
- Complementary price-sheet/itinerary bundles now have a mutual-best, tenant/supplier/cohort-or-explicit-upload-batch-scoped resolver, immutable bundle/member/decision schema, and a multi-source EvidenceIR merge contract. Every merged node retains its true source document, extraction, and hash; revisions can link only to an eligible bundle whose primary source is a member. Upload-batch membership expands search scope but never proves product identity. The latest development shadow scan classified 643 sources but produced zero safe pairs; the previous diagnostic review found 49/50 closest misses lacked sufficient title identity, so this path remains shadow-only.
- Customer-open readiness requires at least 100 operational/manual pasted-text sections, at least 100 comparable HWP/paste lineages, and 100% critical-fact parity. Production currently has zero qualifying operational admin-paste sources; all 16 text sources are legacy backfill. New operational paste and HWP extraction paths now record a common whitespace-tolerant lineage fingerprint, but generated paste fixtures cannot satisfy this gate.
- The frozen blind-review queue currently contains 164 source cases covering 303 product sections. Reviewers do not see engine output; a confirmed source departure year may be recorded only when it is independently recoverable from the supplier context, and it is reported as input assistance rather than parser accuracy.
- The active-learning cycle never exposes individual frozen cases. It clusters development/calibration blockers, selects only diverse development cases for correction, emits a blind 34-source review queue, and emits 12 dual-model silver candidates. Silver consensus requires exact value, scope, anchors, quote hash, and deterministic replay, but is never ground truth or publication evidence. Promotion remains blocked until at least 300 independently double-reviewed frozen sections pass twice consecutively with zero critical false publications and no active regression.
- Migrations `20260813075624_product_registration_95_benchmark_corpus.sql`, `20260813192600_product_registration_source_document_bundles.sql`, and `20260814131701_product_registration_source_weekday_policy_v3.sql` are repository-only in this branch and have not been applied to production. Production remains frozen.
- A real table layout with a Korean full-date departure row and a separate unique `여행경비` row now resolves to an exact date-price pair with cell evidence. The resolver rejects multi-amount/grade cells, and the full non-frozen comparison recovered five development sections with zero regression.
- A product header containing one explicit Korean departure date and one uniquely labelled product price is also resolved deterministically even when HWP table reading order places the amount before its `상품가` label. Competing amounts are rejected. Four actual Huangshan sections that previously became blocked or could have rolled to a wrong future year now terminate as expired schedules; no active safe section regressed.
- A paired monthly roster layout (`month | day list | price | day list | price`) now resolves only adjacent date/amount cells in the same EvidenceIR row. It preserves row-spanning month cells, rejects conflicting same-date prices, excludes `마감` dates, and accepts the last amount only when an explicit arrow/discount expression proves that it is the final sale price. A date cell such as `10 월` (day 10, Monday) can no longer be mistaken for October.
- Same-document price cards and itinerary cards are joined only when deterministic product identity overlaps, grade discriminators do not conflict, the first card lacks a DAY itinerary, and the next card supplies one. Actual-source checks confirmed exact exclusions and special-price precedence for the Zhangjiajie 3U source, a verified Osaka price/itinerary continuation, 66 Kyushu date-price rows followed by correct past-only termination, and closed/final-special-price handling for the Shizuoka charter source.
- Sixteen new HWP sources added since the preceding run contributed 24 travel sections. Reused corpus splits are pinned by both lineage and stable source path so an in-place supplier revision cannot move from frozen to development. Genuinely new lineages receive deterministic split assignment. Across common non-frozen cases, the new source-year propagation recovered one further section with zero regressions.
- The branch now builds a conservative document context graph for multi-product HWP catalogs. A single terminal inclusion/exclusion pair, cancellation block, or booking notice after the final itinerary is inherited by every local product section; repeated product-specific headings are never mixed. This directly addresses the first shadow batch where the source contained commercial terms but earlier sections could not see them.
- Customer timezone copy now converts the stored absolute UTC offset to a Korea-relative difference. UTC+8 destinations such as Kota Kinabalu render as one hour behind Korea, never eight hours ahead.
- A deferred database invariant now requires every `published` pointer to end its transaction bound to the exact tenant/catalog/revision, a `published` immutable snapshot, passed proof, matching renderer build, and a non-local deploy build. Pre-existing split-brain pointers are audit-logged and quarantined instead of remaining apparently published.
- Snapshot immutability is now enforced by a database trigger, not only by application convention: payload/hash/projection/build lineage cannot be updated or deleted, and a referenced published snapshot cannot be downgraded. Corrections must create a new snapshot and proof.
- Existing product flight data is no longer blindly copied. The forward migration admits only rows with an explicit departure date, route encoded in the stable internal code, a single valid flight number, and both times present in the saved source. The current production inventory has 58 such evidence-qualified rows covering 24 distinct dated facts and 17 flight numbers; only two facts currently have two independent source families and are immediately eligible to fill a missing time.
- Explicit times in the newly uploaded supplier source remain the highest-priority customer fact. Missing times may be filled by two independent, date/route/flight-matched verified product sources with combined trust 1.6 or by current OAG+Cirium consensus. One historical row, duplicate products from one source, undated facts, seasonal conflicts, or low-trust variants never fill customer time fields.
- The historical fixed 40-file HWP regression corpus extracts and normalizes 40/40 files and yields 66 product sections. Under the V6 terminal-state policy, 1 is verified, 52 are safely degraded, and 13 are blocked, so 53/66 (80.30%) can be automatically concluded without forcing unsafe facts into the customer payload. This set is not the current frozen holdout and cannot establish production accuracy.
- Critical claim evidence is 248/248. Overall claim evidence is 92.15% because editorial/high claims without their own field-level anchor are no longer incorrectly credited with the whole section's evidence.
- This is a structural readiness result, not a claimed 99.5% accuracy result. Production stores it as a failed/non-promotable shadow benchmark until frozen human annotations measure field exact match and critical false-publication count.
- Production V6 has zero unfinished/stale jobs after two abandoned historical failures were moved through dead-letter to a terminal state. The watchdog now also detects jobs that never wrote a heartbeat and distinguishes restart from two-hour quarantine.
- Serverless Chromium bundled in the Vercel runtime is now recognized by readiness checks. Flight/OCR token parsing defects that could turn ISO year digits into a time or flight number are covered by regression tests.
- Licensed destination reference media can be added through the free-first Wikimedia/Pexels adapters only with URL, stable provider hash, license, source page, photographer/author, attribution, destination relevance, and a customer disclaimer. Wikimedia media is copied into the public licensed-media bucket instead of relying on a fragile hotlink; Pexels remains provider-delivered and bypasses paid image transformation. Customer detail and mobile LP expose both source and license links. It never represents a generic destination image as the actual product photo.
- Public package search, B2B v1, affiliate API/landing/embed/referral, blog product links/destination, destination RSS, itinerary print, destination-attraction packages, and generated marketing content now consume publication pointers and immutable snapshots instead of starting from `travel_packages`.
- Package detail metadata now uses the same pointer-only snapshot reader as the page body. A blocked/404 legacy package cannot leak its title, price, inclusions, destination or OG copy to search crawlers and messenger previews; it returns readable generic Korean metadata with `noindex`.
- Production remains `authority_mode=shadow` with `publication_freeze=true`. The V6 branch preview may run only bounded shadow backfill batches; existing 990 packages are classification inventory, never bulk customer-exposure candidates.
- All Product Registration foreign keys currently reported by the Supabase performance advisor now have covering indexes; the eight remaining public-schema indexes were applied and verified valid/ready on production.
- The latest verification passes the full 731-file/5,484-test suite, TypeScript validation, authority-contract validation (`authorized=1`, `legacy=143`, `unapproved=0`), targeted lint, and `git diff --check`. No deployment or production migration was performed for the source-money, default-commission, or filename policy changes. These software checks do not replace the still-missing blinded frozen-corpus reviews.

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
- Existing inventory backfill is now a feature-flagged shadow workflow. It claims at most 25 packages, binds each run to the existing tenant/catalog identity, never publishes, and automatically heals a lost follow-up bind from a deterministic operation key. Evidence-rich rows are processed first; missing source text terminates as an explained block instead of consuming retries.
- Runtime authority defaults to `legacy` unless `PRODUCT_REGISTRATION_AUTHORITY_MODE` is explicitly set. The V6 branch preview is explicitly scoped to `shadow`, platform tenant `00000000-0000-0000-0000-000000000001`, shadow enabled, publish disabled, bounded backfill enabled, and publication frozen.
- The current authority scan is `authorized=1 legacy=143 unapproved=0`. The 143 legacy writers are a measured retirement ledger, not extra authorities: kernel database guards prevent them from changing canonical facts or publication.
- The latest verification passes TypeScript, lint, authority/registration contracts, the full 710-file/5,261-test suite, and a production Next.js build with 20 durable workflow steps and 389 static pages. When Supabase/blog build-time credentials are absent, sitemap generation returns no package/blog entries rather than falling back to mutable rows.
- The live mobile-readiness audit now treats an authoritative customer pointer as the definition of public. Two legacy active/published samples both failed: the pointerless Kota Kinabalu row, and the Fukuoka row whose 85 saved price dates disagree with its 84-date snapshot and whose mobile proof/customer-open contract are stale or blocked.
- A real Matsuyama HWP canary now reaches terminal `published_degraded` in shadow. Its 10 date-price pairs, 3-day/2-night itinerary, BX134/BX133, 7 inclusions, 5 exclusions, and customer-safe cancellation notice match the source; 8/8 critical/high claims are evidence-backed. Its exact snapshot passed real 390x844 serverless-Chromium `/packages` and `/lp` rendering, Korean webfont readiness, CTA interaction, snapshot/build lineage, required/forbidden-text, image-integrity, and hydration checks. Publication remained frozen and no pointer was created.
- The canary is safe degraded, not premium visual-ready: it has only a brand fallback image. After the current source-priority correction, flight times explicitly stated in its HWP may be shown after a new snapshot and proof; inferred missing times still require two independent date/route/flight-matched sources. Broad customer opening still requires representative-cohort error-budget evidence, media policy/provider completion, and shadow classification of the remaining legacy rows.
- The exact first 390x844 customer viewport is stored only in tenant-scoped private Storage with capture state, SHA-256, and private artifact location in the proof result. The proof separately scrolls the full page, verifies Korean font readiness, customer facts, forbidden values, image integrity, hydration, and CTA interaction. Immutable snapshots can be re-proved after a deployment; a proof still passes only when its observed renderer build matches that proof run's expected build.
- Customer score-signal API and database constraints must share the same allowlist. Migration `20260812082107_expand_package_score_signal_types.sql` adds the recommendation, comparison, intent, and lead-sheet event types already accepted by the API; silent HTTP-200 telemetry drops are a failed customer-flow verification.
- The first bounded production-data shadow batch claimed and started 25/25 workflows with zero start/bind failures and reached 25/25 terminal states without changing a publication pointer. All 25 were safely blocked: 13 for missing/ambiguous critical sales facts and 12 because a shared multi-product source could not yet be bound to one legacy identity. The latter exposed a Kernel defect, not a customer-data defect: the binding now uses the existing title/internal code only to select an exact local source section, never as product evidence. If selection remains ambiguous it becomes an explained block and no longer opens a dead letter.
- The first 12 corrected-engine retries removed the identity ambiguity failure and revealed a second downstream invariant: the workflow compared one bound revision with the source document's full section count. The downstream contract now carries `revisionSectionIndexes`, slices canonical payload/source segments to the exact bound product, and prevents another product in the same supplier source from contributing blockers or customer facts.
- Migration `20260812154000_product_registration_backfill_terminal_sync.sql` makes terminal V6 state and legacy-backfill ledger state converge in the same database transaction and prioritizes evidence-rich rows in bounded canaries. Production authority remains shadow and publication remains frozen.
- Migration `20260812155000_product_registration_foreign_key_indexes.sql` covers all 61 internal Product Registration foreign keys reported by the Supabase performance advisor. The follow-up advisor result is zero uncovered internal foreign keys; this protects backfill joins, terminal sync, correction/revision lookup, provider retries, and future high-volume cleanup without changing customer data.
- Migration `20260812156000_product_registration_backfill_retry_priority.sql` gives corrected-engine retries priority over unseen legacy inventory while retaining the three-attempt ceiling, so bounded canaries prove a fix before another large batch is admitted.
- The corrected 12-item shared-source retry then produced 11 ordinary evidence/policy blocks and one unsupported two-variant projection. `REVISION_VARIANT_CARDINALITY_UNSUPPORTED` is now an explicit policy blocker rather than a retried infrastructure failure: the Kernel never guesses which complementary variant is the saleable product and never dead-letters a document merely because human-verifiable product structure is ambiguous.
- Migration `20260813001000_product_registration_backfill_engine_version.sql` scopes retries to a workflow engine version. A corrected engine may re-run an earlier `WORKFLOW_FAILED` row once, while ordinary price/date/terms/evidence blocks never loop. Migration `20260813002000_product_registration_backfill_attempt_audit.sql` preserves the lifetime attempt count across engine upgrades.
- The final `product-registration-v6-workflow-2` production-data canary ended as `blocked`/`not_requested` with the exact price, inclusion/exclusion, departure-date, variant-cardinality, and cancellation-policy blockers. It created no new dead letter and did not move the single existing publication pointer. The 25-row shadow ledger is now 25/25 terminal blocked, 0 failed; V6 has 73 terminal outcomes, 0 unfinished/stale jobs, 17 unique sources, and 19 media-ready revisions.
- These terminal figures prove safe automatic completion, not customer-open accuracy. The annotated benchmark exact-match rate remains `null`, audited cohort size remains zero, and automatic publication remains frozen until the 99.5% critical-field exact-match and zero-critical-false-publication gates are measured.

Safe deployment order:

1. Keep production publication frozen and permit only bounded shadow backfill batches while database pressure and terminal-state health are monitored.
2. Expand the successful shadow HWP path across representative supplier/layout cohorts and confirm terminal verified/degraded/blocked outcomes without moving customer pointers.
3. Complete media and schedule-provider policy, then pass live tenant/RLS, private Chrome proof, and bounded pointer/surface-convergence tests for the exact revision/snapshot hashes.
4. Reprocess the existing 989 rows in bounded shadow batches and retain duplicate/ambiguous identities in quarantine.
5. Promote one bounded cohort to `kernel`; remove the freeze only for an exact canary operation, then re-enable it until its error budget holds.
6. Retire remaining legacy writers and direct readers only after the authoritative reader and rollback-pointer path are proven in production.

## V6 통합 자동화 계약 (2026-08-11)

V6의 유일한 종료 결과는 `published_verified`, `published_degraded`, `discarded_source_incomplete`, `blocked_action_required`이다. 완전 자동화는 모든 문서를 억지로 공개하는 것이 아니라, 모든 업로드가 검증된 공개·안전 축약 공개·원문 불완전 자동 폐기·안전 차단 중 하나로 자동 종결되는 상태를 뜻한다. `discarded_source_incomplete`는 판매가 부재가 원문 전체에서 확인된 경우만 허용하며 고객 데이터는 만들지 않는다.

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

Docling, Unstructured, Marker, MinerU, Camelot, PaddleOCR, Azure Document Intelligence, and similar tools are benchmark candidates only until text-upload golden corpus and source-span IR are stable. Do not add them as production dependencies in the upload route. When the OCR profile is explicitly enabled for a shadow/recovery worker, the default provider mode is `local`: a separately installed PaddleOCR JSON wrapper is the primary observation and Tesseract is the critical-token challenger. CLOVA and Google Document AI remain optional `cloud` mode escalations; they are never required for normal HWP/HWPX parsing and are not an automatic publication authority.

Any OCR/PDF benchmark must compare candidates offline using the same customer outcomes as the text corpus: product split count, price rows/dates, itinerary days, flight/hotel/meal relocation, evidence spans, and `/packages` + A4 render readiness.

Implementation status:

- `src/lib/product-registration/ocr-benchmark.ts` accepts OCR/PDF candidate extracted text and scores it through the same central registration engine and customer render checks.
- `npm run benchmark:product-ocr` runs the offline benchmark. With no input file, it uses the supplier raw golden fixtures, including the noisy OCR fixture, as the text-upload baseline.
- `npm run benchmark:product-ocr -- --input=path/to/candidates.json --json` can compare extracted text from Docling, Marker, MinerU, PaddleOCR PP-StructureV3, LayoutParser, Azure Document Intelligence, or any other candidate without adding that tool to production.
- `npm run benchmark:product-ocr:ci` is strict and fails when any candidate is not final-customer-outcome ready.

The local OCR contract is process-isolated and fail-closed. `PADDLEOCR_LOCAL_COMMAND` and `TESSERACT_LOCAL_COMMAND` are executed without a shell, receive a temporary source path through the exact `{input}` argument placeholder, and must return a bounded result. PaddleOCR wrappers must return JSON with `text`, optional `pages[].nodes`/`pages[].tables[].cells`, and `rawModelVersion`; Tesseract may return plain text for the challenger. Both results are retained as observations with model version and zero API cost. Critical price/date/flight tokens are compared after deterministic formatting normalization; disagreement becomes review-required and never overwrites the original source.
- External-engine candidates fail closed unless they include the exact engine version,
  source SHA-256, extracted-text SHA-256, source basename, and extraction duration.
  The benchmark recomputes the text hash, rejects duplicate engine/version/case/source
  identities, strips local directory names from reports, and publishes per-engine
  readiness summaries. A versionless or tampered extraction is not benchmark evidence.
- `npm run prepare:product-ocr-shadow` creates this manifest only under the git-ignored
  `data/product-registration/ocr-shadow/` directory. It reads the source file and an
  engine-produced UTF-8 text file, records hashes and provenance, and performs no DB,
  upload, publication, or customer-surface write.

Example shadow comparison:

```bash
npm run prepare:product-ocr-shadow -- --engine=docling --engine-version=<PINNED_VERSION> --case-id=<GOLDEN_CASE_ID> --source=<SOURCE_PDF> --text=<DOCLING_TEXT> --duration-ms=<MS>
npm run prepare:product-ocr-shadow -- --engine=paddleocr-pp-structure-v3 --engine-version=<PINNED_VERSION> --case-id=<GOLDEN_CASE_ID> --source=<SOURCE_PDF> --text=<PADDLE_TEXT> --duration-ms=<MS> --append
npm run benchmark:product-ocr -- --input=data/product-registration/ocr-shadow/candidates.json --json
```

Docling and PaddleOCR remain external shadow tools. Pin their own environment and
model artifacts outside the Next.js application, retain license/model provenance,
and promote neither engine until the same frozen private corpus proves better
critical-value exact match and final customer readiness in two consecutive runs.

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

## 2026-08-18 V6 production canary re-verification

- Production was redeployed with the proof route environment secret present and the server-only package availability preflight fixed to use the internal service key. Before this fix, a published-pointer lookup was sent with the anonymous key, returned `401`, and incorrectly surfaced as `PACKAGE_AVAILABILITY_UNAVAILABLE` (`503`) before the customer page rendered.
- The real HWP canary `[★KE-499특가] 다낭 9월 499 스팟특가 3박4일_0827발권.hwp` completed extraction, normalization, seven future departures, canonical revision, immutable snapshot, DeepSeek consensus, and both 390×844 mobile browser proofs. The latest proof run had `/packages` and `/lp` HTTP 200, CTA opened on both surfaces, no hydration errors, Korean font ready, zero broken images, no forbidden text, and matching snapshot/renderer hashes.
- Publication then stopped at the intentional cohort-quality gate because the database has zero eligible quality cohorts (`cohort_sample_count=0`, `eligible_cohort_count=0`). This is not a parsing or browser-proof failure. The workflow now terminalizes this condition as `blocked_action_required` with `V6_COHORT_QUALITY_INCOMPLETE` and creates no customer pointer; it is no longer misclassified as `quarantined_system_failure` or retried into the system dead-letter queue.
- Production remains safe for new uploads: each input reaches a terminal state, eligible reviewed cohorts may publish automatically, and inputs without an approved cohort remain safely blocked with an explicit reason. Existing products were not mass-published by this canary.

## 2026-09-01 Product registration cron retirement

- The permanent Vercel schedules for `product-registration-v5-outbox`, `product-registration-v5-convergence`, `product-registration-v6-watchdog`, and `product-registration-v6-backfill` are retired. Their API routes remain available for an explicitly approved recovery or migration window.
- V5 outbox delivery and convergence observation are part of the durable V6 workflow's `convergeStep`; successful uploads must not depend on separate 2-minute and 5-minute global polling loops.
- The V6 legacy backfill ledger is terminal and the production upload-job queue has no current unfinished or stale work. A backfill or watchdog schedule may be restored only for a bounded change window with a measured backlog, an owner-approved stop condition, and post-run evidence.
- A cron must not be scheduled merely because its route exists. Product registration defaults to event-driven workflow execution, with manual recovery endpoints retained without consuming permanent Vercel cron slots.
