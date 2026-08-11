-- V5 proof-bound publication transition.
--
-- The compatibility RPC remains available for legacy/V4 rollout. This RPC is
-- deliberately narrower: it accepts immutable revision/snapshot/proof IDs and
-- a compare-and-swap pointer version, never an arbitrary customer-field patch.

create or replace function public.publish_product_registration_v5_snapshot_atomic(
  p_package_id uuid,
  p_revision_id uuid,
  p_snapshot_id uuid,
  p_snapshot_hash text,
  p_proof_run_id uuid,
  p_expected_pointer_version bigint,
  p_idempotency_key text,
  p_actor_id uuid default null,
  p_channel text default 'customer',
  p_locale text default 'ko-KR',
  p_policy_version text default 'v5-risk-policy-1',
  p_publication_state text default 'published'
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  v_pointer public.product_registration_v5_publication_pointers%rowtype;
  v_revision public.product_registration_v5_revisions%rowtype;
  v_snapshot public.public_package_snapshots%rowtype;
  v_proof public.product_registration_v5_proof_runs%rowtype;
  v_request_hash text;
  v_stored_request_hash text;
  v_inserted_ledger boolean := false;
  v_existing_status text;
  v_existing_response jsonb;
  v_response jsonb;
  v_next_version bigint;
begin
  if p_package_id is null or p_revision_id is null or p_snapshot_id is null or p_proof_run_id is null then
    raise exception 'V5_PUBLICATION_LINEAGE_REQUIRED';
  end if;
  if coalesce(nullif(p_snapshot_hash, ''), '') = '' then
    raise exception 'V5_PUBLICATION_SNAPSHOT_HASH_REQUIRED';
  end if;
  if coalesce(nullif(p_idempotency_key, ''), '') = '' then
    raise exception 'V5_PUBLICATION_IDEMPOTENCY_KEY_REQUIRED';
  end if;
  if p_expected_pointer_version is null or p_expected_pointer_version < 0 then
    raise exception 'V5_PUBLICATION_POINTER_VERSION_INVALID';
  end if;
  if p_publication_state not in ('approved', 'published', 'blocked', 'quarantined') then
    raise exception 'V5_PUBLICATION_STATE_INVALID';
  end if;

  v_request_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_object(
        'package_id', p_package_id,
        'revision_id', p_revision_id,
        'snapshot_id', p_snapshot_id,
        'snapshot_hash', p_snapshot_hash,
        'proof_run_id', p_proof_run_id,
        'expected_pointer_version', p_expected_pointer_version,
        'channel', p_channel,
        'locale', p_locale,
        'policy_version', p_policy_version,
        'publication_state', p_publication_state
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.product_registration_v5_idempotency_ledger (
    operation_key,
    operation_type,
    aggregate_id,
    request_hash,
    status
  ) values (
    p_idempotency_key,
    'publish_product_registration_v5_snapshot_atomic',
    p_package_id,
    v_request_hash,
    'started'
  ) on conflict (operation_key) do nothing
  returning true into v_inserted_ledger;

  select status, response, request_hash
    into v_existing_status, v_existing_response, v_stored_request_hash
  from public.product_registration_v5_idempotency_ledger
  where operation_key = p_idempotency_key;

  if v_stored_request_hash is distinct from v_request_hash then
    raise exception 'V5_PUBLICATION_IDEMPOTENCY_KEY_REUSED';
  end if;

  if v_existing_status = 'succeeded' then
    return coalesce(v_existing_response, '{}'::jsonb);
  end if;
  if not v_inserted_ledger and v_existing_status = 'started' then
    raise exception 'V5_PUBLICATION_IDEMPOTENCY_IN_PROGRESS';
  end if;
  if v_existing_status is distinct from 'started' then
    raise exception 'V5_PUBLICATION_IDEMPOTENCY_NOT_RETRYABLE:%', coalesce(v_existing_status, 'missing');
  end if;

  select * into v_revision
  from public.product_registration_v5_revisions
  where id = p_revision_id
    and package_id = p_package_id;
  if not found then raise exception 'V5_PUBLICATION_REVISION_NOT_FOUND'; end if;
  if v_revision.status in ('blocked', 'superseded', 'needs_review') then
    raise exception 'V5_PUBLICATION_REVISION_NOT_PUBLISHABLE:%', v_revision.status;
  end if;

  select * into v_snapshot
  from public.public_package_snapshots
  where id = p_snapshot_id
    and package_id = p_package_id
    and snapshot_hash = p_snapshot_hash;
  if not found then raise exception 'V5_PUBLICATION_SNAPSHOT_NOT_FOUND'; end if;
  if v_snapshot.canonical_revision_id is distinct from p_revision_id then
    raise exception 'V5_PUBLICATION_SNAPSHOT_REVISION_MISMATCH';
  end if;

  select * into v_proof
  from public.product_registration_v5_proof_runs
  where id = p_proof_run_id
    and package_id = p_package_id
    and revision_id = p_revision_id
    and snapshot_hash = p_snapshot_hash
    and public_snapshot_id = p_snapshot_id
    and status = 'passed';
  if not found then raise exception 'V5_PUBLICATION_PROOF_NOT_VALID'; end if;

  insert into public.product_registration_v5_publication_pointers (
    package_id,
    channel,
    locale,
    state,
    pointer_version
  ) values (
    p_package_id,
    p_channel,
    p_locale,
    'draft',
    0
  ) on conflict (package_id, channel, locale) do nothing;

  select * into v_pointer
  from public.product_registration_v5_publication_pointers
  where package_id = p_package_id
    and channel = p_channel
    and locale = p_locale
  for update;

  if v_pointer.pointer_version <> p_expected_pointer_version then
    raise exception 'V5_PUBLICATION_POINTER_VERSION_CONFLICT:expected %, actual %',
      p_expected_pointer_version, v_pointer.pointer_version;
  end if;

  v_next_version := v_pointer.pointer_version + 1;

  update public.product_registration_v5_publication_pointers
  set current_revision_id = p_revision_id,
      current_snapshot_id = p_snapshot_id,
      state = p_publication_state,
      pointer_version = v_next_version,
      updated_at = now()
  where package_id = p_package_id
    and channel = p_channel
    and locale = p_locale;

  update public.travel_packages
  set canonical_revision_id = p_revision_id,
      canonical_payload_hash = v_revision.payload_hash,
      publication_state = p_publication_state,
      status = case when p_publication_state = 'published' then 'active' else status end,
      package_revision = greatest(package_revision, v_revision.revision_no),
      updated_at = now()
  where id = p_package_id;
  if not found then raise exception 'V5_PUBLICATION_PACKAGE_NOT_FOUND'; end if;

  insert into public.package_publish_decisions (
    package_id,
    package_revision,
    public_snapshot_id,
    public_snapshot_hash,
    publication_state,
    publishable,
    canonical_revision_id,
    proof_run_id,
    policy_version,
    idempotency_key,
    mobile_proof_ref,
    decision_source
  ) values (
    p_package_id,
    v_revision.revision_no,
    p_snapshot_id,
    p_snapshot_hash,
    p_publication_state,
    p_publication_state in ('approved', 'published'),
    p_revision_id,
    p_proof_run_id,
    p_policy_version,
    p_idempotency_key,
    p_proof_run_id::text,
    'publish_gate_v5_cas'
  );

  v_response := jsonb_build_object(
    'package_id', p_package_id,
    'revision_id', p_revision_id,
    'snapshot_id', p_snapshot_id,
    'snapshot_hash', p_snapshot_hash,
    'proof_run_id', p_proof_run_id,
    'pointer_version', v_next_version,
    'publication_state', p_publication_state,
    'policy_version', p_policy_version
  );

  insert into public.product_registration_v5_publication_outbox (
    aggregate_type,
    aggregate_id,
    event_type,
    dedupe_key,
    payload
  ) values (
    'travel_package',
    p_package_id,
    'package.publication.pointer_committed',
    p_idempotency_key || ':surface-invalidation',
    v_response
  ) on conflict (dedupe_key) do nothing;

  update public.product_registration_v5_idempotency_ledger
  set status = 'succeeded', response = v_response, completed_at = now()
  where operation_key = p_idempotency_key;

  return v_response;
exception when others then
  update public.product_registration_v5_idempotency_ledger
  set status = 'failed', response = jsonb_build_object('error', sqlerrm), completed_at = now()
  where operation_key = p_idempotency_key
    and status = 'started';
  raise;
end;
$$;

revoke all on function public.publish_product_registration_v5_snapshot_atomic(
  uuid, uuid, uuid, text, uuid, bigint, text, uuid, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.publish_product_registration_v5_snapshot_atomic(
  uuid, uuid, uuid, text, uuid, bigint, text, uuid, text, text, text, text
) to service_role;
