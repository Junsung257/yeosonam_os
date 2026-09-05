-- keyword_pool: 트렌드·DataLab 등에서 수집한 키워드 원장 (큐 승격 전 단계)
CREATE TABLE IF NOT EXISTS keyword_pool (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword               TEXT NOT NULL,
  source                TEXT NOT NULL,
  related_destination   TEXT,
  trend_score           NUMERIC(5,2),
  search_intent         TEXT CHECK (search_intent IS NULL OR search_intent IN ('informational','commercial','mixed')),
  collected_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  promoted_at           TIMESTAMPTZ,
  raw                   JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_keyword_pool_collected ON keyword_pool(collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_keyword_pool_keyword ON keyword_pool(keyword);
CREATE INDEX IF NOT EXISTS idx_keyword_pool_unpromoted ON keyword_pool(collected_at) WHERE promoted_at IS NULL;

ALTER TABLE keyword_pool ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "allow_all_keyword_pool" ON keyword_pool;
CREATE POLICY "allow_all_keyword_pool" ON keyword_pool FOR ALL USING (true) WITH CHECK (true);

COMMENT ON TABLE keyword_pool IS 'pSEO 시드 — 트렌드/연관 키워드 적재 후 blog_topic_queue 승격 시 promoted_at 기록';
