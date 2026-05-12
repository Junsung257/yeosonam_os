-- ============================================================
-- 패키지 점수 시스템 v1 (Hedonic + TOPSIS, BWM×Entropy 가중치)
-- 마이그레이션: 20260427500000
-- ============================================================
-- 목적
-- 1) scoring_policies — 가중치/시장가/회귀계수 통합 정책 테이블 (DB로 정책 변경 가능)
-- 2) package_scores — 그룹내 TOPSIS 점수 캐시 (cron 매일 갱신)
-- 3) optional_tour_market_rates — 옵션 시장가 카탈로그 (effective_price 차감용)
-- 4) v1.0-bootstrap 정책 시드 (BWM 입력·헤도닉 회귀 전 안전 폴백)
-- ============================================================

BEGIN;

-- ── 1) scoring_policies ─────────────────────────────────
CREATE TABLE IF NOT EXISTS scoring_policies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version         TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT FALSE,

  -- BWM × Entropy 결합 가중치 (criterion → 0.0~1.0, sum=1)
  weights         JSONB NOT NULL,

  -- 호텔 등급별 등가 금액 (effective_price 차감용, KRW)
  hotel_premium   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- 항공 프리미엄 (KRW)
  flight_premium  JSONB NOT NULL DEFAULT '{"direct": 0, "transit": 0}'::jsonb,

  -- 헤도닉 회귀 결과 implicit price (cron 갱신)
  hedonic_coefs   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- 옵션명 → 평균 시장가 인덱스 캐시 (실데이터는 optional_tour_market_rates)
  market_rates    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- 데이터 부족 시 폴백
  fallback_rules  JSONB NOT NULL DEFAULT '{}'::jsonb,

  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 활성 정책은 1행만
CREATE UNIQUE INDEX IF NOT EXISTS uq_scoring_policies_active
  ON scoring_policies(is_active) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_scoring_policies_version
  ON scoring_policies(version);

COMMENT ON TABLE scoring_policies IS
  '패키지 점수 정책. is_active=TRUE 1행만 활성. 정책 변경은 새 row + 토글로 (A/B 가능)';
COMMENT ON COLUMN scoring_policies.weights IS
  'BWM×Entropy 결합 가중치. 예: {"price":0.50,"hotel":0.20,"meal":0.10,"free_options":0.10,"shopping_avoidance":0.10}';
COMMENT ON COLUMN scoring_policies.hedonic_coefs IS
  '헤도닉 회귀 implicit price (KRW). 예: {"shopping_per_count":50000,"meal_per_count":15000,"hotel_grade_step":30000,"computed_from":"regression|fallback","sample_size":N}';

-- ── 2) package_scores 캐시 ──────────────────────────────
CREATE TABLE IF NOT EXISTS package_scores (
  package_id        UUID NOT NULL REFERENCES travel_packages(id) ON DELETE CASCADE,
  policy_id         UUID NOT NULL REFERENCES scoring_policies(id) ON DELETE CASCADE,
  group_key         TEXT NOT NULL,                 -- 'danang|2026-04-20'

  -- 핵심 점수
  effective_price   NUMERIC(12, 0) NOT NULL,       -- 환산 실효 가격 (KRW)
  topsis_score      NUMERIC(10, 6) NOT NULL,       -- 0.0~1.0
  rank_in_group     INT NOT NULL,
  group_size        INT NOT NULL,

  -- 점수 분해 (자비스 답변 사유 생성용)
  breakdown         JSONB NOT NULL,

  -- 캐시된 인풋 (회귀 학습 데이터로도 사용)
  shopping_count    INT NOT NULL DEFAULT 0,
  hotel_avg_grade   NUMERIC(4, 2),                 -- 3.0~5.0
  meal_count        INT NOT NULL DEFAULT 0,
  free_option_count INT NOT NULL DEFAULT 0,
  is_direct_flight  BOOLEAN NOT NULL DEFAULT FALSE,
  duration_days     INT NOT NULL DEFAULT 0,

  computed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (package_id, policy_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_pkg_scores_group_rank
  ON package_scores(group_key, rank_in_group);
CREATE INDEX IF NOT EXISTS idx_pkg_scores_policy_group
  ON package_scores(policy_id, group_key, topsis_score DESC);
CREATE INDEX IF NOT EXISTS idx_pkg_scores_pkg
  ON package_scores(package_id);

COMMENT ON TABLE package_scores IS
  '패키지 점수 캐시. cron이 매일 새벽 재계산. group_key=destination|departure_date';

-- ── 3) 옵션 시장가 카탈로그 ─────────────────────────────
CREATE TABLE IF NOT EXISTS optional_tour_market_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tour_name       TEXT NOT NULL,
  destination     TEXT,                          -- 지역별 차이 (방콕 마사지 vs 다낭 마사지)
  market_rate_krw NUMERIC(10, 0) NOT NULL,
  source          TEXT NOT NULL DEFAULT 'manual', -- 'manual' | 'cron-learned' | 'imported'
  sample_size     INT NOT NULL DEFAULT 1,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_otmr_name_dest
  ON optional_tour_market_rates(tour_name, COALESCE(destination, ''));

CREATE INDEX IF NOT EXISTS idx_otmr_destination
  ON optional_tour_market_rates(destination);

COMMENT ON TABLE optional_tour_market_rates IS
  '옵션관광 시장가 카탈로그. 무료 포함 옵션을 effective_price에서 차감 시 사용';

-- ── 4) 정책 v1 시드 ─────────────────────────────────────
INSERT INTO scoring_policies (
  version, is_active, weights, hotel_premium, flight_premium,
  hedonic_coefs, market_rates, fallback_rules, notes, created_by
)
VALUES (
  'v1.0-bootstrap',
  TRUE,
  -- 사장님 BWM 입력 전 부트스트랩 (가격 최우선)
  '{"price": 0.50, "hotel": 0.20, "meal": 0.10, "free_options": 0.10, "shopping_avoidance": 0.10}'::jsonb,
  -- 호텔 등급별 등가 금액 (실효가격 차감용 — 비싼 호텔이 있으면 그만큼 가성비)
  '{"3성": 0, "준4성": 30000, "4성": 70000, "준5성": 110000, "5성": 150000}'::jsonb,
  -- 항공
  '{"direct": 50000, "transit": 0}'::jsonb,
  -- 헤도닉 implicit price (회귀 전 폴백 — 한국 패키지 시장 통상값)
  '{"shopping_per_count": 50000, "meal_per_count": 15000, "hotel_grade_step": 30000, "computed_from": "fallback", "sample_size": 0, "computed_at": null}'::jsonb,
  -- 옵션 시장가 인덱스 (cron이 optional_tour_market_rates 에서 채움)
  '{}'::jsonb,
  -- 폴백 규칙
  '{"min_group_size": 2, "min_regression_samples": 20, "default_shopping_avoidance_per_count": 50000, "departure_window_days": 3}'::jsonb,
  '부트스트랩 정책. BWM 입력·헤도닉 회귀 전 안전 기본값.',
  'system'
);

-- ── 5) RLS ──────────────────────────────────────────────
ALTER TABLE scoring_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE optional_tour_market_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY scoring_policies_service ON scoring_policies
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY package_scores_service ON package_scores
  FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY otmr_service ON optional_tour_market_rates
  FOR ALL USING (auth.role() = 'service_role');

-- ── 6) 활성 정책 조회 헬퍼 ───────────────────────────────
CREATE OR REPLACE FUNCTION get_active_scoring_policy()
RETURNS scoring_policies
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM scoring_policies WHERE is_active = TRUE LIMIT 1;
$$;

COMMENT ON FUNCTION get_active_scoring_policy IS
  '현재 활성 점수 정책 반환. effective_price·TOPSIS 계산이 모두 이걸 참조';

-- ── 7) updated_at 트리거 ────────────────────────────────
CREATE OR REPLACE FUNCTION scoring_policies_touch_updated()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_scoring_policies_touch ON scoring_policies;
CREATE TRIGGER trg_scoring_policies_touch
  BEFORE UPDATE ON scoring_policies
  FOR EACH ROW EXECUTE FUNCTION scoring_policies_touch_updated();

DROP TRIGGER IF EXISTS trg_otmr_touch ON optional_tour_market_rates;
CREATE TRIGGER trg_otmr_touch
  BEFORE UPDATE ON optional_tour_market_rates
  FOR EACH ROW EXECUTE FUNCTION scoring_policies_touch_updated();

COMMIT;

NOTIFY pgrst, 'reload schema';
