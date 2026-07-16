-- ────────────────────────────────────────────────────────────────────────────
-- mv_destination_aggregates
--   목적지별 패키지 집계 — 홈페이지 /api/packages?aggregate=destination 용
--   기존: status IN ('active','approved') 모든 패키지 SELECT * → JS GROUP BY (메모리 풀스캔)
--   개선: 사전 집계된 MV 를 SELECT 만 → O(N) → O(distinct destinations)
-- ────────────────────────────────────────────────────────────────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_destination_aggregates AS
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
  WHERE status IN ('active','approved')
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

CREATE UNIQUE INDEX IF NOT EXISTS mv_destination_aggregates_pk
  ON public.mv_destination_aggregates (destination);

CREATE INDEX IF NOT EXISTS mv_destination_aggregates_count_idx
  ON public.mv_destination_aggregates (count DESC);

-- ────────────────────────────────────────────────────────────────────────────
-- RPC
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_destinations_aggregate()
RETURNS TABLE (
  destination text,
  country text,
  count int,
  "minPrice" numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    destination::text,
    country::text,
    count,
    min_price AS "minPrice"
  FROM public.mv_destination_aggregates
  ORDER BY count DESC, destination ASC;
$$;

GRANT EXECUTE ON FUNCTION public.get_destinations_aggregate() TO anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- pg_cron 매일 00:10 UTC (KST 09:10) CONCURRENTLY refresh
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_mv_destination_aggregates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_destination_aggregates;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_mv_destination_aggregates() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule('refresh-mv-destination-aggregates');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'refresh-mv-destination-aggregates',
  '10 0 * * *',
  $cron$ SELECT public.refresh_mv_destination_aggregates(); $cron$
);

SELECT public.refresh_mv_destination_aggregates();
