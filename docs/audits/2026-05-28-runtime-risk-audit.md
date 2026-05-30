# 런타임 리스크 전수조사 리포트 (2026-05-28)

> **목적**: `tsc --noEmit`은 통과하지만 실제 서비스 운영 시 장애를 유발할 수 있는 코드 패턴 전수조사
> **범위**: `src/` 전체 `.ts`/`.tsx` 파일 (총 189건 `as any` 중 핵심 경로 집중 분석)
> **방법**: 4개 분석 에이전트 병렬 진행 + 직접 검증

---

## 요약

| 카테고리 | 발견 건수 | CRITICAL | HIGH | MEDIUM |
|----------|-----------|----------|------|--------|
| P0 정산/결제/예약 경로 | 13 | 4 | 4 | 5 |
| Silent fail (에러 삼킴) | 150+ | 10 | 40+ | 100+ |
| Supabase 타입 우회 (`as never`) | 50+ | 15 | 20+ | 15+ |
| SSG 빌드 크래시 위험 | 3 | 1 | 2 | 3 |

---

## 🚨 CRITICAL (즉시 수정 필요, 29건)

### A. 정산/결제 — 널 접근 크래시 (4건)

| # | 파일 | 라인 | 문제 | 영향 |
|---|------|------|------|------|
| 1 | `src/app/api/settlements/route.ts` | 141 | `affiliate.payout_type` — `current.affiliates`가 `null`일 때 접근 | 고아 정산 PATCH 시 TypeError → 500 |
| 2 | `src/app/api/settlements/[id]/pdf/route.ts` | 67, 109 | `settlement.affiliates as any` 후 `aff.name` — null 접근, try/catch 없음 | PDF 다운로드 시 크래시, 로그 없음 |
| 3 | `src/app/api/cron/affiliate-live-celebration/route.ts` | 58 | `.catch(() => {})`로 Kakao API 실패 완전 침묵 | 축하 알림 미발송, 크론은 성공으로 보고 |
| 4 | `src/app/api/cron/affiliate-lifetime-commission/route.ts` | 77 | `as never`로 스키마 검증 우회한 `insert` | 스키마 변경 시 디버깅 불가 |

### B. Silent Fail — `ff()` 헬퍼 (1건, 13회 호출)

**파일**: `src/app/api/bookings/route.ts` (L13-15)
```typescript
function ff<T>(p: PromiseLike<T>): void {
  Promise.resolve(p).then(() => {}).catch(() => {});
}
```
**13회 호출 위치** (모두 예약 생성 직후 사이드 이펙트):
- L404: `enqueueDepositNoticeGateTask` — 입금 알림 작업
- L409: `audit_logs.insert` (셀프 리퍼럴 차단 감사)
- L419: `affiliates.update` (마지막 전환 시간)
- L427-437: `influencer_links.update` (링크 전환 카운트)
- L451: `affiliate_promo_codes.update` (프로모션 코드 사용)
- L469: `affiliate_lifetime_links.insert` (평생 링크 등록)
- L515: `bookings.update` (lead_time)
- L530: `conversations.update` (세션 병합)
- L538: `tryRetroactiveMatch` (소급 입금 매칭)

> **영향**: 예약이 생성돼도 정산/어필리에이트 연결 실패를 전혀 감지 불가

### C. 정산 리버스 Slack 알림 침묵 (1건)

| 파일 | 라인 | 문제 |
|------|------|------|
| `src/app/api/payments/settlement-reverse/route.ts` | 56 | `.catch(() => {})` — 회계 사고 알림이 조용히 사라짐 |

### D. AI 챗봇 — 사실 추출/태스크 전이 침묵 (4건)

| 파일 | 라인 | 문제 |
|------|------|------|
| `src/app/api/qa/chat/v2/route.ts` | 454 | `.catch(() => {})` — 사실 추출 실패 |
| 동일 파일 | 462 | `.catch(() => {})` — 태스크 전이 실패 |
| 동일 파일 | 469 | `.catch(() => {})` — 트레이스 저장 실패 |
| 동일 파일 | 476 | `.catch(() => {})` — 실패 태스크 전이 실패 |

### E. `as never` 타입 전면 우회 (15건 중 핵심)

`as never`는 `as any`보다 더 위험합니다. **타입 시스템을 완전히 무력화**하고 Supabase 컬럼명 오타나 필드 누락을 런타임까지 발견 불가능하게 만듭니다.

| 파일 | 라인 | 패턴 |
|------|------|------|
| `src/lib/db/tenant.ts` | 122, 132, 165, 167, 229 | `insert(payload as never).select().single()` |
| `src/lib/db/ads.ts` | 58, 74, 109, 287, 293, 299, 307, 342, 346 | `upsert/snapshot/insert(data as never)` |
| `src/lib/db/message-log.ts` | 59 | `insert(data as never).select().single()` |
| `src/lib/response-learning.ts` | 80, 115, 187, 289 | `insert(record as never)` |
| `src/lib/magic-link.ts` | 152, 318, 366, 393, 439 | 5회 `insert/update(row as never)` |
| `src/lib/magic-link-audit.ts` | 44 | `insert(input as never)` |
| `src/lib/magic-link.ts` | 152, 318, 366, 393, 439 | 5회 as never |
| `src/lib/supabase.ts` | 878, 924, 1070, 1099, 1111, 1125 | **voidBooking 포함 6회** — 정산/결제 경로 |
| `src/lib/booking-workflow-tasks.ts` | 20, 38 | 2회 as never |
| `src/app/api/cron/affiliate-content-24h-report/route.ts` | 122 | `.insert(payload as never).select('id')` |
| `src/app/api/cron/sync-engagement/route.ts` | 432, 441, 447 | 3회 as never |
| `src/app/api/cron/snapshot-inventory/route.ts` | 133 | `.upsert(slice as never)` |
| `src/app/api/cron/magic-tokens-cleanup/route.ts` | 26 | `.rpc(... as never)` |
| `src/app/api/influencer/promo-codes/route.ts` | 60 | `.upsert(payload as never)` |
| `src/app/api/bookings/[id]/restore/route.ts` | 66, 102, 119 | 3회 as never |
| `src/app/api/attractions/route.ts` | 478, 488 | `.upsert(chunk as never[])` |

> **영향**: 스키마 변경(컬럼명 수정/추가/삭제) 시 `tsc`가 감지하지 못하고 런타임에 Supabase 400 에러 발생

### F. SSG 빌드 크래시 (1건)

| 파일 | 라인 | 문제 |
|------|------|------|
| `src/app/blog/[slug]/page.tsx` | 538-540 | `result.variantValue.replace(...)` — `variantValue`가 `undefined`일 때 `.replace()` 호출 → SSG prerender 중 TypeError → **빌드 실패** |

---

## 🔴 HIGH (우선 수정 권장, 60+건)

### Silent fail — 주요 비즈니스 로직

| 파일 | 라인 | 문제 |
|------|------|------|
| `src/app/api/cron/affiliate-anomaly-detect/route.ts` | 170-172 | 빈 `catch {}`가 인프라 오류를 포함한 모든 예외 침묵 |
| `src/app/api/cron/affiliate-live-celebration/route.ts` | 60 | `await void` audit_log insert — 단일 실패가 전체 루프 중단 |
| `src/app/api/unmatched/route.ts` | 320, 523, 587 | `void reEnrichAffectedPackages(...).catch(() => {})` — Itinerary 재계산 침묵 |
| `src/app/api/upload/route.ts` | 686, 688, 1091, 1791-1792 | Reflexion/시그널/Pexels fire-and-forget |
| `src/app/api/card-news/route.ts` | 82, 153, 185, 459, 466, 550, 578 | 카드뉴스 렌더/발행 파이프라인 다중 빈 catch |
| `src/app/api/card-news/campaign/route.ts` | 90, 97, 143, 184 | Content Factory INSERT 등 |
| `src/app/api/cron/affiliate-settlement-draft/route.ts` | 89 | `draft as unknown as Record<string, unknown>` — 비직렬화 가능 페이로드 |
| `src/app/api/cron/settlement-auto/route.ts` | 85 | `as unknown` cast on bookings |
| `src/app/api/packages/route.ts` | 188 | `query = ... as any` — 처음부터 타입 우회 |
| `src/app/api/blog/BlogData.tsx` | 122 | `listRes.data as unknown as BlogPost[]` |
| `src/lib/ai-analyst.ts` | 다수 | `getApprovedPackages()` 결과를 `as unknown as TravelPackage[]` |

### SSG 페이지 null-safety

| 파일 | 라인 | 문제 |
|------|------|------|
| `src/app/packages/[id]/page.tsx` | 127-138 | `notFound()` 이후 데드코드 + `departure_date` null 키 생성 위험 |
| `src/app/packages/[id]/page.tsx` | 419-421 | `row.travel_packages[0]?.title` — 존재할 경우 안전하나 422행 `rivalsByDate[row.departure_date]` null 키 위험 |
| `src/app/destinations/[city]/page.tsx` | 231, 233 | `(attractions as any[]) || []` 패턴 — `as`는 런타임 무효, `??`로 수정 필요 |

### `as any` 집중 보유 파일 (Phase 1-2 대상)

| 파일 | `as any` 건수 | 도메인 |
|------|---------------|--------|
| `src/app/admin/marketing/card-news/[id]/page.tsx` | 36 | 카드뉴스 스타일 편집기 |
| `src/app/m/admin/bookings/[id]/page.tsx` | 20 | 모바일 예약 상세 |
| `src/app/api/unmatched/route.ts` | 15 | 무숙자 매칭 |
| `src/app/api/upload/route.ts` | 9 | 상품 등록 |
| `src/app/api/rfq/[id]/route.ts` | 8 | RFQ |
| `src/app/destinations/[city]/page.tsx` | 8 | 도시 랜딩 |
| `src/app/api/card-news/route.ts` | 6 | 카드뉴스 |
| `src/components/MetaPixel.tsx` | 6 | Facebook 픽셀 |

---

## 🟡 MEDIUM (모니터링/분석, 100+건)

- 클립보드 복사 `.catch(() => {})` — 5+ 파일
- localStorage/sessionStorage 접근 — 10+ 파일
- 분석/트래킹 fetch — 10+ 파일
- 대시보드 위젯 fetch — 15+ 파일
- JSON.parse fallback — 20+ 파일
- AbTest 컨텍스트 클릭 — 2개 파일

---

## 근본 원인 분석

### 원인 1: `supabaseAdmin` 타입이 처음부터 `any`로 시작

과거 `supabase.ts`에서 `supabaseAdmin as any`로 내보내면서 모든 하위 체인이 `any`로 전염. 이후 `Proxy` 패턴으로 `SupabaseClient` 타입 복원했으나 이미 생성된 코드의 `as any`는 그대로 남아 있음.

### 원인 2: Supabase `PromiseLike` vs `Promise` 혼동

Supabase 체이닝 메서드(`.insert()`, `.update()`, `.select()`)는 `Promise`가 아닌 `PromiseLike` 반환. `.catch()` 직접 호출 불가 → 개발자들이 `then(() => {}).catch(() => {})` 또는 `void`로 회피하면서 에러 핸들링이 사라짐.

### 원인 3: `ff()` 헬퍼 패턴의 오용

처음에 "fire-and-forget이 필요해서" 만든 `ff()` 헬퍼가 예약 생성의 핵심 사이드 이펙트(정산/어필리에이트)까지 감싸면서 장애 탐지 불가능 영역 생성.

### 원인 4: 타입 우회의 만연

PostgREST의 제네릭 타입이 복잡해지자 개발자들이 `as any` → `as never`로 점진적으로 타입 안전성을 포기. 현재 `as never`가 50+건 존재.

---

## 권장 조치 (우선순위별)

### 즉시 (P0)
1. `bookings/route.ts` `ff()` 헬퍼에 `console.warn` 추가 또는 `try { await p } catch(e) { console.error(...) }` 패턴으로 교체
2. `settlements/route.ts` L141 — nullable 체크 추가
3. `settlements/[id]/pdf/route.ts` — try/catch 추가 + `affiliates` null 체크
4. `blog/[slug]/page.tsx` L538 — `variantValue?.replace()` 수정
5. `cron/affiliate-live-celebration/route.ts` L58 — `.catch()`에 `console.warn` 추가

### 단기 (P1)
6. `as never` 전수조사 및 구체적 인터페이스로 교체 (50+건)
7. `settlements/[id]/pdf/route.ts` — try/catch 추가
8. `qa/chat/v2/route.ts` 4개 `.catch()` 로깅 추가
9. 정산 리버스 Slack 알림 `.catch()` 수정

### 중기 (P2)
10. `as any` 집중 파일 (unmatched, upload, rfq, card-news) 개선
11. 모든 빈 catch 블록에 최소 `console.warn` 추가
12. SSG 페이지 null-safety 강화 (`??` vs `||` 패턴 통일)

### 장기 (P3)
13. `as any` 전수 제거 규칙(`.cursor/rules/yeosonam-typescript-safety.mdc`)에 따라 Phase 3-4 진행
14. 서드파티 window 접근 (`MetaPixel.tsx`, `NaverAnalyticsPixel.tsx`) `declare global`로 대체

---

*생성: 2026-05-28 23:07 KST*
