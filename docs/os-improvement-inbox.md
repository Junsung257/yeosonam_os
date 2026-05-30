# OS Improvement Inbox

- generated_at_kst: 2026-05-29T20:28:38+09:00
- actionable_changed_files: 43
- todo_markers: 0
- areas: ETC 18, LIB 14, DB 8, API 3

## 1) Actionable Changed Files

- ` M` `src/app/api/qa/chat/route.ts`
- ` M` `src/app/api/qa/chat/v2/route.ts`
- ` M` `src/lib/jarvis/cost-tracker.ts`
- ` M` `src/lib/jarvis/response-critic.ts`
- ` M` `src/lib/jarvis/scoped-tables.ts`
- ` M` `src/lib/llm-gateway.ts`
- ` M` `src/lib/prompt-loader.ts`
- ` M` `src/lib/secret-registry.ts`
- `??` `api_test.json`
- `??` `api_total.txt`
- `??` `packages_response.txt`
- `??` `response1.json`
- `??` `response2.json`
- `??` `response3.json`
- `??` `response4.json`
- `??` `response5.json`
- `??` `result-01.txt`
- `??` `result-sc12.txt`
- `??` `scripts/demand-forecast-pipeline.py`
- `??` `scripts/qa-chat-scenario-test.mjs`
- `??` `scripts/requirements.txt`
- `??` `src/app/api/v1/`
- `??` `src/lib/anomaly-detection.ts`
- `??` `src/lib/api-key-middleware.ts`
- `??` `src/lib/api-key-service.ts`
- `??` `src/lib/customer-events.ts`
- `??` `src/lib/multimodal-sdk.ts`
- `??` `src/lib/qa-chat-engine.ts`
- `??` `src/lib/recommendation-events.ts`
- `??` `src/lib/toss-billing.ts`
- `??` `supabase/migrations/20260529100000_customer_events.sql`
- `??` `supabase/migrations/20260529110000_prompt_registry.sql`
- `??` `supabase/migrations/20260529120000_recommendation_events.sql`
- `??` `supabase/migrations/20260529130000_demand_forecasts.sql`
- `??` `supabase/migrations/20260529140000_anomaly_detection.sql`
- `??` `supabase/migrations/20260529150000_api_keys.sql`
- `??` `supabase/migrations/20260529160000_toss_billing.sql`
- `??` `supabase/migrations/20260529170000_agent_tasks.sql`
- `??` `test_quick.mjs`
- `??` `test_sc_12.mjs`
- `??` `test_scenario_01.mjs`
- `??` `test_scenarios.mjs`
- `??` `test_ux.mjs`

## 2) TODO/FIXME/HACK/XXX Markers

- 없음

## 3) Auto Priority Candidates (P0/P1)

- [ ] P1 `??` `supabase/migrations/20260529100000_customer_events.sql`
- [ ] P1 `??` `supabase/migrations/20260529110000_prompt_registry.sql`
- [ ] P1 `??` `supabase/migrations/20260529120000_recommendation_events.sql`
- [ ] P1 `??` `supabase/migrations/20260529130000_demand_forecasts.sql`
- [ ] P1 `??` `supabase/migrations/20260529140000_anomaly_detection.sql`
- [ ] P1 `??` `supabase/migrations/20260529150000_api_keys.sql`
- [ ] P1 `??` `supabase/migrations/20260529160000_toss_billing.sql`
- [ ] P1 `??` `supabase/migrations/20260529170000_agent_tasks.sql`

## 4) Next Actions (Manual Prioritization Queue)

- [ ] P0: 운영 장애/결제/데이터 정합성 이슈
- [ ] P1: 매출 직접 영향(전환/리타겟팅/제휴)
- [ ] P2: UX/관리자 생산성 개선
- [ ] P3: 리팩토링/문서화

> 실행: `npm run os:inbox`
