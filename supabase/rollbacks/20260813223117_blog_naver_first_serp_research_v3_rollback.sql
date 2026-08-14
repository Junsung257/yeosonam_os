-- Manual rollback for 20260813223117_blog_naver_first_serp_research_v3.sql.
-- Run only after confirming no V3 consumer depends on the added fields.
begin;

drop table if exists public.blog_serp_page_observations;
drop table if exists public.blog_keyword_demand_observations;

alter table if exists public.serp_snapshots
  drop column if exists research_run_id,
  drop column if exists result_type,
  drop column if exists domain,
  drop column if exists is_editorial,
  drop column if exists original_rank,
  drop column if exists published_at;

alter table if exists public.serp_analysis
  drop column if exists intent,
  drop column if exists recommended_archetypes,
  drop column if exists structure_consensus,
  drop column if exists content_gaps,
  drop column if exists confidence,
  drop column if exists analysis_version;

drop table if exists public.blog_serp_research_runs;

commit;
