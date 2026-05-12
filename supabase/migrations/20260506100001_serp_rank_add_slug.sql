-- serp_rank_snapshots에 slug 컬럼 추가 — rank_history(slug 기반)와 JOIN 가능하도록
-- rank_history는 slug 기반(GSC), serp_rank_snapshots는 keyword 기반(SerpAPI) → 통합 대시보드를 위해 연결

ALTER TABLE serp_rank_snapshots
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- 키워드별 slug 추적 인덱스 (slug로 GSC JOIN 시 사용)
CREATE INDEX IF NOT EXISTS idx_serp_rank_slug ON serp_rank_snapshots(slug)
  WHERE slug IS NOT NULL;

COMMENT ON COLUMN serp_rank_snapshots.slug IS '블로그 slug — rank_history와 JOIN 키. SerpAPI로 외부 순위 추적 시 대상 페이지 slug를 함께 기록';
