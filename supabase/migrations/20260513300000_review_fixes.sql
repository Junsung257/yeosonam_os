-- ────────────────────────────────────────────────────────────────────────────
-- 코드리뷰 fix (2026-05-10) — 3개 마이그레이션 누적 보정
--
--   1. mv_destination_aggregates: status enum 확장 (published, available 포함)
--      → 신규 워크플로우 'published' / 레거시 'available' 누락 fix
--
--   2. travel_packages_itinerary_data_structure_check: COALESCE fail-closed
--      → jsonb_matches_schema NULL 반환 시 CHECK 통과되던 무력화 수정
--
--   3. llm_semantic_cache.prompt_text: length CHECK 16000
--      → DB 직접 INSERT 우회 시 무제한 length 차단 (코드는 8KB cap)
-- ────────────────────────────────────────────────────────────────────────────

-- 1. MV 재구축 (WHERE 절 확장)
DROP MATERIALIZED VIEW IF EXISTS public.mv_destination_aggregates CASCADE;

CREATE MATERIALIZED VIEW public.mv_destination_aggregates AS
WITH pkg_min_price AS (
  SELECT
    destination,
    country,
    COALESCE(
      NULLIF((
        SELECT MIN((d->>'price')::numeric)
        FROM jsonb_array_elements(COALESCE(price_dates, '[]'::jsonb)) d
        WHERE (d->>'price') ~ '^[0-9]+(\.[0-9]+)?$'
      ), 0),
      NULLIF((
        SELECT MIN((t->>'adult_price')::numeric)
        FROM jsonb_array_elements(COALESCE(price_tiers, '[]'::jsonb)) t
        WHERE (t->>'adult_price') ~ '^[0-9]+(\.[0-9]+)?$'
      ), 0),
      NULLIF(price, 0)
    ) AS effective_min_price
  FROM public.travel_packages
  -- 코드리뷰 fix: 'published' (신규 워크플로우) / 'available' (레거시) 추가
  WHERE status IN ('active','approved','published','available')
    AND destination IS NOT NULL
    AND destination <> ''
)
SELECT
  destination,
  COALESCE(MIN(country), '') AS country,
  COUNT(*)::int AS count,
  COALESCE(MIN(effective_min_price), 0)::numeric AS min_price
FROM pkg_min_price
GROUP BY destination;

CREATE UNIQUE INDEX mv_destination_aggregates_pk
  ON public.mv_destination_aggregates (destination);
CREATE INDEX mv_destination_aggregates_count_idx
  ON public.mv_destination_aggregates (count DESC);

CREATE OR REPLACE FUNCTION public.get_destinations_aggregate()
RETURNS TABLE (destination text, country text, count int, "minPrice" numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT destination::text, country::text, count, min_price AS "minPrice"
  FROM public.mv_destination_aggregates
  ORDER BY count DESC, destination ASC;
$$;
GRANT EXECUTE ON FUNCTION public.get_destinations_aggregate() TO anon, authenticated, service_role;

SELECT public.refresh_mv_destination_aggregates();

-- 2. CHECK constraint fail-closed (NULL → false)
ALTER TABLE public.travel_packages
  DROP CONSTRAINT IF EXISTS travel_packages_itinerary_data_structure_check;

ALTER TABLE public.travel_packages
  ADD CONSTRAINT travel_packages_itinerary_data_structure_check
  CHECK (
    itinerary_data IS NULL
    OR COALESCE(
      extensions.jsonb_matches_schema(
        '{
          "anyOf": [
            { "type": "array", "items": { "type": "object" } },
            { "type": "object", "required": ["days"], "properties": { "days": { "type": "array", "items": { "type": "object" } } } }
          ]
        }'::json,
        itinerary_data
      ),
      false  -- jsonb_matches_schema NULL 반환 시 fail-closed
    )
  ) NOT VALID;

COMMENT ON CONSTRAINT travel_packages_itinerary_data_structure_check ON public.travel_packages IS
  'P1-2 + 코드리뷰 fix(2026-05-10): COALESCE fail-closed 적용. NULL 반환 시 통과되던 우회 차단.';

-- 3. llm_semantic_cache.prompt_text length CHECK
ALTER TABLE public.llm_semantic_cache
  DROP CONSTRAINT IF EXISTS llm_semantic_cache_prompt_text_check;

ALTER TABLE public.llm_semantic_cache
  ADD CONSTRAINT llm_semantic_cache_prompt_text_check
  CHECK (length(prompt_text) <= 16000);

COMMENT ON CONSTRAINT llm_semantic_cache_prompt_text_check ON public.llm_semantic_cache IS
  '코드리뷰 fix(2026-05-10): DB 직접 INSERT 우회 차단. 코드는 8KB cap (semantic-cache.ts MAX_PROMPT_CHARS).';
