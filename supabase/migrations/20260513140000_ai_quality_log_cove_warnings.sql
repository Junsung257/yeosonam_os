-- CoVe (Chain-of-Verification) 결과 적재 컬럼 추가
ALTER TABLE ai_quality_log
  ADD COLUMN IF NOT EXISTS cove_warnings jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cove_completed_at timestamptz;

COMMENT ON COLUMN ai_quality_log.cove_warnings IS
  'CoVe (Chain-of-Verification) 감사 결과. 원문↔DB claim 단위 환각 감지. db/cove_audit.js 가 비동기 적재.';
