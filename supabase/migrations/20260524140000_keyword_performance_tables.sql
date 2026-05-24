-- ============================================================
-- 여소남 키워드 광고 성과 테이블
-- Phase 1: 데이터 파이프라인 구축 (2026 H2)
-- 키워드 단위의 정밀 성과 추적을 위한 테이블
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. keyword_performance_daily — 키워드 단위 일별 성과
--    Google Ads / Naver SearchAd 키워드 레벨 데이터
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keyword_performance_daily (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_text    TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('google', 'naver')),
  date            DATE NOT NULL,

  -- 노출/클릭
  impressions     INTEGER DEFAULT 0,
  clicks          INTEGER DEFAULT 0,
  ctr             DECIMAL(8,4),         -- %

  -- 비용
  cost_micros     BIGINT DEFAULT 0,      -- Google: micros 단위
  cost_krw        INTEGER DEFAULT 0,     -- Naver: 원 단위
  avg_cpc         INTEGER DEFAULT 0,     -- 원 단위

  -- 전환
  conversions     DECIMAL(10,2) DEFAULT 0,
  conversion_value DECIMAL(12,2) DEFAULT 0,
  roas            DECIMAL(10,2),         -- conversion_value / cost

  -- 포지션/점유율
  avg_position    DECIMAL(3,1),
  impression_share DECIMAL(5,4),

  -- 메타데이터
  campaign_id     TEXT,
  ad_group_id     TEXT,
  keyword_id      TEXT,                   -- 플랫폼 키워드 ID
  match_type      TEXT CHECK (match_type IN ('exact', 'phrase', 'broad', 'auto')),

  created_at      TIMESTAMPTZ DEFAULT now(),

  UNIQUE (keyword_text, platform, date)
);

CREATE INDEX IF NOT EXISTS idx_kpd_date        ON keyword_performance_daily(date);
CREATE INDEX IF NOT EXISTS idx_kpd_keyword     ON keyword_performance_daily(keyword_text);
CREATE INDEX IF NOT EXISTS idx_kpd_platform    ON keyword_performance_daily(platform);
CREATE INDEX IF NOT EXISTS idx_kpd_kw_platform ON keyword_performance_daily(keyword_text, platform);
CREATE INDEX IF NOT EXISTS idx_kpd_date_range  ON keyword_performance_daily(date, platform);


-- ══════════════════════════════════════════════════════════════
-- 2. keyword_search_terms — 검색어 (Search Terms) 저장
--    Google Ads Search Terms View 데이터
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keyword_search_terms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     TEXT,
  ad_group_id     TEXT,
  keyword_text    TEXT,                   -- 타겟 키워드
  search_term     TEXT NOT NULL,          -- 실제 검색어
  match_type      TEXT CHECK (match_type IN ('exact', 'phrase', 'broad', 'auto')),

  -- 성과
  impressions     INTEGER DEFAULT 0,
  clicks          INTEGER DEFAULT 0,
  ctr             DECIMAL(8,4),
  cost_krw        INTEGER DEFAULT 0,
  conversions     DECIMAL(10,2) DEFAULT 0,

  -- 조치 상태
  is_added_as_keyword   BOOLEAN DEFAULT FALSE,
  is_added_as_negative   BOOLEAN DEFAULT FALSE,
  is_reviewed           BOOLEAN DEFAULT FALSE,

  first_seen      DATE NOT NULL,
  last_seen       DATE,
  platform        TEXT NOT NULL CHECK (platform IN ('google', 'naver')),

  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kst_search_term  ON keyword_search_terms(search_term);
CREATE INDEX IF NOT EXISTS idx_kst_keyword      ON keyword_search_terms(keyword_text);
CREATE INDEX IF NOT EXISTS idx_kst_first_seen   ON keyword_search_terms(first_seen);
CREATE INDEX IF NOT EXISTS idx_kst_unreviewed   ON keyword_search_terms(is_reviewed) WHERE is_reviewed = FALSE;


-- ══════════════════════════════════════════════════════════════
-- 3. keyword_historical_metrics — 월별 검색량/경쟁도 히스토리
--    Google Keyword Planner / Naver DataLab 데이터
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS keyword_historical_metrics (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword_text       TEXT NOT NULL,
  year               SMALLINT NOT NULL,
  month              SMALLINT NOT NULL CHECK (month BETWEEN 1 AND 12),
  platform           TEXT NOT NULL CHECK (platform IN ('google', 'naver')),

  -- 검색량
  avg_monthly_searches  INTEGER DEFAULT 0,
  competition           TEXT CHECK (competition IN ('LOW', 'MEDIUM', 'HIGH')),
  competition_index     SMALLINT,         -- 1-100

  -- 입찰가 참고
  low_top_of_page_bid   INTEGER,          -- 원
  high_top_of_page_bid  INTEGER,          -- 원

  -- 메타
  trend_direction       TEXT CHECK (trend_direction IN ('rising', 'falling', 'stable')),
  year_over_year_change DECIMAL(6,2),     -- % 변화

  fetched_at          TIMESTAMPTZ DEFAULT now(),

  UNIQUE (keyword_text, year, month, platform)
);

CREATE INDEX IF NOT EXISTS idx_khm_keyword    ON keyword_historical_metrics(keyword_text);
CREATE INDEX IF NOT EXISTS idx_khm_period     ON keyword_historical_metrics(year, month);
CREATE INDEX IF NOT EXISTS idx_khm_platform   ON keyword_historical_metrics(platform);


-- ══════════════════════════════════════════════════════════════
-- 4. optimization_log — 모든 자동/수동 최적화 액션 로그
--    Phase 2+의 AI 의사결정 추적의 기반
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS optimization_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action          TEXT NOT NULL CHECK (action IN (
    'bid_increase', 'bid_decrease',
    'pause', 'activate', 'archive',
    'add_negative', 'remove_negative',
    'add_keyword', 'remove_keyword',
    'budget_change', 'strategy_change',
    'campaign_pause', 'campaign_activate',
    'tier_change', 'match_type_change'
  )),
  platform        TEXT NOT NULL CHECK (platform IN ('google', 'naver', 'meta')),

  -- 대상
  keyword_text    TEXT,
  campaign_id     TEXT,
  ad_group_id     TEXT,
  keyword_id      TEXT,

  -- 변경값
  old_value       TEXT,
  new_value       TEXT,
  reason          TEXT,

  -- 출처
  triggered_by    TEXT NOT NULL CHECK (triggered_by IN ('rule', 'ai', 'manual')) DEFAULT 'manual',

  -- 메타
  executed_at     TIMESTAMPTZ DEFAULT now(),
  success         BOOLEAN DEFAULT TRUE,
  error_message   TEXT,
  metadata        JSONB
);

CREATE INDEX IF NOT EXISTS idx_ol_executed     ON optimization_log(executed_at);
CREATE INDEX IF NOT EXISTS idx_ol_keyword      ON optimization_log(keyword_text);
CREATE INDEX IF NOT EXISTS idx_ol_action       ON optimization_log(action);
CREATE INDEX IF NOT EXISTS idx_ol_triggered_by ON optimization_log(triggered_by);
CREATE INDEX IF NOT EXISTS idx_ol_platform     ON optimization_log(platform);


-- ══════════════════════════════════════════════════════════════
-- 5. budget_history — 일/월별 예산 집행 내역
--    예산 변경 이유 추적 (시즌, AI 최적화, 수동)
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS budget_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        TEXT NOT NULL CHECK (platform IN ('google', 'naver', 'meta')),
  campaign_id     TEXT,
  campaign_name   TEXT,
  date            DATE NOT NULL,

  -- 예산
  budget_amount   INTEGER NOT NULL,       -- 설정 예산 (원)
  spend           INTEGER DEFAULT 0,      -- 실제 소진 (원)

  -- 구분
  reason          TEXT,                    -- 'seasonal_adjustment', 'ai_optimization', 'manual', 'initial'
  note            TEXT,

  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bh_date        ON budget_history(date);
CREATE INDEX IF NOT EXISTS idx_bh_platform    ON budget_history(platform);
CREATE INDEX IF NOT EXISTS idx_bh_campaign    ON budget_history(campaign_id);


-- ══════════════════════════════════════════════════════════════
-- 6. 최적화 RLS 정책 (service_role 전체 접근, authenticated 읽기)
-- ══════════════════════════════════════════════════════════════

ALTER TABLE keyword_performance_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_search_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_historical_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE optimization_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_history ENABLE ROW LEVEL SECURITY;

-- service_role: 모든 작업 허용 (백엔드 API)
DO $$ BEGIN
  DROP POLICY IF EXISTS "service_keyword_performance_daily_all" ON keyword_performance_daily;
  DROP POLICY IF EXISTS "service_keyword_search_terms_all" ON keyword_search_terms;
  DROP POLICY IF EXISTS "service_keyword_historical_metrics_all" ON keyword_historical_metrics;
  DROP POLICY IF EXISTS "service_optimization_log_all" ON optimization_log;
  DROP POLICY IF EXISTS "service_budget_history_all" ON budget_history;
END $$;

CREATE POLICY "service_keyword_performance_daily_all"
  ON keyword_performance_daily FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_keyword_search_terms_all"
  ON keyword_search_terms FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_keyword_historical_metrics_all"
  ON keyword_historical_metrics FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_optimization_log_all"
  ON optimization_log FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_budget_history_all"
  ON budget_history FOR ALL TO service_role USING (true) WITH CHECK (true);

-- authenticated: 읽기 전용 (관리자 대시보드)
CREATE POLICY "auth_keyword_performance_daily_read"
  ON keyword_performance_daily FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_keyword_search_terms_read"
  ON keyword_search_terms FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_keyword_historical_metrics_read"
  ON keyword_historical_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_optimization_log_read"
  ON optimization_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_budget_history_read"
  ON budget_history FOR SELECT TO authenticated USING (true);


-- ══════════════════════════════════════════════════════════════
-- 7. 성능 인덱스 (쿼리 패턴 기반)
-- ══════════════════════════════════════════════════════════════

-- keyword_performance_daily: 일/주/월 범위 조회
CREATE INDEX IF NOT EXISTS idx_kpd_weekly
  ON keyword_performance_daily(date, platform, impressions DESC);

-- keyword_search_terms: 미검토 검색어 우선 조회
CREATE INDEX IF NOT EXISTS idx_kst_review_priority
  ON keyword_search_terms(last_seen DESC NULLS LAST, impressions DESC)
  WHERE is_reviewed = FALSE;

-- optimization_log: 최근 액션 조회
CREATE INDEX IF NOT EXISTS idx_ol_recent
  ON optimization_log(executed_at DESC)
  WHERE triggered_by IN ('rule', 'ai');


-- ══════════════════════════════════════════════════════════════
-- 8. 초기 데이터: 키워드 Tier 정의 참고용
--    (seed data — 실제 키워드는 keyword-brain에서 관리)
-- ══════════════════════════════════════════════════════════════

INSERT INTO app_settings (key, value, description)
VALUES
  ('keyword_core_min_bid',    '500',   '핵심 키워드 최소 입찰가 (원)'),
  ('keyword_mid_min_bid',     '300',   '중간 키워드 최소 입찰가 (원)'),
  ('keyword_longtail_bid',    '200',   '롱테일 키워드 입찰가 (원)'),
  ('keyword_micro_bid',       '100',   '마이크로 키워드 입찰가 (원)'),
  ('keyword_optimization_interval_hours', '24', '최적화 루프 실행 간격 (시간)'),
  ('keyword_min_ctr_to_keep', '0.5',   '키워드 유지 최소 CTR (%)'),
  ('keyword_min_roas_to_keep','1.0',   '키워드 유지 최소 ROAS'),
  ('search_terms_review_interval_days', '7', '검색어 검토 주기 (일)')
ON CONFLICT (key) DO NOTHING;


-- 확인
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('keyword_performance_daily','keyword_search_terms','keyword_historical_metrics','optimization_log','budget_history')
ORDER BY table_name;
