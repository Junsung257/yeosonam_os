-- Reserve provider operations before making billable network calls. A worker
-- retry can now reuse the durable result or wait for the existing lease
-- instead of blindly charging OAG/Cirium a second time.

alter table internal_product_registration.provider_calls
  add column if not exists attempt_count integer not null default 0
    check (attempt_count >= 0 and attempt_count <= 3),
  add column if not exists lease_expires_at timestamptz;

create or replace function internal_product_registration.reserve_provider_call(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_operation_key text := nullif(btrim(p_payload->>'operation_key'), '');
  v_request_hash text := nullif(p_payload->>'request_hash', '');
  v_row internal_product_registration.provider_calls%rowtype;
begin
  if v_tenant_id is null or v_operation_key is null or v_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'V6_PROVIDER_RESERVATION_LINEAGE_REQUIRED';
  end if;

  insert into internal_product_registration.provider_calls (
    tenant_id, job_id, product_revision_id, provider, operation,
    operation_key, request_hash, status, cost_krw, source_hash,
    revision_hash, result, created_version, attempt_count, lease_expires_at
  ) values (
    v_tenant_id,
    nullif(p_payload->>'job_id', '')::uuid,
    nullif(p_payload->>'product_revision_id', '')::uuid,
    p_payload->>'provider',
    p_payload->>'operation',
    v_operation_key,
    v_request_hash,
    'started',
    0,
    p_payload->>'source_hash',
    nullif(p_payload->>'revision_hash', ''),
    '{}'::jsonb,
    coalesce(nullif(p_payload->>'created_version', ''), 'product-registration-v6-provider-2'),
    1,
    now() + interval '10 minutes'
  ) on conflict (tenant_id, operation_key) do nothing
  returning * into v_row;

  if found then
    return jsonb_build_object('action', 'execute', 'call_id', v_row.id, 'attempt_count', 1);
  end if;

  select * into v_row
  from internal_product_registration.provider_calls
  where tenant_id = v_tenant_id and operation_key = v_operation_key
  for update;
  if not found then raise exception 'V6_PROVIDER_RESERVATION_LOST'; end if;
  if v_row.request_hash is distinct from v_request_hash then
    raise exception 'V6_PROVIDER_OPERATION_KEY_CONFLICT';
  end if;
  if v_row.status in ('succeeded', 'skipped') then
    return jsonb_build_object(
      'action', 'reuse',
      'call_id', v_row.id,
      'attempt_count', v_row.attempt_count,
      'status', v_row.status,
      'result', v_row.result,
      'cost_krw', v_row.cost_krw
    );
  end if;
  if v_row.status = 'started' and v_row.lease_expires_at > now() then
    return jsonb_build_object(
      'action', 'wait',
      'call_id', v_row.id,
      'attempt_count', v_row.attempt_count,
      'lease_expires_at', v_row.lease_expires_at
    );
  end if;
  if v_row.attempt_count >= 3 then
    return jsonb_build_object(
      'action', 'exhausted',
      'call_id', v_row.id,
      'attempt_count', v_row.attempt_count,
      'status', v_row.status,
      'result', v_row.result
    );
  end if;

  update internal_product_registration.provider_calls
  set job_id = nullif(p_payload->>'job_id', '')::uuid,
      product_revision_id = nullif(p_payload->>'product_revision_id', '')::uuid,
      status = 'started',
      response_hash = null,
      billed_units = null,
      cost_krw = 0,
      result = '{}'::jsonb,
      completed_at = null,
      started_at = now(),
      attempt_count = attempt_count + 1,
      lease_expires_at = now() + interval '10 minutes'
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'action', 'execute',
    'call_id', v_row.id,
    'attempt_count', v_row.attempt_count
  );
end;
$$;

create or replace function internal_product_registration.complete_provider_call(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_call_id uuid := nullif(p_payload->>'call_id', '')::uuid;
  v_request_hash text := nullif(p_payload->>'request_hash', '');
  v_response_hash text := nullif(p_payload->>'response_hash', '');
  v_status text := p_payload->>'status';
  v_row internal_product_registration.provider_calls%rowtype;
begin
  if v_call_id is null or v_request_hash !~ '^[0-9a-f]{64}$'
    or v_response_hash !~ '^[0-9a-f]{64}$'
    or v_status not in ('succeeded', 'failed', 'indeterminate', 'skipped') then
    raise exception 'V6_PROVIDER_COMPLETION_INVALID';
  end if;

  update internal_product_registration.provider_calls
  set response_hash = v_response_hash,
      status = v_status,
      billed_units = nullif(p_payload->>'billed_units', '')::numeric,
      cost_krw = coalesce(nullif(p_payload->>'cost_krw', '')::numeric, 0),
      result = coalesce(p_payload->'result', '{}'::jsonb),
      completed_at = now(),
      lease_expires_at = null
  where id = v_call_id
    and request_hash = v_request_hash
    and status = 'started'
  returning * into v_row;

  if not found then
    select * into v_row
    from internal_product_registration.provider_calls
    where id = v_call_id and request_hash = v_request_hash;
    if not found or v_row.response_hash is distinct from v_response_hash then
      raise exception 'V6_PROVIDER_COMPLETION_CONFLICT';
    end if;
    return jsonb_build_object('call_id', v_row.id, 'completed', false, 'status', v_row.status);
  end if;

  return jsonb_build_object(
    'call_id', v_row.id,
    'completed', true,
    'status', v_row.status,
    'cost_krw', v_row.cost_krw
  );
end;
$$;

create or replace function public.reserve_product_registration_v6_provider_call(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
  select internal_product_registration.reserve_provider_call(p_payload);
$$;

create or replace function public.complete_product_registration_v6_provider_call(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
  select internal_product_registration.complete_provider_call(p_payload);
$$;

revoke all on function internal_product_registration.reserve_provider_call(jsonb) from public, anon, authenticated;
revoke all on function internal_product_registration.complete_provider_call(jsonb) from public, anon, authenticated;
revoke all on function public.reserve_product_registration_v6_provider_call(jsonb) from public, anon, authenticated;
revoke all on function public.complete_product_registration_v6_provider_call(jsonb) from public, anon, authenticated;
grant execute on function public.reserve_product_registration_v6_provider_call(jsonb) to service_role;
grant execute on function public.complete_product_registration_v6_provider_call(jsonb) to service_role;
