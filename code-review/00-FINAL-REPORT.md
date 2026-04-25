# 여소남 OS — 전체 코드리뷰 통합 리포트

**작성일:** 2026-04-26
**리뷰 범위:** `src/` (621 TS/TSX, ~131,869 LOC) + `db/` (128 JS, ~35,460 LOC) ≈ **167,000 LOC**
**구성:** 7개 분할 리포트의 통합본 (`01-lib-core.md` ~ `07-in-migration.md`)

---

## 0. 한 화면 요약

| 분할 | 범위 | 파일수 | LOC | Critical | High | Medium |
|------|------|--------|-----|----------|------|--------|
| 01 | `src/lib/` 코어 유틸 | 192 | 42,281 | 3 | 4 | 6 |
| 02 | `src/app/api/` 라우트 | 192 (+4 제외) | ~8,500 | 5 | 8 | 10+ |
| 03 | `src/app/admin/` 페이지 (마이그제외) | 42 | ~31,000 | 1 | 5 | 8 |
| 04 | 고객 페이지 + components | 21 | — | 4 | 6 | 5 |
| 05 | Content pipeline + AI | 28 | 4,500 | 5 | 8 | 12 |
| 06 | `db/` 스크립트 | 128 | 35,460 | 2 | 3 | — |
| 07 | 마이그레이션 진행중 파일 | 21 | 11,500 | 1 | 3 | 6 |
| **합계** | | **624** | **~133,000** | **21** | **37** | **47+** |

> 분할별 상세 리포트는 같은 디렉토리(`code-review/`)의 `01-..` ~ `07-..` 파일 참조.

---

## 1. 가장 심각한 5가지 (저장소 전체 기준)

### 1.1 CRC(렌더링 계약) 절반만 적용 — A4↔모바일 잠재적 분기
- **Files:** `src/app/packages/[id]/DetailClient.tsx:231–245`, `src/components/admin/YeosonamA4Template.tsx:172,175,209`, `src/app/packages/PackagesClient.tsx:84,248`, `src/app/admin/packages/page.tsx:67`
- **증상:** `view = renderPackage(pkg)`을 호출은 하지만 `view.airlineHeader.airlineName`만 소비. 일정/선택관광/항공편 추출은 여전히 raw `pkg.itinerary_data` / `pkg.optional_tours` / `pkg.flight_info` 파싱.
- **영향:** A4 포스터와 모바일 상세가 같은 데이터를 다른 경로로 파싱 → 렌더 결과가 silently 분기 (ERR-KUL-05이 막으려던 그 패턴).
- **수정:** `CanonicalView`에 `days`, `optionalToursByRegion`, `flightHeader.outbound/return` 필드 추가 → 4개 호출 사이트 마이그레이션. (Split 7 §3, Split 1 §4)

### 1.2 booking 상태 머신 우회 (어드민 클라이언트)
- **File:** `src/app/admin/bookings/page.tsx:1029` `patchStatus`
- **증상:** 클라이언트 `ALLOWED_TRANSITIONS` 사전검증 없이 임의 status를 PATCH. 라인 1854–1990의 상태 버튼이 모두 검증 없이 호출됨.
- **영향:** 무효 전이가 서버에서 거부될 때 클라이언트 상태가 서버와 분기 → 정산/메시지 로그 정합성 위협.
- **수정:** `patchStatus` 진입부에 `ALLOWED_TRANSITIONS[currentStatus].includes(target)` 가드 + 무효 버튼 disable. (Split 3 §7, Split 7 §2.2)

### 1.3 어드민 쓰기 엔드포인트 인증 누락
- **Files:** `src/app/api/products/route.ts` (PATCH/DELETE), `src/app/api/bank-transactions/route.ts` (PUT/PATCH), `src/app/api/settlements/route.ts` (POST/PATCH), `src/middleware.ts:32–34` (`/api/register-via-ir`, `/api/audit-pkg-to-ir`, `/api/register-via-assembler` 공개 노출)
- **증상:** 명시적 세션 검증 없이 미들웨어에 의존. `bank-transactions`은 결제/정산 데이터 수정.
- **영향:** Critical — 미들웨어 우회 시 익명 사용자가 결제 레코드 수정 가능.
- **수정:** 각 라우트 진입부에서 `getServerSession()` 검증 + role 체크. PUBLIC_PATHS에서 register-via-ir 류 제거. (Split 2 §2)

### 1.4 RFQ HTML 렌더 sanitize 부재 (XSS)
- **Files:** `src/app/rfq/[id]/page.tsx:415` (`report.report_html`), `src/app/rfq/[id]/contract/page.tsx:98`, `src/app/admin/rfqs/[id]/page.tsx:475`
- **증상:** AI 생성 HTML을 `dangerouslySetInnerHTML`로 직접 주입. DOMPurify 미사용.
- **영향:** Critical — 상류 파이프라인이 sanitize하지 않으면 즉시 XSS 표면. 외부 공유 링크 페이지에 노출.
- **수정:** `isomorphic-dompurify`로 wrap. 1줄 수정 × 3 파일. (Split 4 §3, Split 7 §6)

### 1.5 LLM 출력 검증 우회 + 출처 미준수 (faithfulness 누수)
- **Files:** `src/lib/content-pipeline/agents/{card-news-copywriter,cover-critic,structure-designer,instagram-caption,kakao-channel,google-ads-rsa,meta-ads,threads-post,card-copy,competitor-ad-analyzer}.ts`
- **증상:** 10개 에이전트가 raw `JSON.parse` + `safeParse` 후 실패시 즉시 fallback. `callWithZodValidation` feedback 루프 미사용. 4개 에이전트(card-news-copywriter, cover-critic, blog-body, structure-designer)는 "원문에서만 사용" 제약 명시 없음 → 무근거 사실 생성 가능 (예: "2시간 정상 트레킹", "비싼 보홀 피하는 법").
- **영향:** High — 마케팅 카피에 없는 사실 삽입 = 환불/법적 리스크 (memory `feedback_card_news_faithfulness.md` 정책 위반). 주간 fallback율 5–10%로 품질 저하.
- **수정:** 모든 에이전트를 `callWithZodValidation`로 마이그레이션 + 프롬프트에 `"제공된 입력 외 사실 추가 금지"` 명시. (Split 5 §2, §4)

---

## 2. 가로지르는 패턴 (Cross-cutting Themes)

### 2.1 단일 진실 소스(SSOT) 무너짐 — 동일 로직 N개 위치
| 패턴 | 위치 | 승자 (canonical) |
|------|------|------------------|
| IATA→항공사명 매핑 | `parser.ts:50`, `transportParser.ts`, `render-contract.ts`, `PackagesClient.tsx:248` 인라인 | `getAirlineName()` in `render-contract.ts` |
| 가격 포맷 | `admin-utils.ts` (fmt만/fmtK), `payments/page.tsx`, `bookings/page.tsx`, `customers/page.tsx` 인라인 | 신규 `lib/formats.ts`로 통합 |
| 날짜 포맷 | bookings (3종), payments (2종), customers/marketing 인라인 (총 6+) | 신규 `lib/formats.ts` |
| 상태 배지 색 | packages, bookings, rfqs, marketing, control-tower 5곳 | 신규 `lib/status-colors.ts` |
| 후크 룰 (콘텐츠) | structure-designer, card-news-copywriter, cover-critic 3곳 (충돌) | 통합 prompt registry |
| 어셈블러 코어 | xian/qingdao/danang 60% 중복 (`parseRawText`, `buildProduct` 등) | `db/lib/block-master.js` 추출 |
| 제목 정제 정규식 | `YeosonamA4Template.tsx:161–163`, DetailClient | `lib/title-clean.ts` |

→ 통합 작업으로 약 **2,000+ LOC 감축** 가능.

### 2.2 클라이언트/서버 경계 위반
- **어드민 페이지 42개 모두 `'use client'` + `useEffect`로 마운트시 fetch.** ISR/캐시 0건. 페이지 이동마다 풀 API 호출.
- **고객 페이지 5개**(`concierge`, `group-inquiry`, `share`, `rfq/[id]`, `influencer/[code]`)도 클라이언트 마운트 fetch. CLAUDE.md §4-4 정면 위반.
- **수정 방향:** 읽기 전용 페이지부터 서버 컴포넌트로 이전. `'use client'`는 폼/편집 영역으로 한정.

### 2.3 N+1 / 비효율 쿼리
- `src/lib/blog-scheduler.ts:63–142` — for 루프 × 50회 `insert()`
- `src/app/api/cron/embed-products` — 200개 패키지 1건씩 vector update
- `src/app/api/customers` (bulk_tag), `bank-transactions` (resync), `unmatched` (POST), `bookings` (retroactive match) — for+await 루프
- `src/app/admin/bookings/page.tsx:1078–1089` `handleBulkCommit` — N개 PATCH 직렬 fetch
- **수정:** 단일 `.insert([...])` / `.in(...)` / 단일 RPC + array 파라미터.

### 2.4 입력 검증 부재 (어드민/내부 API 15+)
- bookings, customers, products, RFQ, settlements 라우트가 zod 없이 body 직접 사용. 타입 혼동/주입 위험.
- **수정 방향:** 라우트 진입부 zod 스키마 1개씩 추가 + 공통 `withValidation()` 헬퍼.

### 2.5 분석/추적 동의 없음 (PIPA 노출)
- `src/components/MetaPixel.tsx:29` — `fbq('init', PIXEL_ID)`이 첫 방문에 발화
- `src/components/BlogTracker.tsx:19` — `trackContentView()` 동의 게이트 없음
- **수정:** CMP 도입 + `if (window.__consent?.analytics)` 가드.

### 2.6 테스트 부재 (Load-Bearing 모듈)
- Vitest/Jest 설정 자체 없음. Visual regression만 존재.
- 단위 테스트 0인 모듈: `booking-state-machine`, `payment-matcher`, `package-acl`, `render-contract`, `package-register`, `mileage-service`. **재무·상태·파싱 모두 무방어.**
- **수정:** Vitest 부트스트랩 → 위 6개 모듈 80% 커버리지.

### 2.7 Soft-delete / GENERATED 컬럼 위반
- 하드 DELETE: `src/lib/supabase.ts:224`, `src/app/api/attractions/route.ts:236–254`. CLAUDE.md §2-3 위반.
- `selling_price` (GENERATED) 포함 INSERT 가능성 — `api/packages/route.ts` 감사 필요.

---

## 3. 분할별 핵심 요약

### Split 1 — `src/lib/` 코어 유틸
192 파일 / 42K LOC. **god 모듈 10개** (최대: `supabase.ts` 3,325 LOC). **항공사 매핑 3중 중복**, **blog-scheduler 미배치 INSERT**, **하드 DELETE**, **CRC 우회**, **load-bearing 모듈 단위 테스트 0개**, `any` 타입 126건, 매직넘버(`MIN_EARN`, payment-matcher 임계치) 미문서화. → `01-lib-core.md`

### Split 2 — `src/app/api/` 라우트
196 파일 / 8.5K LOC. **N+1 6+ 라우트**, **어드민 쓰기 인증 누락 (Critical)**, **bare `.single()` 8+ 인스턴스**, **검증 없는 body 15+**, **웹훅 멱등성 갭** (kakao 웹훅, bank-transactions PUT, unmatched POST). 응답 envelope과 env 가드는 일관됨(좋음). → `02-api-routes.md`

### Split 3 — `src/app/admin/` 페이지 (마이그 제외 42개)
~31K LOC. **42 페이지 모두 `'use client'` + on-mount fetch** (ISR/캐시 0). **god 컴포넌트 5개** (packages 1978, payments 1502, marketing/card-news/v2 982, content-hub 858, root 805). **booking 상태 머신 우회 (Critical)**. 포맷 함수 6중 / 상태 배지 5중 중복. 디바운스 부재. → `03-admin-pages.md`

### Split 4 — 고객 페이지 + components (마이그 제외)
21 파일. **RFQ HTML XSS 표면 2건 (Critical)**, **분석 무동의 발화 (Critical)**, **5개 페이지 SSR/ISR 위반**, raw `<img>` 다수, `concierge`/`group-inquiry` 메타데이터 부재, 서비스워커 minified로 감사 불가. JSON-LD/canonical은 양호. → `04-customer-components.md`

### Split 5 — Content Pipeline + AI
28 파일 / 4.5K LOC. **10개 에이전트가 `callWithZodValidation` 미사용 (Critical)**, **4개 에이전트 출처 제약 부재 → 무근거 사실 생성 가능**, **product context 3중 전송 (월 $50–100 낭비)**, hook 룰 3곳 충돌, Gemini 호출 per-call timeout 부재, card-news-refine 중복 실행 방지 없음, faithfulness gate 미존재. cron auth/maxDuration/error 로깅은 양호. → `05-content-pipeline.md`

### Split 6 — `db/` 스크립트
128 파일 / 35K LOC. **assembler_xian:948 raw_text 빈 폴백 (Rule Zero 위반, Critical)**, **post_register_audit가 `agent_audit_report` 누락 시 침묵 스킵 (High)**, **55+ 임시 스크립트** (`insert_*`, `seed_*`, `check_*`) 미정리 → `db/archive/` 권장, **assembler 코어 60% 중복** → `BlockMaster` 클래스 추출 권고, `audit_render_vs_source.js` CI 미연결. → `06-db-scripts.md`

### Split 7 — 마이그레이션 진행 중 파일 (디자인 V2)
21 파일 / 11.5K LOC. **CRC 절반 적용 (Critical)** — view 계산만 하고 미사용. **booking patchStatus 무가드**, **`/api/attractions` 하드 DELETE**, **`/api/tracking` 포스트백 await 차단**, **`/api/unmatched` POST N+1**, `packages/page.tsx` `.limit(50)` 하드코딩, 서비스 워커 source 추적 필요. 디자인 토큰/색상 결정은 손대지 않음. → `07-in-migration.md`

---

## 4. 권장 실행 순서

### Phase A — 즉시 (이번주, 안전한 1줄 ~ 1시간 수정)
1. **RFQ HTML DOMPurify wrap** × 3 파일 (Critical, S)
2. **bookings `patchStatus`에 `ALLOWED_TRANSITIONS` 가드 추가** (Critical, S)
3. **분석/픽셀 동의 게이트** (`MetaPixel.tsx`, `BlogTracker.tsx`) (Critical, M)
4. **assembler_xian:948–949 raw_text 빈 폴백 제거 + hash 항상 계산** (Critical, S)
5. **`/api/attractions` DELETE → `is_active=false` 소프트 삭제** (High, S)
6. **`/api/tracking` 포스트백 `void fetch(...)` 변경** (Medium, S)
7. **post_register_audit가 agent_audit_report 부재시 fail-fast** (High, S)

### Phase B — 1~2주 (구조적 SSOT 통합)
8. **`getAirlineName()` 단일화** — parser.ts/transportParser.ts/PackagesClient 인라인 매핑 제거 → render-contract로 통합 (M)
9. **`CanonicalView` 확장** — `days`, `optionalToursByRegion`, `flightHeader` 추가 → DetailClient/YeosonamA4Template/PackagesClient 마이그레이션. CRC 절반 적용 종료 (M, **마이그 PR과 별도로 가능**)
10. **`lib/formats.ts` + `lib/status-colors.ts` 신규** — 어드민 6중 포맷 / 5중 배지 통합 (M)
11. **어드민 쓰기 라우트 인증 추가** (`/api/products`, `/api/bank-transactions`, `/api/settlements`) + PUBLIC_PATHS에서 register-via-ir 제거 (Critical, M)
12. **블로그 스케줄러 배치 INSERT** (S)
13. **10개 LLM 에이전트 → `callWithZodValidation`** + 4개에 출처 제약 프롬프트 명시 (M)

### Phase C — 1개월 (테스트 + 큰 리팩)
14. **Vitest 부트스트랩** + load-bearing 6개 모듈 단위 테스트
15. **god 모듈 분할** — `supabase.ts` (3,325 → entity별 분할), `parser.ts` (1,267 → airline/price 분리), 어드민 god 컴포넌트 5개
16. **어드민 페이지 서버 컴포넌트 이전** (읽기 전용부터)
17. **assembler `BlockMaster` 클래스** 추출 — 새 지역 추가 비용 1000→200 LOC
18. **`db/archive/` 정리** — 55+ 임시 스크립트 이동
19. **faithfulness gate** — variant/blog 출력 ↔ 상품 사실 비교 모듈

### Phase D — 디자인 마이그 종료 후 (연계)
20. **bookings/page.tsx 분해** (2005 LOC → 4–5 컴포넌트)
21. **packages/page.tsx 분해** (1978 LOC)
22. **YeosonamA4Template 분해** (1677 LOC)
23. **서비스 워커 runtimeCaching 감사** + source 확보

---

## 5. 강점 (보존할 것)

- **`render-contract.ts`** — CRC 자체는 잘 설계됨. 부족한 것은 사용처 확장.
- **`booking-state-machine.ts`** — `ALLOWED_TRANSITIONS` 명시적, 단순.
- **`notification-adapter.ts`** — Solapi/Mock 어댑터 패턴 깔끔.
- **`itinerary-render.ts`** — 지역별 그룹핑 잘 구조화.
- **`api/attractions` PUT** — 500건씩 배치 + 단건 fallback (배치 + 식별성 동시 확보).
- **`packages/page.tsx`** — 서버 컴포넌트 + ISR 5분, JSON-LD/canonical 충실.
- **Cron 라우트들** — `CRON_SECRET`/Vercel 헤더 검증, `maxDuration` 적정, 구조화 JSON 로깅.
- **웹훅 서명 검증** — Instagram/Kakao/Slack 모두 HMAC 검증.

---

## 6. 산출물 위치

```
code-review/
├── 00-FINAL-REPORT.md          ← 이 파일
├── 01-lib-core.md              src/lib/ 코어 유틸 (Split 1)
├── 02-api-routes.md            API 라우트 (Split 2)
├── 03-admin-pages.md           어드민 페이지 (Split 3, 마이그 제외)
├── 04-customer-components.md   고객/공용 컴포넌트 (Split 4)
├── 05-content-pipeline.md      AI/콘텐츠 파이프라인 (Split 5)
├── 06-db-scripts.md            DB 스크립트 (Split 6)
└── 07-in-migration.md          디자인 마이그 진행중 파일 (Split 7)
```

각 분할에 *Quick Wins Top 10* + *Larger Refactors Top 5* 표 포함. 단일 파일에서 작업할 때는 해당 분할 리포트만 열어도 충분.

---

**총평:** 코드베이스는 도메인 복잡도(어셈블러·상태머신·렌더 계약·LLM 파이프)에 비해 SSOT 인프라(`render-contract`, `package-acl`, `booking-state-machine`, `llm-validate-retry`)가 매우 잘 짜여 있다. 문제는 **사용처가 그 인프라까지 도달하지 못한 것**이다 — CRC를 호출만 하고 결과를 안 쓰거나, state-machine이 클라이언트 가드에 안 걸려 있거나, `callWithZodValidation`이 있어도 raw `JSON.parse`로 우회한다. **Phase A + B만으로도 Critical 21건 중 13건이 정리되며**, 그 다음은 디자인 마이그 종료를 기다리며 god-component 분해를 시작하는 흐름이 가장 자연스럽다.
