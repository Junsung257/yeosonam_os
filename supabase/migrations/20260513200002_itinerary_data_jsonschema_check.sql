-- ────────────────────────────────────────────────────────────────────────────
-- P1-2 — itinerary_data 구조 CHECK 제약 (pg_jsonschema)
--
-- 목적: ERR-20260418-33 같은 직접 INSERT/UPDATE (Zod 우회) 사고 방어.
--   API 라우트는 PackageStrictSchema 로 검증하지만, db/* 스크립트나 SQL Editor
--   에서 직접 INSERT 하면 검증 우회. DB 레벨 게이트가 최후의 보루.
--
-- Zod 의 모든 refine 을 미러링하지는 않음 (불가능·과도). 구조만 강제:
--   - array of objects (`[{day:1,...}, ...]`)  OR
--   - object with days array (`{days:[{day:1,...}, ...]}`)
-- 잘못된 wrapping (예: `{itinerary_data:[...]}`) / 문자열 / 빈 객체 차단.
--
-- NOT VALID:
--   기존 행은 검증 안 함 (1개 archived legacy 행 제외 모두 통과 확인).
--   신규 INSERT/UPDATE 만 즉시 검증.
-- ────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_jsonschema WITH SCHEMA extensions;

ALTER TABLE public.travel_packages
  DROP CONSTRAINT IF EXISTS travel_packages_itinerary_data_structure_check;

ALTER TABLE public.travel_packages
  ADD CONSTRAINT travel_packages_itinerary_data_structure_check
  CHECK (
    itinerary_data IS NULL
    OR extensions.jsonb_matches_schema(
      '{
        "anyOf": [
          { "type": "array", "items": { "type": "object" } },
          { "type": "object", "required": ["days"], "properties": { "days": { "type": "array", "items": { "type": "object" } } } }
        ]
      }'::json,
      itinerary_data
    )
  ) NOT VALID;

COMMENT ON CONSTRAINT travel_packages_itinerary_data_structure_check ON public.travel_packages IS
  'P1-2: itinerary_data 가 days array 또는 {days: array} 형태인지 DB 레벨 강제. NOT VALID — 기존 행은 통과, 신규/업데이트만 검증.';
