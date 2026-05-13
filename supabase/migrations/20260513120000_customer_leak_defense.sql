-- ═══════════════════════════════════════════════════════════════════
-- Migration: customer leak defense (defense-in-depth 2차 게이트)
-- 박제일: 2026-05-13
-- 사유: 나트랑/달랏 등록에서 "투어비 9%" 커미션이 notices_parsed[INFO] 에
--       그대로 노출. 1차 게이트는 src/lib/customer-leak-sanitizer.ts.
--       이 트리거는 sanitizer 우회/누락 경로에서도 차단되도록 박제.
--
-- 정책 (Hybrid):
--   - CRITICAL 패턴 매치 → RAISE EXCEPTION (INSERT/UPDATE 실패)
--   - HIGH/MEDIUM 패턴 매치 → audit 로그만, 동작은 허용 (운영 중단 회피)
-- ═══════════════════════════════════════════════════════════════════

-- 1) audit 로그 테이블 (없으면 생성)
CREATE TABLE IF NOT EXISTS customer_leak_audit (
  id           bigserial PRIMARY KEY,
  package_id   uuid,
  internal_code text,
  field_path   text NOT NULL,
  pattern_id   text NOT NULL,
  severity     text NOT NULL CHECK (severity IN ('critical','high','medium')),
  matched_text text,
  action       text NOT NULL CHECK (action IN ('rejected','logged')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_leak_audit_created
  ON customer_leak_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_leak_audit_pkg
  ON customer_leak_audit (package_id);

COMMENT ON TABLE customer_leak_audit IS
  '고객 노출 leak 패턴 감지 로그. 트리거가 자동 적재. sanitizer 우회 추적용.';

-- 2) leak 검사 함수
CREATE OR REPLACE FUNCTION check_customer_leak()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  haystack text;
  critical_patterns text[] := ARRAY[
    '투어비\s*\d{1,2}\s*%',
    '컴\s*\d{1,2}\s*%',
    '커미션\s*\d{1,2}\s*%',
    '마진\s*\d{1,2}\s*%',
    '원가\s*[:：]?\s*[0-9,]+',
    'cost\s*[:：]?\s*[0-9,]+'
  ];
  high_patterns text[] := ARRAY[
    '파이널\s*조건',
    '파이널\s*요청',
    '실명단\s*요청',
    '실명단\s*확정',
    '선수금\s*[:：]?\s*[0-9,]+',
    '랜드\s*협의',
    '랜드사\s*협의'
  ];
  medium_patterns text[] := ARRAY[
    '\d+\s*방까지\s*사용',
    'allotment\s*\d+'
  ];
  pat text;
  matched text;
BEGIN
  -- haystack = 고객 노출 필드 통합 텍스트
  haystack := COALESCE(NEW.notices_parsed::text, '') || E'\n'
           || COALESCE(NEW.special_notes::text, '') || E'\n'
           || COALESCE(NEW.itinerary_data::text, '') || E'\n'
           || COALESCE(array_to_string(NEW.inclusions, E'\n'), '') || E'\n'
           || COALESCE(array_to_string(NEW.excludes, E'\n'), '');

  -- CRITICAL → REJECT
  FOREACH pat IN ARRAY critical_patterns LOOP
    SELECT (regexp_matches(haystack, pat, 'g'))[1] INTO matched LIMIT 1;
    IF matched IS NOT NULL THEN
      INSERT INTO customer_leak_audit (package_id, internal_code, field_path, pattern_id, severity, matched_text, action)
        VALUES (NEW.id, NEW.internal_code, 'multi', pat, 'critical', matched, 'rejected');
      RAISE EXCEPTION 'Customer-Leak: critical pattern matched (pattern=%, matched=%). Customer-facing field cannot contain commission/cost info.', pat, matched
        USING ERRCODE = 'check_violation', HINT = 'src/lib/customer-leak-sanitizer.ts 통과 후 INSERT';
    END IF;
  END LOOP;

  -- HIGH → log only
  FOREACH pat IN ARRAY high_patterns LOOP
    SELECT (regexp_matches(haystack, pat, 'g'))[1] INTO matched LIMIT 1;
    IF matched IS NOT NULL THEN
      INSERT INTO customer_leak_audit (package_id, internal_code, field_path, pattern_id, severity, matched_text, action)
        VALUES (NEW.id, NEW.internal_code, 'multi', pat, 'high', matched, 'logged');
    END IF;
  END LOOP;

  -- MEDIUM → log only
  FOREACH pat IN ARRAY medium_patterns LOOP
    SELECT (regexp_matches(haystack, pat, 'g'))[1] INTO matched LIMIT 1;
    IF matched IS NOT NULL THEN
      INSERT INTO customer_leak_audit (package_id, internal_code, field_path, pattern_id, severity, matched_text, action)
        VALUES (NEW.id, NEW.internal_code, 'multi', pat, 'medium', matched, 'logged');
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION check_customer_leak() FROM PUBLIC;

COMMENT ON FUNCTION check_customer_leak() IS
  '고객 노출 leak 패턴 검사 트리거 함수. CRITICAL=reject, HIGH/MEDIUM=audit log.';

-- 3) travel_packages 트리거 (INSERT/UPDATE 모두)
DROP TRIGGER IF EXISTS trg_check_customer_leak ON travel_packages;
CREATE TRIGGER trg_check_customer_leak
  BEFORE INSERT OR UPDATE ON travel_packages
  FOR EACH ROW
  EXECUTE FUNCTION check_customer_leak();

COMMENT ON TRIGGER trg_check_customer_leak ON travel_packages IS
  '고객 노출 leak 패턴 2차 게이트. 1차는 src/lib/customer-leak-sanitizer.ts.';
