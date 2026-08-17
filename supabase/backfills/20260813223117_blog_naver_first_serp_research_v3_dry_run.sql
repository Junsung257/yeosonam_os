-- Read-only review for the Naver-first SERP V3 migration.
-- This file intentionally contains no INSERT/UPDATE/DELETE/MERGE/CALL.
-- Legacy title-frequency observations are not trustworthy V3 decision research
-- and must not be copied automatically.

select
  count(*) as legacy_snapshot_rows,
  count(*) filter (where fetched_at >= now() - interval '30 days') as recent_30d_rows,
  count(distinct keyword) as distinct_queries,
  count(*) filter (
    where coalesce(url, '') ~ '^https://'
      and nullif(btrim(coalesce(title, '')), '') is not null
  ) as minimally_reviewable_rows
from public.serp_snapshots;

select
  source,
  count(*) as row_count,
  min(fetched_at) as oldest_observation,
  max(fetched_at) as newest_observation
from public.serp_snapshots
group by source
order by row_count desc, source;

select
  count(*) as v3_run_count,
  count(*) filter (where mode = 'unavailable') as unavailable_run_count,
  count(*) filter (where status = 'failed') as failed_run_count
from public.blog_serp_research_runs;

-- Expected backfill action: 0 legacy rows. Re-run fresh provider research so
-- provenance, provider rank, result type, demand semantics and expiry are known.
select 0::bigint as approved_legacy_backfill_rows,
       'fresh_research_required'::text as disposition;
