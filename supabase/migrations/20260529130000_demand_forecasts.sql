-- 여소남 OS — 취소/수요 예측
-- Phase 2-2: Python 배치 파이프라인 결과 저장

CREATE TABLE IF NOT EXISTS demand_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type TEXT NOT NULL CHECK (target_type IN ('destination', 'hotel', 'package')),
  target_id TEXT NOT NULL,
  forecast_date DATE NOT NULL,
  predicted_demand_lo NUMERIC,
  predicted_demand_mid NUMERIC,
  predicted_demand_hi NUMERIC,
  confidence NUMERIC CHECK (confidence >= 0 AND confidence <= 1),
  model_version TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_demand_forecasts_target ON demand_forecasts(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_demand_forecasts_date ON demand_forecasts(forecast_date);
CREATE INDEX IF NOT EXISTS idx_demand_forecasts_created ON demand_forecasts(created_at DESC);

-- RLS (어드민 전용)
ALTER TABLE demand_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY demand_forecasts_select ON demand_forecasts
  FOR SELECT USING (auth.role() = 'service_role' OR auth.role() = 'authenticated');
CREATE POLICY demand_forecasts_insert ON demand_forecasts
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- 취소율 예측 결과 테이블 (선택적 — 필요시 사용)
CREATE TABLE IF NOT EXISTS cancellation_predictions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID,
  cancellation_probability NUMERIC CHECK (cancellation_probability >= 0 AND cancellation_probability <= 1),
  risk_level TEXT CHECK (risk_level IN ('low', 'medium', 'high')),
  top_reason TEXT,
  model_version TEXT,
  feature_snapshot JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cancel_pred_booking ON cancellation_predictions(booking_id);
CREATE INDEX IF NOT EXISTS idx_cancel_pred_risk ON cancellation_predictions(risk_level);
