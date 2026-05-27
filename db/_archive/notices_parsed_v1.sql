-- ============================================================
-- notices_parsed v1: 유의사항 정제 배열 컬럼
-- ============================================================
-- 목적: PDF 원문(special_notes)은 보존하면서,
--       Gemini가 정제한 1건=1문장 배열을 별도 저장
--       → 프론트 정규식 분리 제거, 깨짐/중복 근본 해결
--
-- 실행: Supabase SQL Editor에서 실행

-- 1. 정제된 유의사항 배열 (JSONB)
-- 형식: ["여권 유효기간 6개월 이상 필수", "전자담배 반입 금지...", ...]
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS notices_parsed JSONB DEFAULT '[]'::jsonb;

-- 2. 기존 데이터 마이그레이션: special_notes가 있고 notices_parsed가 비어있는 행은
--    special_notes 전체를 1건짜리 배열로 임시 변환 (다음 업로드 시 Gemini가 재정제)
UPDATE travel_packages
SET notices_parsed = jsonb_build_array(special_notes)
WHERE special_notes IS NOT NULL
  AND special_notes != ''
  AND (notices_parsed IS NULL OR notices_parsed = '[]'::jsonb);
