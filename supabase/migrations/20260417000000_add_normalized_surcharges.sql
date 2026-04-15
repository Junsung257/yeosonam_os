-- ============================================================
-- 여소남 OS: 추가요금 정규화 컬럼 추가
-- 마이그레이션: 20260417000000
-- 목적:
--   string(guide_tip, single_supplement) + object(surcharges[])로
--   혼재돼 있던 추가요금을 단일 Surcharge[] 구조로 통합 저장.
--   기존 컬럼은 후방 호환을 위해 유지, 신규 경로는 이 컬럼을 우선 사용.
-- 전제: travel_packages 테이블 존재
-- ============================================================

BEGIN;

-- normalized_surcharges 컬럼 추가 (JSONB)
-- 스키마:
--   [{
--     amount_krw: number | null,
--     amount_usd: number | null,
--     period: string | null,
--     note: string,
--     kind: 'guide' | 'single' | 'small_group' | 'festival' | 'hotel' | 'meal' | 'other',
--     unit: string | null
--   }]
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS normalized_surcharges JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN travel_packages.normalized_surcharges IS
  '정규화된 추가요금 배열. guide_tip/single_supplement/small_group_surcharge 문자열과 surcharges[] 객체를 통합. Phase 2 신규.';

-- kind 필드로 조회 최적화 (GIN 인덱스)
CREATE INDEX IF NOT EXISTS idx_travel_packages_normalized_surcharges_gin
  ON travel_packages USING GIN (normalized_surcharges jsonb_path_ops);

COMMIT;
