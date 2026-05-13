-- ═══════════════════════════════════════════════════════════════════
-- P10-4: Partial Index 3건 — 빈번한 쿼리 패턴 최적화
-- 박제일: 2026-05-13 Phase 10
-- priority 는 smallint (0=urgent, 1=high, 2=medium)
-- ═══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_booking_tasks_open_high
  ON booking_tasks(priority ASC, created_at DESC)
  WHERE status = 'open' AND priority <= 1;

CREATE INDEX IF NOT EXISTS idx_ai_quality_log_review_queue
  ON ai_quality_log(created_at DESC, confidence)
  WHERE auto_gate IN ('confirm_queue', 'pending_review', 'rejected');

CREATE INDEX IF NOT EXISTS idx_fraud_signals_recent_high
  ON fraud_signals_log(detected_at DESC)
  WHERE severity IN ('high', 'critical');
