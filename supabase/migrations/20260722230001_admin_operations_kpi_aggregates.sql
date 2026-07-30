-- Server-side aggregates for admin operations KPIs. These functions keep
-- totals correct beyond PostgREST's row limit and retain service-role-only use.

CREATE OR REPLACE FUNCTION public.get_admin_settlement_balances()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS today
  ),
  base AS (
    SELECT
      COALESCE(total_price, 0)::numeric AS total_price,
      COALESCE(total_cost, 0)::numeric AS total_cost,
      COALESCE(paid_amount, 0)::numeric AS paid_amount,
      COALESCE(total_paid_out, 0)::numeric AS total_paid_out,
      departure_date,
      status
    FROM public.bookings
    WHERE COALESCE(is_deleted, false) = false
  ),
  classified AS (
    SELECT
      *,
      departure_date IS NOT NULL AND departure_date <= bounds.today AS departed,
      CASE
        WHEN departure_date IS NULL OR departure_date > bounds.today THEN 'not_due'
        WHEN bounds.today - departure_date <= 30 THEN '0-30d'
        WHEN bounds.today - departure_date <= 60 THEN '30-60d'
        WHEN bounds.today - departure_date <= 90 THEN '60-90d'
        ELSE '90d+'
      END AS bucket,
      CASE WHEN status <> 'cancelled' THEN GREATEST(0, total_price - paid_amount) ELSE 0 END AS receivable,
      CASE WHEN status <> 'cancelled' AND departure_date IS NOT NULL AND departure_date <= bounds.today
        THEN GREATEST(0, total_cost - total_paid_out) ELSE 0 END AS payable
    FROM base CROSS JOIN bounds
  ),
  totals AS (
    SELECT
      COALESCE(SUM(paid_amount), 0) AS received,
      COALESCE(SUM(total_paid_out), 0) AS paid_out,
      COALESCE(SUM(paid_amount - total_paid_out), 0) AS balance,
      COALESCE(SUM(payable), 0) AS payable,
      COALESCE(SUM(receivable), 0) AS receivable
    FROM classified
  ),
  aging AS (
    SELECT bucket, COALESCE(SUM(payable), 0) AS payable, COALESCE(SUM(receivable), 0) AS receivable
    FROM classified GROUP BY bucket
  )
  SELECT jsonb_build_object(
    'cash', jsonb_build_object(
      'received', totals.received, 'paid_out', totals.paid_out, 'balance', totals.balance,
      'basis', 'all_time_non_deleted_bookings'
    ),
    'payable', jsonb_build_object(
      'total', totals.payable,
      'aging', jsonb_build_array(
        jsonb_build_object('bucket', 'not_due', 'amount', COALESCE((SELECT payable FROM aging WHERE bucket = 'not_due'), 0)),
        jsonb_build_object('bucket', '0-30d', 'amount', COALESCE((SELECT payable FROM aging WHERE bucket = '0-30d'), 0)),
        jsonb_build_object('bucket', '30-60d', 'amount', COALESCE((SELECT payable FROM aging WHERE bucket = '30-60d'), 0)),
        jsonb_build_object('bucket', '60-90d', 'amount', COALESCE((SELECT payable FROM aging WHERE bucket = '60-90d'), 0)),
        jsonb_build_object('bucket', '90d+', 'amount', COALESCE((SELECT payable FROM aging WHERE bucket = '90d+'), 0))
      )
    ),
    'receivable', jsonb_build_object(
      'total', totals.receivable,
      'aging', jsonb_build_array(
        jsonb_build_object('bucket', 'not_due', 'amount', COALESCE((SELECT receivable FROM aging WHERE bucket = 'not_due'), 0)),
        jsonb_build_object('bucket', '0-30d', 'amount', COALESCE((SELECT receivable FROM aging WHERE bucket = '0-30d'), 0)),
        jsonb_build_object('bucket', '30-60d', 'amount', COALESCE((SELECT receivable FROM aging WHERE bucket = '30-60d'), 0)),
        jsonb_build_object('bucket', '60-90d', 'amount', COALESCE((SELECT receivable FROM aging WHERE bucket = '60-90d'), 0)),
        jsonb_build_object('bucket', '90d+', 'amount', COALESCE((SELECT receivable FROM aging WHERE bucket = '90d+'), 0))
      )
    )
  ) FROM totals;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_booking_pace_and_cancellation()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT (now() AT TIME ZONE 'Asia/Seoul')::date AS today
  ),
  pace_rows AS (
    SELECT
      CASE
        WHEN departure_date - bounds.today <= 7 THEN 'D-7'
        WHEN departure_date - bounds.today <= 30 THEN 'D-30'
        WHEN departure_date - bounds.today <= 90 THEN 'D-90'
        WHEN departure_date - bounds.today <= 180 THEN 'D-180'
        ELSE 'D+'
      END AS bucket,
      COUNT(*)::bigint AS bookings,
      COALESCE(SUM(gmv), 0)::numeric AS gmv
    FROM public.v_bookings_kpi CROSS JOIN bounds
    WHERE departure_date >= bounds.today AND lifecycle_state <> 'cancelled'
    GROUP BY 1
  ),
  cancellation AS (
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE lifecycle_state = 'cancelled')::bigint AS cancelled
    FROM public.v_bookings_kpi CROSS JOIN bounds
    WHERE created_at >= (bounds.today::timestamp AT TIME ZONE 'Asia/Seoul') - interval '90 days'
  )
  SELECT jsonb_build_object(
    'pace', jsonb_build_array(
      jsonb_build_object('bucket', 'D-7', 'bookings', COALESCE((SELECT bookings FROM pace_rows WHERE bucket = 'D-7'), 0), 'gmv', COALESCE((SELECT gmv FROM pace_rows WHERE bucket = 'D-7'), 0)),
      jsonb_build_object('bucket', 'D-30', 'bookings', COALESCE((SELECT bookings FROM pace_rows WHERE bucket = 'D-30'), 0), 'gmv', COALESCE((SELECT gmv FROM pace_rows WHERE bucket = 'D-30'), 0)),
      jsonb_build_object('bucket', 'D-90', 'bookings', COALESCE((SELECT bookings FROM pace_rows WHERE bucket = 'D-90'), 0), 'gmv', COALESCE((SELECT gmv FROM pace_rows WHERE bucket = 'D-90'), 0)),
      jsonb_build_object('bucket', 'D-180', 'bookings', COALESCE((SELECT bookings FROM pace_rows WHERE bucket = 'D-180'), 0), 'gmv', COALESCE((SELECT gmv FROM pace_rows WHERE bucket = 'D-180'), 0)),
      jsonb_build_object('bucket', 'D+', 'bookings', COALESCE((SELECT bookings FROM pace_rows WHERE bucket = 'D+'), 0), 'gmv', COALESCE((SELECT gmv FROM pace_rows WHERE bucket = 'D+'), 0))
    ),
    'cancellation_90d', jsonb_build_object(
      'total_in_window', cancellation.total,
      'cancelled_in_window', cancellation.cancelled,
      'rate', CASE WHEN cancellation.total > 0 THEN cancellation.cancelled::numeric / cancellation.total ELSE 0 END
    )
  ) FROM cancellation;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_operator_take_rates(p_limit integer DEFAULT 8)
RETURNS TABLE (
  operator_id uuid, operator_name text, bookings bigint, gmv numeric, margin numeric, take_rate numeric
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT
      (now() AT TIME ZONE 'Asia/Seoul')::date AS today,
      date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul'))::date - interval '5 months' AS month_start
  )
  SELECT
    land_operator_id,
    COALESCE(land_operator, '미지정'),
    COUNT(*)::bigint,
    COALESCE(SUM(total_price), 0)::numeric,
    COALESCE(SUM(margin), 0)::numeric,
    CASE WHEN SUM(total_price) FILTER (WHERE total_price > 0 AND margin > 0) > 0
      THEN SUM(margin) FILTER (WHERE total_price > 0 AND margin > 0)::numeric
        / SUM(total_price) FILTER (WHERE total_price > 0 AND margin > 0)::numeric
      ELSE NULL END
  FROM public.bookings CROSS JOIN bounds
  WHERE departure_date >= bounds.month_start
    AND departure_date <= bounds.today
    AND status <> 'cancelled'
    AND COALESCE(is_deleted, false) = false
  GROUP BY land_operator_id, land_operator
  ORDER BY SUM(total_price) DESC
  LIMIT LEAST(GREATEST(p_limit, 1), 100);
$$;

CREATE OR REPLACE FUNCTION public.get_admin_repeat_booking_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH customer_value AS (
    SELECT lead_customer_id, COUNT(*)::bigint AS bookings, COALESCE(SUM(total_price), 0)::numeric AS gmv
    FROM public.bookings
    WHERE status <> 'cancelled' AND COALESCE(is_deleted, false) = false AND lead_customer_id IS NOT NULL
    GROUP BY lead_customer_id
  ), totals AS (
    SELECT
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE bookings >= 2)::bigint AS repeat,
      COUNT(*) FILTER (WHERE bookings = 1)::bigint AS one_time,
      COUNT(*) FILTER (WHERE bookings = 2)::bigint AS two_time,
      COUNT(*) FILTER (WHERE bookings >= 3)::bigint AS three_plus,
      COALESCE(SUM(gmv), 0)::numeric AS total_gmv,
      COALESCE(SUM(gmv) FILTER (WHERE bookings >= 2), 0)::numeric AS repeat_gmv,
      COALESCE(MAX(gmv), 0)::numeric AS top_ltv
    FROM customer_value
  )
  SELECT jsonb_build_object(
    'total_customers', total, 'repeat_customers', repeat,
    'repeat_rate', CASE WHEN total > 0 THEN repeat::numeric / total ELSE 0 END,
    'repeat_revenue_share', CASE WHEN total_gmv > 0 THEN repeat_gmv / total_gmv ELSE 0 END,
    'top_customer_ltv', top_ltv, 'one_time', one_time, 'two_time', two_time, 'three_plus', three_plus
  ) FROM totals;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_data_quality_counts()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'total_live', COUNT(*),
    'missing_total_price', COUNT(*) FILTER (WHERE COALESCE(total_price, 0) = 0),
    'missing_total_cost', COUNT(*) FILTER (WHERE COALESCE(total_cost, 0) = 0),
    'missing_operator', COUNT(*) FILTER (WHERE land_operator_id IS NULL),
    'missing_region', COUNT(*) FILTER (WHERE departure_region IS NULL OR btrim(departure_region) = ''),
    'missing_margin_calc', COUNT(*) FILTER (WHERE COALESCE(margin, 0) = 0 AND COALESCE(total_price, 0) > 0 AND COALESCE(total_cost, 0) > 0),
    'payment_status_mismatch', COUNT(*) FILTER (WHERE COALESCE(paid_amount, 0) > 0 AND payment_status = '미입금')
  )
  FROM public.bookings
  WHERE status <> 'cancelled' AND COALESCE(is_deleted, false) = false;
$$;

CREATE OR REPLACE FUNCTION public.get_admin_ai_usage_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH rows_30d AS (
    SELECT
      created_at,
      COALESCE(cost_usd, 0)::numeric AS cost_usd,
      COALESCE(model, 'unknown') AS model,
      COALESCE(input_tokens, 0)::numeric AS input_tokens,
      COALESCE(cache_read_tokens, 0)::numeric AS cache_read_tokens,
      (created_at AT TIME ZONE 'Asia/Seoul')::date AS kst_date
    FROM public.jarvis_cost_ledger
    WHERE created_at >= now() - interval '30 days'
  ),
  daily AS (
    SELECT kst_date, SUM(cost_usd)::numeric AS cost_usd, COUNT(*)::bigint AS calls
    FROM rows_30d GROUP BY kst_date
  ),
  calendar AS (
    SELECT generate_series(
      (now() AT TIME ZONE 'Asia/Seoul')::date - 29,
      (now() AT TIME ZONE 'Asia/Seoul')::date,
      interval '1 day'
    )::date AS kst_date
  ),
  model_stats AS (
    SELECT model, SUM(cost_usd)::numeric AS cost_usd, COUNT(*)::bigint AS calls
    FROM rows_30d GROUP BY model ORDER BY cost_usd DESC LIMIT 5
  ),
  provider_stats AS (
    SELECT
      CASE
        WHEN model LIKE 'deepseek%' THEN 'deepseek'
        WHEN model LIKE 'gemini%' THEN 'gemini'
        WHEN model LIKE 'claude%' THEN 'anthropic'
        ELSE 'unknown'
      END AS provider,
      SUM(cost_usd)::numeric AS cost_usd,
      COUNT(*)::bigint AS calls,
      CASE WHEN SUM(input_tokens) > 0 THEN SUM(cache_read_tokens) / SUM(input_tokens) ELSE 0 END AS cache_hit_rate
    FROM rows_30d GROUP BY 1
  )
  SELECT jsonb_build_object(
    'total_usd_7d', COALESCE((SELECT SUM(cost_usd) FROM rows_30d WHERE created_at >= now() - interval '7 days'), 0),
    'total_usd_30d', COALESCE((SELECT SUM(cost_usd) FROM rows_30d), 0),
    'total_calls_30d', (SELECT COUNT(*) FROM rows_30d),
    'daily', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'date', to_char(calendar.kst_date, 'YYYY-MM-DD'),
        'cost_usd', COALESCE(daily.cost_usd, 0),
        'calls', COALESCE(daily.calls, 0)
      ) ORDER BY calendar.kst_date)
      FROM calendar LEFT JOIN daily USING (kst_date)
    ), '[]'::jsonb),
    'by_model', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('model', model, 'cost_usd', cost_usd, 'calls', calls) ORDER BY cost_usd DESC)
      FROM model_stats
    ), '[]'::jsonb),
    'by_provider', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'provider', provider, 'cost_usd', cost_usd, 'calls', calls, 'cache_hit_rate', cache_hit_rate
      ) ORDER BY cost_usd DESC)
      FROM provider_stats
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.get_admin_ai_month_usage_by_provider()
RETURNS TABLE (provider text, cost_usd numeric, calls bigint)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul' AS month_start
  )
  SELECT
    CASE
      WHEN model LIKE 'deepseek%' THEN 'deepseek'
      WHEN model LIKE 'gemini%' THEN 'gemini'
      WHEN model LIKE 'claude%' THEN 'anthropic'
      ELSE 'unknown'
    END AS provider,
    COALESCE(SUM(cost_usd), 0)::numeric AS cost_usd,
    COUNT(*)::bigint AS calls
  FROM public.jarvis_cost_ledger CROSS JOIN bounds
  WHERE created_at >= bounds.month_start
  GROUP BY 1;
$$;

REVOKE ALL ON FUNCTION public.get_admin_settlement_balances() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_booking_pace_and_cancellation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_operator_take_rates(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_repeat_booking_stats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_data_quality_counts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_ai_usage_stats() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_admin_ai_month_usage_by_provider() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_settlement_balances() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_booking_pace_and_cancellation() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_operator_take_rates(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_repeat_booking_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_data_quality_counts() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_ai_usage_stats() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_admin_ai_month_usage_by_provider() TO service_role;
