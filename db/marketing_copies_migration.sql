-- ============================================================
-- Step 2: 마케팅 카피 승인 시스템 마이그레이션
-- Supabase SQL Editor에서 실행하세요.
-- ============================================================

-- 1. travel_packages 테이블에 marketing_copies 컬럼 추가
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS marketing_copies JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN travel_packages.marketing_copies IS
  '[{"type":"감성형","title":"...","summary":"...","selected":false}, ...]';

-- 2. travel_packages에 internal_code FK 컬럼 추가 (upload route에서 이미 사용)
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS internal_code VARCHAR REFERENCES products(internal_code) ON DELETE SET NULL;

COMMENT ON COLUMN travel_packages.internal_code IS
  'products 테이블 FK (예: PUS-TP-OSA-03-0001)';

-- 3. status 인덱스 추가 (pending_review 필터링 최적화)
CREATE INDEX IF NOT EXISTS idx_travel_packages_status
  ON travel_packages (status);

-- 4. 기존 status 값 확인 (참고용)
-- SELECT DISTINCT status FROM travel_packages;
-- pending_review / active / draft / pending / approved / rejected 모두 허용 (VARCHAR 제약 없음)
