select
  cron_name,
  count(*) as runs_24h,
  count(*) filter (where status = 'success') as success_24h,
  count(*) filter (where status = 'error') as error_24h,
  count(*) filter (where status = 'partial_failure') as partial_failure_24h,
  count(*) filter (where status <> 'success') as non_success_24h,
  max(finished_at) filter (where status = 'success') as last_success,
  max(finished_at) filter (where status <> 'success') as last_non_success,
  max(error_count) filter (where status <> 'success') as max_error_count
from public.cron_run_logs
where started_at >= now() - interval '24 hours'
group by cron_name
order by non_success_24h desc, runs_24h desc, cron_name;
