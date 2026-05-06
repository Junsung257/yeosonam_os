# OS Improvement Inbox

- generated_at_kst: 2026-05-07T05:10:39+09:00
- actionable_changed_files: 40
- todo_markers: 0
- areas: ETC 15, APP 11, UI 5, API 5, DB 2, LIB 1, DOCS 1

## 1) Actionable Changed Files

- ` M` `docs/pending-settings-tracker.md`
- ` M` `src/app/admin/AdminPageClient.tsx`
- ` M` `src/app/admin/marketing/card-news/CardNewsListPageClient.tsx`
- ` M` `src/app/admin/packages/PackagesPageClient.tsx`
- ` M` `src/app/api/card-news/[id]/route.ts`
- ` M` `src/app/api/card-news/render-v2/route.ts`
- ` M` `src/app/api/card-news/route.ts`
- ` M` `src/app/api/packages/[id]/reviews/route.ts`
- ` M` `src/app/blog/page.tsx`
- ` M` `src/app/globals.css`
- ` M` `src/app/login/LoginForm.tsx`
- ` M` `src/app/login/page.tsx`
- ` M` `src/app/packages/PackagesClient.tsx`
- ` M` `src/app/packages/[id]/page.tsx`
- ` M` `src/app/packages/page.tsx`
- ` M` `src/components/blog/TableOfContents.tsx`
- ` M` `src/components/reviews/ReviewsSection.tsx`
- `??` `.lazyweb/`
- `??` `.tmp-lh-admin.json`
- `??` `.tmp-lh-home.json`
- `??` `.tmp-lh-local-admin.json`
- `??` `.tmp-lh-local-login.json`
- `??` `.tmp-lh-local-package-detail.json`
- `??` `.tmp-lh-local-packages.json`
- `??` `.tmp-lh-login.json`
- `??` `.tmp-lh-packages.json`
- `??` `.tmp-lh-prodlocal-admin.json`
- `??` `.tmp-lh-prodlocal-detail.json`
- `??` `.tmp-lh-prodlocal-login.json`
- `??` `.tmp-lh-prodlocal-packages.json`
- `??` `public/sw.js`
- `??` `public/swe-worker-ab00d3c7d2d59769.js`
- `??` `src/app/admin/marketing/card-news/campaign/`
- `??` `src/app/api/card-news/campaign/`
- `??` `src/components/blog/BackToTop.tsx`
- `??` `src/components/blog/ScrollReveal.tsx`
- `??` `src/components/customer/PackageFAQ.tsx`
- `??` `src/lib/card-news/blog-topic-queue.ts`
- `??` `supabase/migrations/20260507000000_review_source_type.sql`
- `??` `supabase/migrations/20260510000000_card_news_rendering_status.sql`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [ ] P1 `??` `supabase/migrations/20260507000000_review_source_type.sql`
- [ ] P1 `??` `supabase/migrations/20260510000000_card_news_rendering_status.sql`

## 4) Next Actions (Manual Prioritization Queue)

- [ ] P0: 운영 장애/결제/데이터 정합성 이슈
- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)
- [ ] P2: UX/관리자 생산성 개선
- [ ] P3: 리팩토링/문서화

> 실행: `npm run os:inbox`
