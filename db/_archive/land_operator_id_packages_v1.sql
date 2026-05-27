-- ============================================================
-- 여소남 OS — travel_packages.land_operator_id FK 추가 v1
-- Supabase Dashboard > SQL Editor 에서 실행하세요.
--
-- 수정 내용:
--   travel_packages 테이블에 land_operators FK 컬럼 추가
--   (기존 land_operator TEXT 필드는 유지, 신규 UUID FK 병행)
--
-- ✅ 멱등성 보장 — 재실행 안전
-- ============================================================

ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS land_operator_id UUID REFERENCES land_operators(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_travel_packages_land_operator_id
  ON travel_packages (land_operator_id);

-- 검증 쿼리
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'travel_packages'
  AND column_name = 'land_operator_id';
