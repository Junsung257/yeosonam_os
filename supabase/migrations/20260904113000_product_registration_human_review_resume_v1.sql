-- Product Registration V6 PR-06: review-completed resume worker.
--
-- This migration adds only a private processing ledger and service-role RPCs.
-- Review history remains append-only; the worker can create an extraction or a
-- shadow normalization, but it never creates a Revision, Snapshot, or public
-- pointer.

create table if not exists internal_product_registration.product_review_resume_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  event_id uuid not null references internal_product_registration.product_review_events(id) on delete restrict,
  case_id uuid not null references internal_product_registration.product_review_cases(id) on delete restrict,
  receipt_id uuid not null references internal_product_registration.product_review_receipts(id) on delete restrict,
  worker_id text not null check (btrim(worker_id) <> ''),
  status text not null default 'claimed' check (status in ('claimed', 'succeeded', 'skipped', 'failed', 'unknown_outcome')),
  attempt_count integer not null default 1 check (attempt_count >= 1),
  lease_expires_at timestamptz not null,
  derived_extraction_id uuid references public.product_document_extractions(id) on delete restrict,
  normalization_id uuid references public.product_registration_v4_normalizations(id) on delete restrict,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (event_id),
  check ((status in ('succeeded', 'skipped')) = (completed_at is not null))
);

create index if not exists idx_product_review_resume_claims
  on internal_product_registration.product_review_resume_runs(status, lease_expires_at, created_at);

alter table internal_product_registration.product_review_resume_runs enable row level security;
alter table internal_product_registration.product_review_resume_runs force row level security;
revoke all on table internal_product_registration.product_review_resume_runs from public, anon, authenticated, service_role;

create or replace function public.claim_product_registration_review_resume(
  p_limit integer default 5,
  p_worker_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_event record;
  v_run_id uuid;
  v_result jsonb := '[]'::jsonb;
  v_worker text := nullif(btrim(p_worker_id), '');
begin
  if v_worker is null then raise exception 'PRODUCT_REVIEW_RESUME_WORKER_REQUIRED'; end if;
  for v_event in
    select e.id as event_id,
      e.tenant_id,
      e.case_id,
      e.receipt_id,
      c.status as case_status,
      c.job_id,
      c.source_document_id,
      c.packet,
      c.reason_codes,
      c.source_hash,
      c.parent_extraction_hash,
      r.reviewer_id,
      r.reviewer_slot,
      r.receipt_hash,
      to_jsonb(r) as receipt,
      (
        select coalesce(jsonb_agg(to_jsonb(all_receipts) order by all_receipts.created_at, all_receipts.id), '[]'::jsonb)
        from internal_product_registration.product_review_receipts all_receipts
        where all_receipts.case_id = c.id
      ) as receipts,
      e.from_status,
      e.to_status,
      e.created_at as event_created_at,
      jsonb_build_object(
        'id', x.id,
        'sourceDocumentId', x.source_document_id,
        'sourceHash', d.sha256,
        'extractionHash', x.extraction_hash,
        'documentIr', x.document_ir
      ) as parent_extraction
    from internal_product_registration.product_review_events e
    join internal_product_registration.product_review_cases c on c.id = e.case_id and c.tenant_id = e.tenant_id
    join internal_product_registration.product_review_receipts r on r.id = e.receipt_id and r.case_id = e.case_id
    join public.product_document_extractions x on x.id = c.parent_extraction_id and x.source_document_id = c.source_document_id and x.tenant_id = c.tenant_id and x.extraction_hash = c.parent_extraction_hash
    join public.product_source_documents d on d.id = c.source_document_id and d.tenant_id = c.tenant_id
    where e.event_type = 'review_completed'
      and c.status in ('accepted', 'source_insufficient', 'system_quarantined')
      and e.id = (
        select latest.id from internal_product_registration.product_review_events latest
        where latest.case_id = e.case_id and latest.event_type = 'review_completed'
        order by latest.created_at desc, latest.id desc limit 1
      )
      and not exists (
        select 1 from internal_product_registration.product_review_resume_runs prior
        where prior.event_id = e.id
          and (prior.status in ('succeeded', 'skipped')
            or (prior.status = 'claimed' and prior.lease_expires_at > now()))
      )
    order by e.created_at, e.id
    limit least(greatest(coalesce(p_limit, 5), 1), 10)
    for update of e skip locked
  loop
    v_run_id := null;
    insert into internal_product_registration.product_review_resume_runs (
      tenant_id, event_id, case_id, receipt_id, worker_id, lease_expires_at
    ) values (
      v_event.tenant_id, v_event.event_id, v_event.case_id, v_event.receipt_id, v_worker, now() + interval '5 minutes'
    )
    on conflict (event_id) do update
      set worker_id = excluded.worker_id,
        status = 'claimed',
        attempt_count = internal_product_registration.product_review_resume_runs.attempt_count + 1,
        lease_expires_at = excluded.lease_expires_at,
        error_code = null,
        updated_at = now(),
        completed_at = null
      where internal_product_registration.product_review_resume_runs.status in ('failed', 'unknown_outcome')
        or (internal_product_registration.product_review_resume_runs.status = 'claimed'
          and internal_product_registration.product_review_resume_runs.lease_expires_at <= now())
    returning id into v_run_id;
    if v_run_id is not null then
      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'runId', v_run_id,
        'eventId', v_event.event_id,
        'tenantId', v_event.tenant_id,
        'caseId', v_event.case_id,
        'jobId', v_event.job_id,
        'caseStatus', v_event.case_status,
        'packet', v_event.packet,
        'reasonCodes', v_event.reason_codes,
        'receipt', v_event.receipt,
        'receipts', v_event.receipts,
        'parentExtraction', v_event.parent_extraction,
        'event', jsonb_build_object(
          'fromStatus', v_event.from_status,
          'toStatus', v_event.to_status,
          'createdAt', v_event.event_created_at
        )
      ));
    end if;
  end loop;
  return v_result;
end;
$$;

create or replace function public.complete_product_registration_review_resume(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_run_id uuid := nullif(p_payload->>'run_id', '')::uuid;
  v_worker text := nullif(btrim(p_payload->>'worker_id'), '');
  v_status text := nullif(p_payload->>'status', '');
  v_run internal_product_registration.product_review_resume_runs%rowtype;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
    or v_run_id is null or v_worker is null
    or v_status not in ('succeeded', 'skipped', 'failed', 'unknown_outcome') then
    raise exception 'PRODUCT_REVIEW_RESUME_COMPLETION_INVALID';
  end if;
  select * into v_run
  from internal_product_registration.product_review_resume_runs r
  where r.id = v_run_id
  for update;
  if not found then raise exception 'PRODUCT_REVIEW_RESUME_RUN_NOT_FOUND'; end if;
  if v_run.worker_id <> v_worker then raise exception 'PRODUCT_REVIEW_RESUME_WORKER_MISMATCH'; end if;
  if v_run.status not in ('claimed', 'failed', 'unknown_outcome') then
    raise exception 'PRODUCT_REVIEW_RESUME_RUN_NOT_ACTIVE';
  end if;
  if v_status in ('succeeded', 'skipped') and p_payload->>'reason_code' is null
    and p_payload->>'normalization_id' is null and p_payload->>'derived_extraction_id' is null then
    raise exception 'PRODUCT_REVIEW_RESUME_RESULT_EVIDENCE_REQUIRED';
  end if;
  update internal_product_registration.product_review_resume_runs
  set status = v_status,
    worker_id = v_worker,
    derived_extraction_id = nullif(p_payload->>'derived_extraction_id', '')::uuid,
    normalization_id = nullif(p_payload->>'normalization_id', '')::uuid,
    error_code = nullif(btrim(p_payload->>'error_code'), ''),
    completed_at = case when v_status in ('succeeded', 'skipped') then now() else null end,
    lease_expires_at = now(),
    updated_at = now()
  where id = v_run_id;
  return jsonb_build_object(
    'runId', v_run_id,
    'eventId', v_run.event_id,
    'caseId', v_run.case_id,
    'status', v_status,
    'idempotent', false
  );
end;
$$;

revoke all on function public.claim_product_registration_review_resume(integer, text) from public, anon, authenticated;
grant execute on function public.claim_product_registration_review_resume(integer, text) to service_role;
revoke all on function public.complete_product_registration_review_resume(jsonb) from public, anon, authenticated;
grant execute on function public.complete_product_registration_review_resume(jsonb) to service_role;

comment on table internal_product_registration.product_review_resume_runs is
  'Private lease/idempotency ledger for review_completed resume. It never grants Revision or customer publication authority.';
