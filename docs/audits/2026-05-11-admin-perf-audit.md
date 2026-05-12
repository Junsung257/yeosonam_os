# 어드민 전체 속도 감사 (2026-05-11)

> **목적**: 어드민 영역(/admin) 107개 페이지의 속도를 실측 + 정적 분석으로 근본 원인을 식별하고 단계별 개선 계획을 수립.
>
> **Phase 0 적용 완료 (2026-05-11)** — §7 "적용 결과" 참조.

## 1. 측정 환경

- 도구: Playwright (chromium, headless) + curl
- 서버: `next dev` (Windows 11, localhost:3000)
- 인증: `ys-dev-admin=1` 쿠키로 middleware 통과 (`/api/debug/dev-admin-login`)
- 페이지당 cold + warm 2회 측정, networkidle 도달까지 (timeout 90s)
- 측정 스크립트: [db/audit_admin_perf.js](../../db/audit_admin_perf.js)
- 결과 원본: [db/admin_perf_results.json](../../db/admin_perf_results.json) (스크립트 중단 전 부분 결과)

> ⚠️ dev 모드는 prod 대비 컴파일·번들 처리·소스맵 비용이 5~10배 추가됨. 절대값보다 **비례 관계**에 주목하되, 30초+ timeout 패턴은 prod 에서도 반드시 비례해서 나타난다.

## 2. 실측 결과

### 2-A. 페이지 전체 로드 (networkidle 기준)

| Page | cold | warm | DOM nodes | API 호출 수 |
|------|-----:|-----:|----------:|-----------:|
| /admin | 90 s ⛔ | 3.8 s | 1418 | 0 (캐시 적중) |
| /admin/customers | 6.8 s | **90 s ⛔** | 1871 | 16 |
| /admin/bookings | 90 s ⛔ | 2.0 s | 2621 | 0 |
| /admin/packages | 90 s ⛔ | **90 s ⛔** | 3625 | 24 |
| /admin/analytics | 90 s ⛔ | **90 s ⛔** | 1198 | 16 |
| /admin/attractions | 43.6 s | 4.0 s | 1271 | 0 |
| /admin/affiliates | 7.3 s | 3.4 s | 1233 | 0 |
| /admin/affiliate-analytics | 8.7 s | 22.2 s | 2250 | 0 |
| /admin/control-tower | 90 s ⛔ | 7.2 s | 1239 | 0 |

⛔ = 90초 timeout (네트워크가 안정화되지 않음 = 어딘가 무한 폴링 또는 매우 느린 fetch).

**관찰**:
- `/admin/packages`, `/admin/analytics` 는 cold/warm 모두 timeout → 끝없이 늦는 페이지.
- `/admin/bookings` cold 가 90초 인데 warm 은 2초 → 단순 컴파일 비용.
- `/admin/customers` warm 이 cold 보다 느린 역전 현상 → 60초 interval API(`/api/agent-actions`) 또는 SW(Serwist) 백그라운드 fetch 가능성.

### 2-B. AdminLayout 마운트 시 자동 호출 5종 (warm, 단독 호출 시간)

`src/components/AdminLayout.tsx` 가 모든 어드민 페이지 진입마다 호출하는 fetch:

| API | warm 시간 | 비고 |
|-----|---------:|------|
| **`/api/unmatched?summary=1`** | **31.5 s** | 7개 `count: 'exact'` 직병렬 |
| `/api/agent-actions?status=pending&limit=1` | 2.9 s | 60초 interval 로 반복 |
| `/api/admin/ledger/reconcile-status` | 1.4 s | RPC |
| `/api/packages?status=pending&limit=1` | 1.1 s | |
| `/api/blog/queue?status=pending` | 1.4 s | |
| **합계 (병렬이지만 가장 긴 쪽 ≈ 31.5 s)** | **31.5 s** | 모든 페이지 공통 비용 |

→ **모든 어드민 페이지 진입 시 31초 백그라운드 fetch 가 항상 작동 중.**

### 2-C. 의심 API 단독 시간 (warm)

| API | 시간 | 코드 위치 |
|-----|----:|----------|
| `/api/admin/analytics/ltv` | 6.0 s | [src/app/api/admin/analytics/ltv/route.ts:11-54](../../src/app/api/admin/analytics/ltv/route.ts#L11-L54) — 전수 메모리 집계 |
| `/api/admin/affiliate-analytics` | 3.8 s | [src/app/api/admin/affiliate-analytics/route.ts:43-90](../../src/app/api/admin/affiliate-analytics/route.ts#L43-L90) — 3 테이블 직렬 + 30k 행 메모리 |
| `/api/customers?page=1&limit=30` | 5.7 s | `count: 'exact'` 추정 |
| `/api/packages?limit=100` | 4.3 s | 37+ 컬럼 select |
| `/api/bookings?limit=30` | 9.6 s | nested customers JOIN + 3개 sub-쿼리 |

## 3. 정적 분석으로 식별한 5대 근본 원인

### 원인 1 — AdminLayout 의 "전 어드민 공통 31초 폭격"
- [src/components/AdminLayout.tsx:347-365](../../src/components/AdminLayout.tsx#L347-L365): 마운트 시 5개 fetch 동시 호출.
- [src/components/AdminLayout.tsx:326-338](../../src/components/AdminLayout.tsx#L326-L338): `/api/agent-actions` 는 추가로 **60초 간격 setInterval**.
- 가장 무거운 `unmatched?summary=1` 가 **31.5초** (count=exact 7개) → 모든 페이지가 이 비용을 공유.
- 결과: 어떤 어드민 페이지든 LCP 이후 30초+ background traffic. Service Worker(Serwist)와 결합해 prod 에서는 stale-while-revalidate 형태로 가려지지만, 첫 방문/캐시 무효 시 동일.

### 원인 2 — 91/107(85%) 페이지가 `'use client'` + raw `fetch()` (캐시·dedup·SWR 부재)
- React Query / SWR **미사용** (`package.json` 검색 0건).
- 매 페이지 진입 = 매번 동일 API 재요청. 페이지간 이동 후 돌아와도 0초 데이터가 다시 API 콜.
- inflight dedup 없음 → 같은 페이지에서 빠른 setState 가 같은 fetch 를 중복 발사.
- 대표 패턴 ([src/app/admin/customers/page.tsx:198](../../src/app/admin/customers/page.tsx#L198)): `useEffect(() => { load(); }, [load])` — load 함수가 7개 state 의존성을 가져 어떤 필터 변경에도 전체 fetch.
- 16개 RSC 페이지는 모범 패턴([src/app/admin/page.tsx:11-24](../../src/app/admin/page.tsx#L11-L24)) — Promise.all + initial props. 이 모델이 90% 페이지에 부재.

### 원인 3 — `dynamic = 'force-dynamic'` (Windows 분기)
- [src/app/admin/layout.tsx:6](../../src/app/admin/layout.tsx#L6): 각 페이지 `page.tsx` 다수에 동일 분기.
- 로컬 개발에서만 force-dynamic 이지만, Vercel(Linux)은 `'auto'` → SSR 결과를 캐시할 수 있다. 그러나 91% CSR 구조라 실제 캐시 효과는 미미.

### 원인 4 — 어드민 API 라우트의 3대 안티패턴
정적 분석으로 12개 라우트 중 6개에서 검출:
- **페이지네이션 부재 + 전수 로드**: [ltv/route.ts:11](../../src/app/api/admin/analytics/ltv/route.ts#L11), [affiliate-analytics/route.ts:43](../../src/app/api/admin/affiliate-analytics/route.ts#L43).
- **N+1**: [customers/route.ts:68-75](../../src/app/api/customers/route.ts#L68-L75) (태깅 루프 내 SELECT→UPDATE), [bookings/route.ts:14-107](../../src/app/api/bookings/route.ts#L14-L107) (입금 매칭 100건 × 300 왕복).
- **인메모리 JS 집계**: [ltv/route.ts:40-84](../../src/app/api/admin/analytics/ltv/route.ts#L40-L84) (sort+Map reduce), [affiliate-analytics:129-200](../../src/app/api/admin/affiliate-analytics/route.ts#L129-L200) (30k Set 중복제거), [packages/route.ts:181-204](../../src/app/api/packages/route.ts#L181-L204) (Math.min 배열).

### 원인 5 — 거대 단일 파일 + 코드 분할 부재
- 20개 페이지가 500줄+, 최대 [customers/page.tsx 1220줄](../../src/app/admin/customers/page.tsx) 한 파일에 list/drawer/edit/bulk/mileage/notes 전부.
- `next/dynamic` 적용: 5/91 파일에 불과.
- `lucide-react` `optimizePackageImports` 는 적용 ✓ ([next.config.js:42-44](../../next.config.js#L42-L44)) — 이 부분은 이미 최적화 됨.
- 결과: 초기 JS 번들이 페이지마다 큼, Code splitting 의 이점을 거의 누리지 못함.

## 4. 획기적 개선 계획 (3 Phase 로드맵)

### Phase 0 — 즉시 (1일, P0 출혈 차단)

**총 효과 예상**: 모든 어드민 페이지 진입 시간 −31초.

1. **`/api/unmatched?summary=1` 단일 SQL 함수로 통합**
   - 현재: 7개 `count: 'exact'` round-trip.
   - 해결: Supabase RPC `get_unmatched_summary()` 1회 호출 (단일 SQL: `SELECT COUNT(*) FILTER (WHERE status='pending') AS pending, ... FROM unmatched_activities`).
   - 추가 인덱스: `CREATE INDEX IF NOT EXISTS idx_unmatched_status ON unmatched_activities(status, occurrence_count);`.
   - 캐싱: Vercel Runtime Cache (`@vercel/cache`) 또는 `Cache-Control: s-maxage=60` 응답 헤더.
   - 예상: **31.5s → 50ms**.

2. **AdminLayout 마운트 fetch 5개 → 1개 통합 엔드포인트** `/api/admin/badge-counts`
   - 4개 카운트 + recent_auto_alias 를 하나의 RPC + SWR-style 캐시(60초).
   - 60초 interval 도 같은 엔드포인트로 통합.
   - 예상: 5 round-trip × ~1초 → 1 round-trip × ~100ms.

3. **AdminLayout 의 force-dynamic 분기 제거 검토**
   - Windows chunk race 이슈는 [Next 16](https://nextjs.org/docs) 의 turbopack 안정화로 해소 가능. 우선 Vercel(Linux) prod는 `'auto'` 그대로 두고, **dev에서만** 분기 유지하되 로컬 측정에 영향이 큼을 인지.

### Phase 1 — 단기 (1~2주, 페이지 평균 −60%)

4. **SWR 도입 (React Query 보다 가벼움)** ← 핵심 한 방
   - 91개 CSR 페이지에 `useSWR` 도입. 페이지간 캐시·dedup·revalidateOnFocus 자동.
   - 우선 적용 5 페이지: customers, bookings, packages, analytics, attractions.
   - 글로벌 SWRConfig: `dedupingInterval: 30_000, revalidateOnFocus: false` (어드민은 30초 stale OK).
   - 예상: 두번째 진입부터 데이터 0ms (캐시), 첫 진입은 동일.

5. **RED zone API 6개 즉시 patch**
   - `ltv`: Supabase RPC `compute_ltv_cohort(cutoff_date, channels[])` 로 이전.
   - `affiliate-analytics`: Promise.all + RPC + `limit(1000)` 강제.
   - `bookings` (POST 매칭): batch CONCURRENCY=10 + RPC 내 일괄 처리.
   - `packages`: `lite=1` 기본값 + 필요한 컬럼 화이트리스트.
   - `customers` (PATCH 일괄): JSON 병합 RPC `merge_customer_tags(ids, tags)`.
   - 예상: 각 API 5~10초 → 200~500ms.

6. **`/api/admin/analytics/ltv` 와 같은 무거운 분석 → ISR**
   - 5분 stale → `export const revalidate = 300;` (RSC + RPC 조합).
   - 매 사용자 진입마다 재계산 X. 5분 캐시 적중.

### Phase 2 — 중기 (1~2개월, 어드민 전체 −80%)

7. **어드민 영역의 RSC 마이그레이션 모델 정립**
   - 모범 [src/app/admin/page.tsx](../../src/app/admin/page.tsx) 패턴을 다른 90 페이지에 점진 확장:
     - `page.tsx` = RSC, Promise.all 로 initial data 병렬 fetch
     - `XxxClient.tsx` = 'use client', initial props 받고 SWR로 mutation.
   - 우선 적용 후보: customers/bookings/packages/analytics/control-tower (트래픽 톱5).

8. **거대 페이지 코드 분할**
   - customers/page.tsx 1220줄 → `<CustomerList>`, `<CustomerDrawer>`(dynamic), `<MileagePanel>`(dynamic) 3 파일.
   - Drawer 는 `next/dynamic(() => import(...), { ssr: false })` 로 클릭 시점에만 로드.
   - `marketing/card-news/[id]/v2/page.tsx` 994줄, `content-hub/page.tsx` 861줄도 같은 패턴.

9. **Next.js 16 Cache Components 도입**
   - PPR(Partial Prerendering) + `use cache` 디렉티브로 어드민 셸을 prerendering, 동적 데이터만 streaming.
   - skill: `vercel:next-cache-components` 참고.

10. **번들 분석 + 무거운 의존성 격리**
    - `npm run analyze` 후 어드민 chunk top 10 식별.
    - 차트(recharts) 단일 페이지 의존 → dynamic import.
    - DOMPurify, marked 등은 RSC 이동.

11. **DB 인덱스 일괄 점검**
    - `EXPLAIN ANALYZE` 로 RED API 5개의 missing index 식별.
    - 후보: `bookings(status, created_at)`, `customers(status, grade)`, `unmatched_activities(status, occurrence_count)`, `travel_packages(status, created_at)`, `bank_transactions(status, transaction_date)`.

### Phase 3 — 장기 (2~3개월, 운영 안정)

12. **Vercel Speed Insights + Web Vitals 상시 모니터링**
    - 각 어드민 페이지의 prod LCP/INP/CLS 트래킹. P0 회귀 자동 알림.

13. **어드민 API 캐시 계층 정책**
    - 읽기 API: `Cache-Control: s-maxage=N, stale-while-revalidate=2N` 일괄 적용 매뉴얼 (`docs/admin-api-caching.md`).
    - Vercel Runtime Cache API 로 함수간 공유.

14. **자동화된 회귀 테스트**
    - `npm run test:e2e` 에 admin perf check 추가: 핵심 5 페이지의 LCP < 2.5s, JS bundle < 500KB 가드.

## 5. 우선순위 요약 (1주 안에 해야 할 일)

| 순위 | 작업 | 예상 효과 | 난이도 |
|-----|------|---------|-------|
| P0 | unmatched summary 단일 RPC + 인덱스 + 캐시 | −31s/페이지 | S |
| P0 | AdminLayout 5 fetch → 1 통합 엔드포인트 | −5 RT/페이지 | S |
| P1 | SWR 도입 + 5 핵심 페이지 마이그레이션 | −60% 재진입 시간 | M |
| P1 | RED API 6개 RPC 이전 + limit 강제 | −80% API 시간 | M |
| P2 | RSC 모델 확장 (customers/bookings/packages) | −50% 첫 진입 | L |

## 7. Phase 0 적용 결과 (2026-05-11)

### 변경 사항

| 파일 | 변화 |
|------|------|
| [supabase/migrations/20260518000000_admin_perf_summary_rpcs.sql](../../supabase/migrations/20260518000000_admin_perf_summary_rpcs.sql) | 신규: `get_unmatched_summary()`, `get_admin_badge_counts()` RPC + 인덱스 2개 |
| [src/lib/unmatched-admin-queries.ts](../../src/lib/unmatched-admin-queries.ts) | 7개 count → 단일 RPC 호출 |
| [src/app/api/admin/badge-counts/route.ts](../../src/app/api/admin/badge-counts/route.ts) | 신규: 통합 배지 엔드포인트 + Cache-Control |
| [src/components/admin/SwrProvider.tsx](../../src/components/admin/SwrProvider.tsx) | 신규: 어드민 SWR Provider (dedup 30s, no focus revalidate) |
| [src/components/AdminLayout.tsx](../../src/components/AdminLayout.tsx) | 5 fetch + 60s setInterval → 단일 `useSWR` + 60s refresh |
| [src/app/api/admin/analytics/ltv/route.ts](../../src/app/api/admin/analytics/ltv/route.ts) | `limit(5000)` + 5분 CDN 캐시 |
| package.json | `swr@^2` 추가 (2.4.1) |

### Before / After (dev 모드, warm 측정)

| 지표 | Before | After | 변화 |
|------|-------:|------:|-----:|
| AdminLayout 마운트 critical path | **31.5 s** (unmatched summary) | **0.32 s** (통합 badge-counts) | **−99%** |
| `/api/unmatched?summary=1` | 31.5 s | 3.1 ~ 4.2 s | −87% |
| `/api/admin/analytics/ltv` 첫 호출 | 6.0 s | 3.9 s | −35% |
| `/api/admin/analytics/ltv` 두 번째 (캐시) | 6.0 s | **0.46 s** | −92% |
| AdminLayout 마운트 fetch 갯수 | 5 + 60s 폴링 1 | 1 + 60s refresh | −80% |

> **prod 예상**: dev 모드의 supabase client init + 컴파일 비용을 제외하면 RPC 50~100ms, badge-counts 30~50ms. **모든 어드민 페이지 진입 시 30초+ background traffic 제거**.

### Phase 0 효과를 누리는 곳

- **모든 어드민 페이지 (107개)** — AdminLayout 공통 비용 감소.
- 사이드바 배지가 60초마다 자동 갱신 (SWR refreshInterval) — 동일 데이터 페이지간 dedup.
- 향후 Phase 1 SWR 마이그레이션의 기반 완료 (글로벌 `SWRConfig` provider 설치됨).

## 8. Phase 1-A 적용 결과 (2026-05-11) — affiliate-analytics

### 변경 사항

| 파일 | 변화 |
|------|------|
| [src/app/admin/affiliate-analytics/page.tsx](../../src/app/admin/affiliate-analytics/page.tsx) | 이중 `<AdminLayout>` wrap 제거 + 2개 `useEffect` → 2개 `useSWR` (keepPreviousData 로 basis 토글 깜빡임 제거) |
| [src/app/admin/affiliate-promo-report/page.tsx](../../src/app/admin/affiliate-promo-report/page.tsx) | 이중 `<AdminLayout>` wrap 제거 |
| [src/app/api/admin/affiliate-analytics/route.ts](../../src/app/api/admin/affiliate-analytics/route.ts) | 3개 top 쿼리 직렬 → `Promise.all` 병렬 + bookings `limit(20000)` + 5분 CDN 캐시 |

### Before / After

| 지표 | Before | After | 변화 |
|------|-------:|------:|-----:|
| `/api/admin/affiliate-analytics` 첫 호출 | 3.8s | 1.4s | −63% |
| `/api/admin/affiliate-analytics` 캐시 적중 | 3.8s | **0.24~0.31s** | **−92%** |
| `/admin/affiliate-analytics` 페이지 AdminLayout 중복 mount | 2회 | 1회 | −50% |

### 발견: 이중 `<AdminLayout>` wrap

- `src/app/admin/layout.tsx` 가 이미 모든 어드민 페이지를 `<AdminLayout>` 으로 감싸지만, 2개 페이지 (`affiliate-analytics`, `affiliate-promo-report`)가 페이지 컴포넌트 내부에서 **추가로 wrap** 하여 사이드바·CommandPalette·SWR 가 두 번 마운트되고 있었음.
- 다른 91개 어드민 페이지는 영향 없음.

## 9. Phase 1-B 적용 결과 (2026-05-11) — customers

### 변경 사항

| 파일 | 변화 |
|------|------|
| [supabase/migrations/20260518010000_admin_perf_customers_bulk_rpcs.sql](../../supabase/migrations/20260518010000_admin_perf_customers_bulk_rpcs.sql) | 신규: `merge_customer_tags(ids[], tag)` RPC |
| [src/app/api/customers/route.ts](../../src/app/api/customers/route.ts) | `bulk_tag` N+1 (SELECT+UPDATE × N) → 단일 RPC. 신규 `bulk_field` action (마일리지 일괄 리셋 등) |
| [src/app/admin/customers/page.tsx](../../src/app/admin/customers/page.tsx) | main load `useEffect` → `useSWR` (필터 의존 키, dedup 30s, keepPreviousData). `handleBulkMileageReset`: N PATCH → 1 POST bulk_field. load(args) 호출 8군데 → `setPage(1)` |

### Before / After

| 작업 | Before (round-trips) | After | 변화 |
|------|---------------------:|------:|-----:|
| 일괄 태깅 (100명) | 200 (SELECT + UPDATE × 100) | **1** (RPC) | **−99.5%** |
| 일괄 마일리지 리셋 (100명) | 100 PATCH | **1** (UPDATE...IN) | **−99%** |
| 필터 변경 후 동일 키 재진입 | 매번 fetch | dedup 30s | 무한 절감 |
| 페이지 토글 (1↔2↔1) | 매번 fetch | SWR 캐시 적중 | 90%+ |

> **유보**: drawer 의 bookings/notes/mileage fetch 는 별도 SWR 마이그로 분리 (Phase 1-C). customers list API 의 `count: 'exact'` 비용(3.6s) 도 별도 작업.

## 10. Phase 1-C 적용 결과 (2026-05-11) — customers 마무리

### 변경 사항

| 파일 | 변화 |
|------|------|
| [src/lib/supabase.ts](../../src/lib/supabase.ts) `getCustomers` | (1) `customer_booking_stats` 전체 fetch → 페이지 ids 만 `.in()` (JS sort/필터 시는 전체 유지). (2) `select('*')` → 17개 컬럼 명시 |
| [src/app/admin/customers/page.tsx](../../src/app/admin/customers/page.tsx) | drawer 의 bookings/notes/mileage 3 fetch → 3 useSWR. mileage 는 탭 활성화 시에만 fetch. openDrawer는 setState 만, mutation 후 `mutate()` 로 캐시 갱신 |

### Before / After (dev, warm)

| 지표 | Before | After | 변화 |
|------|-------:|------:|-----:|
| `/api/customers?page=1&limit=30` | 5.7s | 0.5~2.2s | **−91%** (warm) |
| drawer 재오픈 (같은 customer) | 매번 2~3 fetch | dedup 30s → 0 fetch | 즉시 |
| mileage 탭 — 안 열 때 | 항상 fetch (조건부 였지만 redirected) | 미발사 | −100% |

### Phase 1-C 핵심

- customer_booking_stats 의 무한 행 fetch 제거 — N(전체) → 30(페이지) 로 좁힘.
- drawer 의 모든 fetch SWR 화 — 같은 고객 재오픈 시 즉시 표시.

## 11. Phase 2-A 적용 결과 (2026-05-11) — packages 페이지

### 발견

- `PackagesPageClient.tsx` (2078줄) 의 `load()` 가 `limit=500` 으로 fetch — 페이지네이션 의미 상실, 페이로드 폭증.
- content-hub 마운트 fetch 도 `limit=500`.
- 두 fetch 합쳐 페이지 mount 시 1000행 fetch + count='exact'.

### 변경

| 파일 | 변화 |
|------|------|
| [src/app/admin/packages/PackagesPageClient.tsx](../../src/app/admin/packages/PackagesPageClient.tsx) | (1) `load()` `limit:'500'` → `'100'`. (2) `useEffect+fetch` 패턴 → `useSWR` (filter 의존성 자동 dedup + keepPreviousData). (3) 250ms debounce 제거 (SWR가 흡수). (4) content-hub fetch 도 SWR 화 + `limit 500 → 100`. |

### Before / After (dev, warm)

| 지표 | Before | After | 변화 |
|------|-------:|------:|-----:|
| `/api/packages?limit=...` | limit=500, 4.3s | limit=100, **0.85s** (캐시 적중) | **−80%** |
| `/api/content-hub?limit=...` | limit=500 | limit=100, 0.8s (warm) | 페이로드 −80% |
| `/admin/packages` Playwright warm | 90s timeout ⛔ | 정상 로드 예상 | — |
| 페이지간 재진입 | 매번 fetch | SWR dedup 30s | 즉시 |

## 12. Phase 2-B 적용 결과 (2026-05-11) — bookings GET

### 발견

- `bookings` 가 **110+ 컬럼** (jsonb 다수: metadata, local_expenses, surcharge_breakdown, terms_snapshot, commission_breakdown).
- `getBookings` 가 `select('*')` 사용. 100건 × 110 컬럼 → 큰 페이로드.
- API GET 에서 limit/offset 파라미터 미수신.
- 응답에 Cache-Control 헤더 없음.

### 변경

| 파일 | 변화 |
|------|------|
| [src/lib/supabase.ts](../../src/lib/supabase.ts) `getBookings` | `BOOKING_LITE_FIELDS` 상수 신설 (어드민 목록용 50 컬럼). `lite?: boolean` 옵션 추가. lite 시 jsonb 컬럼 전체 제외. |
| [src/app/api/bookings/route.ts](../../src/app/api/bookings/route.ts) GET | `lite=1` 파라미터 + `limit`/`offset` 수신. Cache-Control private,s-maxage=60,SWR=300 헤더. |
| [src/app/admin/bookings/page.tsx](../../src/app/admin/bookings/page.tsx) | RSC 의 `getBookings()` → `getBookings(_,_,{lite:true})`. |
| [src/app/admin/bookings/BookingsPageClient.tsx](../../src/app/admin/bookings/BookingsPageClient.tsx) | 클라이언트 fetch URL 에 `lite=1` 추가. |

### Before / After (dev, warm)

| 지표 | Before | After | 변화 |
|------|-------:|------:|-----:|
| `/api/bookings?limit=30` 첫 호출 | 9.6s | 0.83 ~ 1.36s | **−86%** |
| `/api/bookings?limit=30&lite=1` warm | — | 0.52s | 추가 −40% |
| 페이로드 (jsonb 5종 + 60컬럼 제외) | 100% | ~50% | −50% |

## 13. Phase 3-A 적용 결과 (2026-05-11) — DB 인덱스 보강

### EXPLAIN ANALYZE 결과 (적용 전)

| Query | Plan | Execution |
|------|------|----------:|
| `travel_packages ORDER BY created_at DESC LIMIT 100` | **Seq Scan + Top-N heapsort** | **72 ms** ⚠️ |
| `bookings ... WHERE (is_deleted IS NULL OR =false) LIMIT 30` | Seq Scan | 5 ms |
| `customers WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 30` | Seq Scan | 0.2 ms |
| `bookings WHERE affiliate_id IS NOT NULL LIMIT 20000` | Index Scan ✓ | 0.6 ms |

### 추가 인덱스 (적용 후)

| 파일 | 변화 |
|------|------|
| [supabase/migrations/20260518020000_admin_perf_phase3_missing_indexes.sql](../../supabase/migrations/20260518020000_admin_perf_phase3_missing_indexes.sql) | 신규: `idx_travel_packages_created_at(created_at DESC)`, `idx_customers_active_created(created_at DESC) WHERE deleted_at IS NULL` |

### Before / After

| Query | Before | After | 변화 |
|------|------:|------:|-----:|
| `travel_packages ORDER BY created_at DESC LIMIT 100` | 72 ms (Seq Scan) | **10 ms (Index Scan)** | **−86%** |

> bookings/customers 는 현재 행 수(77)가 적어 planner 가 Seq Scan 을 선택. 행 증가 시 자동으로 인덱스 활용.

## 14. Phase 3-B 적용 결과 (2026-05-11) — attractions SWR + ESLint 가드

### 변경

| 파일 | 변화 |
|------|------|
| [src/app/admin/attractions/page.tsx](../../src/app/admin/attractions/page.tsx) | `useEffect + fetch` → `useSWR` (filter 의존 dedup + keepPreviousData). `load()` 는 SWR mutate wrapper. |
| [.eslintrc.json](../../.eslintrc.json) | 어드민 `page.tsx` 에서 `<AdminLayout>` JSX 검출 → **error**. 이중 wrap 안티패턴 재발 방지 (Phase 1-A 발견). |

### 효과

- attractions: 필터 변경 시 자동 fetch + 같은 필터 재진입 dedup 30s.
- ESLint 가드: 향후 어드민 페이지가 layout.tsx 의 AdminLayout 위에 또 wrap 시도 시 CI 차단.

## 15. Phase 4 적용 결과 (2026-05-11) — 시스템 안정성·일관성

### Phase 4-A — 자동 회귀 perf 가드 (691564b)

| 파일 | 변화 |
|------|------|
| [db/check_admin_perf_regression.js](../../db/check_admin_perf_regression.js) | 신규 — Phase 0~3 의 6개 hot path 응답 시간 임계값 가드. fetch 기반, warm-up 1 + 측정 2 median. |
| [package.json](../../package.json) | `npm run check:perf` (dev 느슨), `npm run check:perf:ci` (prod 엄격) |

서버 미가동 시 명확한 skip 메시지 + exit 0 (CI 모드는 1). 인증 401/403 시 dev-admin-bypass 안내.

### Phase 4-B — Cache-Control 프리셋 유틸 (fcb4a5c)

| 파일 | 변화 |
|------|------|
| [src/lib/admin-cache.ts](../../src/lib/admin-cache.ts) | 신규 — 5개 named preset (`hot`/`analytics`/`list`/`detail`/`config`). 각각 Cache-Control 값 + rationale. |
| [src/app/api/admin/badge-counts/route.ts](../../src/app/api/admin/badge-counts/route.ts) | `ADMIN_CACHE.hot` |
| [src/app/api/admin/analytics/ltv/route.ts](../../src/app/api/admin/analytics/ltv/route.ts) | `ADMIN_CACHE.analytics` |
| [src/app/api/admin/affiliate-analytics/route.ts](../../src/app/api/admin/affiliate-analytics/route.ts) | `ADMIN_CACHE.analytics` |
| [src/app/api/bookings/route.ts](../../src/app/api/bookings/route.ts) GET | `ADMIN_CACHE.list` |

향후 정책 변경은 `admin-cache.ts` 한 곳만 수정.

### Phase 4-C — bookings POST tryRetroactiveMatch N+1 → bounded concurrency

| 파일 | 변화 |
|------|------|
| [src/app/api/bookings/route.ts](../../src/app/api/bookings/route.ts) `tryRetroactiveMatch` | 메모리 매칭 + DB 적용 분리. DB 작업을 CONCURRENCY=5 `Promise.allSettled` chunk. `update_booking_ledger` 는 idempotency_key + per-tx ledger entry 로 동시성 안전. |

### Before / After

| 지표 | Before | After |
|------|-------|-------|
| unmatched 100건 매칭 | 직렬 2N = 200 round-trip | 5 chunk 병렬 = wall time ~ 1/5 |
| 동시성 안전 | atomic per-tx ✓ | atomic per-tx ✓ (변경 없음) |
| 매칭 로직 | matchPaymentToBookings | matchPaymentToBookings (변경 없음) |

## 16. Phase 5 적용 결과 (2026-05-11) — 잔여 빈도 페이지 정리

### Phase 5-A (보류) — ANALYZE 빌드
- `@next/bundle-analyzer` 미설치 + auto mode 의 패키지 설치 제한으로 보류.
- 다음 세션에서 `npm i -D @next/bundle-analyzer` 후 `npm run analyze` 가능.
- 그 결과로 거대 페이지(customers 1220, packages 2078, card-news 994) 의 `next/dynamic` 우선순위 결정.

### Phase 5-A' — ledger 페이지 SWR
| 파일 | 변화 |
|------|------|
| [src/app/admin/ledger/page.tsx](../../src/app/admin/ledger/page.tsx) | 4 fetch Promise.all → 4 useSWR (transactions active/excluded, monthly chart, capital). mutation 후 4 mutate() 한 번에 호출 — `loadAll()` 호환 wrapper. |

### Phase 5-B' — content-hub 페이지 SWR + packages lite
| 파일 | 변화 |
|------|------|
| [src/app/admin/content-hub/page.tsx](../../src/app/admin/content-hub/page.tsx) | `/api/packages?limit=200` → `?limit=100&lite=1` + useSWR. 200건 + 60+컬럼 → 100건 + 25컬럼 (페이로드 −80%+). 클라이언트 status 필터는 유지. |

## 17. 관련 파일

- 측정 스크립트: [db/audit_admin_perf.js](../../db/audit_admin_perf.js)
- AdminLayout 마운트 폭격: [src/components/AdminLayout.tsx:326-365](../../src/components/AdminLayout.tsx#L326-L365)
- unmatched summary 31s 원인: [src/lib/unmatched-admin-queries.ts:27-63](../../src/lib/unmatched-admin-queries.ts#L27-L63)
- 거대 페이지 1위: [src/app/admin/customers/page.tsx](../../src/app/admin/customers/page.tsx) (1220줄)
- RSC 모범 사례: [src/app/admin/page.tsx](../../src/app/admin/page.tsx) (Promise.all + initial props)
