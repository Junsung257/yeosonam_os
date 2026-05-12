# 여소남 OS — 종합 코드 리뷰 (5-Pass Deep Audit)

> **작성일**: 2026-05-11
> **방법론**: 5개 도메인별 병렬 심층 리뷰 (보안 / 성능 / 아키텍처 / 비즈니스 로직 / AI 인프라)
> **범위**: TS/TSX 1256 · API 419 · lib 438 · admin pages 107 · migrations 157 · cron 88 · db scripts 168
> **총 finding**: **250건** (S0/P0/A0/B0/L0 즉시 패치 = **39건**)

---

## 0. Executive Summary

여소남 OS는 **인프라·정책·SSOT가 매우 정교하게 박혀있는 코드베이스**다. dependency-cruiser, knip, dep-cruiser 화이트리스트, audit 스크립트 10+ 종, error-registry, FIELD_POLICY, render-contract CRC, llm-gateway ROUTING, booking-state-machine, settlement-mode 3-모드 — 큰 그림은 매우 잘 설계돼있다.

문제는 **"호출 지점에서 누락된 안전망"** 패턴이 모든 도메인에서 반복된다는 것이다:

| 도메인 | 박혀있는 인프라 | 호출 누락 |
|--------|----------------|----------|
| 보안 | `isAdminRequest`, `requireCronBearer`, RLS | Admin 14/77, Cron 76/88, RLS 0/13 |
| 비즈니스 로직 | `booking-state-machine`, `clawbackMileage`, `voidBooking` | 마일리지 clawback 호출 **0건**, secure-chat unmask 무인증 |
| AI/LLM | `llm-gateway.ts ROUTING`, `escalateIfLowConfidence` | gateway 우회 **18곳**, confidence escalation 호출 **0건** |
| 아키텍처 | `supabase-database.generated.ts` (14k줄) | import **0건** → as any 834건 |
| 성능 | `audit_vercel_functions_count`, SWR Provider | vercel.json 13개 중복 정의, SWR 마이그 5/112 |

**가장 큰 ROI는 신규 기능이 아니라 기존 안전망의 호출 누락을 채우는 것**이다. 본 문서는 이를 우선순위·작업량·예상 효과 매트릭스로 정리한다.

---

## 1. 메타 통계

```
총 finding: 250건
├─ Pass 1 (보안)         : 52건 — S0:16 S1:16 S2:15 S3:5
├─ Pass 2 (성능)         : 50건 — P0:4  P1:13 P2:15 P3:18
├─ Pass 3 (아키텍처)     : 64건 — A0:7  A1:22 A2:20 A3:15
├─ Pass 4 (비즈니스)     : 50건 — B0:5  B1:17 B2:28
└─ Pass 5 (AI/LLM)       : 34건 — L0:7  L1:14 L2:10 L3:3

즉시 패치급 (Sev 0): 39건
```

**충격 지표**:
- Admin API 가드 사용률: **14 / 77 = 18%** (63개 admin 라우트 무인증)
- 핵심 PII 테이블 RLS 적용률: **0 / 13 = 0%**
- Rate limiter 사용 라우트: **19 / 419 = 4.5%**
- Cron 인증: 76 / 88 (12개 누락)
- `clawbackMileage()` 호출 횟수: **0** (정의만 존재 → 마일리지 무한 어뷰징 가능)
- `escalateIfLowConfidence()` 활성 사용: **0** (advisor 패턴 정의만 존재)
- `llm-gateway` 우회 진입점: **18곳**
- `console.error` (Sentry 캡처 0건): **339**
- `err.message` 라우트 응답 노출: **167**
- `as any` 사용처: **356**, `: any` 358, `as unknown as` 120 = **총 834**
- `src/types/supabase-database.generated.ts` 14047줄 import: **0건** (완전 데드)
- `src/lib/supabase.ts` 라인: **1250** (59 exports, 518 import 사이트)
- Vercel functions 객체: **24/50** (이 중 13개 라우트 export와 중복)
- vercel.json cron 동시각 01:00 시작: **5개**
- 단일 파일 100KB+: AdminPageClient.tsx 93KB, BookingsPageClient.tsx 151KB, supabase.ts 54KB
- 168 db 스크립트 중 외부 참조: **19개** (146개 orphan/일회성)

---

## 2. 🚨 Week 1 — 즉시 패치 (Sev 0 = 39건)

### 2-A. 보안 S0 (16건)

| # | 위치 | 위험 |
|---|------|------|
| S0-1 | `src/app/api/bookings/[id]/route.ts:85-197` PATCH | **누구나 결제완료/commission/출발지 위조 — 돈 손실 즉시** |
| S0-2 | `src/app/api/bookings/[id]/cancel/route.ts:4-124` | 임의 예약 취소·환불액 위조 |
| S0-3 | `src/app/api/customers/route.ts:6-49` GET/POST | 전체 고객 PII(passport, birth, phone, memo) 노출 |
| S0-4 | `src/app/api/customers/[id]/notes/route.ts:4-43` | CRM 메모 임의 R/W/D |
| S0-5 | `src/app/api/affiliates/route.ts:11-77` `?showBankInfo=true` | **모든 affiliate 평문 계좌번호 유출** |
| S0-6 | `src/app/api/billing/charge/route.ts:26-80` | 임의 테넌트 빌링 강제 청구 |
| S0-7 | `src/app/admin/reviews/page.tsx:99` `NEXT_PUBLIC_CRON_SECRET` | **88개 cron 외부 트리거 가능** (클라 번들 노출) |
| S0-8 | `src/app/api/cron/ledger-reconcile/route.ts:37-65` | 회계 drift 공개 |
| S0-9 | `src/app/api/cron/settlement-auto/route.ts:21-80` | 정산 강제 마감 |
| S0-10 | `supabase/migrations/*` 13개 핵심 테이블 | **RLS 0/13** (라우트 가드 빠지면 즉시 전면 노출) |
| S0-11 | `src/app/api/admin/bookings/[id]/dispute/route.ts:6-50` | dispute 플래그 임의 토글 → settlement 사보타주 |
| S0-12 | `src/app/api/admin/analytics/ltv/route.ts:15` | 채널별 LTV·매출 KPI 노출 |
| S0-13 | `src/app/api/auth/session/route.ts:35-57` POST | session fixation 가능(서명 미검증) |
| S0-14 | `src/app/api/passport/ocr/route.ts:53-100` | 익명 호출 → AI 비용 폭발 + 여권 PII 로그 누출 |
| S0-15 | `src/app/api/join/[token]/route.ts:63-134` | 토큰 brute-force + 여권 평문 저장 |
| S0-16 | `src/app/login/LoginForm.tsx:48-49` | Open redirect — 피싱 |

### 2-B. 비즈니스 로직 B0 (5건)

| # | 위치 | 위험 |
|---|------|------|
| B0-1 | `src/app/api/bookings/[id]/route.ts:20-44` PATCH_FIELDS에 status | state-machine 우회 → 매출/정산 KPI 깨짐 |
| B0-10 | `src/app/api/bank-transactions/route.ts:760-805` POST bulk | **「출금 자동매칭 금지」정책 위반** (정산 오결합) |
| B0-11 | `src/app/api/bank-transactions/route.ts:271-328` PUT | `deposit_notice_blocked` 무시 → 운영 승인 게이트 우회 |
| B0-27 | `src/lib/mileage-service.ts:227` `clawbackMileage` | **호출 0건** — cancel 후 마일리지 그대로 → 무한 어뷰징 |
| B0-35 | `src/app/api/secure-chat/route.ts:151-174` PATCH | **인증·결제상태 검증 없이 PII unmask** (PIPA 위반) |

### 2-C. AI/LLM L0 (7건)

| # | 위치 | 위험 |
|---|------|------|
| L0-01 | `src/lib/jarvis/claude-router.ts:11-37` | 매 호출 `new OpenAI()` + gateway 우회 + 비용 추적 0 |
| L0-02 | `src/lib/jarvis/deepseek-agent-loop-v2.ts:72-76, 192` | cache_hit_tokens 가산 버그(line 192) → 비용 데이터 오염 |
| L0-03 | `src/lib/jarvis/deepseek-agent-loop.ts:32-72` (V1) | cost-tracker 호출 0건, 월 $50~100 누락 |
| L0-16 | V2 system prompt에 lessons fragment 매 호출 다름 | DeepSeek 자동 캐시 hit ≈ 0 → 월 $20+ 손실 |
| L0-28 | `src/lib/jarvis/supervisor-lite.ts` | 설계상 Haiku Supervisor 미구현 (룰만) |
| L0-33 | `src/lib/guardrails/prompt-injection.ts:1-10` | 패턴 8개뿐 + Jarvis V2 미적용 → 어드민 권한 탈취 risk |
| L0-35 | `src/lib/semantic-cache.ts:185-194` | prompt 임베딩 평문 저장 — embedding inversion 공격 |

### 2-D. 아키텍처 A0 (7건)

| # | 위치 | 위험 |
|---|------|------|
| A0-1 | `src/types/supabase-database.generated.ts` (14047줄) | import 0 → 활성화 시 834 `as any` 70%+ 즉시 제거 |
| A0-2 | 167개 API 라우트 | raw `err.message` 클라이언트 노출 (DB 컬럼/constraint 추출 가능) |
| A0-3 | `sentry.server.config.ts` | 설정만 있고 manual capture **0건** (200+ console.error production silent) |
| A0-4 | `src/lib/supabase.ts` (1250줄, 518 imports) | God Module — `createBooking` 170줄 인라인 |
| A0-5 | `.dependency-cruiser.cjs:9-16` | 순환 의존 화이트리스트 5+개월 미해결 |
| A0-6 | `src/app/admin/bookings/[id]/BookingDetailClient.tsx` | `'use client'` + `supabaseAdmin` import → **서비스롤 키 클라 번들 누출 위험** |
| A0-7 | `supabase/migrations/` | prefix collision **12쌍** (24 파일) |

### 2-E. 성능 P0 (4건)

| # | 위치 | 위험 |
|---|------|------|
| P0-1 | `vercel.json:341-360` | **13개 cron 라우트 export와 이중 정의 → 슬롯 24→11 즉시 회수** |
| P0-2 | `src/app/api/card-news/[id]/render-html-to-png/route.ts:16`, `itinerary/[id]/screenshot/route.ts:2` | `puppeteer` 풀 패키지(Chromium 200MB) — prod 동작 안 함 |
| P0-3 | `cron/{payment-heartbeat,rfq-timeout,settlement-auto,slack-gap-fill}` | schedule 없음 → 죽은 코드 또는 미문서 외부 트리거 |
| P0-4 | `src/app/admin/AdminPageClient.tsx:1116-1194` | `/admin` 진입 시 9개 fetch 동시 발사 |

---

## 3. 교차도메인 근본 원인 (Why 250건이 나왔는가)

5개 패스에서 도출된 finding을 묶으면 **6개 근본 원인**으로 수렴한다. 각 원인은 1개 PR로 해결 가능하고, 평균 30~50건 finding을 한꺼번에 닫는다.

### 원인 1. 인증/권한 가드의 단일 진입점 부재

증상: S0-1, S0-3, S0-4, S0-5, S0-6, S0-11~13, S1-17 (admin 63개), S1-19 (cron 12개), S1-22, S1-25, B0-35, S2-42 — **총 80+ finding**

근본: `requireAdmin()` / `isAdminRequest()` / `requireCronBearer()` 가 존재하지만 라우트마다 수동으로 import + 호출해야 함. 새 라우트 추가 시 무심코 누락. 미들웨어는 path-prefix 통과 검사만 함.

해법: `withAdminGuard(handler)`, `withCronGuard(handler)`, `withUserGuard(handler)` 3개 wrapper 도입 + ESLint custom rule "admin/cron 라우트는 wrapper 통과 강제". CI에서 admin/cron 라우트의 AST 분석으로 강제.

### 원인 2. 비즈니스 단일 진입점 우회 (State Machine, Mileage, Settlement)

증상: B0-1, B0-10, B0-11, B0-27, B0-35, B1-3, B1-5, B1-6, B1-7, B1-12, B1-13, B1-18, B1-23, B2-39 — **총 25+ finding**

근본: `booking-state-machine.ts`, `mileage-service.clawbackMileage`, `voidBooking`, `applyCommissionPolicies` 등 단일 진입점이 정의돼있지만 호출자가 직접 `bookings.update({status})` `mileage += X` 우회.

해법: `src/lib/booking-transition.ts` 헬퍼 추출 + dep-cruiser 룰 "`bookings.update.*status` 직접 호출 금지" 박기. 마일리지·정산·attribution 동일 패턴.

### 원인 3. LLM 클라이언트 직접 인스턴스화 (Gateway 우회 18곳)

증상: L0-01, L0-02, L0-03, L1-04~09, L2-10, L2-11, A1-9 — **총 30+ finding**

근본: `llm-gateway.ts ROUTING` SSOT 정책이 박혀있는데, 18개 모듈이 `new OpenAI()` / `new Anthropic()` / `new GoogleGenerativeAI()` 직접 호출. 캐시·비용추적·fallback·confidence escalation 모두 누락.

해법: 모든 LLM 호출처를 `llmCall({ task: '...' })` 로 마이그레이션. ROUTING 테이블에 신규 task 추가(`router`, `card-news-critic`, `ktkg-extract`, `vision-ocr`, `passport-ocr`, `invoice-parse`). dep-cruiser 룰: `src/app/api/**` 와 `src/lib/**`(`blog-ai-caller`, `llm-gateway`, `normalize-with-llm` 제외) 에서 `node_modules/(openai|@anthropic-ai|@google/generative-ai)` 직접 import 금지.

### 원인 4. 타입 안전성 인프라 미활용 (14k 줄 generated 데드)

증상: A0-1, A2-7, A2-8, A2-12, A1-12 (38 as any), A1-13 (18 any), B-* JSONB 컬럼 `as any` 다수, S0-* 응답 변조 위험 — **총 40+ finding**

근본: `supabase-database.generated.ts` 14047줄이 import 0건. 모든 라우트가 `as any` 또는 manual interface 사용 → 컬럼 drift를 컴파일 시점에 못 잡음.

해법: `src/lib/supabase.ts`의 `createClient<Database>()` 활성화. JSONB 컬럼(`parsed_data`, `itinerary_data`, `slides`, `commission_breakdown`, `notices_parsed`)별 Zod schema 정의 + `parse()` 후 typed view 제공.

### 원인 5. God Module / God Component 분해 미완료

증상: A0-4 (supabase.ts 1250줄), A1-11 (YeosonamA4Template 1681줄), A1-13 (dashboard.ts 893줄), A1-15 (parser.ts 1805줄), A2-3 (customers/page.tsx 1232줄), A2-4 (BookingsPageClient 2492줄), A3-5 (AdminLayout 645 + AdminPageClient 1728줄), P1-7, P1-8 — **총 15+ finding**

근본: 분할 의도는 박혀있지만(`db/booking-create.ts` 등 디렉토리만 만들어진 곳) 끝까지 안 됨. dep-cruiser 화이트리스트로 baseline 인정.

해법: Phase B(P3 예정)를 끝내기. `createBooking` → `db/booking-create.ts`, YeosonamA4Template → `lib/a4-poster/{page-budget,price-table-chunk,notice-normalizer}`, dashboard.ts → 10 파일 분리.

### 원인 6. 관측·회귀 가드의 마지막 1km

증상: A0-2 (167 routes raw err), A0-3 (Sentry 0 capture), A1-21 (24 ERR 미박제), A2-6 (502 console), L1-32 (DLQ 미연결), P3-* (CI 가드 미정착) — **총 20+ finding**

근본: Sentry 설치돼있지만 manual capture 0건. ERR-* 24건 메모만 있고 회귀 테스트로 박지 않음. 가드 스크립트(`audit:*` 10+종) 일부만 CI 강제.

해법: `src/lib/observability.ts` 헬퍼 도입 + 핫패스 30곳 마이그. ERR-* 회귀 테스트 7건 추가. 모든 `audit:*` 스크립트를 `prebuild` 또는 PR gate에 박기.

---

## 4. 4-Sprint 로드맵

### Sprint 1 (Week 1) — 즉시 패치 (출혈 멈춤)

**테마**: 돈 손실/PII 유출/외부 트리거 가능한 구멍 막기.

| # | 작업 | 출처 | 작업량 | 영향 |
|---|------|------|--------|------|
| 1 | `withAdminGuard()` wrapper 도입 + 77 admin 라우트 일괄 적용 | S0-1,2,11,12 + S1-17 | M (8h) | ★★★★★ |
| 2 | `withCronGuard()` 적용 — 12개 미인증 cron | S0-8,9 + S1-19 | S (2h) | ★★★★★ |
| 3 | `NEXT_PUBLIC_CRON_SECRET` 제거 + `/api/admin/cron-trigger` 프록시 | S0-7 | S (1h) | ★★★★★ |
| 4 | `/api/customers`, `/notes`, `/affiliates` admin guard + PII 마스킹 | S0-3,4,5 | S (3h) | ★★★★★ |
| 5 | `/api/billing/charge` ADMIN_API_TOKEN 강제 | S0-6 | S (1h) | ★★★★★ |
| 6 | `/api/bookings/[id]` PATCH에서 `status` 화이트리스트 제거 + transition route 강제 | S0-1 + B0-1 | S (1h) | ★★★★★ |
| 7 | Login `?redirect=` same-origin 화이트리스트 | S0-16 | S (15분) | ★★★★ |
| 8 | `vercel.json` 13개 중복 functions 제거 (라우트 export와 중복) | P0-1 | S (5분) | ★★★★ |
| 9 | `secure-chat` PATCH unmask에 admin guard + booking 상태 검증 | B0-35 | S (1h) | ★★★★★ |
| 10 | `clawbackMileage` 호출을 `cancel/route.ts` + `bank-transactions undo`에 추가 | B0-27 | S (1h) | ★★★★★ |
| 11 | `bank-transactions` 출금 자동매칭 차단 (`txType==='출금'` 분기) | B0-10 | S (30분) | ★★★★★ |
| 12 | Sentry `logError(err, ctx)` 헬퍼 도입 + 핫패스 30곳 마이그 | A0-3 + A0-2 | M (6h) | ★★★★ |
| 13 | `supabase-database.generated.ts` 활성화 (`createClient<Database>()`) | A0-1 | M (4h) | ★★★★★ |
| 14 | Migration prefix collision 12쌍 분리 + CI 게이트 | A0-7 | S (1h) | ★★★ |
| 15 | RLS enable: customers, bookings, settlements, customer_notes, booking_companions, affiliates, conversations, secure_chats (8개) | S0-10 | M (4h) | ★★★★★ |

**Sprint 1 합산 작업량**: 약 33h (1주 1인 풀타임). **닫히는 finding**: 약 60건.

### Sprint 2 (Week 2-3) — 권한·인프라 안정

| # | 작업 | 출처 | 작업량 |
|---|------|------|--------|
| 16 | `puppeteer` → `puppeteer-core` + `@sparticuz/chromium` 마이그 | P0-2 | M |
| 17 | 4개 unscheduled cron 정리(payment-heartbeat 등) | P0-3 | S |
| 18 | `googleapis` → REST fetch 직접 (GSC 4 라우트) | P1-1 | M |
| 19 | `next.config.js` external에 `sharp` 추가 | P1-2 | S |
| 20 | cron schedule stagger (01:00 5개 분산) | P1-3 | S |
| 21 | LLM client 18곳 → `llm-gateway` 마이그 (Phase A: 싱글톤만, Phase B: 라우팅) | A1-9, L0-01~03, L1-04~09 | L |
| 22 | `escalateIfLowConfidence` 활성화 (normalize, qa-chat critic) | L1-23 | S |
| 23 | system prompt에서 lessons/corrections → user prompt로 이동 (cache hit↑) | L0-16 | S |
| 24 | Prompt-injection 패턴 8→30+ 확장 + Jarvis V2 적용 | L0-33 | M |
| 25 | Affiliate PIN bcrypt + timing-safe + 5분 5회 잠금 | S1-20 | M |
| 26 | 랜드사 portal token hash + expires_at + 회전 | S1-21 | M |
| 27 | JWKS issuer strict whitelist (`SUPABASE_URL` 일치 강제) | S1-24 | S |
| 28 | `rateLimitAI` 30개 비싼 LLM 라우트 일괄 적용 | S1-25 | M |
| 29 | `terms_snapshot` atomic (RPC 내부 또는 await) | B1-30 | M |
| 30 | RFQ bid claim race fix (RPC + advisory lock) | B1-32 | M |

**Sprint 2 합산**: 약 50h. **닫히는**: 약 50건.

### Sprint 3 (Week 4-6) — 구조적 리팩토링

| # | 작업 | 출처 |
|---|------|------|
| 31 | `src/lib/supabase.ts` God Module 분해 (`createBooking` → `db/booking-create.ts` 등) + dep-cruiser 화이트리스트 제거 | A0-4, A0-5 |
| 32 | `AdminPageClient` + `BookingsPageClient` SWR 마이그 (Phase 2-D~F) | P0-4, P1-13 |
| 33 | `YeosonamA4Template` 1681줄 분할 (`lib/a4-poster/*`) | A1-11 |
| 34 | `dashboard.ts` 10 KPI → 10 파일 분리 + 타입 박기 | A1-13 |
| 35 | `parser.ts` 1805줄 → `parser/{pdf,hwp,image,extract-*}` 5분할 | A1-15 |
| 36 | cron 88개 → orchestrator 패턴 (affiliate-* 16개를 1개 dispatcher로) | A1-10 |
| 37 | Silo RAG `tenant_id` 필터 강제 | L1-29 |
| 38 | Jarvis V2 Supervisor 신설(`supervisor-claude.ts` 또는 `supervisor-deepseek-flash.ts`) | L0-28 |
| 39 | CanonicalView에 `minPrice`/`nextDeparture` 추가 + ProductCard/PackageCard 마이그 (ERR-KUL-05 완수) | A1-5, A2-16 |
| 40 | DLQ 적재 옵션 gateway에 추가 + cron/dlq-replay 통합 | L1-32 |
| 41 | Top 15 N+1 핫스팟 → Promise.all / RPC | P1-5, P1-6, P2-4 |
| 42 | b2b_api_keys total_calls race condition → 원자적 증가 RPC | S2-40 |

**Sprint 3 합산**: 약 80h. **닫히는**: 약 50건.

### Sprint 4+ (Month 2-3) — 누적 정리

| # | 작업 | 출처 |
|---|------|------|
| 43 | Mobile admin (`/m/admin`) 폐기 또는 responsive 통합 | A2-2 |
| 44 | 146개 db/*.js → `db/_archive/` 이동 | A2-14 |
| 45 | 10개 orphan lib 파일 archive | A1-14 |
| 46 | Inngest 4개 + cron 88 → 단일화 (Inngest로 80% 이주) | A2-18 |
| 47 | terms 4-level state-machine helper 추가 + 7 booking-tasks/rules 마이그 | A1-22 |
| 48 | 5 settlement 페이지 → `/admin/settlements/[tab]` 단일 | A1-18 |
| 49 | content-pipeline vs marketing-pipeline 책임 통합 | A1-17 |
| 50 | card-news 5개 모듈 통합(`src/lib/card-news/*`) | A1-16 |
| 51 | 24개 ERR-* 항목 회귀 테스트 박기 | A1-21 |
| 52 | knip / depcruise CI gate 정착 | P3-4 |
| 53 | 어드민 112개 페이지 → Server Component shell + Client island 분리 | P1-12 |
| 54 | `attribution-recalc` cron이 commission 재계산까지 (음수 adjustment 자동) | B1-18 |
| 55 | mileage_history vs mileage_transactions 이중 스키마 통합 | B1-28 |
| 56 | jarvis-lessons + response-corrections 통합 (`prompt_memory`) | L2-37 |

---

## 5. CI 자동 가드 추가 (회귀 방지)

Sprint 1 안에 박을 자동 검사. 한 번 박으면 새 라우트 추가 시 자동 막힘.

```js
// .eslintrc.json — 5개 custom rule
{
  "rules": {
    // 1. admin/cron 라우트 가드 강제
    "yeosonam/admin-route-must-use-guard": "error",
    "yeosonam/cron-route-must-use-guard": "error",

    // 2. select('*') 금지 (PII/egress)
    "no-restricted-syntax": ["warn", {
      "selector": "CallExpression[callee.property.name='select'][arguments.0.value='*']",
      "message": "select('*') 금지. 필요한 컬럼만 명시."
    }],

    // 3. err.message 직접 응답 금지
    "yeosonam/no-raw-error-in-response": "error",

    // 4. 'use client' + supabaseAdmin 동시 사용 금지
    "yeosonam/no-supabase-admin-in-client": "error",

    // 5. bookings.update.*status 직접 호출 금지
    "yeosonam/no-direct-booking-status-update": "error"
  }
}
```

```js
// .dependency-cruiser.cjs forbidden — 5개 룰
[
  { name: 'no-business-logic-in-tsx',
    from: { path: '^src/(components|app)/.+\\.tsx$' },
    to: { /* 정규식·JSON.parse는 ESLint */ } },

  { name: 'no-puppeteer-outside-render',
    from: { pathNot: '^src/app/api/(card-news|itinerary).+/route\\.ts$' },
    to: { path: '^node_modules/puppeteer(/|$)' } },

  { name: 'no-googleapis-outside-gsc',
    from: { pathNot: '^src/lib/gsc-.+\\.ts$' },
    to: { path: '^node_modules/googleapis(/|$)' } },

  { name: 'no-direct-llm-in-api',
    from: { path: '^src/app/api/.+/route\\.ts$' },
    to: { path: '^node_modules/(openai|@anthropic-ai|@google/generative-ai)/' } },

  { name: 'renderer-must-use-canonical-view',
    from: { path: '^src/(components|app)/.+/(YeosonamA4Template|DetailClient|PackageCard|ProductCard)\\.tsx?$' },
    to: { path: '^src/lib/render-contract\\.ts$' } }
]
```

```js
// scripts/check-bundle-budget.mjs — 페이지별 임계
{
  "/packages/[id]": 600,
  "/admin": 600,
  "/admin/bookings": 700,
  "/admin/marketing/card-news/[id]": 800,
  "/packages": 500
}
```

```js
// scripts/check-no-secret-leak.mjs (prebuild)
// .next/ 산출물에서 _SECRET|_TOKEN|_PRIVATE 검출 시 빌드 fail
```

```js
// scripts/check-cron-collisions.mjs (prebuild)
// 동일 schedule cron 3개 이상이면 warn (CI에서 fail)
```

```sql
-- supabase/tests/rls.spec.sql
-- anon 키로 customers/bookings/settlements select 시 0행 반환 강제
```

---

## 6. 회귀 테스트 시나리오 (도메인별 10건)

```ts
// 1. tests/regression/booking-state-machine-guard.test.ts
//    PATCH /api/bookings/:id { status: 'fully_paid' } → 422

// 2. tests/regression/mileage-clawback.test.ts
//    fully_paid 예약 cancel → mileage_history CLAWBACK row + customers.mileage 감소

// 3. tests/regression/secure-chat-unmask-auth.spec.ts (playwright)
//    미인증 PATCH /api/secure-chat → 401, pending booking unmask → 409

// 4. tests/regression/payment-bulk-no-auto-withdraw.test.ts
//    bulk insert 100 row (50 출금) → 출금 중 auto 매칭 0건

// 5. tests/regression/rfq-bid-concurrency.spec.ts (playwright)
//    max_proposals=3 RFQ에 5 tenant 병렬 POST → 3건만 통과

// 6. tests/regression/terms-snapshot-atomic.test.ts
//    buildTermsSnapshot mock 실패 시 booking POST도 500

// 7. tests/regression/admin-route-guard.spec.ts (playwright)
//    50개 admin API에 토큰 없이 호출 → 모두 401/403

// 8. tests/regression/cron-secret-not-public.test.ts
//    빌드 산출물에서 CRON_SECRET 문자열 검색 → 0건

// 9. tests/regression/rls-anon-isolation.spec.sql
//    anon 키로 customers/bookings select → 0행

// 10. tests/regression/llm-gateway-no-bypass.test.ts
//     src/app/api/**/*.ts AST에서 `new OpenAI|Anthropic|GoogleGenerativeAI` 직접 호출 0건
```

---

## 7. error-registry.md 신규 등재 (도메인 확장)

현재 error-registry는 데이터/렌더 사고만. 본 리뷰에서 결제·예약·정산·보안·AI 도메인 사고가 다수 발견됨. 다음 항목 등재 권고:

```
## 💰 결제·정산·예약 사고
- ERR-mileage-clawback-missing@2026-05-11 (B0-27)
- ERR-secure-chat-unmask-noauth@2026-05-11 (B0-35)
- ERR-bulk-auto-match-outflow@2026-05-11 (B0-10)
- ERR-booking-patch-status-bypass@2026-05-11 (B0-1)
- ERR-sms-shinhan-only@2026-05-11 (B1-13)
- ERR-attribution-recalc-no-commission@2026-05-11 (B1-18)
- ERR-terms-snapshot-fire-forget@2026-05-11 (B1-30)
- ERR-rfq-bid-race@2026-05-11 (B1-32)

## 🔒 보안 사고
- ERR-admin-route-noauth-mass@2026-05-11 (S1-17, 63개)
- ERR-cron-secret-public-leak@2026-05-11 (S0-7)
- ERR-bookings-patch-noauth@2026-05-11 (S0-1)
- ERR-affiliate-bankinfo-leak@2026-05-11 (S0-5)
- ERR-rls-zero-coverage@2026-05-11 (S0-10)
- ERR-affiliate-pin-bruteforce@2026-05-11 (S1-20)
- ERR-jwks-issuer-ssrf@2026-05-11 (S1-24)
- ERR-login-open-redirect@2026-05-11 (S0-16)

## 🤖 AI/LLM 사고
- ERR-llm-gateway-bypass-18@2026-05-11 (L0-01~03 + L1-04~09)
- ERR-cache-invalidation-lessons@2026-05-11 (L0-16)
- ERR-prompt-injection-weak@2026-05-11 (L0-33)
- ERR-mileage-cache-hit-bug@2026-05-11 (L0-02, line 192)
```

---

## 8. Quick Wins (Week 1 첫날 1시간 안에 가능)

빠른 만족감을 위한 가장 작은 작업들:

1. **5분**: `vercel.json`에서 13개 중복 functions 제거 → 슬롯 24→11 (P0-1)
2. **15분**: Login `?redirect=` same-origin 검증 추가 (S0-16)
3. **30분**: `bank-transactions` POST bulk에서 `txType==='출금'` 분기 강제 review (B0-10)
4. **30분**: `clawbackMileage` 호출을 `cancel/route.ts` 추가 (B0-27)
5. **30분**: `NEXT_PUBLIC_CRON_SECRET` 사용처 1곳(`admin/reviews/page.tsx`)을 `/api/admin/cron-trigger` 프록시로 (S0-7)
6. **10분**: Migration prefix collision 12쌍 timestamp 분리 (A0-7)
7. **5분**: `next.config.js` external에 `sharp` 추가 (P1-2)
8. **30분**: `vercel.json` 01:00 시작 5개 cron 분 단위 stagger (P1-3)
9. **10분**: `/api/admin/ai-credits` Cache-Control 5분 추가 (P1-10)
10. **15분**: `tsconfig.tsbuildinfo` / `.tmp-lh-*.json` .gitignore 추가 (P3-2,3)

**합산 3시간으로 8건 finding을 즉시 닫는다.**

---

## 9. 메트릭 / KPI

Sprint별 통과 기준:

| Sprint | KPI | Target |
|--------|-----|--------|
| 1 | Admin 라우트 가드 사용률 | 18% → **100%** |
| 1 | Cron 인증 누락 | 12 → **0** |
| 1 | 핵심 PII RLS | 0/13 → **8/13** |
| 1 | Sentry manual capture (hot paths) | 0 → 30 |
| 1 | `clawbackMileage` 호출 site | 0 → 2 (cancel + bank-transactions undo) |
| 2 | LLM gateway 우회 진입점 | 18 → **5 (전문 모듈만)** |
| 2 | Prompt cache hit ratio (DeepSeek) | 측정 안됨 → ≥60% |
| 2 | Rate limiter 적용 라우트 | 19 → **49** (비싼 LLM 30개 추가) |
| 3 | `as any` 카운트 | 356 → **<100** |
| 3 | `src/lib/supabase.ts` 라인 | 1250 → **<200** |
| 3 | SWR 마이그 어드민 페이지 | 5/112 → **30/112** |
| 4 | 미사용 lib 파일 | 10 → 0 |
| 4 | db/*.js 액티브 카운트 | 165 → **19** (146 archived) |
| 4 | 어드민 페이지 'use client' | 112/112 → **<50** |

---

## 10. 결론 — 한 줄 요약

> **여소남 OS는 안전망의 설계는 정교한데 호출 누락이 누적된 코드베이스다.** 신규 기능보다 **기존 안전망의 호출 지점을 채우고 자동 가드(CI 룰·dep-cruiser·ESLint)로 회귀를 막는 것**이 가장 높은 ROI다.

가장 시급한 단일 PR 1개: **`withAdminGuard` wrapper + 77개 admin 라우트 일괄 적용 + RLS 8개 테이블 enable**. 이 1개 PR이 80+ 보안 finding을 한 번에 닫고, Sprint 2부터의 작업을 안전하게 만든다.

---

*작성: 2026-05-11 / 5-pass parallel audit (Pass 1 보안, Pass 2 성능, Pass 3 아키텍처, Pass 4 비즈니스, Pass 5 AI/LLM)*
*다음 검토: Sprint 1 완료 후 (`+2026-05-18`)*
