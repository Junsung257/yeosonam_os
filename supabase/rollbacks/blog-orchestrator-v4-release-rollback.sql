-- Emergency rollback for the Blog Orchestrator V4 release bundle.
-- Run only after application rollback and a database backup. This script does
-- not restore content rows and intentionally does not mutate published posts.
begin;

-- V4 completion observations are append-only and contain no public content.
drop table if exists public.blog_seo_audit_findings;
drop table if exists public.blog_seo_observations;
drop table if exists public.blog_seo_audit_runs;
drop table if exists public.blog_adapter_benchmarks;

drop table if exists public.blog_search_correction_queue;
drop table if exists public.blog_search_followup_jobs;
drop table if exists public.blog_indexing_classification_revisions;

alter table if exists public.blog_generation_runs
  drop column if exists pipeline_version,
  drop column if exists deployment_commit_sha,
  drop column if exists schema_migration_version;
alter table if exists public.indexing_reports
  drop column if exists search_lifecycle_status,
  drop column if exists provider_receipt_status,
  drop column if exists classification_version,
  drop column if exists provider_raw_response,
  drop column if exists pipeline_version,
  drop column if exists deployment_commit_sha,
  drop column if exists schema_migration_version;
alter table if exists public.blog_visibility_snapshots
  drop column if exists search_lifecycle_status,
  drop column if exists provider_receipt_status,
  drop column if exists classification_version,
  drop column if exists pipeline_version,
  drop column if exists deployment_commit_sha,
  drop column if exists schema_migration_version;

drop function if exists public.replace_blog_information_automated_draft_atomically(
  uuid,uuid,uuid,uuid,char,jsonb,jsonb,text,text
);
drop table if exists public.blog_information_automated_replacements;

drop view if exists public.public_blog_slug_registry;
drop function if exists public.list_public_blog_slug_registry_v1();

drop function if exists public.apply_blog_publication_rollout_evaluation_v1(
  text,date,bigint,text,text,text,boolean,boolean,integer,integer,integer,integer,text[],jsonb
);
drop table if exists public.blog_publication_rollout_evaluations;
drop table if exists public.blog_publication_rollout_state;

alter table public.blog_generation_attempts drop column if exists finish_reason;

delete from public.blog_information_official_research_documents d
using public.blog_information_official_source_registry r
where d.official_source_registry_id = r.id
  and r.hostname in ('vietnam.travel', 'danangfantasticity.com')
  and d.reviewed_by = 'codex_live_source_availability_audit_20260816';
delete from public.blog_information_official_source_registry
where hostname in ('vietnam.travel', 'danangfantasticity.com')
  and reviewed_by = 'codex_live_source_availability_audit_20260816'
  and not exists (
    select 1 from public.blog_information_official_research_documents d
    where d.official_source_registry_id = blog_information_official_source_registry.id
  );

drop function if exists public.settle_blog_ai_budget_v4(uuid,numeric,jsonb,text,boolean);
drop function if exists public.reserve_blog_ai_budget_v4(uuid,integer,text,text,text,numeric,numeric,date);
drop table if exists public.blog_ai_budget_reservations;

alter table public.blog_generation_runs
  drop constraint if exists blog_generation_runs_status_check;
alter table public.blog_generation_runs
  add constraint blog_generation_runs_status_check
    check (status in (
      'queued', 'generating', 'approved_for_slot', 'rewrite_pro_high', 'rewrite_pro_max',
      'reresearch', 'human_review', 'quarantine', 'publishing', 'published', 'failed', 'cancelled'
    ));

alter table public.blog_generation_attempts
  drop constraint if exists blog_generation_attempts_provider_model_stage_check,
  drop constraint if exists blog_generation_attempts_stage_check,
  drop constraint if exists blog_generation_attempts_provider_check;
alter table public.blog_generation_attempts
  add constraint blog_generation_attempts_stage_check
    check (stage in ('draft_flash', 'rewrite_pro_high', 'rewrite_pro_max')),
  add constraint blog_generation_attempts_provider_check check (provider = 'deepseek'),
  add constraint blog_generation_attempts_model_check
    check (model in ('deepseek-v4-flash', 'deepseek-v4-pro'));

create or replace function public.is_blog_public_slug_eligible_v3(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select nullif(btrim(coalesce(p_slug, '')), '') is not null
    and exists (
      select 1 from public.public_blog_content_creatives
      where slug = btrim(p_slug)
    );
$$;
revoke all on function public.is_blog_public_slug_eligible_v3(text) from public;
grant execute on function public.is_blog_public_slug_eligible_v3(text) to anon, service_role;

drop table if exists public.blog_generation_attempts cascade;
drop table if exists public.blog_generation_runs cascade;
drop table if exists public.ai_model_price_catalog cascade;

drop policy if exists service_role_blog_keyword_family_members on public.blog_keyword_family_members;
drop policy if exists service_role_blog_keyword_families on public.blog_keyword_families;
drop table if exists public.blog_keyword_family_members;
drop table if exists public.blog_keyword_families;

commit;
