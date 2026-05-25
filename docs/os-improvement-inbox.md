# OS Improvement Inbox

- generated_at_kst: 2026-05-26T06:57:35+09:00
- actionable_changed_files: 15
- todo_markers: 0
- areas: ETC 4, LIB 4, API 2, DB 2, APP 2, UI 1

## 1) Actionable Changed Files

- ` M` `next.config.js`
- ` M` `package-lock.json`
- ` M` `package.json`
- `D ` `pr-body.md`
- ` M` `src/app/api/content-calendar/route.ts`
- ` M` `src/app/api/cron/blog-publisher/route.ts`
- ` M` `src/app/blog/[slug]/page.tsx`
- ` M` `src/components/blog/AuthorBox.tsx`
- ` M` `src/lib/ab-test-engine.ts`
- ` M` `src/lib/blog-bayesian-optimizer.ts`
- ` M` `src/lib/blog-jsonld.ts`
- ` M` `src/lib/content-pipeline/blog-body.ts`
- `??` `src/app/about/`
- `??` `supabase/migrations/20260526140000_queue_lock.sql`
- `??` `supabase/migrations/20260526141000_ab_atomic_counters.sql`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [ ] P1 ` M` `src/app/api/cron/blog-publisher/route.ts`
- [ ] P1 `??` `supabase/migrations/20260526140000_queue_lock.sql`
- [ ] P1 `??` `supabase/migrations/20260526141000_ab_atomic_counters.sql`

## 4) Next Actions (Manual Prioritization Queue)

- [ ] P0: 운영 장애/결제/데이터 정합성 이슈
- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)
- [ ] P2: UX/관리자 생산성 개선
- [ ] P3: 리팩토링/문서화

> 실행: `npm run os:inbox`
