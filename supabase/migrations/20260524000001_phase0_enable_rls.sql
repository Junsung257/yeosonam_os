-- Phase 0 — RLS 정책 활성화 (Jarvis V2 멀티테넌트 격리)
--
-- 20260423020000 에서 정책을 등록만 하고 활성화하지 않았음.
-- 모든 STRICT/NULLABLE 테이블에 대해 RLS 를 ENABLE 하고,
-- applyRequestContext() 가 set_jarvis_request_context() RPC 를 호출하도록 전환한다.
--
-- 실행:   psql $SUPABASE_DB_URL -f 이파일.sql
-- 또는:   supabase db execute -f 이파일.sql
-- 또는:   SELECT jarvis_enable_rls();

BEGIN;

-- ─── RLS 활성화 ───────────────────────────────────────────────────
SELECT jarvis_enable_rls();

-- ─── 신규 테이블이 RLS 등록 안 된 상태로 추가되지 않도록 경고 ─────
-- (테이블 생성 migration 에서 RLS ENABLE 을 빼먹는 경우 방지)
--
-- jarvis_v2_rls_policies.sql 은 이미 DO $$ 블록으로 정책을 생성하므로,
-- 새 테이블이 생기면 저 migration 에 ARRAY 추가만 하면 됨.

COMMIT;

-- 적용 확인:
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE rowsecurity = true AND tablename IN (
--   'bookings','customers','payments','bank_transactions','message_logs',
--   'settlements','jarvis_sessions','jarvis_tool_logs','jarvis_pending_actions',
--   'agent_actions','inventory_blocks','rfq_access','rfq_proposals',
--   'tenant_bot_profiles','jarvis_cost_ledger','customer_facts',
--   'travel_packages','api_orders','error_patterns',
--   'content_creatives','content_daily_stats','content_insights',
--   'blog_posts','attractions','jarvis_knowledge_chunks'
-- ) ORDER BY tablename;
