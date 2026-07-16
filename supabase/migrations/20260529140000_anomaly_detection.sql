-- Yeosonam OS anomaly detection views (Phase 2-3).
-- Historical clean-room fix: keep the original intent, but align to the
-- canonical settlements schema and create the views explicitly.

-- 1. Settlement amount anomaly detection.
CREATE OR REPLACE VIEW anomaly_settlement_alerts AS
WITH stats AS (
  SELECT
    tenant_id,
    AVG(total_amount) AS avg_amount,
    STDDEV(total_amount) AS stddev_amount,
    COUNT(*) AS n
  FROM settlements
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY tenant_id
)
SELECT
  s.id AS settlement_id,
  s.tenant_id,
  s.total_amount AS amount,
  st.avg_amount,
  st.stddev_amount,
  CASE
    WHEN st.stddev_amount > 0 AND ABS(s.total_amount - st.avg_amount) > 3 * st.stddev_amount THEN 'CRITICAL'
    WHEN st.stddev_amount > 0 AND ABS(s.total_amount - st.avg_amount) > 2 * st.stddev_amount THEN 'WARNING'
    ELSE 'NORMAL'
  END AS anomaly_level,
  ROUND(ABS(s.total_amount - st.avg_amount) / NULLIF(st.stddev_amount, 0), 2) AS z_score,
  NOW() AS detected_at
FROM settlements s
JOIN stats st ON s.tenant_id = st.tenant_id
WHERE s.created_at >= NOW() - INTERVAL '7 days'
  AND st.n >= 5
  AND (
    (st.stddev_amount > 0 AND ABS(s.total_amount - st.avg_amount) > 2 * st.stddev_amount)
    OR s.total_amount <= 0
  )
ORDER BY anomaly_level DESC, z_score DESC;

-- 2. Commission anomaly detection.
CREATE OR REPLACE VIEW anomaly_commission_alerts AS
WITH stats AS (
  SELECT
    affiliate_id,
    AVG(COALESCE(influencer_commission, commission_amount, 0)) AS avg_commission,
    STDDEV(COALESCE(influencer_commission, commission_amount, 0)) AS stddev_commission,
    COUNT(*) AS n
  FROM bookings
  WHERE created_at >= NOW() - INTERVAL '30 days'
    AND affiliate_id IS NOT NULL
  GROUP BY affiliate_id
)
SELECT
  b.id AS commission_id,
  b.affiliate_id,
  b.id AS booking_id,
  COALESCE(b.influencer_commission, b.commission_amount, 0) AS commission_amount,
  st.avg_commission,
  st.stddev_commission,
  CASE
    WHEN st.stddev_commission > 0 AND ABS(COALESCE(b.influencer_commission, b.commission_amount, 0) - st.avg_commission) > 3 * st.stddev_commission THEN 'CRITICAL'
    WHEN st.stddev_commission > 0 AND ABS(COALESCE(b.influencer_commission, b.commission_amount, 0) - st.avg_commission) > 2 * st.stddev_commission THEN 'WARNING'
    ELSE 'NORMAL'
  END AS anomaly_level,
  ROUND(ABS(COALESCE(b.influencer_commission, b.commission_amount, 0) - st.avg_commission) / NULLIF(st.stddev_commission, 0), 2) AS z_score,
  NOW() AS detected_at
FROM bookings b
JOIN stats st ON b.affiliate_id = st.affiliate_id
WHERE b.created_at >= NOW() - INTERVAL '7 days'
  AND st.n >= 5
  AND (
    (st.stddev_commission > 0 AND ABS(COALESCE(b.influencer_commission, b.commission_amount, 0) - st.avg_commission) > 2 * st.stddev_commission)
    OR COALESCE(b.influencer_commission, b.commission_amount, 0) < 0
  )
ORDER BY anomaly_level DESC, z_score DESC;

-- 3. Booking volume surge/drop detection.
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
ORDER BY ABS(ROUND((d.cnt - b.avg_daily) / NULLIF(b.stddev_daily, 0), 2)) DESC;

-- 4. Unified anomaly alert log table for persisted ML/manual findings.
CREATE TABLE IF NOT EXISTS anomaly_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  source_table TEXT,
  source_id UUID,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  message TEXT,
  details JSONB DEFAULT '{}',
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID REFERENCES admin_users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_type ON anomaly_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_severity ON anomaly_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_tenant ON anomaly_alerts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_created ON anomaly_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_unacknowledged ON anomaly_alerts(acknowledged_at) WHERE acknowledged_at IS NULL;

ALTER TABLE anomaly_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anomaly_alerts_select ON anomaly_alerts;
CREATE POLICY anomaly_alerts_select ON anomaly_alerts
  FOR SELECT USING (auth.role() IN ('service_role', 'authenticated'));
DROP POLICY IF EXISTS anomaly_alerts_insert ON anomaly_alerts;
CREATE POLICY anomaly_alerts_insert ON anomaly_alerts
  FOR INSERT WITH CHECK (auth.role() = 'service_role');
