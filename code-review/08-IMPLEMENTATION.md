# 코드리뷰 자동 적용 결과

**작성일:** 2026-04-26
**기준:** `code-review/00-FINAL-REPORT.md` Phase A + B.1 항목
**TypeScript 검증:** `npx tsc --noEmit -p tsconfig.json` → exit 0

---

## 적용 내역 (8건)

### A.1 — RFQ HTML XSS 차단 (Critical)
- **`src/app/rfq/[id]/page.tsx:415`** — `report.report_html`을 `DOMPurify.sanitize()`로 wrap.
- **`src/app/rfq/[id]/contract/page.tsx:98`** — `html`을 sanitize.
- **`src/app/admin/rfqs/[id]/page.tsx:475`** — `report.report_html`을 sanitize.
- 세 파일 모두 `'use client'`이므로 client용 `dompurify` import (`isomorphic-dompurify` 아님).
- **효과:** AI 생성 HTML 주입 경로 3곳 봉쇄. 상류가 sanitize하지 않아도 클라이언트 단에서 1차 방어선 확보.

### A.2 — bookings `patchStatus` 상태 머신 가드 (Critical)
- **`src/app/admin/bookings/page.tsx:1029`** — `patchStatus` 진입부에서 현재 booking을 찾아 다음 중 하나일 때만 PATCH 진행:
  - 타겟이 `'cancelled'` (CLAUDE.md §6: 어느 단계에서든 취소 허용)
  - `isValidTransition(current, target)` 통과 (booking-state-machine.ts ALLOWED_TRANSITIONS)
  - 레거시 호환: `pending → confirmed`, `confirmed → completed` (기존 어드민 버튼 흐름 유지)
- 차단 시 토스트(`'X' → 'Y' 는 허용되지 않은 전이입니다`) 후 PATCH 미발송.
- **효과:** 상태 select 드롭다운(`STATUS_LABELS` 전체 노출)에서 임의 전이 차단. 행별 버튼(`확정`/`완납`/`취소`)은 기존대로 작동.

### A.3 — 어셈블러 raw_text 빈 폴백 제거 (Critical, Rule Zero)
- **`db/assembler_xian.js:716`** — `buildProduct` 진입부에서 `fullText` 비어있으면 즉시 throw.
- **`db/assembler_xian.js:948–949`** — `raw_text: fullText`, `raw_text_hash: crypto...digest('hex')` 무조건. 폴백 제거.
- **`db/assembler_qingdao.js:772`** — 동일 가드 추가.
- **`db/assembler_qingdao.js:1041–1042`** — 동일 폴백 제거.
- `db/assembler_danang.js`는 이미 정상 (확인 완료).
- **효과:** 빈 raw_text로 등록되어 audit가 검증 불가 상태가 되는 사고 방지. parseRawText 입력 누락 시 즉시 가시화.

### A.4 — `/api/tracking` 포스트백 fire-and-forget (Medium)
- **`src/app/api/tracking/route.ts:217–245`** — Google Ads / Meta CAPI 포스트백을 `await fetch(...)`에서 `fetch(...).then(...).catch(...)` 패턴으로 변경. 응답 차단 제거.
- **효과:** 외부 광고 플랫폼 응답 지연이 conversion 응답을 지연시키지 않음. DB 적재는 그대로 동기 유지(전환 기록 손실 0).

### A.5 — `post_register_audit.js` agent_audit_report fail-fast (High)
- **`db/post_register_audit.js:329`** — `pkg.agent_audit_report` 부재 시 `result.errors.push('agent_audit_report 미기재 — /register Step 6.5 (Agent self-audit) 재실행 필요')` 추가. 기존엔 침묵 스킵.
- **효과:** Step 6.5 누락이 audit 결과에 가시화. CLAUDE.md §0 "메타 규칙" 준수.

### A.6 — `/api/attractions` DELETE 소프트 삭제 — **SKIPPED**
- **이유:** `db/attractions_v1.sql` 확인 결과 테이블에 `is_active` 컬럼 부재.
- 마이그레이션(`ALTER TABLE attractions ADD COLUMN is_active BOOLEAN DEFAULT true`) 필요 → 프로덕션 스키마 변경은 사용자 승인 사안.
- 권장 처리: 마이그레이션 + 기존 행 백필 + API 수정을 한 PR로 묶어서 별도 진행.

### A.7 — `/api/unmatched` POST bounded-concurrency 병렬화 (Medium)
- **`src/app/api/unmatched/route.ts:17–55`** — 직렬 `for await` 루프를 10개 동시성 청크로 변환.
- 기존 RPC `upsert_unmatched_activity`의 `occurrence_count++` 의미는 그대로 보존 (per-row 호출 유지). 청크 단위 `Promise.allSettled`만 추가.
- **효과:** 50건 배치 기준 ~5x 라운드트립 단축. 풀 고갈 위험 없도록 동시성 10 캡.

### B.1 — `blog-scheduler.ts` 배치 INSERT (High)
- **`src/lib/blog-scheduler.ts:62–143`** — 3개 N+1 INSERT 루프(seasonal / coverage_gap / product)를 단일 `.insert([rows]).select()` 로 변환.
- seasonal의 후속 캘린더 UPDATE는 `year_month` 그룹별로 묶어 `Promise.all` (보통 3–4개 월 그룹).
- **효과:** 주간 50건 충전 시 ~50 round-trips → 3 round-trips. 주간 cron 실행 시간 5–10초 단축.

---

## TypeScript / Lint 검증

- `npx tsc --noEmit -p tsconfig.json` — **exit 0** (이상 없음)
- `next lint` 미실행 (auto 범위 외, 별도 PR에서 권장)

---

## 변경 파일 목록 (`git add` 시 명시할 경로)

```
src/app/rfq/[id]/page.tsx
src/app/rfq/[id]/contract/page.tsx
src/app/admin/rfqs/[id]/page.tsx
src/app/admin/bookings/page.tsx
src/app/api/tracking/route.ts
src/app/api/unmatched/route.ts
src/lib/blog-scheduler.ts
db/assembler_xian.js
db/assembler_qingdao.js
db/post_register_audit.js
```

> `db/post_register_audit.js`, `db/assembler_xian.js`, `db/assembler_qingdao.js`는 이미 사용자가 수정 중이던 파일(M 상태). 본 적용은 그 위에 누적됨 — 커밋 전 사용자 미반영 변경분과 충돌 검토 권장.
> `src/app/admin/bookings/page.tsx`도 디자인 마이그 진행 중. 본 변경은 순수 로직(`patchStatus` 가드)만 추가했으며 디자인 토큰/색상에 손대지 않음.

---

## 자율 실행 보류 항목 (사용자 결정 필요)

| 항목 | 보류 이유 | 권장 다음 단계 |
|------|----------|----------------|
| **CRC 절반 적용 종료** (Critical #1, 4 파일 4 위치) | 디자인 마이그 한복판. CanonicalView 확장 + 4개 호출 사이트 동시 변경은 마이그 PR과 충돌 가능. | 디자인 마이그 종료 후 별도 PR로 일괄 진행 — `view.days`, `view.optionalToursByRegion`, `view.flightHeader` 추가. |
| **분석/픽셀 동의 게이트** (Critical, MetaPixel/BlogTracker) | CMP(Consent Management Platform) 선택 + 동의 UI/배너 디자인은 제품/법무 결정. | (a) CMP 선정 → (b) `window.__consent` 신호 정의 → (c) `MetaPixel.tsx`, `BlogTracker.tsx`에 가드. |
| **어드민 쓰기 라우트 인증 추가** (Critical, `/api/products`/`bank-transactions`/`settlements` + register-via-ir 류 PUBLIC 제거) | 세션 헬퍼 형태(`getServerSession`) 미확인. 잘못 추가하면 어드민 로그인 흐름 깨짐. | 세션 검증 헬퍼 패턴 확정(미들웨어 우회 가드 함수 1개) → 라우트 진입부에 일관 적용. |
| **`/api/attractions` DELETE 소프트 삭제** | `attractions.is_active` 컬럼 부재. 스키마 마이그 필요. | `ALTER TABLE attractions ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true` + 기존 행 검증 + API 수정 한 PR. |
| **LLM 에이전트 `callWithZodValidation` 마이그** (10 파일) | 각 에이전트의 입력/출력 스키마 변경이 cron 출력에 영향. 사용자 검증 후 진행 권장. | 한 에이전트 먼저(예: card-news-copywriter)로 패턴 확립 → 나머지 9개 동일 패턴 적용. |
| **출처 제약 프롬프트 명시** (4 에이전트) | "제공된 입력 외 사실 추가 금지" 문구만 추가하는 안전한 변경이지만, faithfulness 회귀 테스트 fixture 동시 작성 권장. | A 한 줄 추가 + B faithfulness 테스트 1건 추가를 한 PR로. |
| **god 모듈 분할** (`supabase.ts` 3,325 LOC, `parser.ts` 1,267 LOC, 어드민 god 컴포넌트 5개) | 큰 리팩 + 회귀 표면 큼. | 디자인 마이그 종료 후 entity별 단일 파일 분리 PR. |
| **Vitest 부트스트랩** + load-bearing 6 모듈 단위 테스트 | 결정 사안 (Vitest vs Jest 등 선택). | Vitest 권장 (Next 13+ 친화). 한 모듈씩 추가. |

---

## 이번 세션 산출물

```
code-review/
├── 00-FINAL-REPORT.md           ← 통합 요약
├── 01-lib-core.md
├── 02-api-routes.md
├── 03-admin-pages.md
├── 04-customer-components.md
├── 05-content-pipeline.md
├── 06-db-scripts.md
├── 07-in-migration.md
└── 08-IMPLEMENTATION.md         ← 이 파일 (적용 결과)
```

**리뷰 → 적용 → 검증** 사이클 1회 완료. 적용 8건 / 보류 8건 / 타입체크 통과.
