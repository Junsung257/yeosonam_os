-- Phase 13 P13-1: Materialized View daily_registration_stats
-- 박제일: 2026-05-13

CREATE MATERIALIZED VIEW IF NOT EXISTS daily_registration_stats AS
SELECT
  DATE(created_at)                                                 AS registration_date,
  COUNT(*)                                                          AS total_registrations,
  COUNT(*) FILTER (WHERE auto_gate = 'rejected')                    AS rejected_count,
  COUNT(*) FILTER (WHERE auto_gate = 'confirm_queue')               AS confirm_queue_count,
  COUNT(*) FILTER (WHERE auto_gate = 'auto_publish')                AS auto_publish_count,
  COUNT(*) FILTER (WHERE auto_gate = 'pending_review')              AS pending_review_count,
  ROUND(AVG(confidence)::numeric, 3)                                AS avg_confidence,
  ROUND(AVG(leak_score)::numeric, 3)                                AS avg_leak_score,
  COUNT(*) FILTER (WHERE leak_score > 0)                            AS with_leak_count,
  COUNT(*) FILTER (WHERE jsonb_array_length(failed_checks) > 0)     AS with_failed_checks_count,
  COUNT(*) FILTER (WHERE advisor_escalated = true)                  AS advisor_escalated_count,
  ROUND(AVG(llm_cost_usd)::numeric, 5)                              AS avg_llm_cost,
  SUM(llm_cost_usd)                                                  AS total_llm_cost,
  MAX(created_at)                                                    AS last_record_at
FROM ai_quality_log
WHERE created_at >= now() - interval '90 days'
GROUP BY DATE(created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_reg_stats_date
  ON daily_registration_stats(registration_date);

COMMENT ON MATERIALIZED VIEW daily_registration_stats IS
  '일별 등록 통계 (P13-1). cron 새벽 REFRESH.';
