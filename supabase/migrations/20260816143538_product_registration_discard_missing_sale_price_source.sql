-- A source section with no adult selling-price candidate is not a product
-- registration failure that needs operator action. Preserve the private source
-- for audit, create no revision/snapshot, and terminate the job as discarded.

alter table public.upload_jobs
  drop constraint if exists upload_jobs_v6_outcome_check,
  add constraint upload_jobs_v6_outcome_check
    check (v6_outcome is null or v6_outcome in (
      'published_verified',
      'published_degraded',
      'discarded_source_incomplete',
      'blocked_action_required'
    ));

create or replace function internal_product_registration.record_terminal_state(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_job_id uuid := nullif(p_payload->>'job_id', '')::uuid;
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_workflow_run_id text := nullif(p_payload->>'workflow_run_id', '');
  v_fencing_token bigint := nullif(p_payload->>'expected_fencing_token', '')::bigint;
  v_analysis_outcome text := p_payload->>'analysis_outcome';
  v_publication_state text := p_payload->>'publication_state';
  v_compatibility_outcome text := p_payload->>'compatibility_outcome';
  v_policy_version text := p_payload->>'policy_version';
  v_degraded_reasons jsonb := coalesce(p_payload->'degraded_reasons', '[]'::jsonb);
  v_blockers jsonb := coalesce(p_payload->'blockers', '[]'::jsonb);
  v_publication_blockers jsonb := coalesce(p_payload->'publication_blockers', '[]'::jsonb);
  v_job public.upload_jobs%rowtype;
begin
  if v_job_id is null or v_tenant_id is null or v_workflow_run_id is null or v_fencing_token is null then
    raise exception 'V6_TERMINAL_LINEAGE_REQUIRED';
  end if;
  if v_analysis_outcome not in ('verified', 'degraded', 'blocked') then
    raise exception 'V6_ANALYSIS_OUTCOME_INVALID';
  end if;
  if v_publication_state not in (
    'not_requested', 'frozen', 'blocked', 'proof_passed',
    'pointer_committed', 'converged', 'convergence_failed'
  ) then raise exception 'V6_PUBLICATION_STATE_INVALID'; end if;
  if v_compatibility_outcome not in (
    'published_verified',
    'published_degraded',
    'discarded_source_incomplete',
    'blocked_action_required'
  ) then
    raise exception 'V6_TERMINAL_OUTCOME_INVALID';
  end if;
  if jsonb_typeof(v_degraded_reasons) <> 'array'
    or jsonb_typeof(v_blockers) <> 'array'
    or jsonb_typeof(v_publication_blockers) <> 'array' then
    raise exception 'V6_TERMINAL_REASONS_INVALID';
  end if;
  if v_analysis_outcome = 'blocked'
    and v_compatibility_outcome not in ('blocked_action_required', 'discarded_source_incomplete') then
    raise exception 'V6_TERMINAL_ANALYSIS_COMPATIBILITY_MISMATCH';
  end if;
  if v_analysis_outcome <> 'blocked'
    and v_compatibility_outcome in ('blocked_action_required', 'discarded_source_incomplete') then
    raise exception 'V6_TERMINAL_ANALYSIS_COMPATIBILITY_MISMATCH';
  end if;
  if v_compatibility_outcome = 'discarded_source_incomplete'
    and v_publication_state <> 'not_requested' then
    raise exception 'V6_DISCARDED_SOURCE_PUBLICATION_FORBIDDEN';
  end if;

  update public.upload_jobs
  set v6_workflow_run_id = coalesce(v6_workflow_run_id, v_workflow_run_id),
      v6_analysis_outcome = v_analysis_outcome,
      v6_publication_state = v_publication_state,
      v6_publication_blockers = v_publication_blockers,
      v6_outcome = v_compatibility_outcome,
      v6_policy_version = v_policy_version,
      v6_degraded_reasons = v_degraded_reasons,
      v6_blockers = v_blockers,
      v6_terminal_at = now(),
      v6_last_heartbeat_at = now(),
      status = case
        when v_compatibility_outcome = 'discarded_source_incomplete' then 'done'
        when v_analysis_outcome = 'blocked' then 'failed'
        else 'done'
      end,
      v4_stage = case
        when v_compatibility_outcome = 'discarded_source_incomplete' then 'verified'
        when v_analysis_outcome = 'blocked' then 'needs_review'
        when v_publication_state = 'converged' then 'published'
        when v_publication_state in ('proof_passed', 'frozen', 'blocked', 'convergence_failed') then 'proofed'
        else 'verified'
      end,
      updated_at = now()
  where id = v_job_id
    and tenant_id = v_tenant_id
    and v6_fencing_token = v_fencing_token
    and (v6_workflow_run_id is null or v6_workflow_run_id = v_workflow_run_id)
    and v6_analysis_outcome is null
  returning * into v_job;

  if not found then
    select * into v_job
    from public.upload_jobs
    where id = v_job_id and tenant_id = v_tenant_id;
    if not found
      or v_job.v6_fencing_token <> v_fencing_token
      or v_job.v6_workflow_run_id is distinct from v_workflow_run_id
      or v_job.v6_analysis_outcome is distinct from v_analysis_outcome
      or v_job.v6_publication_state is distinct from v_publication_state
      or v_job.v6_outcome is distinct from v_compatibility_outcome then
      raise exception 'V6_TERMINAL_FENCING_CONFLICT';
    end if;
  end if;

  return jsonb_build_object(
    'job_id', v_job.id,
    'analysis_outcome', v_job.v6_analysis_outcome,
    'publication_state', v_job.v6_publication_state,
    'compatibility_outcome', v_job.v6_outcome,
    'terminal_at', v_job.v6_terminal_at,
    'fencing_token', v_job.v6_fencing_token
  );
end;
$$;

revoke all on function internal_product_registration.record_terminal_state(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_product_registration_v6_terminal_state(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_product_registration_v6_terminal_state(jsonb)
  to service_role;
