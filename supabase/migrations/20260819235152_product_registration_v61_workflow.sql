-- Product Registration V6.1: explicit job state model and append-on-attempt,
-- fence-on-finalize workflow stage runs.

alter table public.upload_jobs
  add column if not exists registration_current_stage text not null default 'RECEIVED',
  add column if not exists registration_job_state text not null default 'QUEUED',
  add column if not exists registration_terminal_outcome text,
  add column if not exists registration_next_attempt_at timestamptz,
  add column if not exists registration_operation_key text,
  add column if not exists workflow_version text not null default 'v6.1-recompile',
  add column if not exists parser_version text,
  add column if not exists normalizer_version text,
  add column if not exists publication_policy_version text,
  add column if not exists renderer_version text,
  add column if not exists schema_version text not null default 'product-registration-v61-schema-1',
  add column if not exists engine_commit_sha text;

update public.upload_jobs
set registration_current_stage = case
      when v6_outcome in ('published_verified', 'published_degraded') then 'PUBLISHED'
      when v4_stage = 'uploaded' then 'RECEIVED'
      when v4_stage = 'preflight' then 'SOURCE_STORED'
      when v4_stage = 'extracted' then 'PARSED'
      when v4_stage in ('segmented', 'normalized') then 'NORMALIZED'
      when v4_stage = 'verified' then 'VALIDATED'
      when v4_stage = 'proofed' then 'BROWSER_PROVED'
      else 'VALIDATED'
    end,
    registration_job_state = case
      when v6_outcome is not null then 'TERMINAL'
      when status = 'queued' then 'QUEUED'
      else 'RUNNING'
    end,
    registration_terminal_outcome = case
      when v6_outcome in ('published_verified', 'published_degraded') then 'PUBLISHED'
      when v6_outcome in ('ready_verified_not_published', 'ready_degraded_not_published', 'blocked_action_required') then 'REVIEW_REQUIRED'
      when v6_outcome = 'discarded_source_incomplete' then 'SOURCE_INCOMPLETE'
      when v6_outcome = 'discarded_non_travel' then 'NON_PRODUCT'
      when v6_outcome in ('discarded_duplicate_or_consolidated', 'archived_all_departures_past') then 'ARCHIVED'
      when v6_outcome in ('quarantined_unsupported_or_corrupt', 'quarantined_system_failure') then 'QUARANTINED'
      else null
    end,
    workflow_version = coalesce(nullif(workflow_version, ''), 'v6.1-recompile'),
    publication_policy_version = coalesce(publication_policy_version, v6_policy_version),
    parser_version = coalesce(parser_version, v4_parser_version),
    normalizer_version = coalesce(normalizer_version, v4_parser_version)
where true;

alter table public.upload_jobs
  drop constraint if exists upload_jobs_registration_current_stage_check,
  drop constraint if exists upload_jobs_registration_job_state_check,
  drop constraint if exists upload_jobs_registration_terminal_outcome_check,
  drop constraint if exists upload_jobs_registration_state_outcome_check,
  drop constraint if exists upload_jobs_registration_published_stage_check;

alter table public.upload_jobs
  add constraint upload_jobs_registration_current_stage_check check (
    registration_current_stage in (
      'RECEIVED', 'SOURCE_STORED', 'PARSED', 'NORMALIZED', 'ENRICHED',
      'VALIDATED', 'VERSION_COMMITTED', 'CANDIDATE_SNAPSHOTTED',
      'BROWSER_PROVED', 'PUBLISHED'
    )
  ),
  add constraint upload_jobs_registration_job_state_check check (
    registration_job_state in ('QUEUED', 'RUNNING', 'WAITING', 'TERMINAL')
  ),
  add constraint upload_jobs_registration_terminal_outcome_check check (
    registration_terminal_outcome is null or registration_terminal_outcome in (
      'PUBLISHED', 'REVIEW_REQUIRED', 'SOURCE_INCOMPLETE', 'FAILED_TERMINAL',
      'QUARANTINED', 'CANCELLED', 'NON_PRODUCT', 'ARCHIVED'
    )
  ),
  add constraint upload_jobs_registration_state_outcome_check check (
    (registration_job_state = 'TERMINAL' and registration_terminal_outcome is not null)
    or (registration_job_state <> 'TERMINAL' and registration_terminal_outcome is null)
  ),
  add constraint upload_jobs_registration_published_stage_check check (
    (registration_current_stage = 'PUBLISHED') = (registration_terminal_outcome = 'PUBLISHED')
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.upload_jobs'::regclass
      and conname = 'upload_jobs_registration_operation_key_key'
  ) then
    alter table public.upload_jobs
      add constraint upload_jobs_registration_operation_key_key
      unique (tenant_id, registration_operation_key);
  end if;
end;
$$;

create index if not exists idx_upload_jobs_registration_queue
  on public.upload_jobs(registration_job_state, registration_next_attempt_at, created_at)
  where registration_job_state in ('QUEUED', 'WAITING');
create index if not exists idx_upload_jobs_registration_stage
  on public.upload_jobs(registration_current_stage, updated_at desc);

create or replace function internal_product_registration.sync_v61_job_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
begin
  if new.v6_outcome is not null then
    new.registration_job_state := 'TERMINAL';
    new.registration_terminal_outcome := case
      when new.v6_outcome in ('published_verified', 'published_degraded') then 'PUBLISHED'
      when new.v6_outcome in ('ready_verified_not_published', 'ready_degraded_not_published', 'blocked_action_required') then 'REVIEW_REQUIRED'
      when new.v6_outcome = 'discarded_source_incomplete' then 'SOURCE_INCOMPLETE'
      when new.v6_outcome = 'discarded_non_travel' then 'NON_PRODUCT'
      when new.v6_outcome in ('discarded_duplicate_or_consolidated', 'archived_all_departures_past') then 'ARCHIVED'
      when new.v6_outcome in ('quarantined_unsupported_or_corrupt', 'quarantined_system_failure') then 'QUARANTINED'
      else 'FAILED_TERMINAL'
    end;
    if new.registration_terminal_outcome = 'PUBLISHED' then
      new.registration_current_stage := 'PUBLISHED';
    end if;
    new.registration_next_attempt_at := null;
  elsif new.status = 'queued' then
    new.registration_job_state := 'QUEUED';
    new.registration_terminal_outcome := null;
  elsif new.status = 'processing' then
    new.registration_job_state := 'RUNNING';
    new.registration_terminal_outcome := null;
  end if;
  new.workflow_version := coalesce(nullif(new.workflow_version, ''), 'v6.1-recompile');
  new.publication_policy_version := coalesce(new.publication_policy_version, new.v6_policy_version);
  return new;
end;
$$;

drop trigger if exists trg_upload_jobs_sync_v61_state on public.upload_jobs;
create trigger trg_upload_jobs_sync_v61_state
before insert or update of status, v6_outcome, v6_policy_version on public.upload_jobs
for each row execute function internal_product_registration.sync_v61_job_state();

create or replace function internal_product_registration.assert_published_job_pointer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
begin
  if new.registration_terminal_outcome <> 'PUBLISHED' then return new; end if;
  if not exists (
    select 1
    from public.product_registration_v5_publication_pointers p
    join public.product_registration_v5_revisions r
      on r.id = p.current_revision_id
     and r.catalog_product_id = p.catalog_product_id
    where p.tenant_id = new.tenant_id
      and p.state = 'published'
      and r.source_document_id = new.source_document_id
  ) then
    raise exception 'REGISTRATION_PUBLISHED_JOB_POINTER_REQUIRED:%', new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_upload_jobs_published_pointer on public.upload_jobs;
create constraint trigger trg_upload_jobs_published_pointer
after insert or update of registration_terminal_outcome on public.upload_jobs
deferrable initially deferred
for each row execute function internal_product_registration.assert_published_job_pointer();

create or replace function internal_product_registration.reserve_job_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_source_document_id uuid := nullif(p_payload->>'source_document_id', '')::uuid;
  v_operation_key text := nullif(btrim(p_payload->>'operation_key'), '');
  v_source_type text := p_payload->>'source_type';
  v_normalized_hash text := nullif(p_payload->>'normalized_hash', '');
  v_job public.upload_jobs%rowtype;
  v_inserted boolean := false;
begin
  if v_tenant_id is null or v_source_document_id is null or v_operation_key is null
    or v_source_type not in ('text', 'file')
    or v_normalized_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'REGISTRATION_JOB_RESERVATION_INPUT_INVALID';
  end if;

  insert into public.upload_jobs (
    source_type, tenant_id, status, source_document_id, normalized_hash,
    v4_stage, v4_parser_engine, v4_parser_version, v4_stage_state,
    v4_review_reasons, v6_date_policy_version, v6_source_channel,
    v6_reference_date, registration_current_stage, registration_job_state,
    registration_operation_key, workflow_version, parser_version,
    normalizer_version, publication_policy_version, renderer_version,
    schema_version, engine_commit_sha
  ) values (
    v_source_type, v_tenant_id, 'queued', v_source_document_id, v_normalized_hash,
    'uploaded', nullif(p_payload->>'parser_engine', ''), nullif(p_payload->>'parser_version', ''),
    coalesce(p_payload->'initial_state', '{}'::jsonb), '[]'::jsonb,
    nullif(p_payload->>'date_policy_version', ''),
    coalesce(nullif(p_payload->>'source_channel', ''), 'upload'),
    coalesce(nullif(p_payload->>'reference_date', '')::date, timezone('Asia/Seoul', now())::date),
    'RECEIVED', 'QUEUED', v_operation_key,
    coalesce(nullif(p_payload->>'workflow_version', ''), 'v6.1-recompile'),
    nullif(p_payload->>'parser_version', ''), nullif(p_payload->>'normalizer_version', ''),
    nullif(p_payload->>'publication_policy_version', ''), nullif(p_payload->>'renderer_version', ''),
    coalesce(nullif(p_payload->>'schema_version', ''), 'product-registration-v61-schema-1'),
    nullif(p_payload->>'engine_commit_sha', '')
  )
  on conflict (tenant_id, registration_operation_key) do nothing
  returning * into v_job;
  v_inserted := found;

  if not v_inserted then
    select * into v_job
    from public.upload_jobs j
    where j.tenant_id = v_tenant_id and j.registration_operation_key = v_operation_key
    for share;
    if not found then raise exception 'REGISTRATION_JOB_RESERVATION_CONFLICT'; end if;
    if v_job.source_document_id is distinct from v_source_document_id
      or v_job.normalized_hash is distinct from v_normalized_hash
      or v_job.source_type is distinct from v_source_type then
      raise exception 'REGISTRATION_JOB_OPERATION_KEY_REUSED';
    end if;
  end if;

  return jsonb_build_object(
    'job_id', v_job.id,
    'source_document_id', v_job.source_document_id,
    'current_stage', v_job.registration_current_stage,
    'job_state', v_job.registration_job_state,
    'terminal_outcome', v_job.registration_terminal_outcome,
    'workflow_version', v_job.workflow_version,
    'dedupe_hit', not v_inserted,
    'workflow_run_id', v_job.v6_workflow_run_id,
    'fencing_token', v_job.v6_fencing_token,
    'reference_date', v_job.v6_reference_date,
    'date_policy_version', v_job.v6_date_policy_version
  );
end;
$$;

create or replace function public.reserve_product_registration_v61_job(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.reserve_job_atomic(p_payload);
$$;

-- Convert the previous event-per-status table into one immutable row per
-- attempt. Running rows may transition once; terminal attempts cannot mutate.
drop trigger if exists trg_workflow_stage_runs_immutable
  on internal_product_registration.workflow_stage_runs;

alter table internal_product_registration.workflow_stage_runs
  add column if not exists attempt_no integer,
  add column if not exists output_artifact_id uuid,
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz;

alter table internal_product_registration.workflow_stage_runs
  drop constraint if exists workflow_stage_runs_status_check;

with numbered as (
  select id,
    row_number() over (
      partition by job_id, stage_name, stage_version, input_hash
      order by created_at, id
    )::integer as attempt_no
  from internal_product_registration.workflow_stage_runs
)
update internal_product_registration.workflow_stage_runs r
set attempt_no = n.attempt_no,
    started_at = coalesce(r.started_at, r.created_at),
    finished_at = case when r.status = 'running' then null else coalesce(r.finished_at, r.created_at) end,
    status = case when r.status = 'failed' then 'failed_retryable' else r.status end
from numbered n
where r.id = n.id;

alter table internal_product_registration.workflow_stage_runs
  alter column attempt_no set default 1,
  alter column attempt_no set not null,
  alter column started_at set default now(),
  alter column started_at set not null;

alter table internal_product_registration.workflow_stage_runs
  add constraint workflow_stage_runs_status_check check (
    status in ('running', 'succeeded', 'failed_retryable', 'failed_terminal', 'abandoned')
  ),
  add constraint workflow_stage_runs_attempt_no_check check (attempt_no >= 1),
  add constraint workflow_stage_runs_finished_at_check check (
    (status = 'running' and finished_at is null)
    or (status <> 'running' and finished_at is not null)
  );

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'internal_product_registration.workflow_stage_runs'::regclass
      and contype = 'u'
  loop
    execute format(
      'alter table internal_product_registration.workflow_stage_runs drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

create unique index if not exists idx_pr_v61_stage_attempt_unique
  on internal_product_registration.workflow_stage_runs(
    job_id, stage_name, stage_version, input_hash, attempt_no
  );
create unique index if not exists idx_pr_v61_stage_success_unique
  on internal_product_registration.workflow_stage_runs(
    job_id, stage_name, stage_version, input_hash
  ) where status = 'succeeded';
create index if not exists idx_pr_v61_stage_running_fence
  on internal_product_registration.workflow_stage_runs(job_id, fencing_token, started_at)
  where status = 'running';

create or replace function internal_product_registration.guard_stage_attempt_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, internal_product_registration, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'REGISTRATION_STAGE_ATTEMPT_DELETE_FORBIDDEN';
  end if;
  if old.status <> 'running' then
    raise exception 'REGISTRATION_STAGE_ATTEMPT_TERMINAL_IMMUTABLE';
  end if;
  if new.job_id is distinct from old.job_id
    or new.stage_name is distinct from old.stage_name
    or new.stage_version is distinct from old.stage_version
    or new.input_hash is distinct from old.input_hash
    or new.attempt_no is distinct from old.attempt_no
    or new.fencing_token is distinct from old.fencing_token
    or new.started_at is distinct from old.started_at then
    raise exception 'REGISTRATION_STAGE_ATTEMPT_IDENTITY_IMMUTABLE';
  end if;
  if new.status not in ('succeeded', 'failed_retryable', 'failed_terminal', 'abandoned')
    or new.finished_at is null then
    raise exception 'REGISTRATION_STAGE_ATTEMPT_TRANSITION_INVALID';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_workflow_stage_runs_v61_guard
  on internal_product_registration.workflow_stage_runs;
create trigger trg_workflow_stage_runs_v61_guard
before update or delete on internal_product_registration.workflow_stage_runs
for each row execute function internal_product_registration.guard_stage_attempt_transition();

create or replace function internal_product_registration.stage_to_current_stage(p_stage text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case p_stage
    when 'intake' then 'SOURCE_STORED'
    when 'preflight' then 'SOURCE_STORED'
    when 'deduplicate' then 'SOURCE_STORED'
    when 'extract' then 'PARSED'
    when 'bundle_sources' then 'PARSED'
    when 'segment' then 'NORMALIZED'
    when 'normalize' then 'NORMALIZED'
    when 'resolve_critical_facts' then 'ENRICHED'
    when 'resolve_shared_facts' then 'ENRICHED'
    when 'validate' then 'VALIDATED'
    when 'project_compatibility' then 'VERSION_COMMITTED'
    when 'build_snapshot' then 'CANDIDATE_SNAPSHOTTED'
    when 'browser_proof' then 'BROWSER_PROVED'
    when 'publish_pointer' then 'BROWSER_PROVED'
    when 'converge_surfaces' then 'BROWSER_PROVED'
    else 'RECEIVED'
  end;
$$;

create or replace function internal_product_registration.record_stage_attempt(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_job_id uuid := nullif(p_payload->>'job_id', '')::uuid;
  v_fencing_token bigint := nullif(p_payload->>'fencing_token', '')::bigint;
  v_stage text := nullif(btrim(p_payload->>'stage_name'), '');
  v_stage_version text := nullif(btrim(p_payload->>'stage_version'), '');
  v_input_hash text := p_payload->>'input_hash';
  v_status text := p_payload->>'status';
  v_job public.upload_jobs%rowtype;
  v_run internal_product_registration.workflow_stage_runs%rowtype;
  v_attempt_no integer;
  v_next_attempt_at timestamptz;
begin
  if v_job_id is null or v_fencing_token is null or v_stage is null
    or v_stage_version is null or v_input_hash !~ '^[0-9a-f]{64}$'
    or v_status not in ('running', 'succeeded', 'failed_retryable', 'failed_terminal', 'abandoned') then
    raise exception 'REGISTRATION_STAGE_ATTEMPT_INPUT_INVALID';
  end if;

  select * into v_job
  from public.upload_jobs j
  where j.id = v_job_id and j.v6_fencing_token = v_fencing_token
  for update;
  if not found then raise exception 'REGISTRATION_STAGE_ATTEMPT_STALE_WORKER'; end if;

  if v_status = 'running' then
    select * into v_run
    from internal_product_registration.workflow_stage_runs r
    where r.job_id = v_job_id and r.stage_name = v_stage
      and r.stage_version = v_stage_version and r.input_hash = v_input_hash
      and r.status = 'succeeded'
    limit 1;
    if found then
      return jsonb_build_object('id', v_run.id, 'attempt_no', v_run.attempt_no, 'dedupe_hit', true);
    end if;

    select * into v_run
    from internal_product_registration.workflow_stage_runs r
    where r.job_id = v_job_id and r.stage_name = v_stage
      and r.stage_version = v_stage_version and r.input_hash = v_input_hash
      and r.fencing_token = v_fencing_token and r.status = 'running'
    order by r.attempt_no desc
    limit 1;
    if found then
      return jsonb_build_object('id', v_run.id, 'attempt_no', v_run.attempt_no, 'dedupe_hit', true);
    end if;

    select coalesce(max(r.attempt_no), 0) + 1 into v_attempt_no
    from internal_product_registration.workflow_stage_runs r
    where r.job_id = v_job_id and r.stage_name = v_stage
      and r.stage_version = v_stage_version and r.input_hash = v_input_hash;

    insert into internal_product_registration.workflow_stage_runs (
      tenant_id, job_id, workflow_run_id, fencing_token, stage_name,
      stage_version, input_hash, attempt_no, status, output,
      error_code, error_detail, started_at, finished_at
    ) values (
      v_job.tenant_id, v_job_id, nullif(p_payload->>'workflow_run_id', ''),
      v_fencing_token, v_stage, v_stage_version, v_input_hash, v_attempt_no,
      'running', '{}'::jsonb, null, null, now(), null
    ) returning * into v_run;

    update public.upload_jobs
    set registration_job_state = 'RUNNING',
        registration_terminal_outcome = null,
        registration_current_stage = internal_product_registration.stage_to_current_stage(v_stage),
        registration_next_attempt_at = null,
        updated_at = now()
    where id = v_job_id and v6_fencing_token = v_fencing_token
      and registration_job_state <> 'TERMINAL';
    return jsonb_build_object('id', v_run.id, 'attempt_no', v_run.attempt_no, 'dedupe_hit', false);
  end if;

  select * into v_run
  from internal_product_registration.workflow_stage_runs r
  where r.job_id = v_job_id and r.stage_name = v_stage
    and r.stage_version = v_stage_version and r.input_hash = v_input_hash
    and r.fencing_token = v_fencing_token and r.status = 'running'
  order by r.attempt_no desc
  limit 1
  for update;

  if not found then
    if v_status = 'succeeded' then
      select * into v_run
      from internal_product_registration.workflow_stage_runs r
      where r.job_id = v_job_id and r.stage_name = v_stage
        and r.stage_version = v_stage_version and r.input_hash = v_input_hash
        and r.status = 'succeeded'
      limit 1;
      if found then
        return jsonb_build_object('id', v_run.id, 'attempt_no', v_run.attempt_no, 'dedupe_hit', true);
      end if;
    end if;
    raise exception 'REGISTRATION_STAGE_ATTEMPT_STALE_WORKER';
  end if;

  update internal_product_registration.workflow_stage_runs
  set status = v_status,
      output = coalesce(p_payload->'output', '{}'::jsonb),
      output_artifact_id = nullif(p_payload->>'output_artifact_id', '')::uuid,
      error_code = nullif(p_payload->>'error_code', ''),
      error_detail = nullif(p_payload->>'error_detail', ''),
      finished_at = now()
  where id = v_run.id and fencing_token = v_fencing_token and status = 'running'
  returning * into v_run;
  if not found then raise exception 'REGISTRATION_STAGE_ATTEMPT_STALE_WORKER'; end if;

  if v_status = 'failed_retryable' then
    v_next_attempt_at := coalesce(
      nullif(p_payload->>'next_attempt_at', '')::timestamptz,
      now() + interval '1 minute'
    );
    update public.upload_jobs
    set registration_job_state = 'WAITING',
        registration_terminal_outcome = null,
        registration_next_attempt_at = v_next_attempt_at,
        updated_at = now()
    where id = v_job_id and v6_fencing_token = v_fencing_token
      and registration_job_state <> 'TERMINAL';
  elsif v_status = 'failed_terminal' then
    update public.upload_jobs
    set registration_job_state = 'TERMINAL',
        registration_terminal_outcome = 'FAILED_TERMINAL',
        registration_next_attempt_at = null,
        updated_at = now()
    where id = v_job_id and v6_fencing_token = v_fencing_token
      and registration_job_state <> 'TERMINAL';
  else
    update public.upload_jobs
    set registration_job_state = 'RUNNING',
        registration_terminal_outcome = null,
        registration_current_stage = internal_product_registration.stage_to_current_stage(v_stage),
        registration_next_attempt_at = null,
        updated_at = now()
    where id = v_job_id and v6_fencing_token = v_fencing_token
      and registration_job_state <> 'TERMINAL';
  end if;

  return jsonb_build_object('id', v_run.id, 'attempt_no', v_run.attempt_no, 'dedupe_hit', false);
end;
$$;

create or replace function public.record_product_registration_v6_stage_run(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.record_stage_attempt(p_payload);
$$;

revoke all on function internal_product_registration.sync_v61_job_state()
  from public, anon, authenticated;
revoke all on function internal_product_registration.assert_published_job_pointer()
  from public, anon, authenticated;
revoke all on function internal_product_registration.reserve_job_atomic(jsonb)
  from public, anon, authenticated;
revoke all on function public.reserve_product_registration_v61_job(jsonb)
  from public, anon, authenticated;
revoke all on function internal_product_registration.guard_stage_attempt_transition()
  from public, anon, authenticated;
revoke all on function internal_product_registration.stage_to_current_stage(text)
  from public, anon, authenticated;
revoke all on function internal_product_registration.record_stage_attempt(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_product_registration_v6_stage_run(jsonb)
  from public, anon, authenticated;

grant execute on function public.reserve_product_registration_v61_job(jsonb) to service_role;
grant execute on function public.record_product_registration_v6_stage_run(jsonb) to service_role;

comment on column public.upload_jobs.registration_job_state is
  'Execution state only: QUEUED, RUNNING, WAITING, or TERMINAL. Retryable failure is stored on the stage attempt.';
comment on table internal_product_registration.workflow_stage_runs is
  'V6.1 one-row-per-attempt stage ledger. Attempt identity is stable; fencing_token rejects stale finalization.';
