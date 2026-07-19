-- Align the /admin first-paint KPI RPC with the documented KST accounting basis.
-- This is a read-only formula correction; it does not update booking or ledger rows.

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH bounds AS (
    SELECT
      date_trunc('month', (now() AT TIME ZONE 'Asia/Seoul')::date)::date AS month_start,
      (now() AT TIME ZONE 'Asia/Seoul')::date AS today,
      ((now() AT TIME ZONE 'Asia/Seoul')::date + 7) AS d7,
      ((now() AT TIME ZONE 'Asia/Seoul')::date + 180) AS passport_cutoff
  ), booking_stats AS (
    SELECT
      coalesce(sum(coalesce(b.total_price, 0)) FILTER (
        WHERE b.departure_date BETWEEN bounds.month_start AND bounds.today
      ), 0)::bigint AS total_sales,
      coalesce(sum(coalesce(b.total_cost, 0)) FILTER (
        WHERE b.departure_date BETWEEN bounds.month_start AND bounds.today
      ), 0)::bigint AS total_cost,
      coalesce(sum(coalesce(b.paid_amount, 0)) FILTER (
        WHERE b.departure_date BETWEEN bounds.month_start AND bounds.today
      ), 0)::bigint AS total_paid,
      coalesce(sum(greatest(
        0,
        coalesce(b.total_price, 0) - coalesce(b.paid_amount, 0)
      )) FILTER (
        WHERE b.departure_date BETWEEN bounds.month_start AND bounds.today
      ), 0)::bigint AS total_outstanding,
      coalesce(sum(coalesce(b.margin, 0)) FILTER (
        WHERE b.departure_date BETWEEN bounds.month_start AND bounds.today
      ), 0)::bigint AS margin,
      count(*) FILTER (
        WHERE b.status IN ('pending', 'confirmed')
      )::int AS active_bookings,
      count(*) FILTER (
        WHERE b.status IN ('pending', 'confirmed')
          AND b.departure_date BETWEEN bounds.today AND bounds.d7
          AND coalesce(b.paid_amount, 0) < coalesce(b.total_price, 0)
      )::int AS unpaid_d7,
      count(*) FILTER (
        WHERE b.departure_date BETWEEN bounds.month_start AND bounds.today
      )::int AS total_month_bookings
    FROM public.bookings b
    CROSS JOIN bounds
    WHERE coalesce(b.is_deleted, false) = false
      AND b.status <> 'cancelled'
  ), passport_stats AS (
    SELECT count(*)::int AS expiring_passports
    FROM public.customers c
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

COMMENT ON FUNCTION public.get_admin_dashboard_stats() IS
  '/admin KPI: KST current-month recognized totals plus all-date operational active bookings.';
