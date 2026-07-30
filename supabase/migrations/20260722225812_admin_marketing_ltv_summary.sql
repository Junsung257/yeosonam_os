-- Aggregate all eligible booking rows in PostgreSQL so the marketing LTV
-- dashboard is not sampled or capped by PostgREST pagination.

CREATE OR REPLACE FUNCTION public.get_admin_marketing_ltv_summary()
RETURNS TABLE (
  channel text,
  customer_count bigint,
  total_revenue numeric,
  avg_ltv numeric,
  avg_bookings_per_customer numeric,
  total_bookings bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH eligible AS (
    SELECT
      lead_customer_id,
      lower(trim(COALESCE(utm_source, utm_medium, 'direct'))) AS raw_channel,
      COALESCE(paid_amount, total_price, 0)::numeric AS revenue,
      created_at
    FROM public.bookings
    WHERE status IN ('deposit_paid', 'waiting_balance', 'fully_paid')
      AND COALESCE(is_deleted, false) = false
      AND lead_customer_id IS NOT NULL
  ),
  first_touch AS (
    SELECT DISTINCT ON (lead_customer_id)
      lead_customer_id,
      CASE
        WHEN raw_channel IN ('', 'none', '(none)') THEN 'direct'
        WHEN raw_channel LIKE '%kakao%' OR raw_channel LIKE '%카카오%' THEN 'kakao'
        WHEN raw_channel LIKE '%naver%' OR raw_channel LIKE '%네이버%' THEN 'naver'
        WHEN raw_channel LIKE '%instagram%' OR raw_channel LIKE '%insta%' OR raw_channel = 'ig' THEN 'instagram'
        WHEN raw_channel LIKE '%facebook%' OR raw_channel = 'fb' OR raw_channel LIKE '%meta%' THEN 'facebook'
        WHEN raw_channel LIKE '%google%' THEN 'google'
        WHEN raw_channel LIKE '%blog%' OR raw_channel LIKE '%블로그%' THEN 'blog'
        WHEN raw_channel LIKE '%referral%' OR raw_channel LIKE '%소개%' THEN 'referral'
        WHEN raw_channel LIKE '%organic%' OR raw_channel LIKE '%search%' THEN 'organic'
        ELSE raw_channel
      END AS channel
    FROM eligible
    ORDER BY lead_customer_id, created_at ASC
  ),
  customer_value AS (
    SELECT
      lead_customer_id,
      SUM(revenue)::numeric AS revenue,
      COUNT(*)::bigint AS bookings
    FROM eligible
    GROUP BY lead_customer_id
  )
  SELECT
    first_touch.channel,
    COUNT(*)::bigint AS customer_count,
    SUM(customer_value.revenue)::numeric AS total_revenue,
    ROUND(AVG(customer_value.revenue), 0)::numeric AS avg_ltv,
    ROUND(AVG(customer_value.bookings), 1)::numeric AS avg_bookings_per_customer,
    SUM(customer_value.bookings)::bigint AS total_bookings
  FROM first_touch
  JOIN customer_value USING (lead_customer_id)
  GROUP BY first_touch.channel
  ORDER BY total_revenue DESC;
$$;

REVOKE ALL ON FUNCTION public.get_admin_marketing_ltv_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_marketing_ltv_summary() TO service_role;

COMMENT ON FUNCTION public.get_admin_marketing_ltv_summary() IS
  'Admin-only all-row customer LTV by normalized first-touch UTM channel.';
