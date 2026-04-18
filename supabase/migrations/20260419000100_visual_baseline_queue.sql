-- ERR-FUK-customer-leaks 재발 방지 인프라
-- 승인 시 visual regression baseline 자동 생성 큐 + 일일 감시용 컬럼
-- 기존 방식(manual npm run test:visual:update)을 대체 — 사장님 개입 불필요

ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS baseline_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS baseline_created_at TIMESTAMPTZ;

-- 인덱스 (큐 조회 고속화)
CREATE INDEX IF NOT EXISTS idx_travel_packages_baseline_queue
  ON travel_packages (baseline_requested_at)
  WHERE baseline_requested_at IS NOT NULL
    AND (baseline_created_at IS NULL OR baseline_created_at < baseline_requested_at);

COMMENT ON COLUMN travel_packages.baseline_requested_at IS 'Visual regression baseline 재생성 요청 시각 (approve/수정 시 설정)';
COMMENT ON COLUMN travel_packages.baseline_created_at IS 'Visual regression baseline 실제 생성 완료 시각';
