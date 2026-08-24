-- Durable manual publication workflow. Registration stops at an immutable
-- candidate snapshot; this queue owns exact revalidation, proof, atomic
-- pointer commit, live canary and fail-closed compensation.

alter table internal_product_registration.publication_requests
  add column if not exists workflow_run_id text,
  add column if not exists workflow_attempt_count integer not null default 0,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists live_canary_result jsonb,
  add column if not exists live_canary_checked_at timestamptz;

alter table internal_product_registration.publication_requests
  drop constraint if exists publication_requests_workflow_attempt_count_check,
  add constraint publication_requests_workflow_attempt_count_check
    check (workflow_attempt_count between 0 and 3),
  drop constraint if exists publication_requests_live_canary_result_check,
  add constraint publication_requests_live_canary_result_check
    check (live_canary_result is null or jsonb_typeof(live_canary_result) = 'object');

create or replace function internal_product_registration.claim_publication_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_request_id uuid := nullif(p_payload->>'publication_request_id', '')::uuid;
  v_workflow_run_id text := nullif(btrim(p_payload->>'workflow_run_id'), '');
  v_request internal_product_registration.publication_requests%rowtype;
  v_latest_revision public.product_registration_v5_revisions%rowtype;
  v_channel text;
  v_actual_pointer_version bigint;
begin
  if v_request_id is null or v_workflow_run_id is null then
    raise exception 'REGISTRATION_PUBLICATION_WORKFLOW_CLAIM_REQUIRED';
  end if;

  select request.* into v_request
  from internal_product_registration.publication_requests request
  where request.id = v_request_id
  for update;
  if not found then raise exception 'REGISTRATION_PUBLICATION_REQUEST_NOT_FOUND'; end if;
  if v_request.status = 'published_verified' then
    return jsonb_build_object('action', 'complete', 'request', to_jsonb(v_request));
  end if;
  if v_request.status in ('rejected', 'superseded', 'blocked', 'convergence_failed') then
    return jsonb_build_object('action', 'terminal', 'request', to_jsonb(v_request));
  end if;
  if v_request.workflow_run_id is not null
    and v_request.workflow_run_id <> v_workflow_run_id
    and v_request.lease_expires_at > now() then
    return jsonb_build_object(
      'action', 'in_flight',
      'workflow_run_id', v_request.workflow_run_id,
      'lease_expires_at', v_request.lease_expires_at,
      'request', to_jsonb(v_request)
    );
  end if;
  if v_request.status = 'pointer_committed' then
    update internal_product_registration.publication_requests
    set workflow_run_id = v_workflow_run_id,
        workflow_attempt_count = least(workflow_attempt_count + 1, 3),
        lease_expires_at = now() + interval '15 minutes',
        updated_at = now()
    where id = v_request.id
    returning * into v_request;
    return jsonb_build_object('action', 'compensate', 'request', to_jsonb(v_request));
  end if;
  if v_request.workflow_attempt_count >= 3 then
    update internal_product_registration.publication_requests
    set status = 'blocked',
        error_code = 'REGISTRATION_PUBLICATION_RETRY_EXHAUSTED',
        error_detail = 'Publication request exceeded three durable workflow attempts.',
        lease_expires_at = null,
        completed_at = now(),
        updated_at = now()
    where id = v_request.id
    returning * into v_request;
    return jsonb_build_object('action', 'exhausted', 'request', to_jsonb(v_request));
  end if;

  select revision.* into v_latest_revision
  from public.product_registration_v5_revisions revision
  where revision.tenant_id = v_request.tenant_id
    and revision.catalog_product_id = v_request.catalog_product_id
  order by revision.revision_no desc, revision.created_at desc
  limit 1
  for share;
  if not found
    or v_latest_revision.id is distinct from v_request.expected_revision_id
    or v_latest_revision.revision_no is distinct from v_request.expected_revision_no then
    update internal_product_registration.publication_requests
    set status = 'superseded',
        error_code = 'REVISION_CHANGED_REVALIDATION_REQUIRED',
        error_detail = 'The latest immutable revision changed after review.',
        workflow_run_id = v_workflow_run_id,
        lease_expires_at = null,
        completed_at = now(),
        updated_at = now()
    where id = v_request.id
    returning * into v_request;
    return jsonb_build_object('action', 'superseded', 'request', to_jsonb(v_request));
  end if;

  if not exists (
    select 1
    from public.product_source_documents source_document
    where source_document.id = v_latest_revision.source_document_id
      and source_document.tenant_id = v_request.tenant_id
      and source_document.sha256 = v_request.expected_source_hash
  ) or not exists (
    select 1
    from public.travel_packages package
    where package.id = v_request.package_id
      and package.tenant_id = v_request.tenant_id
      and package.catalog_product_id = v_request.catalog_product_id
      and package.canonical_revision_id = v_request.expected_revision_id
  ) then
    update internal_product_registration.publication_requests
    set status = 'blocked',
        error_code = 'REGISTRATION_PUBLICATION_LINEAGE_REVALIDATION_FAILED',
        error_detail = 'Source or compatibility projection no longer matches the reviewed revision.',
        workflow_run_id = v_workflow_run_id,
        lease_expires_at = null,
        completed_at = now(),
        updated_at = now()
    where id = v_request.id
    returning * into v_request;
    return jsonb_build_object('action', 'blocked', 'request', to_jsonb(v_request));
  end if;

  foreach v_channel in array v_request.channels loop
    select pointer.pointer_version into v_actual_pointer_version
    from public.product_registration_v5_publication_pointers pointer
    where pointer.tenant_id = v_request.tenant_id
      and pointer.catalog_product_id = v_request.catalog_product_id
      and pointer.package_id = v_request.package_id
      and pointer.channel = v_channel
      and pointer.locale = v_request.locale
    for share;
    if (found and v_actual_pointer_version is distinct from nullif(v_request.expected_pointer_versions->>v_channel, '')::bigint)
      or (not found and nullif(v_request.expected_pointer_versions->>v_channel, '')::bigint <> 0) then
      update internal_product_registration.publication_requests
      set status = 'superseded',
          error_code = 'REGISTRATION_PUBLICATION_POINTER_CONFLICT',
          error_detail = 'A channel pointer changed after the publication request was reviewed.',
          workflow_run_id = v_workflow_run_id,
          lease_expires_at = null,
          completed_at = now(),
          updated_at = now()
      where id = v_request.id
      returning * into v_request;
      return jsonb_build_object('action', 'superseded', 'request', to_jsonb(v_request));
    end if;
  end loop;

  update internal_product_registration.publication_requests
  set status = 'revalidating',
      workflow_run_id = v_workflow_run_id,
      workflow_attempt_count = workflow_attempt_count + 1,
      lease_expires_at = now() + interval '15 minutes',
      error_code = null,
      error_detail = null,
      updated_at = now()
  where id = v_request.id
  returning * into v_request;
  return jsonb_build_object('action', 'execute', 'request', to_jsonb(v_request));
end;
$$;

create or replace function public.claim_product_registration_publication_request(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.claim_publication_request(p_payload);
$$;

create or replace function internal_product_registration.transition_publication_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_request_id uuid := nullif(p_payload->>'publication_request_id', '')::uuid;
  v_workflow_run_id text := nullif(btrim(p_payload->>'workflow_run_id'), '');
  v_expected_status text := nullif(p_payload->>'expected_status', '');
  v_next_status text := nullif(p_payload->>'next_status', '');
  v_snapshot_id uuid := nullif(p_payload->>'snapshot_id', '')::uuid;
  v_proof_id uuid := nullif(p_payload->>'proof_id', '')::uuid;
  v_request internal_product_registration.publication_requests%rowtype;
begin
  if v_request_id is null or v_workflow_run_id is null
    or v_expected_status is null or v_next_status is null then
    raise exception 'REGISTRATION_PUBLICATION_TRANSITION_REQUIRED';
  end if;
  if not (
    (v_expected_status = 'revalidating' and v_next_status = 'proving')
    or (v_expected_status = 'proving' and v_next_status = 'ready')
    or (v_expected_status = 'pointer_committed' and v_next_status in ('published_verified', 'convergence_failed'))
    or (v_expected_status in ('requested', 'revalidating', 'proving', 'ready') and v_next_status in ('blocked', 'rejected', 'superseded'))
  ) then
    raise exception 'REGISTRATION_PUBLICATION_TRANSITION_INVALID:%->%', v_expected_status, v_next_status;
  end if;

  select request.* into v_request
  from internal_product_registration.publication_requests request
  where request.id = v_request_id
  for update;
  if not found then raise exception 'REGISTRATION_PUBLICATION_REQUEST_NOT_FOUND'; end if;
  if v_request.workflow_run_id is distinct from v_workflow_run_id then
    raise exception 'REGISTRATION_PUBLICATION_WORKFLOW_FENCING_CONFLICT';
  end if;
  if v_request.status is distinct from v_expected_status then
    if v_request.status = v_next_status then
      return jsonb_build_object('replayed', true, 'request', to_jsonb(v_request));
    end if;
    raise exception 'REGISTRATION_PUBLICATION_STATUS_CONFLICT:%', v_request.status;
  end if;

  if v_next_status = 'ready' then
    if v_snapshot_id is null or v_proof_id is null
      or not exists (
        select 1
        from public.public_package_snapshots snapshot
        where snapshot.id = v_snapshot_id
          and snapshot.tenant_id = v_request.tenant_id
          and snapshot.catalog_product_id = v_request.catalog_product_id
          and snapshot.package_id = v_request.package_id
          and snapshot.canonical_revision_id = v_request.expected_revision_id
          and snapshot.status in ('candidate', 'published')
      ) or not exists (
        select 1
        from public.product_registration_v5_proof_runs proof
        where proof.id = v_proof_id
          and proof.tenant_id = v_request.tenant_id
          and proof.catalog_product_id = v_request.catalog_product_id
          and proof.package_id = v_request.package_id
          and proof.revision_id = v_request.expected_revision_id
          and proof.public_snapshot_id = v_snapshot_id
          and proof.status = 'passed'
      ) then
      raise exception 'REGISTRATION_PUBLICATION_READY_EVIDENCE_MISMATCH';
    end if;
  end if;

  update internal_product_registration.publication_requests
  set status = v_next_status,
      snapshot_id = coalesce(v_snapshot_id, snapshot_id),
      proof_id = coalesce(v_proof_id, proof_id),
      release_manifest_hash = coalesce(nullif(p_payload->>'release_manifest_hash', ''), release_manifest_hash),
      live_canary_result = coalesce(p_payload->'live_canary_result', live_canary_result),
      live_canary_checked_at = case when p_payload ? 'live_canary_result' then now() else live_canary_checked_at end,
      error_code = nullif(p_payload->>'error_code', ''),
      error_detail = nullif(p_payload->>'error_detail', ''),
      lease_expires_at = case
        when v_next_status in ('published_verified', 'convergence_failed', 'blocked', 'rejected', 'superseded') then null
        else now() + interval '15 minutes'
      end,
      completed_at = case
        when v_next_status in ('published_verified', 'convergence_failed', 'blocked', 'rejected', 'superseded') then now()
        else completed_at
      end,
      updated_at = now()
  where id = v_request.id
  returning * into v_request;
  return jsonb_build_object('replayed', false, 'request', to_jsonb(v_request));
end;
$$;

create or replace function public.transition_product_registration_publication_request(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.transition_publication_request(p_payload);
$$;

create or replace function public.get_product_registration_publication_request(p_request_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select to_jsonb(request)
  from internal_product_registration.publication_requests request
  where request.id = p_request_id
$$;

create or replace function public.list_product_registration_publication_dispatches(p_limit integer default 10)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'publication_request_id', dispatch.id,
    'status', dispatch.status,
    'workflow_run_id', dispatch.workflow_run_id,
    'workflow_attempt_count', dispatch.workflow_attempt_count,
    'lease_expires_at', dispatch.lease_expires_at
  ) order by dispatch.requested_at), '[]'::jsonb)
  from (
    select request.*
    from internal_product_registration.publication_requests request
    where request.workflow_attempt_count < 3
      and (
        request.status = 'requested'
        or (
          request.status in ('revalidating', 'proving', 'ready')
          or request.status = 'pointer_committed'
        )
        and request.lease_expires_at <= now()
      )
    order by request.requested_at
    limit least(greatest(p_limit, 1), 20)
  ) dispatch
$$;

create or replace function public.mark_product_registration_convergence_failed(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_result jsonb;
  v_request_id uuid := nullif(p_payload->>'publication_request_id', '')::uuid;
begin
  v_result := internal_product_registration.mark_convergence_failed(p_payload);
  if v_request_id is not null and p_payload ? 'live_canary_result' then
    update internal_product_registration.publication_requests
    set live_canary_result = p_payload->'live_canary_result',
        live_canary_checked_at = now(),
        updated_at = now()
    where id = v_request_id;
  end if;
  return v_result;
end;
$$;

revoke all on function internal_product_registration.claim_publication_request(jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_product_registration_publication_request(jsonb)
  from public, anon, authenticated;
revoke all on function internal_product_registration.transition_publication_request(jsonb)
  from public, anon, authenticated;
revoke all on function public.transition_product_registration_publication_request(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_product_registration_publication_request(uuid)
  from public, anon, authenticated;
revoke all on function public.list_product_registration_publication_dispatches(integer)
  from public, anon, authenticated;
revoke all on function public.mark_product_registration_convergence_failed(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.claim_publication_request(jsonb)
  to service_role;
grant execute on function public.claim_product_registration_publication_request(jsonb)
  to service_role;
grant execute on function internal_product_registration.transition_publication_request(jsonb)
  to service_role;
grant execute on function public.transition_product_registration_publication_request(jsonb)
  to service_role;
grant execute on function public.get_product_registration_publication_request(uuid)
  to service_role;
grant execute on function public.list_product_registration_publication_dispatches(integer)
  to service_role;
grant execute on function public.mark_product_registration_convergence_failed(jsonb)
  to service_role;

comment on function public.claim_product_registration_publication_request(jsonb) is
  'Claims one exact reviewed publication request with a 15-minute lease, latest-revision fencing, pointer CAS revalidation and three-attempt poison isolation.';
