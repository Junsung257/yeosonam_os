-- ============================================================
-- Blog Topic Queue — Keyword Intelligence + Trend Source (2026-04-30)
-- ============================================================
-- 목적:
--   1) source enum 에 'trend','pillar' 추가
--   2) blog_topic_queue 에 키워드 강도 메타데이터 (tier·volume·competition) 추가
--   3) 트렌드 마이너 결과 영구 보관용 trend_keyword_archive 테이블
--   4) keyword_research_cache (Naver DataLab/Google Trends 응답 캐시 — 같은 키워드 재조회 비용 절감)
-- ============================================================

-- 1) source CHECK 확장
ALTER TABLE blog_topic_queue DROP CONSTRAINT IF EXISTS blog_topic_queue_source_check;
ALTER TABLE blog_topic_queue ADD CONSTRAINT blog_topic_queue_source_check
  CHECK (source IN ('seasonal','coverage_gap','user_seed','product','trend','pillar'));

-- 2) 키워드 강도 메타 컬럼
ALTER TABLE blog_topic_queue
  ADD COLUMN IF NOT EXISTS primary_keyword TEXT,
  ADD COLUMN IF NOT EXISTS keyword_tier TEXT
    CHECK (keyword_tier IS NULL OR keyword_tier IN ('head','mid','longtail')),
  ADD COLUMN IF NOT EXISTS monthly_search_volume INTEGER,
  ADD COLUMN IF NOT EXISTS competition_level TEXT
    CHECK (competition_level IS NULL OR competition_level IN ('low','medium','high')),
  ADD COLUMN IF NOT EXISTS trend_score NUMERIC(5,2);  -- 0~100, 트렌드 가중치

CREATE INDEX IF NOT EXISTS idx_btq_keyword_tier ON blog_topic_queue(keyword_tier);
CREATE INDEX IF NOT EXISTS idx_btq_source ON blog_topic_queue(source);

COMMENT ON COLUMN blog_topic_queue.keyword_tier IS 'head=brand/destination 단어, mid=2-3어절, longtail=4어절+초세부';
COMMENT ON COLUMN blog_topic_queue.trend_score IS '트렌드 마이너 0-100점, NULL=non-trend';

-- 3) 트렌드 키워드 아카이브 (마이너가 매일 INSERT, 시계열 분석용)
CREATE TABLE IF NOT EXISTS trend_keyword_archive (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  observed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  source          TEXT         NOT NULL,  -- 'google_trends' | 'naver_datalab' | 'naver_news'
  keyword         TEXT         NOT NULL,
  related_destination TEXT,
  trend_score     NUMERIC(5,2),     -- 0~100
  search_volume   INTEGER,           -- 월간 검색량 추정
  competition_level TEXT
    CHECK (competition_level IS NULL OR competition_level IN ('low','medium','high')),
  raw             JSONB        DEFAULT '{}'::jsonb,
  used_at         TIMESTAMPTZ,       -- 토픽 큐로 변환된 시점
  topic_queue_id  UUID         REFERENCES blog_topic_queue(id) ON DELETE SET NULL,
  UNIQUE(observed_at, source, keyword)
);

CREATE INDEX IF NOT EXISTS idx_tka_observed ON trend_keyword_archive(observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tka_keyword ON trend_keyword_archive(keyword);
CREATE INDEX IF NOT EXISTS idx_tka_unused ON trend_keyword_archive(used_at) WHERE used_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tka_dest ON trend_keyword_archive(related_destination) WHERE related_destination IS NOT NULL;

-- 4) 키워드 리서치 응답 캐시 (24시간 TTL)
CREATE TABLE IF NOT EXISTS keyword_research_cache (
  keyword         TEXT         PRIMARY KEY,
  source          TEXT         NOT NULL,  -- 'naver_datalab' | 'google_trends_widget'
  monthly_search_volume INTEGER,
  competition_level TEXT
    CHECK (competition_level IS NULL OR competition_level IN ('low','medium','high')),
  related_queries TEXT[]       DEFAULT '{}'::text[],
  raw             JSONB        DEFAULT '{}'::jsonb,
  fetched_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_krc_fetched ON keyword_research_cache(fetched_at DESC);

-- 5) RLS
ALTER TABLE trend_keyword_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_research_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_tka" ON trend_keyword_archive FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_krc" ON keyword_research_cache FOR ALL USING (true) WITH CHECK (true);

-- 6) 색인 보고서 — notifyIndexing 결과 누적 (오토파일럿 모니터링)
CREATE TABLE IF NOT EXISTS indexing_reports (
  id              UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  url             TEXT         NOT NULL,
  content_creative_id UUID,
  google_status   TEXT         NOT NULL,  -- 'success' | 'failed' | 'skipped'
  google_error    TEXT,
  indexnow_status TEXT         NOT NULL,
  indexnow_error  TEXT,
  sitemap_pings   JSONB        DEFAULT '[]'::jsonb,
  duration_ms     INTEGER,
  reported_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ir_creative ON indexing_reports(content_creative_id);
CREATE INDEX IF NOT EXISTS idx_ir_reported ON indexing_reports(reported_at DESC);
CREATE INDEX IF NOT EXISTS idx_ir_failed ON indexing_reports(reported_at)
  WHERE google_status = 'failed' OR indexnow_status = 'failed';

ALTER TABLE indexing_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_ir" ON indexing_reports FOR ALL USING (true) WITH CHECK (true);
