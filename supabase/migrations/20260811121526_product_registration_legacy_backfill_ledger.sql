create table if not exists internal_product_registration.legacy_backfill_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  package_id uuid not null references public.travel_packages(id) on delete restrict,
  workflow_job_id uuid references public.upload_jobs(id) on delete set null,
  workflow_run_id text,
  source_document_id uuid references public.product_source_documents(id) on delete set null,
  status text not null default 'reserved'
    check (status in ('reserved', 'started', 'verified', 'degraded', 'blocked', 'failed')),
  attempt_count integer not null default 1 check (attempt_count between 1 and 3),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  terminal_at timestamptz,
  unique (tenant_id, catalog_product_id),
  unique (tenant_id, package_id)
);

create index if not exists idx_registration_legacy_backfill_pending
  on internal_product_registration.legacy_backfill_jobs(status, updated_at)
  where status in ('reserved', 'started', 'failed');

alter table internal_product_registration.legacy_backfill_jobs enable row level security;
revoke all on table internal_product_registration.legacy_backfill_jobs from public, anon, authenticated;
grant select, insert, update on table internal_product_registration.legacy_backfill_jobs to service_role;

create policy legacy_backfill_jobs_service_role
  on internal_product_registration.legacy_backfill_jobs
  for all to service_role using (true) with check (true);

create or replace function internal_product_registration.sync_legacy_backfill_terminal_states()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_count integer;
begin
  -- A workflow may have started successfully while the short follow-up bind RPC
  -- timed out. Recover that link from the deterministic operation key before
  -- selecting work again so the same legacy package is never started twice.
  update internal_product_registration.legacy_backfill_jobs b
  set workflow_job_id = j.id,
      workflow_run_id = j.v6_workflow_run_id,
      source_document_id = j.source_document_id,
      status = 'started',
      updated_at = now()
  from public.upload_jobs j
  where b.status = 'reserved'
    and j.v4_stage_state->>'authorityBindingOperationKey'
      = 'legacy-backfill:' || b.id::text || ':' || b.attempt_count::text;

  update internal_product_registration.legacy_backfill_jobs b
  set status = case j.v6_analysis_outcome
        when 'verified' then 'verified'
        when 'degraded' then 'degraded'
        when 'blocked' then 'blocked'
        else b.status
      end,
      terminal_at = coalesce(j.v6_terminal_at, now()),
      last_error = case
        when j.v6_analysis_outcome = 'blocked' then array_to_string(
          array(select jsonb_array_elements_text(coalesce(j.v6_blockers, '[]'::jsonb))),
          '|'
        )
        else null
      end,
      updated_at = now()
  from public.upload_jobs j
  where b.workflow_job_id = j.id
    and b.status in ('reserved', 'started')
    and j.v6_analysis_outcome is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.claim_product_registration_legacy_backfill(p_limit integer default 10)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform internal_product_registration.sync_legacy_backfill_terminal_states();
  with candidates as (
    select p.tenant_id, p.catalog_product_id, p.id as package_id
    from public.travel_packages p
    left join internal_product_registration.legacy_backfill_jobs b
      on b.tenant_id = p.tenant_id and b.catalog_product_id = p.catalog_product_id
    where p.catalog_product_id is not null
      and p.tenant_id is not null
      and length(btrim(coalesce(p.raw_text, ''))) >= 50
      and (
        b.id is null
        or (b.status = 'failed' and b.attempt_count < 3 and b.updated_at < now() - interval '30 minutes')
      )
    order by p.created_at, p.id
    for update of p skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 25))
  ), claimed as (
    insert into internal_product_registration.legacy_backfill_jobs (
      tenant_id, catalog_product_id, package_id, status, attempt_count, last_error, updated_at
    )
    select tenant_id, catalog_product_id, package_id, 'reserved', 1, null, now()
    from candidates
    on conflict (tenant_id, catalog_product_id) do update
      set status = 'reserved',
          attempt_count = internal_product_registration.legacy_backfill_jobs.attempt_count + 1,
          last_error = null,
          updated_at = now(),
          workflow_job_id = null,
          workflow_run_id = null,
          source_document_id = null,
          terminal_at = null
      where internal_product_registration.legacy_backfill_jobs.status = 'failed'
        and internal_product_registration.legacy_backfill_jobs.attempt_count < 3
    returning id, tenant_id, catalog_product_id, package_id, attempt_count
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v_result
  from claimed;
  return v_result;
end;
$$;

create or replace function public.bind_product_registration_legacy_backfill(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_row internal_product_registration.legacy_backfill_jobs%rowtype;
begin
  update internal_product_registration.legacy_backfill_jobs
  set workflow_job_id = nullif(p_payload->>'workflow_job_id', '')::uuid,
      workflow_run_id = nullif(p_payload->>'workflow_run_id', ''),
      source_document_id = nullif(p_payload->>'source_document_id', '')::uuid,
      status = 'started',
      updated_at = now()
  where id = nullif(p_payload->>'backfill_id', '')::uuid
    and tenant_id = nullif(p_payload->>'tenant_id', '')::uuid
    and catalog_product_id = nullif(p_payload->>'catalog_product_id', '')::uuid
    and status = 'reserved'
  returning * into v_row;
  if not found then raise exception 'REGISTRATION_LEGACY_BACKFILL_BIND_CONFLICT'; end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'workflow_job_id', v_row.workflow_job_id);
end;
$$;

create or replace function public.fail_product_registration_legacy_backfill(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_row internal_product_registration.legacy_backfill_jobs%rowtype;
begin
  update internal_product_registration.legacy_backfill_jobs
  set status = 'failed',
      last_error = left(coalesce(p_payload->>'error', 'LEGACY_BACKFILL_START_FAILED'), 2000),
      terminal_at = now(),
      updated_at = now()
  where id = nullif(p_payload->>'backfill_id', '')::uuid
    and tenant_id = nullif(p_payload->>'tenant_id', '')::uuid
    and status = 'reserved'
  returning * into v_row;
  if not found then raise exception 'REGISTRATION_LEGACY_BACKFILL_FAIL_CONFLICT'; end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end;
$$;

revoke all on function internal_product_registration.sync_legacy_backfill_terminal_states() from public, anon, authenticated;
revoke all on function public.claim_product_registration_legacy_backfill(integer) from public, anon, authenticated;
revoke all on function public.bind_product_registration_legacy_backfill(jsonb) from public, anon, authenticated;
revoke all on function public.fail_product_registration_legacy_backfill(jsonb) from public, anon, authenticated;
grant execute on function public.claim_product_registration_legacy_backfill(integer) to service_role;
grant execute on function public.bind_product_registration_legacy_backfill(jsonb) to service_role;
grant execute on function public.fail_product_registration_legacy_backfill(jsonb) to service_role;
