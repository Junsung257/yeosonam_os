-- ═══════════════════════════════════════════════════════════════════
-- P-2b: customer_leak_defense 트리거에 surcharges + medium 패턴 확장
-- 박제일: 2026-05-13
-- 사유: 푸꾸옥 4박6일 등록에서 "투어비 9%" 가 surcharges 필드에 박혀
--       1차(sanitizer)/2차(trigger) 게이트 모두 통과 → leak 노출.
-- ═══════════════════════════════════════════════════════════════════

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
    '\d+\s*인\s*\d+\s*실',
    'allotment\s*\d+'
  ];
  pat text;
  matched text;
BEGIN
  haystack := COALESCE(NEW.notices_parsed::text, '') || E'\n'
           || COALESCE(NEW.special_notes::text, '') || E'\n'
           || COALESCE(NEW.itinerary_data::text, '') || E'\n'
           || COALESCE(array_to_string(NEW.inclusions, E'\n'), '') || E'\n'
           || COALESCE(array_to_string(NEW.excludes, E'\n'), '') || E'\n'
           || COALESCE(NEW.surcharges::text, '');

  FOREACH pat IN ARRAY critical_patterns LOOP
    SELECT (regexp_matches(haystack, pat, 'g'))[1] INTO matched LIMIT 1;
    IF matched IS NOT NULL THEN
      INSERT INTO customer_leak_audit (package_id, internal_code, field_path, pattern_id, severity, matched_text, action)
        VALUES (NEW.id, NEW.internal_code, 'multi', pat, 'critical', matched, 'rejected');
      RAISE EXCEPTION 'Customer-Leak: critical pattern matched (pattern=%, matched=%). Customer-facing field cannot contain commission/cost info.', pat, matched
        USING ERRCODE = 'check_violation', HINT = 'src/lib/customer-leak-sanitizer.ts 통과 후 INSERT';
    END IF;
  END LOOP;

  FOREACH pat IN ARRAY high_patterns LOOP
    SELECT (regexp_matches(haystack, pat, 'g'))[1] INTO matched LIMIT 1;
    IF matched IS NOT NULL THEN
      INSERT INTO customer_leak_audit (package_id, internal_code, field_path, pattern_id, severity, matched_text, action)
        VALUES (NEW.id, NEW.internal_code, 'multi', pat, 'high', matched, 'logged');
    END IF;
  END LOOP;

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
