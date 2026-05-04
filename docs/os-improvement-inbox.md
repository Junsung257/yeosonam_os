# OS Improvement Inbox

- generated_at_kst: 2026-05-04T22:25:37+09:00
- actionable_changed_files: 52
- todo_markers: 0
- areas: API 15, LIB 15, ETC 8, UI 6, APP 4, DB 3, DOCS 1

## 1) Actionable Changed Files

- `M ` `.gitignore`
- ` M` `docs/env-variables-reference.md`
- ` M` `package-lock.json`
- ` M` `package.json`
- ` M` `public/sw.js`
- ` M` `src/app/admin/blog/queue/BlogQueueClient.tsx`
- ` M` `src/app/api/blog/from-card-news/route.ts`
- ` M` `src/app/api/blog/generate/route.ts`
- ` D` `src/app/api/bookings/[bookingId]/companions/invite/route.ts`
- ` M` `src/app/api/card-news/[id]/render-html-to-png/route.ts`
- ` M` `src/app/api/card-news/[id]/route.ts`
- ` M` `src/app/api/card-news/render-v2/route.ts`
- ` M` `src/app/api/cron/blog-publisher/route.ts`
- ` M` `src/app/api/cron/rank-tracking/route.ts`
- ` M` `src/app/api/cron/trend-topic-miner/route.ts`
- ` M` `src/app/api/ops/blog-system/route.ts`
- ` M` `src/app/api/packages/[id]/approve/route.ts`
- ` M` `src/app/api/unmatched/suggest/route.ts`
- ` M` `src/app/blog/[slug]/page.tsx`
- ` M` `src/app/layout.tsx`
- ` M` `src/app/page.tsx`
- ` M` `src/components/KakaoMomentPixel.tsx`
- ` M` `src/components/MetaPixel.tsx`
- ` M` `src/components/MsClarity.tsx`
- ` M` `src/components/customer/HomeHeroSearchCluster.tsx`
- ` M` `src/lib/agent-action-executor.ts`
- ` M` `src/lib/blog-cta.ts`
- ` M` `src/lib/blog-jsonld.ts`
- ` M` `src/lib/card-news-render-readiness.ts`
- ` M` `src/lib/content-pipeline/blog-body.ts`
- ` M` `src/lib/programmatic-seo.ts`
- ` M` `src/prompts/blog/style-guide.ts`
- ` M` `src/types/supabase-database.generated.ts`
- ` M` `vercel.json`
- `??` `scripts/copy-partytown-lib.cjs`
- `??` `src/app/api/bookings/[id]/companions/`
- `??` `src/app/api/cron/serp-rank-snapshot/`
- `??` `src/app/api/ops/blog-normalize-image/`
- `??` `src/components/PartytownInit.tsx`
- `??` `src/components/customer/HomeHeroUrgencyStrip.tsx`
- `??` `src/lib/blog-chain-of-density.ts`
- `??` `src/lib/blog-image-normalize.ts`
- `??` `src/lib/blog-review-quotes.ts`
- `??` `src/lib/blog-search-intent.ts`
- `??` `src/lib/blog-season-publish.ts`
- `??` `src/lib/card-news-slide-urls.ts`
- `??` `src/lib/marketing-osmu.ts`
- `??` `src/lib/naver-blog-export.ts`
- `??` `src/lib/third-party-script-type.ts`
- `??` `supabase/migrations/20260504240000_leads_utm_term.sql`
- `??` `supabase/migrations/20260504250000_keyword_pool_blog_seo.sql`
- `??` `supabase/migrations/20260504251000_serp_rank_marketing_osmu.sql`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [ ] P0 ` D` `src/app/api/bookings/[bookingId]/companions/invite/route.ts`
- [ ] P0 `??` `src/app/api/bookings/[id]/companions/`
- [ ] P1 ` M` `src/app/api/cron/blog-publisher/route.ts`
- [ ] P1 ` M` `src/app/api/cron/rank-tracking/route.ts`
- [ ] P1 ` M` `src/app/api/cron/trend-topic-miner/route.ts`
- [ ] P1 `??` `src/app/api/cron/serp-rank-snapshot/`
- [ ] P1 ` M` `src/types/supabase-database.generated.ts`
- [ ] P1 `??` `supabase/migrations/20260504240000_leads_utm_term.sql`
- [ ] P1 `??` `supabase/migrations/20260504250000_keyword_pool_blog_seo.sql`
- [ ] P1 `??` `supabase/migrations/20260504251000_serp_rank_marketing_osmu.sql`

## 4) Next Actions (Manual Prioritization Queue)

- [ ] P0: 운영 장애/결제/데이터 정합성 이슈
- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)
- [ ] P2: UX/관리자 생산성 개선
- [ ] P3: 리팩토링/문서화

> 실행: `npm run os:inbox`
