-- Blog publication rollout control V1.
-- Additive only: no content row or existing publishing policy is changed.
-- The application remains fail-closed when these objects are unavailable.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.blog_publication_rollout_state (
  scope text primary key check (scope = 'global'),
  stage text not null default 'pilot_3'
    check (stage in ('pilot_3', 'ramp_10', 'max_30')),
  status text not null default 'active'
    check (status in ('active', 'frozen')),
  healthy_window_streak integer not null default 0
    check (healthy_window_streak >= 0),
  unhealthy_window_streak integer not null default 0
    check (unhealthy_window_streak >= 0),
  publications_since_stage_started integer not null default 0
    check (publications_since_stage_started >= 0),
  stage_started_at timestamptz not null default now(),
  last_window_key date,
  last_evaluated_at timestamptz,
  frozen_at timestamptz,
  freeze_reason text,
  state_version bigint not null default 1 check (state_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint blog_publication_rollout_freeze_pair check (
    (status = 'active' and frozen_at is null and freeze_reason is null)
    or (status = 'frozen' and frozen_at is not null and nullif(btrim(freeze_reason), '') is not null)
  )
);

create table if not exists public.blog_publication_rollout_evaluations (
  id bigint generated always as identity primary key,
  scope text not null references public.blog_publication_rollout_state(scope) on delete restrict,
  window_key date not null,
  evaluated_at timestamptz not null default now(),
  stage_before text not null check (stage_before in ('pilot_3', 'ramp_10', 'max_30')),
  stage_after text not null check (stage_after in ('pilot_3', 'ramp_10', 'max_30')),
  status_before text not null check (status_before in ('active', 'frozen')),
  status_after text not null check (status_after in ('active', 'frozen')),
  decision text not null check (decision in ('hold', 'promote', 'demote', 'freeze')),
  observation_complete boolean not null,
  severe_incident boolean not null,
  healthy_window_streak_after integer not null check (healthy_window_streak_after >= 0),
  unhealthy_window_streak_after integer not null check (unhealthy_window_streak_after >= 0),
  publications_observed integer not null default 0 check (publications_observed >= 0),
  publications_since_stage_started_after integer not null
    check (publications_since_stage_started_after >= 0),
  reasons text[] not null default '{}'::text[],
  signals jsonb not null default '{}'::jsonb,
  state_version_before bigint not null check (state_version_before > 0),
  state_version_after bigint not null check (state_version_after > state_version_before),
  unique (scope, window_key)
);

create index if not exists idx_blog_publication_rollout_evaluations_recent
  on public.blog_publication_rollout_evaluations(scope, window_key desc);
create index if not exists idx_blog_publication_rollout_evaluations_incidents
  on public.blog_publication_rollout_evaluations(evaluated_at desc)
  where severe_incident or decision in ('demote', 'freeze');

insert into public.blog_publication_rollout_state(scope)
values ('global')
on conflict (scope) do nothing;

create or replace function public.apply_blog_publication_rollout_evaluation_v1(
  p_scope text,
  p_window_key date,
  p_expected_state_version bigint,
  p_decision text,
  p_stage_after text,
  p_status_after text,
  p_observation_complete boolean,
  p_severe_incident boolean,
  p_healthy_window_streak_after integer,
  p_unhealthy_window_streak_after integer,
  p_publications_observed integer,
  p_publications_since_stage_started_after integer,
  p_reasons text[],
  p_signals jsonb
) returns setof public.blog_publication_rollout_state
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_state public.blog_publication_rollout_state%rowtype;
begin
  if p_decision not in ('hold', 'promote', 'demote', 'freeze')
    or p_stage_after not in ('pilot_3', 'ramp_10', 'max_30')
    or p_status_after not in ('active', 'frozen') then
    raise exception 'invalid_blog_publication_rollout_transition';
  end if;

  select * into v_state
  from public.blog_publication_rollout_state
  where scope = p_scope
  for update;

  if not found then
    raise exception 'blog_publication_rollout_state_missing:%', p_scope;
  end if;

  if exists (
    select 1
    from public.blog_publication_rollout_evaluations
    where scope = p_scope and window_key = p_window_key
  ) then
    return query
      select * from public.blog_publication_rollout_state where scope = p_scope;
    return;
  end if;

  if v_state.state_version <> p_expected_state_version then
    raise exception 'blog_publication_rollout_state_version_conflict';
  end if;

  if v_state.status = 'frozen' and p_status_after <> 'frozen' then
    raise exception 'blog_publication_rollout_manual_unfreeze_required';
  end if;

  insert into public.blog_publication_rollout_evaluations (
    scope, window_key, stage_before, stage_after, status_before, status_after,
    decision, observation_complete, severe_incident,
    healthy_window_streak_after, unhealthy_window_streak_after,
    publications_observed, publications_since_stage_started_after,
    reasons, signals, state_version_before, state_version_after
  ) values (
    p_scope, p_window_key, v_state.stage, p_stage_after, v_state.status, p_status_after,
    p_decision, p_observation_complete, p_severe_incident,
    greatest(0, p_healthy_window_streak_after), greatest(0, p_unhealthy_window_streak_after),
    greatest(0, p_publications_observed), greatest(0, p_publications_since_stage_started_after),
    coalesce(p_reasons, '{}'::text[]), coalesce(p_signals, '{}'::jsonb),
    v_state.state_version, v_state.state_version + 1
  );

  update public.blog_publication_rollout_state
  set
    stage = p_stage_after,
    status = p_status_after,
    healthy_window_streak = greatest(0, p_healthy_window_streak_after),
    unhealthy_window_streak = greatest(0, p_unhealthy_window_streak_after),
    publications_since_stage_started = greatest(0, p_publications_since_stage_started_after),
    stage_started_at = case when stage is distinct from p_stage_after then now() else stage_started_at end,
    last_window_key = p_window_key,
    last_evaluated_at = now(),
    frozen_at = case when p_status_after = 'frozen' then coalesce(frozen_at, now()) else null end,
    freeze_reason = case
      when p_status_after = 'frozen' then array_to_string(coalesce(p_reasons, '{}'::text[]), ',')
      else null
    end,
    state_version = state_version + 1,
    updated_at = now()
  where scope = p_scope;

  return query
    select * from public.blog_publication_rollout_state where scope = p_scope;
end;
$$;

alter table public.blog_publication_rollout_state enable row level security;
alter table public.blog_publication_rollout_evaluations enable row level security;

revoke all on table
  public.blog_publication_rollout_state,
  public.blog_publication_rollout_evaluations
from PUBLIC, anon, authenticated;
revoke all on sequence public.blog_publication_rollout_evaluations_id_seq
from PUBLIC, anon, authenticated;
revoke all on function public.apply_blog_publication_rollout_evaluation_v1(
  text,date,bigint,text,text,text,boolean,boolean,integer,integer,integer,integer,text[],jsonb
) from PUBLIC, anon, authenticated;

grant select, update on table public.blog_publication_rollout_state to service_role;
grant select, insert on table public.blog_publication_rollout_evaluations to service_role;
grant usage, select on sequence public.blog_publication_rollout_evaluations_id_seq to service_role;
grant execute on function public.apply_blog_publication_rollout_evaluation_v1(
  text,date,bigint,text,text,text,boolean,boolean,integer,integer,integer,integer,text[],jsonb
) to service_role;

drop policy if exists blog_publication_rollout_state_service_role on public.blog_publication_rollout_state;
drop policy if exists blog_publication_rollout_evaluations_service_role on public.blog_publication_rollout_evaluations;
create policy blog_publication_rollout_state_service_role
  on public.blog_publication_rollout_state for all to service_role
  using (true) with check (true);
create policy blog_publication_rollout_evaluations_service_role
  on public.blog_publication_rollout_evaluations for all to service_role
  using (true) with check (true);

comment on table public.blog_publication_rollout_state is
  'Service-role-only durable publication ramp state. A frozen row requires explicit operational recovery.';
comment on table public.blog_publication_rollout_evaluations is
  'Immutable daily rollout decisions and their complete safety/health observations.';
comment on function public.apply_blog_publication_rollout_evaluation_v1 is
  'Idempotently records one KST-day rollout evaluation and applies its optimistic state transition.';

commit;

-- Backfill dry-run (read-only; no historical health is fabricated):
-- select scope, stage, status, healthy_window_streak, unhealthy_window_streak,
--        publications_since_stage_started, state_version
-- from public.blog_publication_rollout_state
-- order by scope;
-- select window_key, decision, stage_before, stage_after, reasons
-- from public.blog_publication_rollout_evaluations
-- order by window_key desc
-- limit 30;

-- Rollback (manual only, after application rollback to a version that does not require rollout state):
-- begin;
-- drop function if exists public.apply_blog_publication_rollout_evaluation_v1(
--   text,date,bigint,text,text,text,boolean,boolean,integer,integer,integer,integer,text[],jsonb
-- );
-- drop table if exists public.blog_publication_rollout_evaluations;
-- drop table if exists public.blog_publication_rollout_state;
-- commit;
