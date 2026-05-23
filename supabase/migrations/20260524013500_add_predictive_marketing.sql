-- ============================================================
-- Predictive Marketing Engine — 예측 인사이트·키워드 트렌드 스냅샷
-- ============================================================
-- 1. predictive_insights — AI 예측 인사이트 저장 (대시보드 표시 + auto-queue)
-- 2. keyword_trend_snapshots — 일별 키워드 트렌드 시계열 (GSC + Naver DataLab)
-- ============================================================

BEGIN;

-- ─── 1) predictive_insights ─────────────────────────────────

CREATE TABLE IF NOT EXISTS predictive_insights (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  insight_type TEXT NOT NULL CHECK (insight_type IN (
    'content_opportunity', 'ad_optimization', 'seasonal_preparation', 'trend_alert'
  )),
  title TEXT NOT NULL,
  description TEXT,
  keyword TEXT,
  destination TEXT,
  trend_direction TEXT,
  change_percent NUMERIC(10,2),
  recommendation TEXT,
  suggested_action TEXT,
  estimated_impact TEXT,
  priority INTEGER DEFAULT 50,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'actioned', 'dismissed', 'expired')),
  actioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_predictive_insights_priority
  ON predictive_insights(priority DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictive_insights_status
  ON predictive_insights(status);
CREATE INDEX IF NOT EXISTS idx_predictive_insights_type
  ON predictive_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_predictive_insights_keyword
  ON predictive_insights(keyword) WHERE keyword IS NOT NULL;

COMMENT ON TABLE predictive_insights IS 'AI 예측 마케팅 인사이트 — GSC/트렌드 분석 결과 저장, 대시보드 표시 및 auto-queue 대상';
COMMENT ON COLUMN predictive_insights.insight_type IS 'content_opportunity=블로그 기회, ad_optimization=광고 최적화, seasonal_preparation=시즌 준비, trend_alert=트렌드 경보';
COMMENT ON COLUMN predictive_insights.priority IS '1-100, 높을수록 긴급';
COMMENT ON COLUMN predictive_insights.status IS 'pending=대기, actioned=조치 완료, dismissed=무시, expired=만료';

-- ─── 2) keyword_trend_snapshots ─────────────────────────────

CREATE TABLE IF NOT EXISTS keyword_trend_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  keyword TEXT NOT NULL,
  destination TEXT,
  date DATE NOT NULL,
  search_volume INTEGER DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  avg_position NUMERIC(5,2),
  competitors_count INTEGER,
  trend_score NUMERIC(5,2),  -- -1 to 1
  snapshot_date TIMESTAMPTZ DEFAULT now(),
  UNIQUE(keyword, date)
);

CREATE INDEX IF NOT EXISTS idx_keyword_trends_keyword
  ON keyword_trend_snapshots(keyword);
CREATE INDEX IF NOT EXISTS idx_keyword_trends_date
  ON keyword_trend_snapshots(date);
CREATE INDEX IF NOT EXISTS idx_keyword_trends_dest
  ON keyword_trend_snapshots(destination) WHERE destination IS NOT NULL;

COMMENT ON TABLE keyword_trend_snapshots IS '일별 키워드 트렌드 스냅샷 — GSC/Naver DataLab 수집 결과 누적, 시계열 예측용';
COMMENT ON COLUMN keyword_trend_snapshots.trend_score IS '-1(급락) ~ 1(급등), 이동평균 기반 정규화 점수';

-- ─── 3) RLS (service_role 전용 — 내부 엔진) ────────────────

ALTER TABLE predictive_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_trend_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "predictive_insights service" ON predictive_insights;
CREATE POLICY "predictive_insights service" ON predictive_insights
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "predictive_insights read" ON predictive_insights;
CREATE POLICY "predictive_insights read" ON predictive_insights
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "keyword_trend_snapshots service" ON keyword_trend_snapshots;
CREATE POLICY "keyword_trend_snapshots service" ON keyword_trend_snapshots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "keyword_trend_snapshots read" ON keyword_trend_snapshots;
CREATE POLICY "keyword_trend_snapshots read" ON keyword_trend_snapshots
  FOR SELECT USING (true);

COMMIT;
