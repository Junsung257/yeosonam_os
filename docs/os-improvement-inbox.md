# OS Improvement Inbox

- generated_at_kst: 2026-05-28T11:21:25+09:00
- actionable_changed_files: 47
- todo_markers: 0
- areas: LIB 18, API 11, APP 11, DB 3, ETC 3, UI 1

## 1) Actionable Changed Files

- `M ` `.gitignore`
- ` M` `src/app/admin/control-tower/page.tsx`
- ` M` `src/app/admin/customers/page.tsx`
- ` M` `src/app/api/auth/threads-oauth-start/route.ts`
- ` D` `src/app/api/card-news/[id]/publish-threads/route.ts`
- ` M` `src/app/api/cron/publish-scheduled/route.ts`
- ` M` `src/app/api/customers/route.ts`
- ` M` `src/app/api/upload/route.ts`
- ` M` `src/app/blog/[slug]/page.tsx`
- ` M` `src/app/blog/error.tsx`
- ` M` `src/app/destinations/[city]/page.tsx`
- ` M` `src/app/lp/[id]/LpDeferSections.tsx`
- ` M` `src/app/lp/[id]/page.tsx`
- ` M` `src/app/mypage/page.tsx`
- ` M` `src/app/packages/PackagesClient.tsx`
- ` M` `src/components/blog/DestinationCuration.tsx`
- ` M` `src/lib/content-pipeline/agents/threads-post.ts`
- ` M` `src/lib/content-pipeline/blog-body.ts`
- ` M` `src/lib/jarvis/agents/marketing.ts`
- ` M` `src/lib/jarvis/orchestration/specialist-registry.ts`
- ` M` `src/lib/kakao.ts`
- ` M` `src/lib/lp-hero-resolver.ts`
- ` M` `src/lib/map-travel-package-to-lp.ts`
- ` M` `src/lib/mileage-service.ts`
- ` D` `src/lib/package-register.ts`
- ` M` `src/lib/parser.ts`
- ` M` `src/lib/policy-engine.ts`
- ` M` `src/lib/render-contract.ts`
- ` M` `src/lib/secret-registry.ts`
- ` M` `src/lib/threads-publisher.ts`
- `??` `db/fix-content-creative-slugs.sql`
- `??` `db/fix-content-creative-slugs.ts`
- `??` `src/app/admin/mileage-analytics/`
- `??` `src/app/api/admin/mileage-analytics/`
- `??` `src/app/api/blog/report-error/`
- `??` `src/app/api/cron/expire-mileage/`
- `??` `src/app/api/customers/me/`
- `??` `src/app/api/gamification/`
- `??` `src/app/api/mileage/`
- `??` `src/app/mypage/mileage/`
- `??` `src/lib/gamification-service.ts`
- `??` `src/lib/mileage-expiration.ts`
- `??` `src/lib/mileage-notification.ts`
- `??` `src/lib/mileage-personalization.ts`
- `??` `supabase/migrations/20260528170000_mileage_expiration_and_badges.sql`
- `??` `supabase/migrations/20260528173000_mileage_challenges.sql`
- `??` `supabase/migrations/20260528180000_mileage_expiration.sql`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [ ] P0 ` M` `src/app/api/auth/threads-oauth-start/route.ts`
- [ ] P1 ` M` `src/app/api/cron/publish-scheduled/route.ts`
- [ ] P1 ` M` `src/lib/kakao.ts`
- [ ] P1 `??` `src/app/api/cron/expire-mileage/`
- [ ] P1 `??` `supabase/migrations/20260528170000_mileage_expiration_and_badges.sql`
- [ ] P1 `??` `supabase/migrations/20260528173000_mileage_challenges.sql`
- [ ] P1 `??` `supabase/migrations/20260528180000_mileage_expiration.sql`

## 4) Next Actions (Manual Prioritization Queue)

- [ ] P0: 운영 장애/결제/데이터 정합성 이슈
- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)
- [ ] P2: UX/관리자 생산성 개선
- [ ] P3: 리팩토링/문서화

> 실행: `npm run os:inbox`
