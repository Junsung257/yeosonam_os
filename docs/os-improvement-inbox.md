# OS Improvement Inbox

- generated_at_kst: 2026-05-28T20:34:32+09:00
- actionable_changed_files: 50
- todo_markers: 0
- areas: API 38, LIB 5, ETC 4, APP 3

## 1) Actionable Changed Files

- ` M` `next.config.js`
- ` M` `src/app/admin/blog/BlogDataFetcher.tsx`
- ` M` `src/app/api/admin/marketing/dashboard/route.ts`
- ` M` `src/app/api/admin/mileage-analytics/route.ts`
- ` M` `src/app/api/admin/packages/[id]/clone/route.ts`
- ` M` `src/app/api/b2b/packages/[id]/route.ts`
- ` M` `src/app/api/b2b/packages/route.ts`
- ` M` `src/app/api/bank-transactions/route.ts`
- ` M` `src/app/api/bookings/route.ts`
- ` M` `src/app/api/card-news/campaign/route.ts`
- ` M` `src/app/api/card-news/route.ts`
- ` M` `src/app/api/content-calendar/route.ts`
- ` M` `src/app/api/content-factory/[cardNewsId]/route.ts`
- ` M` `src/app/api/content-hub/generate/route.ts`
- ` M` `src/app/api/cron/affiliate-anomaly-detect/route.ts`
- ` M` `src/app/api/cron/affiliate-lifetime-commission/route.ts`
- ` M` `src/app/api/cron/affiliate-live-celebration/route.ts`
- ` M` `src/app/api/cron/affiliate-settlement-draft/route.ts`
- ` M` `src/app/api/cron/blog-publisher/route.ts`
- ` M` `src/app/api/cron/daily-marketing/route.ts`
- ` M` `src/app/api/cron/rank-tracking/route.ts`
- ` M` `src/app/api/cron/settlement-auto/route.ts`
- ` M` `src/app/api/cron/setup-new-destinations/route.ts`
- ` M` `src/app/api/customers/me/badges/route.ts`
- ` M` `src/app/api/customers/me/mileage-history/route.ts`
- ` M` `src/app/api/exchange-rate/route.ts`
- ` M` `src/app/api/free-travel/session/route.ts`
- ` M` `src/app/api/gamification/challenges/route.ts`
- ` M` `src/app/api/gamification/checkin/route.ts`
- ` M` `src/app/api/jarvis/approve/route.ts`
- ` M` `src/app/api/join/[token]/route.ts`
- ` M` `src/app/api/mileage/analytics/route.ts`
- ` M` `src/app/api/mileage/balance/route.ts`
- ` M` `src/app/api/mileage/use/route.ts`
- ` M` `src/app/api/packages/route.ts`
- ` M` `src/app/api/payments/settlement-bundle/route.ts`
- ` M` `src/app/api/recommendations/route.ts`
- ` M` `src/app/api/settlements/route.ts`
- ` M` `src/app/api/sms/receive/route.ts`
- ` M` `src/app/api/upload/route.ts`
- ` M` `src/app/blog/BlogData.tsx`
- ` M` `src/app/blog/angle/[angle]/page.tsx`
- ` M` `src/lib/affiliate/settlement-calc.ts`
- ` M` `src/lib/card-news/affiliate-feedback.ts`
- ` M` `src/lib/content-review-workflow.ts`
- ` M` `src/lib/db/dashboard.ts`
- ` M` `src/lib/supabase.ts`
- `??` `.commit-msg.txt`
- `??` `PLAN.md`
- `??` `fix-catch-patterns.py`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [ ] P0 ` M` `src/app/api/bookings/route.ts`
- [ ] P0 ` M` `src/app/api/payments/settlement-bundle/route.ts`
- [ ] P1 ` M` `src/app/api/cron/affiliate-anomaly-detect/route.ts`
- [ ] P1 ` M` `src/app/api/cron/affiliate-lifetime-commission/route.ts`
- [ ] P1 ` M` `src/app/api/cron/affiliate-live-celebration/route.ts`
- [ ] P1 ` M` `src/app/api/cron/affiliate-settlement-draft/route.ts`
- [ ] P1 ` M` `src/app/api/cron/blog-publisher/route.ts`
- [ ] P1 ` M` `src/app/api/cron/daily-marketing/route.ts`
- [ ] P1 ` M` `src/app/api/cron/rank-tracking/route.ts`
- [ ] P1 ` M` `src/app/api/cron/settlement-auto/route.ts`
- [ ] P1 ` M` `src/app/api/cron/setup-new-destinations/route.ts`
- [ ] P1 ` M` `src/lib/affiliate/settlement-calc.ts`
- [ ] P1 ` M` `src/lib/card-news/affiliate-feedback.ts`
- [ ] P1 ` M` `src/lib/supabase.ts`

## 4) Next Actions (Manual Prioritization Queue)

- [ ] P0: 운영 장애/결제/데이터 정합성 이슈
- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)
- [ ] P2: UX/관리자 생산성 개선
- [ ] P3: 리팩토링/문서화

> 실행: `npm run os:inbox`
