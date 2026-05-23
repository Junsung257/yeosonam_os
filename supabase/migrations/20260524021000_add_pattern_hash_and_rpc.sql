-- 학습 플라이휠 Phase 4b/4c — 누락된 DB 객체 추가
-- 1) response_corrections 에 pattern_hash 컬럼 추가 (중복 방지용)
-- 2) get_critique_counts_since RPC 함수 추가 (Summary API 최적화)

-- 1. pattern_hash 컬럼 추가
ALTER TABLE response_corrections
ADD COLUMN IF NOT EXISTS pattern_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_response_corrections_pattern_hash
ON response_corrections (pattern_hash);

COMMENT ON COLUMN response_corrections.pattern_hash IS 'pattern 컬럼의 SHA256 해시 — 중복 패턴 자동 등록 방지용';

-- 2. get_critique_counts_since RPC 함수
-- 최근 N일간 critique_results 의 severity 별 건수를 집계
CREATE OR REPLACE FUNCTION get_critique_counts_since(since_iso TEXT)
RETURNS TABLE(severity TEXT, cnt BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT cr.severity::TEXT, COUNT(*)::BIGINT AS cnt
  FROM critique_results cr
  WHERE cr.created_at >= since_iso::TIMESTAMPTZ
  GROUP BY cr.severity
  ORDER BY cr.severity;
END;
$$;

COMMENT ON FUNCTION get_critique_counts_since IS 'critique_results 테이블의 severity 분포를 지정일 이후만 집계';
