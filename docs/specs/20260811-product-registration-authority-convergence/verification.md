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
- Latest verification: TypeScript, lint, production build, authority/registration contracts (`authorized=1 legacy=143 unapproved=0`), and the full 710-file / 5,252-test suite passed. The build produced 20 durable workflow steps and 389 static pages.

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
- [ ] 기존 989개 shadow backfill이 현재 publication pointer를 변경하지 않는다.

## Evidence To Report

- Test output: authority, kernel, workflow, corpus, type/lint/build
- API response: upload 202, job terminal outcome, correction/reprocess
- DB/schema check: RLS/grants/FK/immutability/RPC/advisors
- Screenshot/browser proof: 390x844 packages/LP/CTA
- Audit/eval/readiness result: V6 readiness, convergence, cohort quality

## Approval Gates

- [x] 로컬 코드와 순방향 migration 파일 작성은 사용자가 승인한 구현 범위다.
- [ ] 운영 DB migration은 별도 적용 게이트에서 live backup, advisor, RLS 검증과 함께 수행한다.
- [ ] publication flag와 freeze는 989개 shadow 결과 및 canary 기준이 통과하기 전 변경하지 않는다.
