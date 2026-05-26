-- ============================================================
-- Threads 완전 자동화: content_plans + content_distributions 확장
-- 마이그레이션: 20260526150000
--
-- 1. content_plans 테이블 (Planner Agent의 계획 저장)
-- 2. content_distributions status 체크에 'ready' 추가
-- 3. travel_packages에 priority_score 칼럼 추가
-- ============================================================

BEGIN;

-- ─── 1. content_plans ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_plans (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_date         DATE NOT NULL,           -- 실행 예정일
  category          TEXT NOT NULL
    CHECK (category IN ('travel_tip', 'product_promo', 'brand_story', 'engagement')),
  priority_score    REAL DEFAULT 0,           -- 0.0 ~ 1.0
  status            TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'generating', 'completed', 'cancelled')),

  -- 연결 대상
  product_id        UUID REFERENCES travel_packages(id) ON DELETE SET NULL,
  card_news_id      UUID REFERENCES card_news(id) ON DELETE SET NULL,
  trend_keyword     TEXT,                    -- 어떤 트렌드 키워드 기반인지

  -- 생성 결과
  distribution_id   UUID REFERENCES content_distributions(id) ON DELETE SET NULL,

  -- 메타
  reason            TEXT,                    -- "출발 7일 전, 마진 상위, 긴급"
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_plan_date     ON content_plans(plan_date);
CREATE INDEX IF NOT EXISTS idx_cp_status        ON content_plans(status);
CREATE INDEX IF NOT EXISTS idx_cp_category      ON content_plans(category);
CREATE INDEX IF NOT EXISTS idx_cp_priority      ON content_plans(priority_score DESC);

COMMENT ON TABLE content_plans IS 'Threads Planner Agent — 일일 콘텐츠 발행 계획';

-- updated_at 트리거
CREATE OR REPLACE FUNCTION update_content_plans_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cp_updated_at ON content_plans;
CREATE TRIGGER trg_cp_updated_at
  BEFORE UPDATE ON content_plans
  FOR EACH ROW EXECUTE FUNCTION update_content_plans_updated_at();


-- ─── 2. content_distributions status 확장 ──────────────────
-- 기존: draft/scheduled/published/archived/failed
-- 추가: ready (자동 발행 대기)
ALTER TABLE content_distributions
  DROP CONSTRAINT IF EXISTS content_distributions_status_check;

ALTER TABLE content_distributions
  ADD CONSTRAINT content_distributions_status_check
  CHECK (status IN ('draft','ready','publishing','scheduled','published','archived','failed'));

-- 'ready', 'publishing' 상태 인덱스
CREATE INDEX IF NOT EXISTS idx_cd_ready_publish
  ON content_distributions(created_at)
  WHERE status IN ('ready', 'publishing');


-- ─── 3. travel_packages priority_score (Planner 계산 결과 캐시) ──
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS priority_score REAL DEFAULT 0;
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS priority_updated_at TIMESTAMPTZ;

COMMENT ON COLUMN travel_packages.priority_score IS 'Threads Planner에서 계산한 콘텐츠 우선순위 점수 (0~1)';
COMMENT ON COLUMN travel_packages.priority_updated_at IS 'priority_score 마지막 계산 시각';


-- ─── 4. batch_update_priority_scores RPC (Planner 최적화) ─────────
CREATE OR REPLACE FUNCTION batch_update_priority_scores(p_scores JSONB)
RETURNS VOID AS $$
DECLARE
  rec JSONB;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(p_scores)
  LOOP
    UPDATE travel_packages
    SET
      priority_score = (rec->>'score')::REAL,
      priority_updated_at = (rec->>'updated_at')::TIMESTAMPTZ
    WHERE id = (rec->>'id')::UUID;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

COMMIT;

NOTIFY pgrst, 'reload schema';
