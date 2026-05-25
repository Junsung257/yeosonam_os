-- SEO 모니터링: 일일 GSC 스냅샷 + 알림
-- 실시간 SEO 모니터링 (순위 변동·트래픽 알림·알고리즘 업데이트 감지)

CREATE TABLE IF NOT EXISTS seo_daily_snapshots (
  date date PRIMARY KEY,
  total_clicks integer NOT NULL DEFAULT 0,
  total_impressions integer NOT NULL DEFAULT 0,
  avg_ctr numeric NOT NULL DEFAULT 0,
  avg_position numeric NOT NULL DEFAULT 0,
  top_keywords jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seo_alerts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('traffic_drop','ranking_drop','algorithm_update')),
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  title text NOT NULL,
  message text NOT NULL,
  metrics jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 동일 타입 + 동일 날짜 중복 알림 방지
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_alerts_dedup
  ON seo_alerts (type, (created_at::date));

ALTER TABLE seo_daily_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "seo_snapshots_authenticated_read" ON seo_daily_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "seo_snapshots_service_insert" ON seo_daily_snapshots
  FOR INSERT TO service_role WITH CHECK (true);
CREATE POLICY "seo_snapshots_service_update" ON seo_daily_snapshots
  FOR UPDATE TO service_role USING (true);

CREATE POLICY "seo_alerts_authenticated_read" ON seo_alerts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "seo_alerts_service_insert" ON seo_alerts
  FOR INSERT TO service_role WITH CHECK (true);
