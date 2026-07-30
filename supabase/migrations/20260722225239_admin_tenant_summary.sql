-- One server-side aggregate replaces 2*N tenant product/settlement requests.

CREATE OR REPLACE FUNCTION public.get_admin_tenant_summaries(p_month text)
RETURNS TABLE (
  tenant_id uuid,
  product_count bigint,
  sale_count bigint,
  settlement_cost numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH bounds AS (
    SELECT
      to_date(p_month || '-01', 'YYYY-MM-DD') AS month_start,
      (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month')::date AS next_month_start
  ),
  product_stats AS (
    SELECT tenant_id, COUNT(*)::bigint AS product_count
    FROM public.travel_packages
    WHERE tenant_id IS NOT NULL
    GROUP BY tenant_id
  ),
  settlement_stats AS (
    SELECT
      orders.tenant_id,
      COUNT(*)::bigint AS sale_count,
      COALESCE(SUM(COALESCE(orders.cost, 0) * COALESCE(orders.quantity, 0)), 0)::numeric AS settlement_cost
    FROM public.api_orders orders
    JOIN public.transactions tx ON tx.id = orders.transaction_id
    CROSS JOIN bounds
    WHERE orders.tenant_id IS NOT NULL
      AND tx.status = 'COMPLETED'
      AND orders.created_at >= (bounds.month_start::timestamp AT TIME ZONE 'Asia/Seoul')
      AND orders.created_at < (bounds.next_month_start::timestamp AT TIME ZONE 'Asia/Seoul')
    GROUP BY orders.tenant_id
  )
  SELECT
    tenants.id,
    COALESCE(product_stats.product_count, 0),
    COALESCE(settlement_stats.sale_count, 0),
    COALESCE(settlement_stats.settlement_cost, 0)
  FROM public.tenants
  LEFT JOIN product_stats ON product_stats.tenant_id = tenants.id
  LEFT JOIN settlement_stats ON settlement_stats.tenant_id = tenants.id;
$$;

REVOKE ALL ON FUNCTION public.get_admin_tenant_summaries(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_tenant_summaries(text) TO service_role;

COMMENT ON FUNCTION public.get_admin_tenant_summaries(text) IS
  'Admin-only tenant product and completed-order cost summary for one KST calendar month.';
