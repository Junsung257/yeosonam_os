-- Fast read-only RPCs for /admin first paint.
-- Keep these SECURITY INVOKER and service-role only; API routes call them server-side.

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      date_trunc('month', current_date)::date AS month_start,
      current_date AS today,
      (current_date + interval '7 days')::date AS d7,
      (current_date + interval '180 days')::date AS passport_cutoff
  ), booking_stats AS (
    SELECT
      coalesce(sum(b.total_price), 0)::bigint AS total_sales,
      coalesce(sum(b.total_cost), 0)::bigint AS total_cost,
      coalesce(sum(b.paid_amount), 0)::bigint AS total_paid,
      greatest(0, coalesce(sum(b.total_price), 0) - coalesce(sum(b.paid_amount), 0))::bigint AS total_outstanding,
      coalesce(sum(b.margin), 0)::bigint AS margin,
      count(*) FILTER (WHERE b.status IN ('pending', 'confirmed'))::int AS active_bookings,
      count(*) FILTER (
        WHERE b.status IN ('pending', 'confirmed')
          AND b.departure_date >= bounds.today
          AND b.departure_date <= bounds.d7
          AND coalesce(b.paid_amount, 0) < coalesce(b.total_price, 0)
      )::int AS unpaid_d7,
      count(*)::int AS total_month_bookings
    FROM bookings b
    CROSS JOIN bounds
    WHERE coalesce(b.is_deleted, false) = false
      AND b.status <> 'cancelled'
      AND b.departure_date >= bounds.month_start
  ), passport_stats AS (
    SELECT count(*)::int AS expiring_passports
    FROM customers c
    CROSS JOIN bounds
    WHERE c.passport_expiry IS NOT NULL
      AND c.passport_expiry <= bounds.passport_cutoff
  )
  SELECT jsonb_build_object(
    'totalSales', booking_stats.total_sales,
    'totalCost', booking_stats.total_cost,
    'totalPaid', booking_stats.total_paid,
    'totalOutstanding', booking_stats.total_outstanding,
    'margin', booking_stats.margin,
    'activeBookings', booking_stats.active_bookings,
    'unpaidD7', booking_stats.unpaid_d7,
    'totalMonthBookings', booking_stats.total_month_bookings,
    'totalMileage', 0,
    'expiringPassports', passport_stats.expiring_passports
  )
  FROM booking_stats, passport_stats;
$$;

REVOKE ALL ON FUNCTION public.get_admin_dashboard_stats() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO service_role;

CREATE OR REPLACE FUNCTION public.get_capital_total()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'entries', '[]'::jsonb,
    'total', coalesce(sum(amount), 0)::bigint
  )
  FROM capital_entries;
$$;

REVOKE ALL ON FUNCTION public.get_capital_total() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_capital_total() TO service_role;

CREATE OR REPLACE FUNCTION public.get_pending_agent_actions_compact(p_limit integer DEFAULT 6)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH rows AS (
    SELECT id, agent_type, action_type, summary, priority, status, created_at
    FROM agent_actions
    WHERE status = 'pending'
    ORDER BY created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 6), 50))
  )
  SELECT jsonb_build_object(
    'actions', coalesce(jsonb_agg(to_jsonb(rows) ORDER BY created_at DESC), '[]'::jsonb),
    'total', 0,
    'page', 1,
    'limit', greatest(1, least(coalesce(p_limit, 6), 50))
  )
  FROM rows;
$$;

REVOKE ALL ON FUNCTION public.get_pending_agent_actions_compact(integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_agent_actions_compact(integer) TO service_role;
