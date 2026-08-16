begin;

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

commit;
