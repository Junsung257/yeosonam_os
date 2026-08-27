-- Blog V4 compatibility forward migration: restore the idempotency contracts
-- that are declared by the canonical orchestrator schema but may be absent
-- when the tables were created earlier by the staging legacy schema.
--
-- This migration is additive and does not change existing rows. It fails
-- closed if duplicate keys already exist, so an operator must reconcile the
-- duplicate lineage before the constraint can be installed.

do $$
begin
  if exists (
    select 1
    from public.blog_generation_runs
    group by queue_id, generation_key
    having count(*) > 1
  ) then
    raise exception 'blog_generation_runs_idempotency_duplicates_present';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.blog_generation_runs'::regclass
      and conname = 'blog_generation_runs_queue_generation_key_key'
  ) then
    alter table public.blog_generation_runs
      add constraint blog_generation_runs_queue_generation_key_key
      unique (queue_id, generation_key);
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from public.blog_generation_attempts
    group by run_id, attempt_number
    having count(*) > 1
  ) then
    raise exception 'blog_generation_attempts_idempotency_duplicates_present';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.blog_generation_attempts'::regclass
      and conname = 'blog_generation_attempts_run_attempt_number_key'
  ) then
    alter table public.blog_generation_attempts
      add constraint blog_generation_attempts_run_attempt_number_key
      unique (run_id, attempt_number);
  end if;
end
$$;

comment on constraint blog_generation_runs_queue_generation_key_key
  on public.blog_generation_runs is
  'V4 generation run idempotency key used by the application upsert contract';

comment on constraint blog_generation_attempts_run_attempt_number_key
  on public.blog_generation_attempts is
  'V4 immutable attempt receipt idempotency key';
