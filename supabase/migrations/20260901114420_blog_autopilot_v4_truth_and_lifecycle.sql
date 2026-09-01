-- Blog Autopilot V4 truth and search-lifecycle contract.
--
-- Raw provider responses remain immutable. Historical classification mistakes
-- are corrected in an append-only revision ledger instead of rewriting the
-- original indexing_reports rows.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.blog_generation_runs
  add column if not exists pipeline_version text not null default 'blog-autopilot-v4.0.0',
  add column if not exists deployment_commit_sha text not null default 'unknown',
  add column if not exists schema_migration_version text not null default '20260901114420';

alter table public.indexing_reports
  add column if not exists search_lifecycle_status text not null default 'submitted',
  add column if not exists provider_receipt_status text not null default 'unknown',
  add column if not exists classification_version text not null default 'legacy',
  add column if not exists provider_raw_response jsonb not null default '{}'::jsonb,
  add column if not exists pipeline_version text not null default 'blog-autopilot-v4.0.0',
  add column if not exists deployment_commit_sha text not null default 'unknown',
  add column if not exists schema_migration_version text not null default '20260901114420';

alter table public.indexing_reports
  drop constraint if exists indexing_reports_search_lifecycle_status_check,
  drop constraint if exists indexing_reports_provider_receipt_status_check;

alter table public.indexing_reports
  add constraint indexing_reports_search_lifecycle_status_check check (
    search_lifecycle_status in (
      'queued', 'submitted', 'received', 'discovered', 'crawled', 'indexed', 'ranking'
    )
  ),
  add constraint indexing_reports_provider_receipt_status_check check (
    provider_receipt_status in ('unknown', 'pending', 'accepted', 'rejected', 'not_applicable')
  );

alter table public.blog_visibility_snapshots
  add column if not exists search_lifecycle_status text not null default 'queued',
  add column if not exists provider_receipt_status text not null default 'unknown',
  add column if not exists classification_version text not null default 'legacy',
  add column if not exists pipeline_version text not null default 'blog-autopilot-v4.0.0',
  add column if not exists deployment_commit_sha text not null default 'unknown',
  add column if not exists schema_migration_version text not null default '20260901114420';

alter table public.blog_visibility_snapshots
  drop constraint if exists blog_visibility_snapshots_search_lifecycle_status_check,
  drop constraint if exists blog_visibility_snapshots_provider_receipt_status_check;

alter table public.blog_visibility_snapshots
  add constraint blog_visibility_snapshots_search_lifecycle_status_check check (
    search_lifecycle_status in (
      'queued', 'submitted', 'received', 'discovered', 'crawled', 'indexed', 'ranking'
    )
  ),
  add constraint blog_visibility_snapshots_provider_receipt_status_check check (
    provider_receipt_status in ('unknown', 'pending', 'accepted', 'rejected', 'not_applicable')
  );

create table if not exists public.blog_indexing_classification_revisions (
  id bigint generated always as identity primary key,
  indexing_report_id uuid not null references public.indexing_reports(id) on delete restrict,
  url text not null,
  prior_google_status text not null,
  corrected_index_status text not null check (
    corrected_index_status in (
      'unknown', 'inspectable', 'indexed', 'not_indexed', 'blocked', 'verification_unavailable'
    )
  ),
  search_lifecycle_status text not null check (
    search_lifecycle_status in (
      'queued', 'submitted', 'received', 'discovered', 'crawled', 'indexed', 'ranking'
    )
  ),
  provider_receipt_status text not null check (
    provider_receipt_status in ('unknown', 'pending', 'accepted', 'rejected', 'not_applicable')
  ),
  source_verdict text,
  source_coverage_state text,
  classification_version text not null,
  reason text not null,
  classified_at timestamptz not null default now(),
  unique (indexing_report_id, classification_version)
);

create table if not exists public.blog_search_followup_jobs (
  id uuid primary key default gen_random_uuid(),
  content_creative_id uuid not null references public.content_creatives(id) on delete cascade,
  slug text not null,
  url text not null,
  milestone_days smallint not null check (milestone_days in (1, 3, 7)),
  due_at timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'retry', 'completed', 'escalated', 'failed')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 3),
  next_attempt_at timestamptz not null,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_creative_id, milestone_days)
);

create table if not exists public.blog_search_correction_queue (
  id uuid primary key default gen_random_uuid(),
  content_creative_id uuid not null references public.content_creatives(id) on delete cascade,
  followup_job_id uuid not null references public.blog_search_followup_jobs(id) on delete restrict,
  url text not null,
  correction_type text not null check (correction_type in ('technical', 'content')),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_creative_id, correction_type, status)
);

create index if not exists idx_blog_indexing_classification_revisions_url
  on public.blog_indexing_classification_revisions(url, classified_at desc);
create index if not exists idx_blog_indexing_classification_revisions_lifecycle
  on public.blog_indexing_classification_revisions(search_lifecycle_status, classified_at desc);
create index if not exists idx_indexing_reports_search_lifecycle
  on public.indexing_reports(search_lifecycle_status, reported_at desc);
create index if not exists idx_blog_visibility_search_lifecycle
  on public.blog_visibility_snapshots(platform, search_lifecycle_status, checked_at desc);
create index if not exists idx_blog_search_followup_jobs_due
  on public.blog_search_followup_jobs(next_attempt_at, due_at)
  where status in ('queued', 'retry');
create index if not exists idx_blog_search_correction_queue_status
  on public.blog_search_correction_queue(status, created_at)
  where status in ('queued', 'reviewing');

-- Preserve every raw provider field and record only the corrected projection.
insert into public.blog_indexing_classification_revisions (
  indexing_report_id,
  url,
  prior_google_status,
  corrected_index_status,
  search_lifecycle_status,
  provider_receipt_status,
  source_verdict,
  source_coverage_state,
  classification_version,
  reason
)
select
  report.id,
  report.url,
  report.google_status,
  case
    when lower(coalesce(report.google_coverage_state, '')) like any (array['%robots%', '%blocked%'])
      or lower(coalesce(report.google_page_fetch_state, '')) like any (array['%robots%', '%blocked%'])
      then 'blocked'
    when upper(coalesce(report.google_index_verdict, '')) = 'PASS'
      and lower(coalesce(report.google_coverage_state, '')) not like '%not indexed%'
      and lower(coalesce(report.google_coverage_state, '')) not like '%not on google%'
      and coalesce(report.google_coverage_state, '') not like '%색인이 생성되지%'
      and coalesce(report.google_coverage_state, '') not like '%색인 생성되지%'
      and coalesce(report.google_coverage_state, '') not like '%색인되지%'
      and coalesce(report.google_coverage_state, '') not like '%아직 알려지지 않은%'
      then 'indexed'
    when upper(coalesce(report.google_index_verdict, '')) in ('FAIL', 'NEUTRAL')
      or lower(coalesce(report.google_coverage_state, '')) like '%not indexed%'
      or lower(coalesce(report.google_coverage_state, '')) like '%not on google%'
      or lower(coalesce(report.google_coverage_state, '')) like '%unknown to google%'
      or coalesce(report.google_coverage_state, '') like '%색인이 생성되지%'
      or coalesce(report.google_coverage_state, '') like '%색인 생성되지%'
      or coalesce(report.google_coverage_state, '') like '%색인되지%'
      or coalesce(report.google_coverage_state, '') like '%아직 알려지지 않은%'
      then 'not_indexed'
    else 'inspectable'
  end,
  case
    when upper(coalesce(report.google_index_verdict, '')) = 'PASS'
      and coalesce(report.google_coverage_state, '') not like '%색인이 생성되지%'
      and coalesce(report.google_coverage_state, '') not like '%색인 생성되지%'
      and lower(coalesce(report.google_coverage_state, '')) not like '%not indexed%'
      then 'indexed'
    when report.google_last_crawl_time is not null
      or nullif(btrim(coalesce(report.google_page_fetch_state, '')), '') is not null
      then 'crawled'
    when lower(coalesce(report.google_coverage_state, '')) like '%discovered%'
      or coalesce(report.google_coverage_state, '') like '%발견됨%'
      then 'discovered'
    else 'received'
  end,
  case
    when report.google_status in ('failed', 'error') then 'rejected'
    when report.google_status in ('success', 'indexed', 'not_indexed', 'skipped') then 'accepted'
    else 'unknown'
  end,
  report.google_index_verdict,
  report.google_coverage_state,
  'blog-search-lifecycle-v4.0.0',
  case
    when report.google_status = 'indexed'
      and (
        upper(coalesce(report.google_index_verdict, '')) in ('FAIL', 'NEUTRAL')
        or lower(coalesce(report.google_coverage_state, '')) like '%not indexed%'
        or coalesce(report.google_coverage_state, '') like '%색인이 생성되지%'
        or coalesce(report.google_coverage_state, '') like '%색인 생성되지%'
      )
      then 'legacy_indexed_false_positive_corrected'
    else 'historical_provider_evidence_reclassified'
  end
from public.indexing_reports report
where report.google_index_verdict is not null
   or report.google_coverage_state is not null
on conflict (indexing_report_id, classification_version) do nothing;

alter table public.blog_indexing_classification_revisions enable row level security;
alter table public.blog_search_followup_jobs enable row level security;
alter table public.blog_search_correction_queue enable row level security;

drop policy if exists allow_all_ir on public.indexing_reports;
drop policy if exists blog_indexing_classification_revisions_service_role
  on public.blog_indexing_classification_revisions;
drop policy if exists blog_search_followup_jobs_service_role
  on public.blog_search_followup_jobs;
drop policy if exists blog_search_correction_queue_service_role
  on public.blog_search_correction_queue;

revoke all on table public.indexing_reports,
  public.blog_visibility_snapshots,
  public.blog_indexing_classification_revisions,
  public.blog_search_followup_jobs,
  public.blog_search_correction_queue
from public, anon, authenticated;
revoke all on sequence public.blog_indexing_classification_revisions_id_seq
from public, anon, authenticated;

grant select, insert, update on table public.indexing_reports,
  public.blog_visibility_snapshots
to service_role;
grant select, insert on table public.blog_indexing_classification_revisions
to service_role;
grant select, insert, update on table public.blog_search_followup_jobs,
  public.blog_search_correction_queue
to service_role;
grant usage, select on sequence public.blog_indexing_classification_revisions_id_seq
to service_role;

drop policy if exists indexing_reports_service_role on public.indexing_reports;
create policy indexing_reports_service_role
  on public.indexing_reports for all to service_role
  using (true) with check (true);

create policy blog_indexing_classification_revisions_service_role
  on public.blog_indexing_classification_revisions for all to service_role
  using (true) with check (true);
create policy blog_search_followup_jobs_service_role
  on public.blog_search_followup_jobs for all to service_role
  using (true) with check (true);
create policy blog_search_correction_queue_service_role
  on public.blog_search_correction_queue for all to service_role
  using (true) with check (true);

comment on table public.blog_indexing_classification_revisions is
  'Append-only corrected search classification. Raw indexing_reports provider evidence is never rewritten.';
comment on column public.indexing_reports.search_lifecycle_status is
  'Derived search progress. Provider submission receipt is not equivalent to indexed.';
comment on table public.blog_search_followup_jobs is
  'Exactly-once D+1/D+3/D+7 URL inspection milestones. D+3 may resubmit Sitemap once; D+7 never loops.';
comment on table public.blog_search_correction_queue is
  'Finite D+7 technical/content correction queue for URLs still not indexed.';

commit;

-- Read-only verification after staging apply:
-- select classification_version, reason, count(*)
-- from public.blog_indexing_classification_revisions
-- group by classification_version, reason order by reason;
-- select search_lifecycle_status, count(*)
-- from public.blog_visibility_snapshots group by search_lifecycle_status;
