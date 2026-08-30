-- Audited, fail-closed manual recovery for a frozen blog publication rollout.
--
-- Recovery is deliberately stricter than the daily rollout evaluator. It can
-- only return to pilot_3 after the incident creative is absent from the public
-- eligibility view, its URL deletion outbox job succeeded, and a fresh V5
-- private canary has an approved, fully traced attempt plus a passing
-- independent editorial evaluation.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table if not exists public.blog_publication_rollout_recoveries (
  id bigint generated always as identity primary key,
  scope text not null references public.blog_publication_rollout_state(scope) on delete restrict,
  recovered_at timestamptz not null default now(),
  stage_before text not null check (stage_before in ('pilot_3', 'ramp_10', 'max_30')),
  stage_after text not null check (stage_after = 'pilot_3'),
  status_before text not null check (status_before = 'frozen'),
  status_after text not null check (status_after = 'active'),
  freeze_reason text not null,
  recovery_reason text not null check (length(btrim(recovery_reason)) >= 20),
  recovered_by text not null check (length(btrim(recovered_by)) >= 3),
  incident_creative_id uuid not null references public.content_creatives(id) on delete restrict,
  canary_run_id uuid not null references public.blog_generation_runs(id) on delete restrict,
  canary_attempt_id uuid not null references public.blog_generation_attempts(id) on delete restrict,
  evidence jsonb not null default '{}'::jsonb,
  state_version_before bigint not null check (state_version_before > 0),
  state_version_after bigint not null check (state_version_after = state_version_before + 1)
);

create index if not exists idx_blog_publication_rollout_recoveries_recent
  on public.blog_publication_rollout_recoveries(scope, recovered_at desc);

create or replace function public.recover_blog_publication_rollout_v1(
  p_expected_state_version bigint,
  p_incident_creative_id uuid,
  p_canary_run_id uuid,
  p_recovery_reason text,
  p_recovered_by text
) returns setof public.blog_publication_rollout_state
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_state public.blog_publication_rollout_state%rowtype;
  v_run public.blog_generation_runs%rowtype;
  v_attempt public.blog_generation_attempts%rowtype;
  v_evidence jsonb;
begin
  if length(btrim(coalesce(p_recovery_reason, ''))) < 20
    or length(btrim(coalesce(p_recovered_by, ''))) < 3 then
    raise exception 'blog_publication_rollout_recovery_audit_fields_invalid';
  end if;

  select * into v_state
  from public.blog_publication_rollout_state
  where scope = 'global'
  for update;

  if not found then
    raise exception 'blog_publication_rollout_state_missing:global';
  end if;
  if v_state.state_version <> p_expected_state_version then
    raise exception 'blog_publication_rollout_state_version_conflict';
  end if;
  if v_state.status <> 'frozen' then
    raise exception 'blog_publication_rollout_not_frozen';
  end if;

  if exists (
    select 1 from public.public_blog_content_creatives
    where id = p_incident_creative_id
  ) then
    raise exception 'blog_publication_rollout_incident_still_public';
  end if;

  if not exists (
    select 1 from public.blog_indexing_jobs
    where content_creative_id = p_incident_creative_id
      and type = 'URL_DELETED'
      and status = 'succeeded'
  ) then
    raise exception 'blog_publication_rollout_incident_deletion_unverified';
  end if;

  select * into v_run
  from public.blog_generation_runs
  where id = p_canary_run_id
    and status = 'approved_for_slot'
    and selected_attempt_id is not null
    and latest_quality_score >= 90
    and approved_at is not null
    and approved_at >= coalesce(v_state.frozen_at, '-infinity'::timestamptz);
  if not found then
    raise exception 'blog_publication_rollout_v5_canary_run_invalid';
  end if;

  select * into v_attempt
  from public.blog_generation_attempts
  where id = v_run.selected_attempt_id
    and run_id = v_run.id
    and queue_id = v_run.queue_id
    and route = 'approved_for_slot'
    and status = 'completed'
    and quality_score_after >= 90
    and prompt_trace_version = 'blog-prompt-trace-v1'
    and prompt_hash ~ '^[0-9a-f]{64}$'
    and brief_hash ~ '^[0-9a-f]{64}$'
    and claim_packet_hash ~ '^[0-9a-f]{64}$'
    and length(btrim(prompt_template_version)) > 0
    and git_commit_sha ~ '^[0-9a-f]{40}$'
    and jsonb_array_length(coalesce(hard_blockers, '[]'::jsonb)) = 0
    and jsonb_array_length(coalesce(failure_reasons, '[]'::jsonb)) = 0;
  if not found then
    raise exception 'blog_publication_rollout_v5_canary_attempt_invalid';
  end if;

  if not exists (
    select 1
    from public.content_creatives c
    where c.id = v_run.content_creative_id
      and c.status = 'draft'
      and c.channel = 'naver_blog'
      and coalesce(c.generation_meta -> 'editorial_harness_v5' ->> 'version', '') = 'blog-editorial-harness-v5.0.0'
      and coalesce(c.generation_meta -> 'editorial_harness_v5' ->> 'passed', 'false') = 'true'
      and coalesce(c.generation_meta -> 'decision_artifact_v1' ->> 'version', '') = 'blog-decision-artifact-v1'
  ) then
    raise exception 'blog_publication_rollout_v5_canary_draft_invalid';
  end if;

  if not exists (
    select 1
    from public.blog_quality_evaluations e
    where e.queue_id = v_run.queue_id
      and e.evaluator_version = 'blog-editorial-harness-v5.0.0'
      and e.passed
      and coalesce(e.score, 0) = 100
      and coalesce(jsonb_array_length(e.failure_reasons), 0) = 0
      and coalesce(array_length(e.hard_blockers, 1), 0) = 0
      and e.evaluated_at >= coalesce(v_state.frozen_at, '-infinity'::timestamptz)
  ) then
    raise exception 'blog_publication_rollout_v5_editorial_judge_unverified';
  end if;

  v_evidence := jsonb_build_object(
    'incident_not_public', true,
    'incident_url_deletion_succeeded', true,
    'canary_status', v_run.status,
    'canary_quality_score', v_run.latest_quality_score,
    'prompt_trace_version', v_attempt.prompt_trace_version,
    'prompt_hash', v_attempt.prompt_hash,
    'brief_hash', v_attempt.brief_hash,
    'claim_packet_hash', v_attempt.claim_packet_hash,
    'prompt_template_version', v_attempt.prompt_template_version,
    'git_commit_sha', v_attempt.git_commit_sha,
    'editorial_harness_version', 'blog-editorial-harness-v5.0.0',
    'editorial_judge_passed', true
  );

  insert into public.blog_publication_rollout_recoveries (
    scope, stage_before, stage_after, status_before, status_after,
    freeze_reason, recovery_reason, recovered_by, incident_creative_id,
    canary_run_id, canary_attempt_id, evidence,
    state_version_before, state_version_after
  ) values (
    'global', v_state.stage, 'pilot_3', 'frozen', 'active',
    v_state.freeze_reason, btrim(p_recovery_reason), btrim(p_recovered_by),
    p_incident_creative_id, v_run.id, v_attempt.id, v_evidence,
    v_state.state_version, v_state.state_version + 1
  );

  update public.blog_publication_rollout_state
  set stage = 'pilot_3',
      status = 'active',
      healthy_window_streak = 0,
      unhealthy_window_streak = 0,
      publications_since_stage_started = 0,
      stage_started_at = now(),
      frozen_at = null,
      freeze_reason = null,
      state_version = state_version + 1,
      updated_at = now()
  where scope = 'global';

  return query
    select * from public.blog_publication_rollout_state where scope = 'global';
end;
$$;

alter table public.blog_publication_rollout_recoveries enable row level security;

revoke all on table public.blog_publication_rollout_recoveries
from public, anon, authenticated;
revoke all on sequence public.blog_publication_rollout_recoveries_id_seq
from public, anon, authenticated;
revoke all on function public.recover_blog_publication_rollout_v1(bigint,uuid,uuid,text,text)
from public, anon, authenticated;

grant select, insert on table public.blog_publication_rollout_recoveries to service_role;
grant usage, select on sequence public.blog_publication_rollout_recoveries_id_seq to service_role;
grant execute on function public.recover_blog_publication_rollout_v1(bigint,uuid,uuid,text,text)
to service_role;

create policy blog_publication_rollout_recoveries_service_role
  on public.blog_publication_rollout_recoveries for all to service_role
  using (true) with check (true);

comment on table public.blog_publication_rollout_recoveries is
  'Immutable service-role-only evidence for explicit recovery from a frozen blog publication rollout.';
comment on function public.recover_blog_publication_rollout_v1 is
  'Returns a frozen rollout to pilot_3 only after database-verifiable incident removal and a fully traced passing V5 private canary.';

commit;

-- Post-deploy verification (read only):
-- select scope, stage, status, state_version, frozen_at, freeze_reason
-- from public.blog_publication_rollout_state where scope = 'global';
-- select id, recovered_at, recovered_by, incident_creative_id, canary_run_id,
--        state_version_before, state_version_after, evidence
-- from public.blog_publication_rollout_recoveries
-- order by recovered_at desc limit 5;

-- Rollback after application rollback only:
-- drop function if exists public.recover_blog_publication_rollout_v1(bigint,uuid,uuid,text,text);
-- drop table if exists public.blog_publication_rollout_recoveries;
