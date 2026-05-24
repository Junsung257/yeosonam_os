-- unmatched_activities 에 note(text) 컬럼 추가
-- 배경: batch_resolve_unmatched.js 가 Wikidata 제안 정보를 저장할 필드 필요
ALTER TABLE public.unmatched_activities ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN public.unmatched_activities.note IS
  '관리자 메모 / Wikidata 제안 정보(JSON)';
