-- Aggregate keyword ranking in PostgreSQL so per-day rows and PostgREST row
-- limits cannot distort the admin top/bottom keyword table.

CREATE OR REPLACE VIEW public.v_keyword_performance_summary AS
SELECT
  keyword AS keyword_text,
  platform,
  COALESCE(SUM(impressions), 0)::bigint AS impressions,
  COALESCE(SUM(clicks), 0)::bigint AS clicks,
  COALESCE(SUM(total_spend), 0)::bigint AS cost_krw,
  COALESCE(SUM(conversions), 0)::numeric AS conversions,
  COALESCE(SUM(total_revenue), 0)::numeric AS conversion_value,
  COUNT(DISTINCT period_end)::integer AS days_active,
  CASE WHEN SUM(impressions) > 0
    THEN (SUM(clicks)::numeric / SUM(impressions)::numeric) * 100
    ELSE 0
  END AS ctr,
  CASE WHEN SUM(clicks) > 0
    THEN SUM(total_spend)::numeric / SUM(clicks)::numeric
    ELSE 0
  END AS avg_cpc,
  CASE WHEN SUM(total_spend) > 0
    THEN SUM(total_revenue)::numeric / SUM(total_spend)::numeric
    ELSE 0
  END AS roas
  FROM public.keyword_performances
 GROUP BY keyword, platform;

ALTER VIEW public.v_keyword_performance_summary SET (security_invoker = on);
GRANT SELECT ON TABLE public.keyword_performances, public.v_keyword_performance_summary TO service_role;

COMMENT ON VIEW public.v_keyword_performance_summary IS
  'All-time keyword/platform aggregates for accurate admin ranking before pagination.';

CREATE OR REPLACE FUNCTION public.get_keyword_performance_admin_summary(
  p_platform text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_keyword text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'totalRows', COUNT(*),
    'uniqueKeywords', COUNT(DISTINCT keyword),
    'totalSpend', COALESCE(SUM(total_spend), 0),
    'totalClicks', COALESCE(SUM(clicks), 0),
    'totalImpressions', COALESCE(SUM(impressions), 0),
    'totalConversions', COALESCE(SUM(conversions), 0),
    'ctr', CASE WHEN SUM(impressions) > 0
      THEN (SUM(clicks)::numeric / SUM(impressions)::numeric) * 100 ELSE 0 END,
    'cpc', CASE WHEN SUM(clicks) > 0
      THEN SUM(total_spend)::numeric / SUM(clicks)::numeric ELSE 0 END,
    'roas', CASE WHEN SUM(total_spend) > 0
      THEN SUM(total_revenue)::numeric / SUM(total_spend)::numeric ELSE 0 END
  )
  FROM public.keyword_performances
  WHERE (p_platform IS NULL OR platform = p_platform)
    AND (p_date_from IS NULL OR period_end >= p_date_from)
    AND (p_date_to IS NULL OR period_start <= p_date_to)
    AND (p_keyword IS NULL OR keyword ILIKE '%' || p_keyword || '%');
$$;

REVOKE ALL ON FUNCTION public.get_keyword_performance_admin_summary(text, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_keyword_performance_admin_summary(text, date, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_keyword_performance_admin_summary(text, date, date, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_keyword_performance_admin_summary(text, date, date, text) TO service_role;
