-- ═══════════════════════════════════════════════════════════════════
-- Phase 9 Final — 자동화 audit 인프라 강화
-- 박제일: 2026-05-13
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS fraud_signals_log (
  id              bigserial PRIMARY KEY,
  booking_id      uuid REFERENCES bookings(id) ON DELETE CASCADE,
  detected_at     timestamptz NOT NULL DEFAULT now(),
  severity        text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  signal_codes    text[] NOT NULL DEFAULT '{}',
  signal_descs    text[] NOT NULL DEFAULT '{}',
  auto_action     text NOT NULL CHECK (auto_action IN ('memo_marked','slack_only','blocked')),
  resolved_at     timestamptz,
  resolved_by     text,
  notes           text
);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_booking ON fraud_signals_log(booking_id);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_detected ON fraud_signals_log(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fraud_signals_unresolved ON fraud_signals_log(resolved_at) WHERE resolved_at IS NULL;
COMMENT ON TABLE fraud_signals_log IS
  'AA-1 fraud-detect 자동 격리 audit log.';

ALTER TABLE ai_quality_log
  ADD COLUMN IF NOT EXISTS llm_calls_count       int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS llm_tokens_input      int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS llm_tokens_output     int DEFAULT 0,
  ADD COLUMN IF NOT EXISTS llm_cost_usd          numeric(8,5) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS llm_providers         text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS advisor_escalated     boolean DEFAULT false;
