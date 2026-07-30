-- Admin dashboard RPCs are called only from guarded server routes with the
-- service-role client. PostgreSQL grants EXECUTE to PUBLIC by default, so
-- revoking only anon/authenticated still leaves inherited access in place.

REVOKE ALL ON FUNCTION public.get_admin_dashboard_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO service_role;

-- The sidebar badge function does not need owner privileges when invoked by
-- service_role. Remove the historical authenticated/SECURITY DEFINER surface.
ALTER FUNCTION public.get_admin_badge_counts() SECURITY INVOKER;
ALTER FUNCTION public.get_admin_badge_counts() SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.get_admin_badge_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_badge_counts() TO service_role;

REVOKE ALL ON FUNCTION public.get_capital_total() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_capital_total() TO service_role;

REVOKE ALL ON FUNCTION public.get_pending_agent_actions_compact(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_agent_actions_compact(integer) TO service_role;

COMMENT ON FUNCTION public.get_admin_badge_counts() IS
  'Service-role-only admin sidebar counters; invoked through the guarded admin API.';

-- Supabase's 2026 Data API defaults no longer guarantee implicit table
-- privileges. Keep the admin functions SECURITY INVOKER and grant only the
-- server role the underlying read/write capabilities they require.
GRANT SELECT ON TABLE
  public.agent_actions,
  public.capital_entries,
  public.unmatched_activities,
  public.travel_packages,
  public.bookings,
  public.customers,
  public.jarvis_cost_ledger,
  public.api_orders,
  public.transactions,
  public.tenants,
  public.keyword_performances
TO service_role;

GRANT SELECT ON TABLE
  public.v_bookings_kpi,
  public.v_monthly_recognized_revenue,
  public.v_monthly_new_bookings,
  public.v_monthly_dashboard_profit,
  public.v_monthly_ad_spend
TO service_role;
