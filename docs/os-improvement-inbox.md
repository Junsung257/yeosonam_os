# OS Improvement Inbox

- generated_at_kst: 2026-05-28T06:13:36+09:00
- actionable_changed_files: 26
- todo_markers: 0
- areas: LIB 11, API 8, ETC 4, APP 2, DB 1

## 1) Actionable Changed Files

- `M ` `.git_commit_msg.txt`
- ` M` `.gitignore`
- ` M` `src/app/api/admin/published-feed/route.ts`
- ` D` `src/app/api/card-news/[id]/publish-threads/route.ts`
- ` M` `src/app/api/content-calendar/reschedule/route.ts`
- ` M` `src/app/api/content-calendar/route.ts`
- ` M` `src/app/api/cron/card-news-refine/route.ts`
- ` M` `src/app/api/cron/publish-scheduled/route.ts`
- ` M` `src/app/api/cron/sync-engagement/route.ts`
- ` M` `src/app/api/upload/route.ts`
- ` M` `src/app/lp/[id]/LpDeferSections.tsx`
- ` M` `src/app/lp/[id]/page.tsx`
- ` M` `src/lib/content-pipeline/agents/threads-post.ts`
- ` M` `src/lib/content-pipeline/blog-body.ts`
- ` M` `src/lib/lp-hero-resolver.ts`
- ` M` `src/lib/map-travel-package-to-lp.ts`
- ` M` `src/lib/marketing-osmu.ts`
- ` D` `src/lib/package-register.ts`
- ` M` `src/lib/parser.ts`
- ` M` `src/lib/publish-orchestration.ts`
- ` M` `src/lib/render-contract.ts`
- ` M` `src/lib/social-publisher.ts`
- ` M` `src/lib/threads-publisher.ts`
- `??` `db/fix-content-creative-slugs.sql`
- `??` `db/fix-content-creative-slugs.ts`
- `??` `supabase/migrations/20260528120000_remove_card_news_threads_columns.sql`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [ ] P1 ` M` `src/app/api/cron/card-news-refine/route.ts`
- [ ] P1 ` M` `src/app/api/cron/publish-scheduled/route.ts`
- [ ] P1 ` M` `src/app/api/cron/sync-engagement/route.ts`
- [ ] P1 `??` `supabase/migrations/20260528120000_remove_card_news_threads_columns.sql`

## 4) Next Actions (Manual Prioritization Queue)

- [ ] P0: 운영 장애/결제/데이터 정합성 이슈
- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)
- [ ] P2: UX/관리자 생산성 개선
- [ ] P3: 리팩토링/문서화

> 실행: `npm run os:inbox`
