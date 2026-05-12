-- Supabase Security Advisor: public 테이블 RLS 미적용 해소
-- anon/authenticated 는 정책 없으면 기본 거부. service_role 은 RLS 우회 → 서버(supabaseAdmin) 정상.
-- 선행조건: /api/affiliates, /api/settlements, /api/audit-logs 등 anon 직접 조회 제거 (코드 동시 반영)

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'audit_logs', 'affiliates', 'settlements', 'intents', 'user_actions',
    'pin_attempts', 'conversations', 'kakao_inbound', 'tour_blocks', 'destination_masters',
    'jarvis_sessions', 'jarvis_tool_logs', 'course_templates', 'scoring_rules',
    'normalization_rules', 'exclusion_rules', 'customer_facts', 'jarvis_pending_actions',
    'jarvis_knowledge_chunks', 'tenant_bot_profiles', 'jarvis_cost_ledger', 'brand_kits',
    'card_news_renders', 'card_news_variants', 'competitor_ad_snapshots',
    'post_engagement_snapshots', 'social_webhook_events', 'cron_run_logs',
    'payment_command_log', 'extractions_corrections', 'content_distributions',
    'land_settlements', 'land_settlement_bookings', 'payment_command_rules',
    'destination_climate', 'package_score_history', 'recommendation_outcomes',
    'policy_ab_results', 'feature_snapshots', 'admin_alerts', 'bronze_chat_events',
    'ktkg_triples', 'hotel_brands', 'free_travel_bookings', 'free_travel_commissions',
    'free_travel_booking_items', 'ota_commission_reports', 'free_travel_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
