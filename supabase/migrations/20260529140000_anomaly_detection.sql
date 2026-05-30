-- 여소남 OS — 이상 징후 탐지 (Phase 2-3)
-- 정산 금액/커미션/예약 패턴의 통계적 이상 감지

-- 1. 정산 이상 탐지 뷰
CREATE OR REPLACE VIEW anomaly_settlement_alerts AS
WITH stats AS (
  SELECT
    tenant_id,
    AVG(amount) AS avg_amount,
    STDDEV(amount) AS stddev_amount,
    COUNT(*) AS n
  FROM settlements
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY tenant_id
)
SELECT
  s.id AS settlement_id,
  s.tenant_id,
  s.amount,
  st.avg_amount,
  st.stddev_amount,
  CASE
    WHEN st.stddev_amount > 0 AND ABS(s.amount - st.avg_amount) > 3 * st.stddev_amount THEN 'CRITICAL'
    WHEN st.stddev_amount > 0 AND ABS(s.amount - st.avg_amount) > 2 * st.stddev_amount THEN 'WARNING'
    ELSE 'NORMAL'
  END AS anomaly_level,
  ROUND(ABS(s.amount - st.avg_amount) / NULLIF(st.stddev_amount, 0), 2) AS z_score,
  NOW() AS detected_at
FROM settlements s
JOIN stats st ON s.tenant_id = st.tenant_id
WHERE s.created_at >= NOW() - INTERVAL '7 days'
  AND st.n >= 5  -- 통계적 의미를 위해 최소 5건 필요
  AND (
    (st.stddev_amount > 0 AND ABS(s.amount - st.avg_amount) > 2 * st.stddev_amount)
    OR s.amount <= 0
  )
ORDER BY anomaly_level DESC, z_score DESC;

-- 2. 커미션 이상 탐지 뷰
CREATE OR REPLACE VIEW anomaly_commission_alerts AS
WITH stats AS (
  SELECT
    affiliate_id,
    AVG(commission_amount) AS avg_commission,
    STDDEV(commission_amount) AS stddev_commission,
    COUNT(*) AS n
  FROM commission_logs
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY affiliate_id
)
SELECT
  cl.id AS commission_id,
  cl.affiliate_id,
  cl.booking_id,
  cl.commission_amount,
  st.avg_commission,
  st.stddev_commission,
  CASE
    WHEN st.stddev_commission > 0 AND ABS(cl.commission_amount - st.avg_commission) > 3 * st.stddev_commission THEN 'CRITICAL'
    WHEN st.stddev_commission > 0 AND ABS(cl.commission_amount - st.avg_commission) > 2 * st.stddev_commission THEN 'WARNING'
    ELSE 'NORMAL'
  END AS anomaly_level,
  ROUND(ABS(cl.commission_amount - st.avg_commission) / NULLIF(st.stddev_commission, 0), 2) AS z_score,
  NOW() AS detected_at
FROM commission_logs cl
JOIN stats st ON cl.affiliate_id = st.affiliate_id
WHERE cl.created_at >= NOW() - INTERVAL '7 days'
  AND st.n >= 5
  AND (
    (st.stddev_commission > 0 AND ABS(cl.commission_amount - st.avg_commission) > 2 * st.stddev_commission)
    OR cl.commission_amount < 0
  )
ORDER BY anomaly_level DESC, z_score DESC;

-- 3. 예약 급증/급감 탐지 뷰
CREATE OR REPLACE VIEW anomaly_booking_volume_alerts AS
WITH daily AS (
  SELECT
    DATE(created_at) AS day,
    COUNT(*) AS cnt
  FROM bookings
  WHERE created_at >= NOW() - INTERVAL '14 days'
  GROUP BY DATE(created_at)
),
baseline AS (
  SELECT AVG(cnt) AS avg_daily, STDDEV(cnt) AS stddev_daily
  FROM daily
  WHERE day < CURRENT_DATE - 1
)
SELECT
  d.day,
  d.cnt,
  b.avg_daily,
  b.stddev_daily,
  CASE
    WHEN b.stddev_daily > 0 AND (d.cnt - b.avg_daily) > 2 * b.stddev_daily THEN 'SURGE'
    WHEN b.stddev_daily > 0 AND (b.avg_daily - d.cnt) > 2 * b.stddev_daily THEN 'DROP'
    ELSE 'NORMAL'
  END AS alert_type,
  ROUND((d.cnt - b.avg_daily) / NULLIF(b.stddev_daily, 0), 2) AS z_score,
  NOW() AS detected_at
FROM daily d, baseline b
WHERE d.day >= CURRENT_DATE - 1
  AND b.stddev_daily > 0
  AND ABS(d.cnt - b.avg_daily) > 1.5 * b.stddev_daily
ORDER BY ABS(z_score) DESC;

-- 4. anomaly_alerts 통합 로그 테이블 (Python ML 모델 결과도 여기 저장)
CREATE TABLE IF NOT EXISTS anomaly_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,        -- 'settlement' | 'commission' | 'booking_volume' | 'ml_anomaly'
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  source_table TEXT,
  source_id UUID,
  tenant_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  message TEXT,
  details JSONB DEFAULT '{}',
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_type ON anomaly_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_severity ON anomaly_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_tenant ON anomaly_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_created ON anomaly_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_unacknowledged ON anomaly_alerts(acknowledged_at) WHERE acknowledged_at IS NULL;

ALTER TABLE anomaly_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY anomaly_alerts_select ON anomaly_alerts
  FOR SELECT USING (auth.role() IN ('service_role', 'authenticated'));
CREATE POLICY anomaly_alerts_insert ON anomaly_alerts
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
