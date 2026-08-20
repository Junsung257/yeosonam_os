-- Blog V4 manually approved rollout transitions.
-- Additive only. This RPC is service-role-only and never fabricates health windows.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.blog_publication_rollout_manual_transitions (
  id bigint generated always as identity primary key,
  scope text not null references public.blog_publication_rollout_state(scope) on delete restrict,
  expected_stage text not null check (expected_stage in ('pilot_3', 'ramp_10', 'max_30')),
  next_stage text not null check (next_stage in ('pilot_3', 'ramp_10', 'max_30')),
  expected_state_version bigint not null check (expected_state_version > 0),
  resulting_state_version bigint not null check (resulting_state_version > expected_state_version),
  approval_reference text not null check (length(btrim(approval_reference)) >= 8),
  approved_inventory_count integer not null default 0 check (approved_inventory_count >= 0),
  github_run_id text not null check (length(btrim(github_run_id)) >= 1),
  release_commit text not null check (release_commit ~ '^[0-9a-f]{40}$'),
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  operator text not null check (length(btrim(operator)) >= 1),
  transitioned_at timestamptz not null default now(),
  unique (scope, expected_state_version, next_stage)
);

create or replace function public.transition_blog_publication_rollout_stage_v1(
  p_scope text,
  p_expected_stage text,
  p_next_stage text,
  p_expected_state_version bigint,
  p_approval_reference text,
  p_approved_inventory_count integer,
  p_github_run_id text,
  p_release_commit text,
  p_evidence_sha256 text,
  p_operator text
) returns setof public.blog_publication_rollout_state
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_state public.blog_publication_rollout_state%rowtype;
  v_next_version bigint;
begin
  if p_scope <> 'global'
    or p_expected_stage not in ('pilot_3', 'ramp_10', 'max_30')
    or p_next_stage not in ('pilot_3', 'ramp_10', 'max_30')
    or p_expected_stage = p_next_stage
    or not ((p_expected_stage = 'pilot_3' and p_next_stage = 'ramp_10')
      or (p_expected_stage = 'ramp_10' and p_next_stage = 'max_30')) then
    raise exception 'invalid_manual_blog_publication_rollout_transition';
  end if;

  if length(btrim(coalesce(p_approval_reference, ''))) < 8
    or lower(btrim(p_approval_reference)) in ('test', 'ok', 'approved', '12345678') then
    raise exception 'manual_rollout_approval_reference_invalid';
  end if;
  if p_next_stage = 'max_30' and coalesce(p_approved_inventory_count, 0) < 60 then
    raise exception 'manual_rollout_approved_inventory_below_60';
  end if;
  if p_release_commit !~ '^[0-9a-f]{40}$'
    or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
    or length(btrim(coalesce(p_github_run_id, ''))) = 0
    or length(btrim(coalesce(p_operator, ''))) = 0 then
    raise exception 'manual_rollout_provenance_invalid';
  end if;

  select * into v_state
  from public.blog_publication_rollout_state
  where scope = p_scope
  for update;

  if not found then raise exception 'blog_publication_rollout_state_missing:%', p_scope; end if;
  if v_state.status <> 'active' then raise exception 'manual_rollout_state_frozen'; end if;
  if v_state.stage <> p_expected_stage then
    raise exception 'manual_rollout_expected_stage_mismatch:%:%', p_expected_stage, v_state.stage;
  end if;
  if v_state.state_version <> p_expected_state_version then
    raise exception 'manual_rollout_state_version_conflict';
  end if;

  v_next_version := v_state.state_version + 1;
  insert into public.blog_publication_rollout_manual_transitions (
    scope, expected_stage, next_stage, expected_state_version, resulting_state_version,
    approval_reference, approved_inventory_count, github_run_id, release_commit,
    evidence_sha256, operator
  ) values (
    p_scope, p_expected_stage, p_next_stage, p_expected_state_version, v_next_version,
    btrim(p_approval_reference), greatest(0, coalesce(p_approved_inventory_count, 0)),
    btrim(p_github_run_id), lower(p_release_commit), lower(p_evidence_sha256), btrim(p_operator)
  );

  update public.blog_publication_rollout_state
  set stage = p_next_stage,
      healthy_window_streak = 0,
      unhealthy_window_streak = 0,
      publications_since_stage_started = 0,
      stage_started_at = now(),
      state_version = v_next_version,
      updated_at = now()
  where scope = p_scope;

  return query select * from public.blog_publication_rollout_state where scope = p_scope;
end;
$$;

alter table public.blog_publication_rollout_manual_transitions enable row level security;
revoke all on table public.blog_publication_rollout_manual_transitions from PUBLIC, anon, authenticated;
revoke all on sequence public.blog_publication_rollout_manual_transitions_id_seq from PUBLIC, anon, authenticated;
revoke all on function public.transition_blog_publication_rollout_stage_v1(
  text,text,text,bigint,text,integer,text,text,text,text
) from PUBLIC, anon, authenticated;
grant select, insert on table public.blog_publication_rollout_manual_transitions to service_role;
grant usage, select on sequence public.blog_publication_rollout_manual_transitions_id_seq to service_role;
grant execute on function public.transition_blog_publication_rollout_stage_v1(
  text,text,text,bigint,text,integer,text,text,text,text
) to service_role;

drop policy if exists blog_publication_rollout_manual_transitions_service_role
  on public.blog_publication_rollout_manual_transitions;
create policy blog_publication_rollout_manual_transitions_service_role
  on public.blog_publication_rollout_manual_transitions for all to service_role
  using (true) with check (true);

comment on table public.blog_publication_rollout_manual_transitions is
  'Immutable operator-approved rollout transitions with release and evidence provenance.';
comment on function public.transition_blog_publication_rollout_stage_v1 is
  'CAS transition pilot_3→ramp_10 or ramp_10→max_30; does not fabricate health observations.';

commit;

-- Rollback (manual only, after disabling activation and exporting transition evidence):
-- begin;
-- drop function if exists public.transition_blog_publication_rollout_stage_v1(text,text,text,bigint,text,integer,text,text,text,text);
-- drop table if exists public.blog_publication_rollout_manual_transitions;
-- commit;
