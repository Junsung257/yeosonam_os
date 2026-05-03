# OS Improvement Inbox

- generated_at_kst: 2026-05-04T06:05:53+09:00
- actionable_changed_files: 101
- todo_markers: 0
- areas: API 37, LIB 17, APP 15, ETC 11, DB 9, DOCS 7, UI 5

## 1) Actionable Changed Files

- `M ` `docs/deploy-checklist.md`
- ` M` `docs/env-variables-reference.md`
- ` M` `next.config.js`
- ` M` `package-lock.json`
- ` M` `package.json`
- ` M` `public/sw.js`
- ` M` `src/app/admin/affiliate-analytics/page.tsx`
- ` M` `src/app/admin/affiliates/[id]/page.tsx`
- ` M` `src/app/admin/qa/page.tsx`
- ` M` `src/app/api/admin/affiliate-analytics/route.ts`
- ` M` `src/app/api/affiliates/route.ts`
- ` M` `src/app/api/auth/refresh/route.ts`
- ` M` `src/app/api/auth/session/route.ts`
- ` M` `src/app/api/bookings/route.ts`
- ` M` `src/app/api/cron/ad-optimizer/route.ts`
- ` M` `src/app/api/cron/affiliate-anomaly-detect/route.ts`
- ` M` `src/app/api/cron/affiliate-content-24h-report/route.ts`
- ` M` `src/app/api/cron/affiliate-dormant/route.ts`
- ` M` `src/app/api/cron/affiliate-settlement-draft/route.ts`
- ` M` `src/app/api/cron/agent-executor/route.ts`
- ` M` `src/app/api/cron/blog-publisher/route.ts`
- ` M` `src/app/api/cron/booking-attribution-audit/route.ts`
- ` M` `src/app/api/cron/marketing-rules/route.ts`
- ` M` `src/app/api/influencer/dashboard/route.ts`
- ` M` `src/app/api/influencer/links/route.ts`
- ` M` `src/app/api/jarvis/route.ts`
- ` M` `src/app/api/jarvis/stream/route.ts`
- ` M` `src/app/api/partner-apply/route.ts`
- ` M` `src/app/api/qa/chat/route.ts`
- ` M` `src/app/api/tracking/route.ts`
- ` M` `src/app/blog/[slug]/page.tsx`
- ` M` `src/app/concierge/page.tsx`
- ` M` `src/app/globals.css`
- ` M` `src/app/influencer/[code]/layout.tsx`
- ` M` `src/app/influencer/[code]/page.tsx`
- ` M` `src/app/influencer/[code]/products/page.tsx`
- ` M` `src/app/layout.tsx`
- ` M` `src/app/packages/[id]/DetailClient.tsx`
- ` M` `src/app/r/[code]/[slug]/page.tsx`
- ` M` `src/app/with/[slug]/page.tsx`
- ` M` `src/components/AdminLayout.tsx`
- ` M` `src/components/ChatWidget.tsx`
- ` M` `src/components/blog/ShareButtons.tsx`
- ` M` `src/lib/blog-queue-lifecycle.ts`
- ` M` `src/lib/card-news-render-readiness.ts`
- ` M` `src/lib/cron-auth.ts`
- ` M` `src/lib/db/ads.ts`
- ` M` `src/lib/kakao.ts`
- ` M` `src/lib/llm-gateway.ts`
- ` M` `src/lib/publish-orchestration.ts`
- ` M` `src/lib/supabase.ts`
- ` M` `src/lib/tracker.ts`
- ` M` `src/middleware.ts`
- ` M` `src/types/supabase-database.generated.ts`
- ` M` `vercel.json`
- `??` `.github/workflows/concierge-eval-gate.yml`
- `??` `docs/affiliate-machine-execution-plan.md`
- `??` `docs/mas-concierge-poc-master-plan.md`
- `??` `docs/mas-concierge-runbook.md`
- `??` `docs/os-automation-runbook.md`
- `??` `docs/pending-settings-tracker.md`
- `??` `scripts/eval-concierge.mjs`
- `??` `scripts/os-improvement-inbox.mjs`
- `??` `src/app/admin/affiliate-promo-report/`
- `??` `src/app/api/admin/affiliate-promo-report/`
- `??` `src/app/api/admin/affiliate-settings/`
- `??` `src/app/api/admin/agent/`
- `??` `src/app/api/affiliate/`
- `??` `src/app/api/agent/approvals/`
- `??` `src/app/api/cron/affiliate-attribution-recalc/`
- `??` `src/app/api/cron/affiliate-lifetime-commission/`
- `??` `src/app/api/cron/affiliate-live-celebration/`
- `??` `src/app/api/cron/affiliate-model-compare-rollup/`
- `??` `src/app/api/cron/affiliate-reactivation-campaign/`
- `??` `src/app/api/cron/affiliate-sub-daily-rollup/`
- `??` `src/app/api/cron/affiliate-tier-rewards/`
- `??` `src/app/api/cron/concierge-cart-retarget/`
- `??` `src/app/api/influencer/playbook/`
- `??` `src/app/api/influencer/promo-codes/`
- `??` `src/app/api/qa/feedback/`
- `??` `src/app/influencer/[code]/playbook/`
- `??` `src/components/MsClarity.tsx`
- `??` `src/components/TrackerBootstrap.tsx`
- `??` `src/lib/affiliate/cron-monitor.ts`
- `??` `src/lib/agent/`
- `??` `src/lib/guardrails/`
- `??` `src/lib/jarvis/risk-scorer.test.ts`
- `??` `src/lib/jarvis/risk-scorer.ts`
- `??` `src/lib/jarvis/supervisor-lite.ts`
- `??` `src/lib/share-url.ts`
- `??` `src/lib/telemetry/`
- `??` `supabase/migrations/20260503150000_affiliate_machine_phase2.sql`
- `??` `supabase/migrations/20260503154000_affiliates_add_landing_video_url.sql`
- `??` `supabase/migrations/20260503162000_affiliate_lifetime_attribution.sql`
- `??` `supabase/migrations/20260503170000_affiliate_sub_daily.sql`
- `??` `supabase/migrations/20260504000000_affiliate_model_compare_daily.sql`
- `??` `supabase/migrations/20260504003000_agent_tasking_core.sql`
- `??` `supabase/migrations/20260504004000_agent_trace_spans.sql`
- `??` `supabase/migrations/20260504180000_customer_booking_stats_view.sql`
- `??` `supabase/migrations/20260504181000_error_patterns_embedding_hnsw.sql`
- `??` `tests/evals/`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [ ] P0 ` M` `src/app/api/cron/booking-attribution-audit/route.ts`
- [ ] P0 `??` `supabase/migrations/20260504180000_customer_booking_stats_view.sql`
- [ ] P0 ` M` `src/app/api/auth/refresh/route.ts`
- [ ] P0 ` M` `src/app/api/auth/session/route.ts`
- [ ] P0 ` M` `src/app/api/bookings/route.ts`
- [ ] P1 ` M` `src/app/admin/affiliate-analytics/page.tsx`
- [ ] P1 ` M` `src/app/admin/affiliates/[id]/page.tsx`
- [ ] P1 ` M` `src/app/api/admin/affiliate-analytics/route.ts`
- [ ] P1 ` M` `src/app/api/affiliates/route.ts`
- [ ] P1 ` M` `src/app/api/cron/ad-optimizer/route.ts`
- [ ] P1 ` M` `src/app/api/cron/affiliate-anomaly-detect/route.ts`
- [ ] P1 ` M` `src/app/api/cron/affiliate-content-24h-report/route.ts`
- [ ] P1 ` M` `src/app/api/cron/affiliate-dormant/route.ts`
- [ ] P1 ` M` `src/app/api/cron/affiliate-settlement-draft/route.ts`
- [ ] P1 ` M` `src/app/api/cron/agent-executor/route.ts`
- [ ] P1 ` M` `src/app/api/cron/blog-publisher/route.ts`
- [ ] P1 ` M` `src/app/api/cron/marketing-rules/route.ts`
- [ ] P1 ` M` `src/app/api/tracking/route.ts`
- [ ] P1 ` M` `src/lib/kakao.ts`
- [ ] P1 `??` `src/app/admin/affiliate-promo-report/`
- [ ] P1 `??` `src/app/api/admin/affiliate-promo-report/`
- [ ] P1 `??` `src/app/api/admin/affiliate-settings/`
- [ ] P1 `??` `src/app/api/affiliate/`
- [ ] P1 `??` `src/app/api/cron/affiliate-attribution-recalc/`
- [ ] P1 `??` `src/app/api/cron/affiliate-lifetime-commission/`
- [ ] P1 `??` `src/app/api/cron/affiliate-live-celebration/`
- [ ] P1 `??` `src/app/api/cron/affiliate-model-compare-rollup/`
- [ ] P1 `??` `src/app/api/cron/affiliate-reactivation-campaign/`
- [ ] P1 `??` `src/app/api/cron/affiliate-sub-daily-rollup/`
- [ ] P1 `??` `src/app/api/cron/affiliate-tier-rewards/`

## 4) Next Actions (Manual Prioritization Queue)

- [ ] P0: 운영 장애/결제/데이터 정합성 이슈
- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)
- [ ] P2: UX/관리자 생산성 개선
- [ ] P3: 리팩토링/문서화

> 실행: `npm run os:inbox`
