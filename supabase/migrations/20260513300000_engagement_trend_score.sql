-- ============================================================================
-- PR-4: post_engagement_snapshots + card_news에 hook_type/archetype/trend_score 추가
-- ============================================================================
-- 목적: 학습 신호를 hook_type × design_archetype 단위로 분해 저장.
--   trend_score = 최근 3일 velocity − 이전 3일 velocity (sync-engagement에서 계산)
-- ============================================================================

-- post_engagement_snapshots 컬럼 추가
ALTER TABLE post_engagement_snapshots
  ADD COLUMN IF NOT EXISTS hook_type TEXT,
  ADD COLUMN IF NOT EXISTS design_archetype_id UUID REFERENCES card_news_design_archetypes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trend_score NUMERIC(7, 4),
  ADD COLUMN IF NOT EXISTS posting_hour SMALLINT;

CREATE INDEX IF NOT EXISTS idx_peng_hook_type
  ON post_engagement_snapshots (hook_type, captured_at DESC)
  WHERE hook_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_peng_archetype
  ON post_engagement_snapshots (design_archetype_id, captured_at DESC)
  WHERE design_archetype_id IS NOT NULL;

-- card_news 컬럼 추가 — 발행 시점 결정값 영구 저장
ALTER TABLE card_news
  ADD COLUMN IF NOT EXISTS hook_type TEXT,
  ADD COLUMN IF NOT EXISTS design_archetype_id UUID REFERENCES card_news_design_archetypes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS palette_category TEXT,
  ADD COLUMN IF NOT EXISTS posting_hour_kst SMALLINT;

CREATE INDEX IF NOT EXISTS idx_card_news_hook_type
  ON card_news (hook_type, ig_published_at DESC)
  WHERE hook_type IS NOT NULL;

-- ============================================================================
-- engagement_by_archetype_hook — 어드민 노출용 집계 뷰 (PR-4)
-- ============================================================================
CREATE OR REPLACE VIEW engagement_by_archetype_hook AS
SELECT
  COALESCE(s.hook_type, 'unknown')                                  AS hook_type,
  COALESCE(a.palette_category, 'unknown')                           AS palette_category,
  COALESCE(a.layout_type, 'unknown')                                AS layout_type,
  s.platform,
  COUNT(DISTINCT s.external_id)                                     AS post_count,
  AVG(s.performance_score) FILTER (WHERE s.performance_score IS NOT NULL) AS avg_performance,
  AVG(s.likes) FILTER (WHERE s.likes IS NOT NULL)                   AS avg_likes,
  AVG(s.saves) FILTER (WHERE s.saves IS NOT NULL)                   AS avg_saves,
  AVG(s.comments) FILTER (WHERE s.comments IS NOT NULL)             AS avg_comments,
  AVG(s.trend_score) FILTER (WHERE s.trend_score IS NOT NULL)       AS avg_trend_score,
  MAX(s.captured_at)                                                AS latest_captured_at
FROM post_engagement_snapshots s
LEFT JOIN card_news_design_archetypes a ON a.id = s.design_archetype_id
WHERE s.captured_at >= now() - interval '30 days'
GROUP BY 1, 2, 3, 4
HAVING COUNT(DISTINCT s.external_id) >= 1;

COMMENT ON VIEW engagement_by_archetype_hook IS
  'hook_type × archetype × platform 30일 집계. 어드민 대시보드 V4 + bandit reward 산정에 사용.';
