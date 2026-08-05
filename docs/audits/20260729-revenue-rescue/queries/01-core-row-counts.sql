-- Project: ixaxnvbmhzjvupissmly
-- Purpose: exact, read-only core inventory. Never replace with planner estimates.
with counts as (
  select 'travel_packages' metric, count(*)::bigint value from public.travel_packages
  union all select 'products', count(*) from public.products
  union all select 'public_package_snapshots', count(*) from public.public_package_snapshots
  union all select 'public_package_snapshots_active', count(*) from public.public_package_snapshots
    where published_at is not null and superseded_at is null
  union all select 'latest_publishable_decisions', count(*) from (
    select distinct on (package_id) package_id, publishable
    from public.package_publish_decisions
    order by package_id, created_at desc
  ) d where publishable is true
  union all select 'leads', count(*) from public.leads
  union all select 'leads_recent_30d', count(*) from public.leads
    where created_at >= now() - interval '30 days'
  union all select 'qa_inquiries', count(*) from public.qa_inquiries
  union all select 'qa_inquiries_recent_30d', count(*) from public.qa_inquiries
    where created_at >= now() - interval '30 days'
  union all select 'group_rfqs', count(*) from public.group_rfqs
  union all select 'bookings', count(*) from public.bookings
  union all select 'bookings_recent_30d', count(*) from public.bookings
    where created_at >= now() - interval '30 days'
  union all select 'bookings_with_paid_amount', count(*) from public.bookings
    where coalesce(is_deleted, false) is false and coalesce(paid_amount, 0) > 0
  union all select 'transactions', count(*) from public.transactions
  union all select 'bank_transactions', count(*) from public.bank_transactions
  union all select 'ledger_entries', count(*) from public.ledger_entries
  union all select 'settlements', count(*) from public.settlements
  union all select 'content_attribution_events', count(*) from public.content_attribution_events
  union all select 'meta_conversion_events', count(*) from public.meta_conversion_events
  union all select 'ad_os_performance_facts', count(*) from public.ad_os_performance_facts
  union all select 'cron_runs_24h', count(*) from public.cron_run_logs
    where started_at >= now() - interval '24 hours'
  union all select 'cron_success_24h', count(*) from public.cron_run_logs
    where started_at >= now() - interval '24 hours' and status = 'success'
  union all select 'cron_error_24h', count(*) from public.cron_run_logs
    where started_at >= now() - interval '24 hours' and status = 'error'
  union all select 'cron_partial_failure_24h', count(*) from public.cron_run_logs
    where started_at >= now() - interval '24 hours' and status = 'partial_failure'
  union all select 'cron_non_success_24h', count(*) from public.cron_run_logs
    where started_at >= now() - interval '24 hours' and status <> 'success'
)
select now() as observed_at, metric, value
from counts
order by metric;
