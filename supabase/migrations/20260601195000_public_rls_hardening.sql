-- Enable RLS for public tables flagged by Supabase security advisor.
-- Default stance: server/service-role only. Public read is allowed only for non-sensitive reference data.

ALTER TABLE public.customer_leak_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_leak_audit_service_role_all ON public.customer_leak_audit;
CREATE POLICY customer_leak_audit_service_role_all
  ON public.customer_leak_audit
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.ai_quality_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_quality_log_service_role_all ON public.ai_quality_log;
CREATE POLICY ai_quality_log_service_role_all
  ON public.ai_quality_log
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.registration_auto_policy ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS registration_auto_policy_service_role_all ON public.registration_auto_policy;
CREATE POLICY registration_auto_policy_service_role_all
  ON public.registration_auto_policy
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.land_operator_extraction_profile ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS land_operator_extraction_profile_service_role_all ON public.land_operator_extraction_profile;
CREATE POLICY land_operator_extraction_profile_service_role_all
  ON public.land_operator_extraction_profile
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_requests_service_role_all ON public.review_requests;
CREATE POLICY review_requests_service_role_all
  ON public.review_requests
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.fraud_signals_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fraud_signals_log_service_role_all ON public.fraud_signals_log;
CREATE POLICY fraud_signals_log_service_role_all
  ON public.fraud_signals_log
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.kr_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kr_holidays_service_role_all ON public.kr_holidays;
DROP POLICY IF EXISTS kr_holidays_public_read ON public.kr_holidays;
CREATE POLICY kr_holidays_service_role_all
  ON public.kr_holidays
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
CREATE POLICY kr_holidays_public_read
  ON public.kr_holidays
  FOR SELECT TO anon, authenticated
  USING (true);

ALTER TABLE public.rejection_pattern_master ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rejection_pattern_master_service_role_all ON public.rejection_pattern_master;
CREATE POLICY rejection_pattern_master_service_role_all
  ON public.rejection_pattern_master
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.attractions_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attractions_aliases_service_role_all ON public.attractions_aliases;
CREATE POLICY attractions_aliases_service_role_all
  ON public.attractions_aliases
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.content_drift_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_drift_actions_service_role_all ON public.content_drift_actions;
CREATE POLICY content_drift_actions_service_role_all
  ON public.content_drift_actions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.semantic_extraction_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS semantic_extraction_cache_service_role_all ON public.semantic_extraction_cache;
CREATE POLICY semantic_extraction_cache_service_role_all
  ON public.semantic_extraction_cache
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.prompt_regression_fixtures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prompt_regression_fixtures_service_role_all ON public.prompt_regression_fixtures;
CREATE POLICY prompt_regression_fixtures_service_role_all
  ON public.prompt_regression_fixtures
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.prompt_regression_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prompt_regression_runs_service_role_all ON public.prompt_regression_runs;
CREATE POLICY prompt_regression_runs_service_role_all
  ON public.prompt_regression_runs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.attribution_touch_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attribution_touch_events_service_role_all ON public.attribution_touch_events;
CREATE POLICY attribution_touch_events_service_role_all
  ON public.attribution_touch_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.attribution_chains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attribution_chains_service_role_all ON public.attribution_chains;
CREATE POLICY attribution_chains_service_role_all
  ON public.attribution_chains
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.attribution_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attribution_summary_service_role_all ON public.attribution_summary;
CREATE POLICY attribution_summary_service_role_all
  ON public.attribution_summary
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.customer_segments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_segments_service_role_all ON public.customer_segments;
CREATE POLICY customer_segments_service_role_all
  ON public.customer_segments
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.customer_rfm ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_rfm_service_role_all ON public.customer_rfm;
CREATE POLICY customer_rfm_service_role_all
  ON public.customer_rfm
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.predictive_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS predictive_insights_service_role_all ON public.predictive_insights;
CREATE POLICY predictive_insights_service_role_all
  ON public.predictive_insights
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.keyword_trend_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS keyword_trend_snapshots_service_role_all ON public.keyword_trend_snapshots;
CREATE POLICY keyword_trend_snapshots_service_role_all
  ON public.keyword_trend_snapshots
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.segment_campaign_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS segment_campaign_logs_service_role_all ON public.segment_campaign_logs;
CREATE POLICY segment_campaign_logs_service_role_all
  ON public.segment_campaign_logs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.affiliate_monthly_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS affiliate_monthly_usage_service_role_all ON public.affiliate_monthly_usage;
CREATE POLICY affiliate_monthly_usage_service_role_all
  ON public.affiliate_monthly_usage
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.affiliate_content_insights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS affiliate_content_insights_service_role_all ON public.affiliate_content_insights;
CREATE POLICY affiliate_content_insights_service_role_all
  ON public.affiliate_content_insights
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.social_platform_configs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS social_platform_configs_service_role_all ON public.social_platform_configs;
CREATE POLICY social_platform_configs_service_role_all
  ON public.social_platform_configs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.cancellation_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cancellation_predictions_service_role_all ON public.cancellation_predictions;
CREATE POLICY cancellation_predictions_service_role_all
  ON public.cancellation_predictions
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
