-- ============================================================
-- 여소남 OS: Advanced Search Analytics
-- Migration: 20260401120000
--
-- 신규 테이블 (3개):
--   abandonment_tracking (이탈 지점 분석)
--   search_queries (검색 쿼리 분석 + 롱테일 키워드)
--   page_engagement_detailed (페이지 체류 시간 상세)
--
-- 참고: search_sessions_detailed, product_comparison_events는
--       20260401110000에서 이미 생성됨 → 건너뜀
-- ============================================================

BEGIN;

-- ============================================================
-- 1. 이탈 지점 분석
-- ============================================================
CREATE TABLE IF NOT EXISTS abandonment_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,

  -- 이탈 정보
  page_url TEXT NOT NULL,
  abandonment_type TEXT CHECK (abandonment_type IN ('exit','back_button','rage_click','long_idle','tab_close')),
  abandonment_stage TEXT CHECK (abandonment_stage IN ('product_list','product_detail','inquiry_form','payment','checkout')),

  -- 컨텍스트
  scroll_depth_percent SMALLINT,
  time_on_page_seconds INTEGER,
  clicks_before_exit INTEGER,
  form_completion_percent SMALLINT,

  context JSONB DEFAULT '{}',

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abandonment_stage ON abandonment_tracking(abandonment_stage);
CREATE INDEX IF NOT EXISTS idx_abandonment_package ON abandonment_tracking(package_id);
CREATE INDEX IF NOT EXISTS idx_abandonment_session ON abandonment_tracking(session_id);
CREATE INDEX IF NOT EXISTS idx_abandonment_created ON abandonment_tracking(created_at DESC);

-- ============================================================
-- 2. 검색 쿼리 분석 (롱테일 키워드 발굴)
-- ============================================================
CREATE TABLE IF NOT EXISTS search_queries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- 검색어
  query_text TEXT NOT NULL,
  query_normalized TEXT,
  query_tokens TEXT[] DEFAULT '{}',

  -- 검색 결과
  results_count INTEGER DEFAULT 0,
  results_shown UUID[] DEFAULT '{}',
  clicked_results UUID[] DEFAULT '{}',

  -- 전환
  led_to_conversion BOOLEAN DEFAULT false,
  conversion_package_id UUID REFERENCES travel_packages(id) ON DELETE SET NULL,

  -- 필터
  filters_applied JSONB DEFAULT '{}',
  sort_order TEXT,

  created_at TIMESTAMPTZ DEFAULT now()
);

-- GIN 인덱스: Supabase에서 'korean' 사전 미지원 → 'simple' 사용
CREATE INDEX IF NOT EXISTS idx_search_queries_text ON search_queries USING GIN (to_tsvector('simple', query_text));
CREATE INDEX IF NOT EXISTS idx_search_queries_normalized ON search_queries(query_normalized);
CREATE INDEX IF NOT EXISTS idx_search_queries_conversion ON search_queries(led_to_conversion) WHERE led_to_conversion = true;
CREATE INDEX IF NOT EXISTS idx_search_queries_created ON search_queries(created_at DESC);

-- ============================================================
-- 3. 페이지 체류 시간 상세 추적
-- ============================================================
CREATE TABLE IF NOT EXISTS page_engagement_detailed (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

  -- 페이지
  page_url TEXT NOT NULL,
  page_type TEXT CHECK (page_type IN ('home','product_list','product_detail','about','blog','chat','inquiry','checkout','other')),
  page_title TEXT,

  -- 참여 지표
  time_on_page_seconds INTEGER,
  scroll_depth_percent SMALLINT,

  -- 인터랙션
  clicks_count INTEGER DEFAULT 0,
  links_clicked TEXT[] DEFAULT '{}',
  buttons_clicked TEXT[] DEFAULT '{}',
  images_viewed TEXT[] DEFAULT '{}',
  videos_played TEXT[] DEFAULT '{}',

  -- 망설임 지표
  hesitation_time_seconds INTEGER,
  rage_clicks INTEGER DEFAULT 0,
  error_encounters INTEGER DEFAULT 0,

  -- 디바이스
  device_type TEXT CHECK (device_type IN ('mobile','tablet','desktop')),
  browser TEXT,
  viewport_width SMALLINT,
  viewport_height SMALLINT,

  created_at TIMESTAMPTZ DEFAULT now(),
  exited_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_page_engage_type ON page_engagement_detailed(page_type);
CREATE INDEX IF NOT EXISTS idx_page_engage_session ON page_engagement_detailed(session_id);
CREATE INDEX IF NOT EXISTS idx_page_engage_created ON page_engagement_detailed(created_at DESC);

-- ============================================================
-- RLS 정책
-- ============================================================
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'abandonment_tracking', 'search_queries', 'page_engagement_detailed'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('DROP POLICY IF EXISTS "authenticated_access" ON %I', tbl);
    EXECUTE format('CREATE POLICY "authenticated_access" ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)', tbl);
  END LOOP;
END $$;

COMMIT;
