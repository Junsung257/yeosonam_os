# Verification: Product Registration Authority Convergence

## Local evidence recorded on 2026-08-11

- PostgreSQL syntax parser: `PARSE_OK 2695 lines 221 statements` for the forward-only authority migration.
- TypeScript: `npm run type-check` passed.
- Authority audit: `authorized=1 legacy=142 unapproved=0`.
- Registration-domain verification: 100 files / 612 tests passed.
- Full repository verification: 681 files / 5,140 tests passed.
- Lint: passed with zero warnings.
- Production build: passed; the workflow bundle contains 20 durable steps and Next.js generated 389 static pages.
- The local build emitted one expected warning because the blog database was unavailable; blog sitemap entries were safely omitted and the build completed.
- The V6 workflow source contains no `legacyCompatibilityStep`, `runUploadRegistrationPipeline`, source re-download, or proof-time package activation path.

These results prove local code consistency, not customer-open readiness. Production migration application, live RLS/grant negative tests, frozen HWP/OCR corpus execution, the 989-product shadow backfill, live OAG/Cirium calls, deployed cache convergence, and real mobile Chrome proof have not been performed in this task and remain mandatory Tier 3 gates.

## Additional evidence recorded on 2026-08-12

- Applied forward migration `20260812133000_product_registration_automation_readiness_and_media.sql` to production. It adds complete legacy-inventory claiming, safe terminal blocking for missing source text, licensed reference-media linkage, and one automation-readiness metrics RPC. It does not change authority mode, publication pointers, or the global freeze.
- Terminalized two historical abandoned V6 jobs through the existing dead-letter/terminal RPC path. Production now has zero unfinished and zero stale V6 jobs.
- Re-ran all 40 HWP files: extraction 40/40, normalization 40/40, 66 product sections, render contracts 66/66, verified 1, degraded 52, blocked 13, safe automatic terminal candidates 53/66 (80.30%). Critical claims have 248/248 evidence anchors; overall claim-level evidence is 92.15% after removing false section-wide evidence inheritance.
- Recorded the result in `profile_benchmark_runs` as `passed=false`, `exact_match_rate=null`, `measurement_status=structural_only`. The readiness gate therefore remains closed until a frozen annotated corpus proves at least 99.5% exact match and zero critical false publications.
- Fixed three production-risk defects: serverless Chromium was falsely reported unavailable; ISO flight timestamps could be parsed from the year as `20:26`; OCR could classify a bare year as a flight number.
- Added a licensed Pexels reference-media path that stores source page, photographer, license, attribution, and a customer-visible reference-image disclaimer. Missing provider configuration remains degraded, never fabricated.
- Converted customer content generation, public search, B2B v1, affiliate API/landing/embed/referral, blog product links/destination, RSS, destination attractions, and itinerary print to exact pointer/snapshot reads.
- Latest verification: TypeScript, lint, production build, authority/registration contracts (`authorized=1 legacy=143 unapproved=0`), and the full 710-file / 5,259-test suite passed. The build produced 20 durable workflow steps and 389 static pages.
- Deployed the guarded V6 backfill endpoint in a branch preview with authority `shadow`, publish disabled, and global publication freeze enabled. The first forced bounded batch claimed/started 25/25 rows with zero start or bind failure and later synchronized 25/25 terminal outcomes without creating or moving customer pointers.
- The first batch correctly exposed that shared legacy source text can contain several catalog products. Twelve rows initially terminal-blocked at normalization with `REGISTRATION_CORRECTION_IDENTITY_AMBIGUOUS`. The Kernel now selects only a uniquely matching local source section using the legacy title/internal code as routing hints, never evidence; unresolved identity remains an expected explained block instead of a dead letter.
- Applied forward migration `20260812154000_product_registration_backfill_terminal_sync.sql` to production. It synchronizes the backfill ledger in the same transaction as the V6 terminal job and prioritizes evidence-rich rows for subsequent bounded canaries. It does not publish, unfreeze, or change authority mode.
- Applied `20260812155000_product_registration_foreign_key_indexes.sql`; the Supabase performance advisor went from 61 uncovered internal Product Registration foreign keys to 0. Security advisor reported no new product-registration warning from the terminal-sync trigger/function.
- Retried the 12 shared-source failures on the corrected section selector. Identity ambiguity fell to zero, exposing `V6_KERNEL_REVISION_COUNT_MISMATCH`; the downstream workflow contract now transports exact `revisionSectionIndexes` and validates only the bound canonical payload/source segments. Migration `20260812156000_product_registration_backfill_retry_priority.sql` keeps corrected canaries ahead of unseen inventory without relaxing the retry ceiling.
- Retried those 12 rows again after the section-index fix: 11 reached ordinary policy/evidence blocks, while one complementary two-variant source exposed `REVISION_VARIANT_CARDINALITY_UNSUPPORTED`. The workflow now classifies this as a customer-safe policy block rather than retrying and dead-lettering it as infrastructure failure.
- Applied `20260813001000_product_registration_backfill_engine_version.sql` and `20260813002000_product_registration_backfill_attempt_audit.sql`. Retries are now scoped to the workflow engine version, only previous `WORKFLOW_FAILED` outcomes can be reconsidered by a newer engine, and lifetime attempts remain auditable across upgrades.
- The exact one-item `product-registration-v6-workflow-2` canary ended `blocked` with publication `not_requested`, no new dead letter, and no publication pointer movement. The legacy ledger is 25/25 terminal blocked and 0 failed; readiness reports 73 V6 terminal outcomes, 0 unfinished/stale jobs, 17 unique sources, and 19 media-ready revisions.
- Final local regression after the last production-data defect fixes: 710 test files / 5,261 tests, TypeScript, zero-warning lint, registration contract, authority boundary (`authorized=1 legacy=143 unapproved=0`), and production build all passed. The build emitted 20 durable workflow steps and 389 static pages. The yearless-date test now pins its reference clock, preventing calendar-date rollover from creating a false annual failure.
- The benchmark still has `exact_match_rate=null`, zero audited cohort samples, and zero eligible cohorts. Publication remains correctly frozen; these results prove terminal safety and regression integrity, not the 99.5% customer-open accuracy gate.

## Automated Checks

```bash
npm run check:product-registration-contract
npm run check:product-registration-authority
npm run verify:product-registration-v4:hwp
npm run verify:product-registration-v5:strict
npm run eval:product-registration:ci
npx vitest run src/lib/product-registration src/lib/product-registration-v4 src/lib/product-registration-v6 src/workflows
npm run type-check
npm run lint
npm run build
npm test
```

## Manual and live QA

- [ ] 동일 source의 중복 요청, 부분 commit, workflow retry가 중복 revision을 만들지 않는다.
- [ ] tenant A는 tenant B의 source, revision, snapshot을 읽거나 연결할 수 없다.
- [ ] signed proof URL에서만 비공개 snapshot이 렌더되고 상품 운영 상태는 바뀌지 않는다.
- [ ] `/packages`, `/lp`, OG, sitemap, affiliate, B2B가 채널별 동일 pointer hash를 표시한다.
- [ ] verified/degraded/blocked 표본이 고객 관점에서 올바르게 자동 종결된다.
- [~] 기존 990개 중 첫 25개 shadow backfill은 publication pointer를 변경하지 않고 25/25 terminal 처리됐다. 나머지 965개도 같은 제한 배치로 검증한다.

## Evidence To Report

- Test output: authority, kernel, workflow, corpus, type/lint/build
- API response: upload 202, job terminal outcome, correction/reprocess
- DB/schema check: RLS/grants/FK/immutability/RPC/advisors
- Screenshot/browser proof: 390x844 packages/LP/CTA
- Audit/eval/readiness result: V6 readiness, convergence, cohort quality

## Approval Gates

- [x] 로컬 코드와 순방향 migration 파일 작성은 사용자가 승인한 구현 범위다.
- [x] 이 작업 범위의 운영 DB migration은 순방향으로 적용했고 Product Registration FK 성능 advisor, 신규 보안 경고, 권한 경계, terminal sync를 재검증했다. 공개 mode/freeze는 변경하지 않았다.
- [ ] publication flag와 freeze는 현재 990개 shadow inventory와 canary 기준이 통과하기 전 변경하지 않는다.
