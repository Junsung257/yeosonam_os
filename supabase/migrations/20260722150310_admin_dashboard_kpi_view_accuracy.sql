-- Keep the admin KPI view on the same KST accounting boundary as the API and
-- prevent overpayments on one booking from reducing another booking's receivable.
-- This migration only changes read models; it does not mutate booking rows.

CREATE OR REPLACE VIEW public.v_bookings_kpi AS
SELECT
  b.id,
  b.booking_no,
  b.created_at,
  b.departure_date,
  b.cancelled_at,
  b.status,
  b.payment_status,
  b.settlement_mode,
  b.booking_type,
  b.departure_region,
  b.land_operator_id,
  b.affiliate_id,
  b.utm_source,
  b.utm_campaign,
  b.tenant_id,
  CASE WHEN b.status = 'cancelled' THEN 'cancelled' ELSE 'live' END AS lifecycle_state,
  (
    b.status <> 'cancelled'
    AND b.departure_date IS NOT NULL
    AND b.departure_date <= (now() AT TIME ZONE 'Asia/Seoul')::date
  ) AS is_recognized,
  to_char(b.departure_date, 'YYYY-MM') AS departure_month,
  to_char((b.created_at AT TIME ZONE 'Asia/Seoul')::date, 'YYYY-MM') AS booking_month,
  COALESCE(b.total_price, 0) AS gmv,
  COALESCE(b.total_cost, 0) AS cogs,
  COALESCE(b.paid_amount, 0) AS paid_amount,
  COALESCE(b.margin, 0) AS margin,
  COALESCE(b.influencer_commission, 0) AS influencer_commission,
  GREATEST(0, COALESCE(b.total_price, 0) - COALESCE(b.paid_amount, 0)) AS outstanding,
  CASE
    WHEN b.departure_date IS NOT NULL AND b.created_at IS NOT NULL
    THEN b.departure_date - (b.created_at AT TIME ZONE 'Asia/Seoul')::date
  END AS lead_time_days
FROM public.bookings b
WHERE COALESCE(b.is_deleted, false) = false;

ALTER VIEW public.v_bookings_kpi SET (security_invoker = on);

COMMENT ON VIEW public.v_bookings_kpi IS
  'Admin KPI SSOT. KST recognized boundary; per-booking outstanding is floored at zero.';

CREATE OR REPLACE VIEW public.v_monthly_recognized_revenue AS
SELECT
  departure_month AS month,
  COUNT(*) AS recognized_bookings,
  COALESCE(SUM(gmv), 0)::bigint AS gmv,
  COALESCE(SUM(margin), 0)::bigint AS margin,
  COALESCE(SUM(paid_amount), 0)::bigint AS paid,
  COALESCE(SUM(outstanding), 0)::bigint AS outstanding,
  COALESCE(SUM(influencer_commission), 0)::bigint AS commission
FROM public.v_bookings_kpi
WHERE is_recognized = true
GROUP BY departure_month;

ALTER VIEW public.v_monthly_recognized_revenue SET (security_invoker = on);

COMMENT ON VIEW public.v_monthly_recognized_revenue IS
  'Monthly recognized revenue by KST departure date; excludes deleted and cancelled bookings.';

CREATE OR REPLACE VIEW public.v_monthly_new_bookings AS
SELECT
  booking_month AS month,
  COUNT(*) AS total_bookings,
  COUNT(*) FILTER (WHERE lifecycle_state = 'live') AS live_bookings,
  COUNT(*) FILTER (WHERE lifecycle_state = 'cancelled') AS cancelled_bookings,
  COALESCE(SUM(gmv) FILTER (WHERE lifecycle_state = 'live'), 0)::bigint AS gmv_live,
  COALESCE(SUM(gmv), 0)::bigint AS gmv_total,
  AVG(lead_time_days) FILTER (WHERE lifecycle_state = 'live') AS avg_lead_time
FROM public.v_bookings_kpi
GROUP BY booking_month;

ALTER VIEW public.v_monthly_new_bookings SET (security_invoker = on);

COMMENT ON VIEW public.v_monthly_new_bookings IS
  'Monthly booking creation cohort in KST, including cancellation and lead-time measures.';

CREATE OR REPLACE VIEW public.v_monthly_dashboard_profit AS
SELECT
  departure_month AS month,
  COALESCE(SUM(gmv) FILTER (WHERE booking_type IS DISTINCT FROM 'AFFILIATE'), 0)::bigint AS direct_sales,
  COALESCE(SUM(gmv) FILTER (WHERE booking_type = 'AFFILIATE'), 0)::bigint AS affiliate_sales,
  COALESCE(SUM(margin) FILTER (WHERE booking_type IS DISTINCT FROM 'AFFILIATE'), 0)::bigint AS direct_margin,
  COALESCE(SUM(margin) FILTER (WHERE booking_type = 'AFFILIATE'), 0)::bigint AS affiliate_margin,
  COALESCE(SUM(influencer_commission) FILTER (WHERE booking_type = 'AFFILIATE'), 0)::bigint AS total_commission
FROM public.v_bookings_kpi
WHERE is_recognized = true
GROUP BY departure_month;

ALTER VIEW public.v_monthly_dashboard_profit SET (security_invoker = on);

COMMENT ON VIEW public.v_monthly_dashboard_profit IS
  'Monthly recognized direct/affiliate sales and margins. Margin already includes commission.';

CREATE OR REPLACE VIEW public.v_monthly_ad_spend AS
SELECT
  to_char(snapshot_date, 'YYYY-MM') AS month,
  COALESCE(SUM(spend_krw), 0)::bigint AS ad_spend_krw
FROM public.ad_performance_snapshots
WHERE snapshot_date <= (now() AT TIME ZONE 'Asia/Seoul')::date
GROUP BY to_char(snapshot_date, 'YYYY-MM');

ALTER VIEW public.v_monthly_ad_spend SET (security_invoker = on);

COMMENT ON VIEW public.v_monthly_ad_spend IS
  'Monthly ad spend through the current KST business date.';
