-- Record the provider completion reason for every durable blog generation.
-- This is additive and does not mutate existing content or publication state.

alter table public.blog_generation_attempts
  add column if not exists finish_reason text;

comment on column public.blog_generation_attempts.finish_reason is
  'Provider completion reason (for example stop or length); non-stop output is rejected before publication.';

-- Rollback (manual, only after application rollback):
-- alter table public.blog_generation_attempts drop column if exists finish_reason;
