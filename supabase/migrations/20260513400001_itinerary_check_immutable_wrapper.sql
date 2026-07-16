-- ────────────────────────────────────────────────────────────────────────────
-- B-3 (코드리뷰 fix 2026-05-10): pg_jsonschema CHECK IMMUTABLE wrapper
--
-- 기존 CHECK 는 매 INSERT/UPDATE 마다 schema 리터럴 파싱.
-- 대량 backfill 오버헤드 누적 → IMMUTABLE 함수로 wrap (옵티마이저 캐싱).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.itinerary_data_structure_valid(d jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, extensions
AS $$
  SELECT COALESCE(
    extensions.jsonb_matches_schema(
      '{
        "anyOf": [
          { "type": "array", "items": { "type": "object" } },
          { "type": "object", "required": ["days"], "properties": { "days": { "type": "array", "items": { "type": "object" } } } }
        ]
      }'::json,
      d
    ),
    false  -- NULL 반환 시 fail-closed
  );
$$;

GRANT EXECUTE ON FUNCTION public.itinerary_data_structure_valid(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.itinerary_data_structure_valid(jsonb) IS
  'P1-2 + 코드리뷰 fix(2026-05-10): itinerary_data 구조 검증 IMMUTABLE wrapper.';

ALTER TABLE public.travel_packages
  DROP CONSTRAINT IF EXISTS travel_packages_itinerary_data_structure_check;

ALTER TABLE public.travel_packages
  ADD CONSTRAINT travel_packages_itinerary_data_structure_check
  CHECK (
    itinerary_data IS NULL
    OR public.itinerary_data_structure_valid(itinerary_data)
  ) NOT VALID;

COMMENT ON CONSTRAINT travel_packages_itinerary_data_structure_check ON public.travel_packages IS
  'P1-2 + 코드리뷰 fix(2026-05-10): IMMUTABLE wrapper 사용. fail-closed (COALESCE → false).';
