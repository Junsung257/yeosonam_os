-- Dynamic Pricing: 수요 기반 자동 markup 컬럼 추가
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS price_markup_rate       NUMERIC(5,4)  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dp_reason               TEXT          DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dp_triggered_at         TIMESTAMPTZ   DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS view_count_weekly_snap  INT           NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS view_count_snap_at      TIMESTAMPTZ   DEFAULT NULL;

COMMENT ON COLUMN travel_packages.price_markup_rate IS
  '동적 가격 마크업 비율 (0.05 = 5%). 0이면 기본가 그대로 노출.';
COMMENT ON COLUMN travel_packages.view_count_weekly_snap IS
  '조회수 스파이크 감지용 주간 스냅샷. dynamic-pricing 크론이 갱신.';

CREATE INDEX IF NOT EXISTS idx_travel_packages_dp
  ON travel_packages (price_markup_rate)
  WHERE price_markup_rate > 0;
