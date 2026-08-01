-- Read-only continuation recheck captured 2026-08-01.
-- Project: ixaxnvbmhzjvupissmly

-- 1) Production migration head and recent history.
select version, name
from supabase_migrations.schema_migrations
order by version desc
limit 10;

-- 2) Revenue-core row counts. Keep this separate from the historical baseline.
select 'travel_packages' as table_name, count(*)::bigint as row_count from public.travel_packages
union all select 'products', count(*)::bigint from public.products
union all select 'public_package_snapshots', count(*)::bigint from public.public_package_snapshots
union all select 'leads', count(*)::bigint from public.leads
union all select 'bookings', count(*)::bigint from public.bookings
union all select 'content_attribution_events', count(*)::bigint from public.content_attribution_events
union all select 'customer_events', count(*)::bigint from public.customer_events;

-- 3) Policies that protect the revenue/PII boundary. Do not infer risk from
-- RLS-enabled/no-policy alone; inspect the actual predicates.
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('bookings', 'customers', 'customer_events', 'leads', 'public_package_snapshots')
order by tablename, policyname;
