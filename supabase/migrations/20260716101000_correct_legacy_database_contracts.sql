-- Correct legacy contracts that are exercised by the current application but
-- were previously dependent on manually-created production schema.

ALTER TABLE public.content_creatives
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS description text;

CREATE OR REPLACE FUNCTION public.recompute_rfm_scores()
RETURNS TABLE(computed integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_computed integer := 0;
BEGIN
  DELETE FROM public.customer_rfm;

  WITH rfm_agg AS (
    SELECT
      b.lead_customer_id::text AS customer_id,
      max(c.email) AS customer_email,
      max(b.booking_date)::timestamptz AS last_booking_at,
      min(b.booking_date)::timestamptz AS first_booking_at,
      count(*)::integer AS frequency,
      coalesce(sum(b.total_price), 0)::numeric(12,2) AS monetary_total,
      greatest(
        0,
        extract(day FROM (now() - max(b.booking_date)::timestamptz))::integer
      ) AS recency_days
    FROM public.bookings AS b
    LEFT JOIN public.customers AS c ON c.id = b.lead_customer_id
    WHERE b.lead_customer_id IS NOT NULL
      AND coalesce(b.is_deleted, false) = false
      AND b.status IS DISTINCT FROM 'cancelled'
      AND b.status IS DISTINCT FROM 'voided'
    GROUP BY b.lead_customer_id
  ),
  thresholds AS (
    SELECT
      percentile_cont(0.2) WITHIN GROUP (ORDER BY -recency_days) AS r20,
      percentile_cont(0.4) WITHIN GROUP (ORDER BY -recency_days) AS r40,
      percentile_cont(0.6) WITHIN GROUP (ORDER BY -recency_days) AS r60,
      percentile_cont(0.8) WITHIN GROUP (ORDER BY -recency_days) AS r80,
      percentile_cont(0.2) WITHIN GROUP (ORDER BY frequency) AS f20,
      percentile_cont(0.4) WITHIN GROUP (ORDER BY frequency) AS f40,
      percentile_cont(0.6) WITHIN GROUP (ORDER BY frequency) AS f60,
      percentile_cont(0.8) WITHIN GROUP (ORDER BY frequency) AS f80,
      percentile_cont(0.2) WITHIN GROUP (ORDER BY monetary_total) AS m20,
      percentile_cont(0.4) WITHIN GROUP (ORDER BY monetary_total) AS m40,
      percentile_cont(0.6) WITHIN GROUP (ORDER BY monetary_total) AS m60,
      percentile_cont(0.8) WITHIN GROUP (ORDER BY monetary_total) AS m80
    FROM rfm_agg
  ),
  scored_base AS (
    SELECT
      a.*,
      CASE
        WHEN a.recency_days >= 365 THEN 1
        WHEN -a.recency_days >= t.r80 THEN 5
        WHEN -a.recency_days >= t.r60 THEN 4
        WHEN -a.recency_days >= t.r40 THEN 3
        WHEN -a.recency_days >= t.r20 THEN 2
        ELSE 1
      END AS r_score,
      CASE
        WHEN a.frequency >= t.f80 THEN 5
        WHEN a.frequency >= t.f60 THEN 4
        WHEN a.frequency >= t.f40 THEN 3
        WHEN a.frequency >= t.f20 THEN 2
        ELSE 1
      END AS f_score,
      CASE
        WHEN a.monetary_total >= t.m80 THEN 5
        WHEN a.monetary_total >= t.m60 THEN 4
        WHEN a.monetary_total >= t.m40 THEN 3
        WHEN a.monetary_total >= t.m20 THEN 2
        ELSE 1
      END AS m_score
    FROM rfm_agg AS a
    CROSS JOIN thresholds AS t
  ),
  scored AS (
    SELECT
      s.*,
      CASE
        WHEN s.r_score >= 4 AND s.f_score >= 4 AND s.m_score >= 4 THEN 'champions'
        WHEN s.r_score >= 2 AND s.f_score >= 4 AND s.m_score >= 4 THEN 'loyal'
        WHEN s.r_score >= 4 AND s.f_score = 1 THEN 'new_customers'
        WHEN s.r_score <= 2 AND s.f_score >= 3 AND s.m_score >= 3 THEN 'at_risk'
        WHEN s.r_score = 1 AND s.f_score = 1 AND s.m_score = 1 THEN 'lost'
        WHEN s.r_score <= 2 AND s.f_score <= 2 THEN 'hibernating'
        ELSE 'potential_loyalists'
      END AS segment_name
    FROM scored_base AS s
  ),
  inserted AS (
    INSERT INTO public.customer_rfm (
      customer_id,
      customer_email,
      recency_days,
      frequency,
      monetary_total,
      r_score,
      f_score,
      m_score,
      rfm_combined,
      segment_id,
      last_booking_at,
      first_booking_at,
      computed_at
    )
    SELECT
      s.customer_id,
      s.customer_email,
      s.recency_days,
      s.frequency,
      s.monetary_total,
      s.r_score,
      s.f_score,
      s.m_score,
      concat_ws('-', s.r_score, s.f_score, s.m_score),
      cs.id,
      s.last_booking_at,
      s.first_booking_at,
      now()
    FROM scored AS s
    LEFT JOIN public.customer_segments AS cs ON cs.segment_name = s.segment_name
    RETURNING 1
  )
  SELECT count(*)::integer INTO v_computed FROM inserted;

  RETURN QUERY SELECT v_computed;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_rfm_scores() FROM public;
GRANT EXECUTE ON FUNCTION public.recompute_rfm_scores() TO service_role;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'travel_packages'
      AND column_name = 'description'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'card_news'
      AND column_name = 'product_id'
  ) THEN
    DROP FUNCTION IF EXISTS public.auto_heal_content_gaps(integer);
  END IF;
END;
$$;
