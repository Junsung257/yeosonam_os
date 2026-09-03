-- Durable, exactly-once consumption for private-source AI review attestations.
-- HMAC verification stays in the application; this transaction binds the
-- verified envelope to the immutable revision, source file, and section row.

create table if not exists internal_product_registration.ai_review_attestation_consumptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete restrict,
  review_run_id text not null check (btrim(review_run_id) <> ''),
  purpose text not null check (purpose in ('structural_evidence', 'sibling_date_exclusion')),
  attestation_id uuid not null unique,
  attestation_digest text not null check (attestation_digest ~ '^[0-9a-f]{64}$'),
  claims_hash text not null check (claims_hash ~ '^[0-9a-f]{64}$'),
  source_file_hash text not null check (source_file_hash ~ '^[0-9a-f]{64}$'),
  section_source_hash text not null check (section_source_hash ~ '^[0-9a-f]{64}$'),
  section_index integer not null check (section_index >= 0),
  variant_index integer not null check (variant_index >= 0),
  expires_at timestamptz not null,
  consumed_at timestamptz not null default now(),
  unique (tenant_id, review_run_id, purpose)
);

create table if not exists internal_product_registration.ai_review_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete restrict,
  snapshot_id uuid not null references public.public_package_snapshots(id) on delete restrict,
  review_run_id text not null,
  claims_hash text not null check (claims_hash ~ '^[0-9a-f]{64}$'),
  source_file_hash text not null check (source_file_hash ~ '^[0-9a-f]{64}$'),
  section_source_hash text not null check (section_source_hash ~ '^[0-9a-f]{64}$'),
  surface_evidence_hash text not null check (surface_evidence_hash ~ '^[0-9a-f]{64}$'),
  result_state text not null check (result_state in (
    'AI_UNANIMOUS_SILVER', 'AI_DISPUTED', 'SOURCE_AMBIGUOUS', 'BLOCKED'
  )),
  result_hash text not null check (result_hash ~ '^[0-9a-f]{64}$'),
  result_json jsonb not null check (jsonb_typeof(result_json) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, review_run_id),
  unique (tenant_id, result_hash)
);

alter table internal_product_registration.ai_review_attestation_consumptions enable row level security;
alter table internal_product_registration.ai_review_attestation_consumptions force row level security;
alter table internal_product_registration.ai_review_runs enable row level security;
alter table internal_product_registration.ai_review_runs force row level security;

revoke all on table internal_product_registration.ai_review_attestation_consumptions
  from public, anon, authenticated;
revoke all on table internal_product_registration.ai_review_attestation_consumptions
  from service_role;
grant select, insert on table internal_product_registration.ai_review_attestation_consumptions
  to service_role;
revoke all on table internal_product_registration.ai_review_runs
  from public, anon, authenticated;
revoke all on table internal_product_registration.ai_review_runs
  from service_role;
grant select, insert on table internal_product_registration.ai_review_runs
  to service_role;

drop policy if exists ai_review_attestation_consumptions_service_read
  on internal_product_registration.ai_review_attestation_consumptions;
create policy ai_review_attestation_consumptions_service_read
  on internal_product_registration.ai_review_attestation_consumptions
  for select to service_role using (true);
drop policy if exists ai_review_attestation_consumptions_service_insert
  on internal_product_registration.ai_review_attestation_consumptions;
create policy ai_review_attestation_consumptions_service_insert
  on internal_product_registration.ai_review_attestation_consumptions
  for insert to service_role with check (true);
drop policy if exists ai_review_runs_service_read
  on internal_product_registration.ai_review_runs;
create policy ai_review_runs_service_read
  on internal_product_registration.ai_review_runs
  for select to service_role using (true);
drop policy if exists ai_review_runs_service_insert
  on internal_product_registration.ai_review_runs;
create policy ai_review_runs_service_insert
  on internal_product_registration.ai_review_runs
  for insert to service_role with check (true);

create or replace function internal_product_registration.reject_ai_review_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  raise exception 'AI_REVIEW_LEDGER_APPEND_ONLY';
end;
$$;

revoke all on function internal_product_registration.reject_ai_review_ledger_mutation()
  from public, anon, authenticated;

drop trigger if exists trg_ai_review_attestation_consumptions_immutable
  on internal_product_registration.ai_review_attestation_consumptions;
create trigger trg_ai_review_attestation_consumptions_immutable
before update or delete on internal_product_registration.ai_review_attestation_consumptions
for each row execute function internal_product_registration.reject_ai_review_ledger_mutation();

drop trigger if exists trg_ai_review_runs_immutable
  on internal_product_registration.ai_review_runs;
create trigger trg_ai_review_runs_immutable
before update or delete on internal_product_registration.ai_review_runs
for each row execute function internal_product_registration.reject_ai_review_ledger_mutation();

create or replace function public.consume_product_registration_ai_review_attestations(p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_review_run_id text := nullif(btrim(p_payload->>'review_run_id'), '');
  v_claims_hash text := p_payload->>'claims_hash';
  v_source_file_hash text := p_payload->>'source_file_hash';
  v_section_source_hash text := p_payload->>'section_source_hash';
  v_section_index integer := (p_payload->>'section_index')::integer;
  v_variant_index integer := (p_payload->>'variant_index')::integer;
  v_structural jsonb := p_payload->'structural';
  v_sibling jsonb := p_payload->'sibling';
  v_structural_expires_at timestamptz;
  v_sibling_expires_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'AI_REVIEW_ATTESTATION_SERVICE_ROLE_REQUIRED';
  end if;
  if v_tenant_id is null or v_catalog_product_id is null or v_revision_id is null
    or v_review_run_id is null or v_section_index < 0 or v_variant_index < 0
    or v_claims_hash !~ '^[0-9a-f]{64}$'
    or v_source_file_hash !~ '^[0-9a-f]{64}$'
    or v_section_source_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(v_structural) <> 'object' then
    raise exception 'AI_REVIEW_ATTESTATION_CONSUMPTION_INPUT_INVALID';
  end if;

  if not exists (
    select 1
    from public.product_registration_v5_revisions revision
    join public.product_source_documents source
      on source.id = revision.source_document_id
     and source.tenant_id = revision.tenant_id
    join public.product_registration_v5_segments segment
      on segment.normalization_id = revision.normalization_id
     and segment.source_document_id = revision.source_document_id
     and segment.tenant_id = revision.tenant_id
    where revision.id = v_revision_id
      and revision.tenant_id = v_tenant_id
      and revision.catalog_product_id = v_catalog_product_id
      and revision.status not in ('blocked', 'superseded')
      and source.sha256 = v_source_file_hash
      and source.status in ('stored', 'ready')
      and segment.segment_index = v_section_index
      and segment.raw_text_hash = v_section_source_hash
  ) then
    raise exception 'AI_REVIEW_ATTESTATION_REVISION_LINEAGE_MISMATCH';
  end if;

  v_structural_expires_at := to_timestamp((v_structural->>'expires_at_epoch')::double precision);
  if (v_structural->>'attestation_id') is null
    or (v_structural->>'attestation_digest') !~ '^[0-9a-f]{64}$'
    or v_structural_expires_at <= now()
    or v_structural_expires_at > now() + interval '15 minutes' then
    raise exception 'AI_REVIEW_STRUCTURAL_ATTESTATION_INVALID';
  end if;

  insert into internal_product_registration.ai_review_attestation_consumptions (
    tenant_id, catalog_product_id, revision_id, review_run_id, purpose,
    attestation_id, attestation_digest, claims_hash, source_file_hash,
    section_source_hash, section_index, variant_index, expires_at
  ) values (
    v_tenant_id, v_catalog_product_id, v_revision_id, v_review_run_id, 'structural_evidence',
    (v_structural->>'attestation_id')::uuid, v_structural->>'attestation_digest',
    v_claims_hash, v_source_file_hash, v_section_source_hash,
    v_section_index, v_variant_index, v_structural_expires_at
  );

  if v_sibling is not null and jsonb_typeof(v_sibling) <> 'null' then
    if jsonb_typeof(v_sibling) <> 'object' then
      raise exception 'AI_REVIEW_SIBLING_ATTESTATION_INVALID';
    end if;
    v_sibling_expires_at := to_timestamp((v_sibling->>'expires_at_epoch')::double precision);
    if (v_sibling->>'attestation_id') is null
      or (v_sibling->>'attestation_digest') !~ '^[0-9a-f]{64}$'
      or v_sibling_expires_at <= now()
      or v_sibling_expires_at > now() + interval '15 minutes' then
      raise exception 'AI_REVIEW_SIBLING_ATTESTATION_INVALID';
    end if;
    insert into internal_product_registration.ai_review_attestation_consumptions (
      tenant_id, catalog_product_id, revision_id, review_run_id, purpose,
      attestation_id, attestation_digest, claims_hash, source_file_hash,
      section_source_hash, section_index, variant_index, expires_at
    ) values (
      v_tenant_id, v_catalog_product_id, v_revision_id, v_review_run_id, 'sibling_date_exclusion',
      (v_sibling->>'attestation_id')::uuid, v_sibling->>'attestation_digest',
      v_claims_hash, v_source_file_hash, v_section_source_hash,
      v_section_index, v_variant_index, v_sibling_expires_at
    );
  end if;

  return true;
end;
$$;

revoke all on function public.consume_product_registration_ai_review_attestations(jsonb)
  from public, anon, authenticated;
grant execute on function public.consume_product_registration_ai_review_attestations(jsonb)
  to service_role;

comment on function public.consume_product_registration_ai_review_attestations(jsonb) is
  'Atomically consumes one exact review-run attestation set after application-side HMAC verification and DB lineage validation.';

create or replace function public.record_product_registration_ai_review_result(p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_snapshot_id uuid := nullif(p_payload->>'snapshot_id', '')::uuid;
  v_review_run_id text := nullif(btrim(p_payload->>'review_run_id'), '');
  v_claims_hash text := p_payload->>'claims_hash';
  v_source_file_hash text := p_payload->>'source_file_hash';
  v_section_source_hash text := p_payload->>'section_source_hash';
  v_surface_evidence_hash text := p_payload->>'surface_evidence_hash';
  v_result_state text := p_payload->>'result_state';
  v_result_hash text := p_payload->>'result_hash';
  v_result_json jsonb := p_payload->'result_json';
begin
  if auth.role() <> 'service_role' then
    raise exception 'AI_REVIEW_RESULT_SERVICE_ROLE_REQUIRED';
  end if;
  if v_tenant_id is null or v_catalog_product_id is null or v_revision_id is null
    or v_snapshot_id is null or v_review_run_id is null
    or v_claims_hash !~ '^[0-9a-f]{64}$'
    or v_source_file_hash !~ '^[0-9a-f]{64}$'
    or v_section_source_hash !~ '^[0-9a-f]{64}$'
    or v_surface_evidence_hash !~ '^[0-9a-f]{64}$'
    or v_result_hash !~ '^[0-9a-f]{64}$'
    or v_result_state not in ('AI_UNANIMOUS_SILVER', 'AI_DISPUTED', 'SOURCE_AMBIGUOUS', 'BLOCKED')
    or jsonb_typeof(v_result_json) <> 'object'
    or v_result_json ? 'sourceText' or v_result_json ? 'evidenceAnchors' then
    raise exception 'AI_REVIEW_RESULT_INPUT_INVALID';
  end if;
  if not exists (
    select 1
    from internal_product_registration.ai_review_attestation_consumptions consumption
    where consumption.tenant_id = v_tenant_id
      and consumption.catalog_product_id = v_catalog_product_id
      and consumption.revision_id = v_revision_id
      and consumption.review_run_id = v_review_run_id
      and consumption.purpose = 'structural_evidence'
      and consumption.claims_hash = v_claims_hash
      and consumption.source_file_hash = v_source_file_hash
      and consumption.section_source_hash = v_section_source_hash
  ) then
    raise exception 'AI_REVIEW_RESULT_ATTESTATION_NOT_CONSUMED';
  end if;
  if not exists (
    select 1 from public.public_package_snapshots snapshot
    where snapshot.id = v_snapshot_id
      and snapshot.tenant_id = v_tenant_id
      and snapshot.catalog_product_id = v_catalog_product_id
      and snapshot.canonical_revision_id = v_revision_id
  ) then
    raise exception 'AI_REVIEW_RESULT_SNAPSHOT_LINEAGE_MISMATCH';
  end if;
  insert into internal_product_registration.ai_review_runs (
    tenant_id, catalog_product_id, revision_id, snapshot_id, review_run_id,
    claims_hash, source_file_hash, section_source_hash, surface_evidence_hash,
    result_state, result_hash, result_json
  ) values (
    v_tenant_id, v_catalog_product_id, v_revision_id, v_snapshot_id, v_review_run_id,
    v_claims_hash, v_source_file_hash, v_section_source_hash, v_surface_evidence_hash,
    v_result_state, v_result_hash, v_result_json
  );
  return true;
end;
$$;

revoke all on function public.record_product_registration_ai_review_result(jsonb)
  from public, anon, authenticated;
grant execute on function public.record_product_registration_ai_review_result(jsonb)
  to service_role;

comment on function public.record_product_registration_ai_review_result(jsonb) is
  'Persists a redacted AI review result only after the exact structural attestation was durably consumed.';
