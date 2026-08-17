-- Product-registration terminal outcomes must be visible as actionable admin
-- alerts. This reuses the existing upload DLQ instead of creating another
-- competing review engine.

alter table public.upload_review_queue
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists upload_job_id uuid references public.upload_jobs(id) on delete cascade,
  add column if not exists source_document_id uuid references public.product_source_documents(id) on delete set null,
  add column if not exists terminal_outcome text,
  add column if not exists blocker_codes jsonb not null default '[]'::jsonb,
  add column if not exists resolution_conditions jsonb not null default '[]'::jsonb;

create unique index if not exists idx_upload_review_queue_pending_registration_job
  on public.upload_review_queue(upload_job_id)
  where upload_job_id is not null and status = 'pending';

create or replace function public.enqueue_product_registration_review_alert(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_job public.upload_jobs%rowtype;
  v_terminal_outcome text := coalesce(p_payload->>'terminal_outcome', '');
  v_source_document_id uuid := nullif(p_payload->>'source_document_id', '')::uuid;
  v_blockers jsonb := coalesce(p_payload->'blockers', '[]'::jsonb);
  v_resolution_conditions jsonb := coalesce(p_payload->'resolution_conditions', '[]'::jsonb);
  v_alert_id uuid;
begin
  if v_terminal_outcome not in ('discarded_source_incomplete', 'blocked_action_required') then
    raise exception 'PRODUCT_REGISTRATION_REVIEW_ALERT_OUTCOME_INVALID';
  end if;
  if jsonb_typeof(v_blockers) <> 'array' or jsonb_typeof(v_resolution_conditions) <> 'array' then
    raise exception 'PRODUCT_REGISTRATION_REVIEW_ALERT_REASONS_INVALID';
  end if;

  select * into v_job
  from public.upload_jobs
  where id = (p_payload->>'job_id')::uuid
    and tenant_id = (p_payload->>'tenant_id')::uuid;
  if not found then raise exception 'PRODUCT_REGISTRATION_REVIEW_ALERT_JOB_NOT_FOUND'; end if;
  if v_job.v6_outcome is distinct from v_terminal_outcome then
    raise exception 'PRODUCT_REGISTRATION_REVIEW_ALERT_TERMINAL_MISMATCH';
  end if;
  if v_source_document_id is not null and not exists (
    select 1 from public.product_source_documents d
    where d.id = v_source_document_id and d.tenant_id = v_job.tenant_id
  ) then
    raise exception 'PRODUCT_REGISTRATION_REVIEW_ALERT_SOURCE_TENANT_MISMATCH';
  end if;

  insert into public.upload_review_queue (
    tenant_id, upload_job_id, source_document_id, status, severity,
    error_reason, source_filename, file_hash, terminal_outcome,
    blocker_codes, resolution_conditions, parsed_draft_json, updated_at
  ) values (
    v_job.tenant_id,
    v_job.id,
    v_source_document_id,
    'pending',
    case when v_terminal_outcome = 'blocked_action_required' then 'critical' else 'high' end,
    case
      when v_terminal_outcome = 'discarded_source_incomplete'
        then '판매가가 없거나 원문에서 판매가로 확정할 수 없어 등록하지 않았습니다.'
      else '핵심 판매 사실이 충돌하거나 불명확해 고객 공개를 차단했습니다.'
    end,
    nullif(p_payload->>'source_filename', ''),
    nullif(p_payload->>'file_hash', ''),
    v_terminal_outcome,
    v_blockers,
    v_resolution_conditions,
    jsonb_build_object(
      'workflowRunId', p_payload->>'workflow_run_id',
      'policyVersion', p_payload->>'policy_version',
      'customerVisible', false
    ),
    now()
  )
  on conflict (upload_job_id) where upload_job_id is not null and status = 'pending'
  do update set
    terminal_outcome = excluded.terminal_outcome,
    error_reason = excluded.error_reason,
    blocker_codes = excluded.blocker_codes,
    resolution_conditions = excluded.resolution_conditions,
    parsed_draft_json = excluded.parsed_draft_json,
    updated_at = now()
  returning id into v_alert_id;

  return v_alert_id;
end;
$$;

revoke all on function public.enqueue_product_registration_review_alert(jsonb)
  from public, anon, authenticated;
grant execute on function public.enqueue_product_registration_review_alert(jsonb)
  to service_role;

comment on function public.enqueue_product_registration_review_alert(jsonb) is
  'Service-role-only idempotent admin alert for terminal missing-sale or action-required product-registration jobs.';
