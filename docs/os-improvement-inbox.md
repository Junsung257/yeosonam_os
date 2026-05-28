# OS Improvement Inbox

- generated_at_kst: 2026-05-28T23:21:38+09:00
- actionable_changed_files: 12
- todo_markers: 0
- areas: API 8, LIB 2, APP 1, DOCS 1

## 1) Actionable Changed Files

- ` M` `src/app/api/bank-transactions/route.ts`
- ` M` `src/app/api/bookings/route.ts`
- ` M` `src/app/api/cron/affiliate-lifetime-commission/route.ts`
- ` M` `src/app/api/cron/affiliate-live-celebration/route.ts`
- ` M` `src/app/api/payments/settlement-reverse/route.ts`
- ` M` `src/app/api/qa/chat/v2/route.ts`
- ` M` `src/app/api/settlements/[id]/pdf/route.ts`
- ` M` `src/app/api/settlements/route.ts`
- ` M` `src/app/blog/[slug]/page.tsx`
- ` M` `src/lib/booking-workflow-tasks.ts`
- ` M` `src/lib/supabase.ts`
- `??` `docs/audits/2026-05-28-runtime-risk-audit.md`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [x] P0 ` M` `src/app/api/bookings/route.ts` — ff() 헬퍼 로깅 추가 완료
- [x] P0 ` M` `src/app/api/payments/settlement-reverse/route.ts` — .catch 로깅 추가 완료
- [x] P0 ` M` `src/lib/booking-workflow-tasks.ts` — as never → satisfies Record 교체 완료
- [x] P1 ` M` `src/app/api/cron/affiliate-lifetime-commission/route.ts` — as never 제거 완료
- [x] P1 ` M` `src/app/api/cron/affiliate-live-celebration/route.ts` — .catch 로깅 추가 완료
- [x] P1 ` M` `src/lib/supabase.ts` — P0 as never 수정 완료

## 4) Completed in This Session

### Runtime Risk Fixes
- [x] **ff() 헬퍼 로깅 추가** — `src/app/api/bookings/route.ts` — 12개 fire-and-forget 호출에 레이블+console.warn 추가
- [x] **정산 PDF null 크래시 수정** — `src/app/api/settlements/[id]/pdf/route.ts` — affiliates null 체크 + try/catch 전체 래핑
- [x] **정산 PATCH null 체크 추가** — `src/app/api/settlements/route.ts` — affiliates 반복 as any 제거, null-safe 타입 처리
- [x] **settlement-reverse Slack 로깅** — `src/app/api/payments/settlement-reverse/route.ts` — .catch(() => {}) → console.warn
- [x] **qa/chat/v2 silent fail 수정** — `src/app/api/qa/chat/v2/route.ts` — 4개 .catch(() => {}) → console.warn
- [x] **affiliate-live-celebration 로깅** — `src/app/api/cron/affiliate-live-celebration/route.ts` — .catch(() => {}) → console.warn
- [x] **affiliate-lifetime-commission as never 제거** — `src/app/api/cron/affiliate-lifetime-commission/route.ts` — 명시적 타입 정의
- [x] **supabase.ts P0 as never → satisfies Record** — 4건 voidBooking 관련 update/insert
- [x] **bank-transactions as never → satisfies Record**
- [x] **blog/[slug] SSG null-safe** — variantValue.replace 옵셔널 체이닝
- [x] **booking-workflow-tasks as never → satisfies Record** — 2건 insert/update

### Verification
- [x] `npx tsc --noEmit` 통과
- [x] `npm run build` 통과 (548 static pages)

## 5) Remaining as never (Non-P0, Future Work)

아래는 P0 경로가 아니거나 테스트 파일로, 이번 수정에서 제외:
- `src/lib/db/helpers.ts`, `src/lib/db/rfq.ts`, `src/lib/db/tenant.ts` (lib/db 계열 30+건)
- `src/lib/db/ads.ts` (광고 성과, 15+건)
- `src/lib/magic-link.ts`, `src/lib/magic-link-audit.ts` (매직링크, 7건)
- `src/lib/cron-observability.ts`, `src/lib/task-hooks.ts` (크론 관측, 3건)
- `src/lib/response-learning.ts`, `src/lib/jarvis/*.ts` (AI 학습/자비스, 10+건)
- `src/lib/content-pipeline/**`, `src/app/api/content/**` (콘텐츠 파이프라인, 10+건)
- `src/app/api/cron/*` (비P0 크론, 10+건)
- `src/app/api/card-news/**` (카드뉴스, 5건)
- `src/app/api/influencer/**` (인플루언서, 5건)
- `src/app/api/webhooks/**` (웹훅, 2건)
- 테스트 파일들: `*.test.ts` (10+건)
