# OS Improvement Inbox

- generated_at_kst: 2026-05-24T23:36:38+09:00
- actionable_changed_files: 95
- todo_markers: 0
- areas: ETC 39, LIB 18, APP 16, API 8, UI 5, DOCS 5, DB 4

## 1) Actionable Changed Files

- `M ` `.gitignore`
- ` M` `db/post_register_audit.js`
- ` M` `package-lock.json`
- ` M` `package.json`
- ` M` `src/app/admin/AdminPageClient.tsx`
- ` M` `src/app/admin/attractions/unmatched/page.tsx`
- ` M` `src/app/admin/blog/page.tsx`
- ` M` `src/app/admin/content-analytics/page.tsx`
- ` M` `src/app/admin/content-gaps/page.tsx`
- ` M` `src/app/admin/content-queue/page.tsx`
- ` M` `src/app/admin/jarvis/page.tsx`
- ` M` `src/app/admin/marketing/page.tsx`
- ` M` `src/app/admin/search-ads/page.tsx`
- ` D` `src/app/api/card-news/render/route.ts`
- ` M` `src/app/api/cron/unmatched-auto-resolve/route.ts`
- ` M` `src/app/api/qa/chat/v2/route.ts`
- ` M` `src/app/api/unmatched/route.ts`
- ` M` `src/app/api/upload/route.ts`
- ` M` `src/components/AdminLayout.tsx`
- ` M` `src/lib/admin-cache.ts`
- ` M` `src/lib/indexing.ts`
- ` M` `src/lib/jarvis/agents/marketing.ts`
- ` M` `src/lib/jarvis/cost-tracker.ts`
- ` M` `src/lib/jarvis/deepseek-agent-loop-v2.ts`
- ` M` `src/lib/jarvis/deepseek-agent-loop.ts`
- ` M` `src/lib/jarvis/mcp-server.ts`
- ` M` `src/lib/jarvis/prompts.ts`
- ` M` `src/lib/jarvis/v2-dispatch.ts`
- ` M` `src/lib/marketing-pipeline/agents/ad-publish-agent.ts`
- ` M` `src/lib/marketing-pipeline/orchestrator.ts`
- ` M` `src/lib/secret-registry.ts`
- ` M` `src/lib/social-publisher.ts`
- ` M` `supabase/migrations/20260524013400_add_social_publish_fields.sql`
- `??` `.pr_body.txt`
- `??` `db/batch_resolve_unmatched.js`
- `??` `db/external-poi.js`
- `??` `db/test_mrt_mcp.mjs`
- `??` `db/test_mrt_tnadetail.mjs`
- `??` `db/test_overpass.mjs`
- `??` `db/test_overpass_world.mjs`
- `??` `db/test_poi_sources.mjs`
- `??` `db/test_wikidata_world.mjs`
- `??` `docs/admin-dashboard-improvement-plan.md`
- `??` `docs/create-pdf.js`
- `??` `docs/google-ads-api-tool-design.md`
- `??` `docs/google-ads-api-tool-design.pdf`
- `??` `docs/marketing-system-audit-and-plan.md`
- `??` `public/eb2d926ae433f7d7122b2cfae05bda30.txt`
- `??` `scripts/add-gsc-owner-via-api.mjs`
- `??` `scripts/check-indexing-status.mjs`
- `??` `scripts/check-schema.mjs`
- `??` `scripts/create-gsc-key.mjs`
- `??` `scripts/enable-gcp-apis.mjs`
- `??` `scripts/google-sa-value.txt`
- `??` `scripts/gsc-owner-delegate.html`
- `??` `scripts/list-blog-posts.mjs`
- `??` `scripts/notify-naver-indexnow.mjs`
- `??` `scripts/oauth-local.mjs`
- `??` `scripts/oauth-web-flow.mjs`
- `??` `scripts/request-indexing.mjs`
- `??` `scripts/set-vercel-env-browser.mjs`
- `??` `scripts/set-vercel-env-ps.ps1`
- `??` `scripts/set-vercel-env.mjs`
- `??` `scripts/test-gsc-direct.mjs`
- `??` `scripts/test-gsc.mjs`
- `??` `scripts/test-indexing-api.mjs`
- `??` `scripts/test-indexing.mjs`
- `??` `scripts/verify-ownership-v2.mjs`
- `??` `scripts/verify-site-ownership.mjs`
- `??` `src/app/admin/blog/BlogSubNav.tsx`
- `??` `src/app/admin/blog/layout.tsx`
- `??` `src/app/admin/content-hub/ContentSubNav.tsx`
- `??` `src/app/admin/content-hub/layout.tsx`
- `??` `src/app/admin/jarvis/components/McpToolGuide.tsx`
- `??` `src/app/admin/marketing/card-news/CardNewsSubNav.tsx`
- `??` `src/app/admin/marketing/card-news/layout.tsx`
- `??` `src/app/api/admin/session/`
- `??` `src/app/api/card-news/render/route.tsx`
- `??` `src/app/api/cron/attraction-dedup/`
- `??` `src/components/admin/IntentRecommendations.tsx`
- `??` `src/components/admin/JarvisQuickAsk.tsx`
- `??` `src/components/admin/SidebarAIWidget.tsx`
- `??` `src/components/admin/SubNav.tsx`
- `??` `src/hooks/useNavLogger.ts`
- `??` `src/hooks/usePinnedItems.ts`
- `??` `src/hooks/useUserRole.ts`
- `??` `src/lib/attraction-desc-gen.ts`
- `??` `src/lib/attraction-photo-match.ts`
- `??` `src/lib/external-poi-search.ts`
- `??` `src/lib/parser/attraction-category.ts`
- `??` `src/lib/wikidata-reconcile.ts`
- `??` `supabase/migrations/20260524130000_ad_campaigns_google_resource.sql`
- `??` `supabase/migrations/20260524160000_unmatched_note_column.sql`
- `??` `supabase/migrations/20260524200000_attractions_qid_reconcile.sql`
- `??` `unindexed-urls.json`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [ ] P1 ` M` `src/app/api/cron/unmatched-auto-resolve/route.ts`
- [ ] P1 `??` `src/app/api/cron/attraction-dedup/`
- [ ] P1 ` M` `supabase/migrations/20260524013400_add_social_publish_fields.sql`
- [ ] P1 `??` `supabase/migrations/20260524130000_ad_campaigns_google_resource.sql`
- [ ] P1 `??` `supabase/migrations/20260524160000_unmatched_note_column.sql`
- [ ] P1 `??` `supabase/migrations/20260524200000_attractions_qid_reconcile.sql`

## 4) Next Actions (Manual Prioritization Queue)

- [ ] P0: 운영 장애/결제/데이터 정합성 이슈
- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)
- [ ] P2: UX/관리자 생산성 개선
- [ ] P3: 리팩토링/문서화

> 실행: `npm run os:inbox`
