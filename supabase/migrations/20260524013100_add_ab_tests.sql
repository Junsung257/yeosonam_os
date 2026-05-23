-- ============================================================================
-- A/B 테스트 엔진 — 블로그 헤드라인·CTA·OG 이미지·전체 콘텐츠 실험
-- ============================================================================
-- 실험 추적: content_creatives.blog_html, slug, seo_title, status 등을
--   원본(control_value)으로 삼고, variant_value로 대체하여 성과 비교.
-- 통계: chi-squared test 또는 Bayesian 분석. min_sample_size 도달 + 95%
--   신뢰구간 충족 시 자동 승자 선언.
-- ============================================================================

BEGIN;

-- ─── 1) ab_experiments ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ab_experiments (
  id                    UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  name                  TEXT        NOT NULL,
  creative_id           UUID        REFERENCES content_creatives(id) ON DELETE CASCADE,
  status                TEXT        DEFAULT 'running'
                                    CHECK (status IN ('running', 'paused', 'completed', 'archived')),
  variant_type          TEXT        NOT NULL
                                    CHECK (variant_type IN ('headline', 'cta', 'og_image', 'full_content')),
  control_value         TEXT,       -- 원본 값 (headline 텍스트 / CTA 텍스트 / OG 이미지 URL 등)
  winner_variant_id     UUID,
  started_at            TIMESTAMPTZ DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  min_sample_size       INTEGER     DEFAULT 100,
  confidence_threshold  NUMERIC(4,3) DEFAULT 0.950,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ab_experiments_creative
  ON ab_experiments(creative_id);
CREATE INDEX IF NOT EXISTS idx_ab_experiments_status
  ON ab_experiments(status);

ALTER TABLE ab_experiments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ab_experiments service" ON ab_experiments;
CREATE POLICY "ab_experiments service" ON ab_experiments
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ab_experiments read" ON ab_experiments;
CREATE POLICY "ab_experiments read" ON ab_experiments
  FOR SELECT USING (true);

COMMENT ON TABLE  ab_experiments IS 'A/B test experiments for blog content (headline, CTA, OG image, full content)';
COMMENT ON COLUMN ab_experiments.variant_type IS 'headline | cta | og_image | full_content — 어떤 요소를 테스트하는지';
COMMENT ON COLUMN ab_experiments.control_value IS '원본 값 (예: 원래 헤드라인 텍스트)';
COMMENT ON COLUMN ab_experiments.winner_variant_id IS '통계 유의성 도달 시 자동 선언된 승리 variant ID';

-- ─── 2) ab_variants ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ab_variants (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  experiment_id     UUID        REFERENCES ab_experiments(id) ON DELETE CASCADE,
  variant_label     TEXT        NOT NULL,  -- 'A' | 'B' | 'C' ...
  variant_value     TEXT        NOT NULL,  -- variant 텍스트 (headline/CTA 등)
  is_control        BOOLEAN     DEFAULT false,
  impressions       INTEGER     DEFAULT 0,
  clicks            INTEGER     DEFAULT 0,
  conversions       INTEGER     DEFAULT 0,
  revenue           NUMERIC(12,2) DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ab_variants_experiment
  ON ab_variants(experiment_id);

ALTER TABLE ab_variants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ab_variants service" ON ab_variants;
CREATE POLICY "ab_variants service" ON ab_variants
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ab_variants read" ON ab_variants;
CREATE POLICY "ab_variants read" ON ab_variants
  FOR SELECT USING (true);

COMMENT ON TABLE  ab_variants IS '각 A/B 실험의 variant (A=control, B/C/D=test)';
COMMENT ON COLUMN ab_variants.variant_label IS 'A, B, C, D …';
COMMENT ON COLUMN ab_variants.is_control IS 'A variant = control (원본)';

-- ─── 3) ab_assignments (개별 방문자 할당) ───────────────────
CREATE TABLE IF NOT EXISTS ab_assignments (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  experiment_id     UUID        REFERENCES ab_experiments(id) ON DELETE CASCADE,
  variant_id        UUID        REFERENCES ab_variants(id) ON DELETE CASCADE,
  visitor_id        TEXT        NOT NULL,
  assigned_at       TIMESTAMPTZ DEFAULT now(),
  converted         BOOLEAN     DEFAULT false,
  converted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ab_assignments_experiment
  ON ab_assignments(experiment_id);
CREATE INDEX IF NOT EXISTS idx_ab_assignments_visitor
  ON ab_assignments(visitor_id);
CREATE INDEX IF NOT EXISTS idx_ab_assignments_lookup
  ON ab_assignments(experiment_id, visitor_id);

ALTER TABLE ab_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ab_assignments service" ON ab_assignments;
CREATE POLICY "ab_assignments service" ON ab_assignments
  FOR ALL TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "ab_assignments read" ON ab_assignments;
CREATE POLICY "ab_assignments read" ON ab_assignments
  FOR SELECT USING (true);

COMMENT ON TABLE  ab_assignments IS '개별 방문자의 variant 할당 내역 — 통계 분석의 원천';
COMMENT ON COLUMN ab_assignments.visitor_id IS '클라이언트 식별자 (익명 uid, 세션 ID, 또는 지문)';
COMMENT ON COLUMN ab_assignments.converted IS '방문자가 목표 행동(클릭/예약)을 완료했는지';

COMMIT;
