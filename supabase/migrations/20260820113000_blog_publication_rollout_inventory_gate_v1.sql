-- Blog V4 max_30 inventory hardening.
-- Additive migration: replaces the manual rollout RPC with a database-owned
-- approved_for_slot count so the caller cannot promote on a stale observation.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

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
  v_actual_approved_inventory integer;
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

  -- The inventory is measured while the rollout row is locked. The value sent
  -- by the workflow is evidence only; it is never trusted for max_30.
  select count(*)::integer into v_actual_approved_inventory
  from public.blog_generation_runs
  where status = 'approved_for_slot';
  if p_next_stage = 'max_30' and v_actual_approved_inventory < 60 then
    raise exception 'manual_rollout_actual_approved_inventory_below_60:%', v_actual_approved_inventory;
  end if;

  v_next_version := v_state.state_version + 1;
  insert into public.blog_publication_rollout_manual_transitions (
    scope, expected_stage, next_stage, expected_state_version, resulting_state_version,
    approval_reference, approved_inventory_count, github_run_id, release_commit,
    evidence_sha256, operator
  ) values (
    p_scope, p_expected_stage, p_next_stage, p_expected_state_version, v_next_version,
    btrim(p_approval_reference), v_actual_approved_inventory,
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

revoke all on function public.transition_blog_publication_rollout_stage_v1(
  text,text,text,bigint,text,integer,text,text,text,text
) from PUBLIC, anon, authenticated;
grant execute on function public.transition_blog_publication_rollout_stage_v1(
  text,text,text,bigint,text,integer,text,text,text,text
) to service_role;

comment on function public.transition_blog_publication_rollout_stage_v1 is
  'CAS rollout transition with database-owned approved_for_slot inventory; caller inventory is not trusted.';

commit;

-- Rollback (manual only): re-apply the previous version of this function from
-- 20260820100000_blog_publication_rollout_manual_transition_v1.sql after
-- disabling activation. Do not drop the audit table during this hardening rollback.
