-- Product Registration authority convergence.
--
-- Parser/provider diversity remains behind adapters. This migration creates
-- one tenant-scoped product identity and one revision/publication authority.
-- It is deliberately forward-only: legacy rows remain as compatibility
-- projections while new writes converge behind service-role RPCs.

create schema if not exists internal_product_registration;

revoke all on schema internal_product_registration from public, anon, authenticated;
grant usage on schema internal_product_registration to service_role;

-- Null historically meant "platform owned". New authority records require a
-- real tenant key, so historical global rows are assigned to an explicit,
-- stable platform tenant without changing customer ownership semantics.
insert into public.tenants (id, name, status, description)
values (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Product Registration Platform',
  'active',
  'System tenant for platform-owned product-registration authority records.'
)
on conflict (id) do nothing;

-- Older deployments used the all-zero UUID as a platform-owner placeholder.
-- It is not a real tenants row and must be normalized exactly like NULL before
-- any tenant-scoped catalog foreign key is created. Real tenant IDs are kept.
update public.products
set tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
where tenant_id is null
   or tenant_id = '00000000-0000-0000-0000-000000000000'::uuid;

update public.travel_packages
set tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
where tenant_id is null
   or tenant_id = '00000000-0000-0000-0000-000000000000'::uuid;

create table if not exists internal_product_registration.catalog_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  product_key text not null check (btrim(product_key) <> ''),
  identity_status text not null default 'resolved'
    check (identity_status in ('resolved', 'conflicting', 'orphaned', 'quarantined')),
  lifecycle_state text not null default 'active'
    check (lifecycle_state in ('active', 'archived', 'quarantined')),
  source_channel text not null default 'legacy_backfill',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, product_key),
  unique (tenant_id, id)
);

comment on table internal_product_registration.catalog_products is
  'Stable tenant-scoped product identity. Revisions, snapshots and channel pointers bind here; mutable compatibility rows are not identity.';

create table if not exists internal_product_registration.registration_authority_config (
  singleton boolean primary key default true check (singleton),
  authority_mode text not null default 'shadow'
    check (authority_mode in ('legacy', 'shadow', 'kernel')),
  publication_freeze boolean not null default true,
  contract_version text not null default 'product-registration-authority-1',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into internal_product_registration.registration_authority_config (
  singleton, authority_mode, publication_freeze
) values (true, 'shadow', true)
on conflict (singleton) do nothing;

create or replace function internal_product_registration.enforce_authority_boundary()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, internal_product_registration, pg_temp
as $$
declare
  v_mode text;
  v_writer text := current_setting('app.product_registration_writer', true);
  v_old jsonb;
  v_new jsonb;
begin
  select authority_mode into v_mode
  from internal_product_registration.registration_authority_config
  where singleton = true;
  if v_mode is distinct from 'kernel' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_writer in ('registration-kernel', 'compatibility-projection', 'publication-kernel') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and tg_table_schema = 'public' and tg_table_name = 'products' then
    v_old := to_jsonb(old) - array['view_count', 'inquiry_count', 'embedding', 'updated_at'];
    v_new := to_jsonb(new) - array['view_count', 'inquiry_count', 'embedding', 'updated_at'];
    if v_old = v_new then return new; end if;
  end if;
  if tg_op = 'UPDATE' and tg_table_schema = 'public' and tg_table_name = 'travel_packages' then
    v_old := to_jsonb(old) - array['view_count', 'view_count_snap_at', 'view_count_weekly_snap', 'inquiry_count', 'embedding', 'updated_at'];
    v_new := to_jsonb(new) - array['view_count', 'view_count_snap_at', 'view_count_weekly_snap', 'inquiry_count', 'embedding', 'updated_at'];
    if v_old = v_new then return new; end if;
  end if;

  raise exception 'REGISTRATION_AUTHORITY_DIRECT_WRITE_BLOCKED:%:%:%',
    tg_table_schema, tg_table_name, tg_op;
end;
$$;

revoke all on function internal_product_registration.enforce_authority_boundary() from public, anon, authenticated;
grant execute on function internal_product_registration.enforce_authority_boundary() to service_role;

drop trigger if exists trg_registration_authority_products on public.products;
create trigger trg_registration_authority_products
before insert or update or delete on public.products
for each row execute function internal_product_registration.enforce_authority_boundary();

drop trigger if exists trg_registration_authority_packages on public.travel_packages;
create trigger trg_registration_authority_packages
before insert or update or delete on public.travel_packages
for each row execute function internal_product_registration.enforce_authority_boundary();

drop trigger if exists trg_registration_authority_revisions on public.product_registration_v5_revisions;
create trigger trg_registration_authority_revisions
before insert or update or delete on public.product_registration_v5_revisions
for each row execute function internal_product_registration.enforce_authority_boundary();

drop trigger if exists trg_registration_authority_pointers on public.product_registration_v5_publication_pointers;
create trigger trg_registration_authority_pointers
before insert or update or delete on public.product_registration_v5_publication_pointers
for each row execute function internal_product_registration.enforce_authority_boundary();

create table if not exists internal_product_registration.registration_authority_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid references internal_product_registration.catalog_products(id) on delete restrict,
  revision_id uuid references public.product_registration_v5_revisions(id) on delete restrict,
  package_id uuid references public.travel_packages(id) on delete set null,
  operation_key text not null,
  writer_id text not null,
  authority_mode text not null check (authority_mode in ('legacy', 'shadow', 'kernel')),
  event_type text not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, operation_key, event_type)
);

-- Stable identity columns. travel_packages.catalog_id already means a source
-- document/group and must not be reused as product identity.
alter table public.products
  add column if not exists catalog_product_id uuid;
alter table public.travel_packages
  add column if not exists catalog_product_id uuid;
alter table public.product_registration_v5_revisions
  add column if not exists catalog_product_id uuid;
alter table public.product_registration_v5_proof_runs
  add column if not exists catalog_product_id uuid;
alter table public.product_registration_v5_publication_pointers
  add column if not exists catalog_product_id uuid;
alter table public.product_registration_v5_publication_outbox
  add column if not exists catalog_product_id uuid;
alter table public.public_package_snapshots
  add column if not exists catalog_product_id uuid,
  add column if not exists tenant_id uuid;
alter table public.package_publish_decisions
  add column if not exists catalog_product_id uuid,
  add column if not exists tenant_id uuid;
alter table public.upload_jobs
  add column if not exists tenant_id uuid;
alter table public.product_document_extractions
  add column if not exists tenant_id uuid;
alter table public.product_registration_v4_normalizations
  add column if not exists tenant_id uuid;

alter table public.product_source_documents
  alter column tenant_id set default '00000000-0000-0000-0000-000000000001'::uuid;
alter table public.product_document_extractions
  alter column tenant_id set default '00000000-0000-0000-0000-000000000001'::uuid;
alter table public.upload_jobs
  alter column tenant_id set default '00000000-0000-0000-0000-000000000001'::uuid;
alter table public.product_registration_v4_normalizations
  alter column tenant_id set default '00000000-0000-0000-0000-000000000001'::uuid;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'departure_instances',
    'transport_segments',
    'lodging_stays',
    'golf_rounds',
    'copy_revisions',
    'copy_claim_links',
    'transport_fact_observations',
    'transport_fact_resolutions',
    'golf_fact_observations',
    'golf_fact_resolutions',
    'provider_calls',
    'workflow_stage_runs',
    'dead_letter_jobs'
  ] loop
    execute format(
      'alter table internal_product_registration.%I add column if not exists catalog_product_id uuid',
      v_table
    );
  end loop;
end;
$$;

-- Compatibility writers remain deployable while authority_mode='shadow'.
-- Kernel-mode activation is a later verified migration that makes the two
-- projection columns NOT NULL after every writer has been retired/rerouted.

create or replace function internal_product_registration.commit_revision_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_product_key text := nullif(btrim(p_payload->>'product_key'), '');
  v_revision_id uuid;
  v_claim_id uuid;
  v_terms_id uuid;
  v_observation_id uuid;
  v_resolution_id uuid;
  v_golf_round_id uuid;
  v_field_path text;
  v_fact_hash text;
  v_row jsonb;
  v_evidence jsonb;
  v_request_hash text;
  v_operation_key text := nullif(btrim(p_payload->>'operation_key'), '');
  v_authority_mode text;
  v_inserted boolean := false;
  v_claim_count integer := 0;
  v_price_count integer := 0;
  v_itinerary_count integer := 0;
  v_domain_count integer := 0;
  v_terms_count integer := 0;
  v_revision_no bigint;
  v_result jsonb;
begin
  perform set_config('app.product_registration_writer', 'registration-kernel', true);
  if v_tenant_id is null then raise exception 'REGISTRATION_TENANT_REQUIRED'; end if;
  if v_product_key is null then raise exception 'REGISTRATION_PRODUCT_KEY_REQUIRED'; end if;
  if v_operation_key is null then raise exception 'REGISTRATION_OPERATION_KEY_REQUIRED'; end if;
  if coalesce(p_payload->>'payload_hash', '') !~ '^[0-9a-f]{64}$' then raise exception 'REGISTRATION_PAYLOAD_HASH_INVALID'; end if;
  if coalesce(p_payload->>'lineage_hash', '') !~ '^[0-9a-f]{64}$' then raise exception 'REGISTRATION_LINEAGE_HASH_INVALID'; end if;

  select authority_mode into v_authority_mode
  from internal_product_registration.registration_authority_config
  where singleton = true
  for share;
  if v_authority_mode is null then raise exception 'REGISTRATION_AUTHORITY_CONFIG_MISSING'; end if;

  v_request_hash := encode(
    extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if v_catalog_product_id is null then
    select id into v_catalog_product_id
    from internal_product_registration.catalog_products
    where tenant_id = v_tenant_id and product_key = v_product_key;
  end if;

  if v_catalog_product_id is null then
    insert into internal_product_registration.catalog_products (
      tenant_id, product_key, identity_status, source_channel, metadata
    ) values (
      v_tenant_id,
      v_product_key,
      coalesce(nullif(p_payload->>'identity_status', ''), 'resolved'),
      coalesce(nullif(p_payload->>'source_channel', ''), 'upload'),
      coalesce(p_payload->'identity_metadata', '{}'::jsonb)
    )
    returning id into v_catalog_product_id;
  else
    if not exists (
      select 1 from internal_product_registration.catalog_products cp
      where cp.id = v_catalog_product_id and cp.tenant_id = v_tenant_id
    ) then
      insert into internal_product_registration.catalog_products (
        id, tenant_id, product_key, identity_status, source_channel, metadata
      ) values (
        v_catalog_product_id,
        v_tenant_id,
        v_product_key,
        coalesce(nullif(p_payload->>'identity_status', ''), 'resolved'),
        coalesce(nullif(p_payload->>'source_channel', ''), 'upload'),
        coalesce(p_payload->'identity_metadata', '{}'::jsonb)
      )
      on conflict (tenant_id, product_key) do nothing;
    end if;
    if not exists (
      select 1 from internal_product_registration.catalog_products cp
      where cp.id = v_catalog_product_id and cp.tenant_id = v_tenant_id and cp.product_key = v_product_key
    ) then raise exception 'REGISTRATION_CATALOG_IDENTITY_CONFLICT'; end if;
  end if;

  if not exists (
    select 1 from public.product_source_documents s
    where s.id = (p_payload->>'source_document_id')::uuid and s.tenant_id = v_tenant_id
  ) then raise exception 'REGISTRATION_SOURCE_TENANT_MISMATCH'; end if;
  if not exists (
    select 1 from public.product_document_extractions e
    where e.id = (p_payload->>'extraction_id')::uuid
      and e.source_document_id = (p_payload->>'source_document_id')::uuid
      and e.tenant_id = v_tenant_id
  ) then raise exception 'REGISTRATION_EXTRACTION_LINEAGE_MISMATCH'; end if;
  if not exists (
    select 1 from public.upload_jobs j
    where j.id = (p_payload->>'job_id')::uuid and j.tenant_id = v_tenant_id
  ) then raise exception 'REGISTRATION_JOB_TENANT_MISMATCH'; end if;

  select r.id into v_revision_id
  from public.product_registration_v5_revisions r
  where r.catalog_product_id = v_catalog_product_id
    and r.payload_hash = p_payload->>'payload_hash'
    and r.lineage_hash = p_payload->>'lineage_hash'
  limit 1;

  if v_revision_id is null then
    perform pg_advisory_xact_lock(hashtextextended(v_catalog_product_id::text, 0));
    select coalesce(max(r.revision_no), 0) + 1 into v_revision_no
    from public.product_registration_v5_revisions r
    where r.catalog_product_id = v_catalog_product_id;

    insert into public.product_registration_v5_revisions (
      tenant_id,
      catalog_product_id,
      package_id,
      job_id,
      normalization_id,
      source_document_id,
      extraction_id,
      revision_no,
      schema_version,
      normalization_version,
      canonical_payload,
      payload_hash,
      lineage_hash,
      status,
      supersedes_revision_id,
      created_by
    ) values (
      v_tenant_id,
      v_catalog_product_id,
      null,
      (p_payload->>'job_id')::uuid,
      (p_payload->>'normalization_id')::uuid,
      (p_payload->>'source_document_id')::uuid,
      (p_payload->>'extraction_id')::uuid,
      v_revision_no,
      coalesce(nullif(p_payload->>'schema_version', ''), 'product-registration-v5-canonical-1'),
      p_payload->>'normalization_version',
      p_payload->'canonical_payload',
      p_payload->>'payload_hash',
      p_payload->>'lineage_hash',
      coalesce(nullif(p_payload->>'status', ''), 'candidate'),
      nullif(p_payload->>'supersedes_revision_id', '')::uuid,
      nullif(p_payload->>'created_by', '')::uuid
    )
    returning id into v_revision_id;
    v_inserted := true;

    for v_row in select value from jsonb_array_elements(coalesce(p_payload->'segments', '[]'::jsonb)) loop
      insert into public.product_registration_v5_segments (
        tenant_id, job_id, normalization_id, source_document_id, extraction_id,
        segment_index, section_key, raw_text_hash, raw_text, evidence, state
      ) values (
        v_tenant_id,
        (p_payload->>'job_id')::uuid,
        (p_payload->>'normalization_id')::uuid,
        (p_payload->>'source_document_id')::uuid,
        (p_payload->>'extraction_id')::uuid,
        (v_row->>'segment_index')::integer,
        v_row->>'section_key',
        v_row->>'raw_text_hash',
        v_row->>'raw_text',
        coalesce(v_row->'evidence', '[]'::jsonb),
        coalesce(nullif(v_row->>'state', ''), 'candidate')
      ) on conflict do nothing;
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_payload->'claims', '[]'::jsonb)) loop
      insert into public.product_registration_v5_claims (
        revision_id, field_path, normalized_value, criticality,
        extraction_method, evidence_status, conflict_status, claim_hash
      ) values (
        v_revision_id,
        v_row->>'field_path',
        v_row->'normalized_value',
        coalesce(nullif(v_row->>'criticality', ''), 'normal'),
        coalesce(nullif(v_row->>'extraction_method', ''), 'deterministic'),
        coalesce(nullif(v_row->>'evidence_status', ''), 'unverified'),
        coalesce(nullif(v_row->>'conflict_status', ''), 'none'),
        v_row->>'claim_hash'
      ) returning id into v_claim_id;
      v_claim_count := v_claim_count + 1;

      for v_evidence in select value from jsonb_array_elements(coalesce(v_row->'evidence', '[]'::jsonb)) loop
        if nullif(v_evidence->>'source_document_id', '')::uuid is distinct from (p_payload->>'source_document_id')::uuid
          or nullif(v_evidence->>'extraction_id', '')::uuid is distinct from (p_payload->>'extraction_id')::uuid then
          raise exception 'REGISTRATION_CLAIM_EVIDENCE_LINEAGE_MISMATCH';
        end if;
        insert into public.product_registration_v5_claim_evidence (
          claim_id, source_document_id, extraction_id, node_id, page,
          table_ref, quote_hash, source_quote, extractor_confidence, semantic_confidence
        ) values (
          v_claim_id,
          (v_evidence->>'source_document_id')::uuid,
          (v_evidence->>'extraction_id')::uuid,
          v_evidence->>'node_id',
          nullif(v_evidence->>'page', '')::integer,
          v_evidence->'table_ref',
          v_evidence->>'quote_hash',
          v_evidence->>'source_quote',
          nullif(v_evidence->>'extractor_confidence', '')::numeric,
          nullif(v_evidence->>'semantic_confidence', '')::numeric
        );
      end loop;
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_payload->'price_rules', '[]'::jsonb)) loop
      insert into public.product_registration_v5_price_rules (
        revision_id, section_index, variant_key, component_type, scope,
        specific_date, effective_start, effective_end, weekday, amount,
        currency, charge_basis, inclusion, source_field_path, evidence_ref, rule_hash
      ) values (
        v_revision_id,
        (v_row->>'section_index')::integer,
        v_row->>'variant_key',
        v_row->>'component_type',
        v_row->>'scope',
        nullif(v_row->>'specific_date', '')::date,
        nullif(v_row->>'effective_start', '')::date,
        nullif(v_row->>'effective_end', '')::date,
        nullif(v_row->>'weekday', '')::smallint,
        (v_row->>'amount')::numeric,
        v_row->>'currency',
        v_row->>'charge_basis',
        v_row->>'inclusion',
        v_row->>'source_field_path',
        coalesce(v_row->'evidence_ref', '{}'::jsonb),
        v_row->>'rule_hash'
      );
      v_price_count := v_price_count + 1;
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_payload->'itinerary_items', '[]'::jsonb)) loop
      insert into public.product_registration_v5_itinerary_items (
        revision_id, section_index, variant_key, day_index, sequence_no,
        item_type, start_time, timezone, title, description, canonical_id,
        source_field_path, evidence_ref, item_hash
      ) values (
        v_revision_id,
        (v_row->>'section_index')::integer,
        v_row->>'variant_key',
        (v_row->>'day_index')::integer,
        (v_row->>'sequence_no')::integer,
        v_row->>'item_type',
        nullif(v_row->>'start_time', ''),
        nullif(v_row->>'timezone', ''),
        v_row->>'title',
        nullif(v_row->>'description', ''),
        nullif(v_row->>'canonical_id', ''),
        v_row->>'source_field_path',
        coalesce(v_row->'evidence_ref', '{}'::jsonb),
        v_row->>'item_hash'
      );
      v_itinerary_count := v_itinerary_count + 1;
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_payload->'departure_instances', '[]'::jsonb)) loop
      insert into internal_product_registration.departure_instances (
        tenant_id, catalog_product_id, revision_id, package_id, section_index,
        variant_key, departure_date, sale_state, source_hash, revision_hash, evidence
      ) values (
        v_tenant_id, v_catalog_product_id, v_revision_id, null,
        (v_row->>'section_index')::integer, v_row->>'variant_key',
        (v_row->>'departure_date')::date, coalesce(nullif(v_row->>'sale_state', ''), 'available'),
        p_payload->>'source_hash', p_payload->>'payload_hash', coalesce(v_row->'evidence', '[]'::jsonb)
      );
      v_domain_count := v_domain_count + 1;
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_payload->'transport_segments', '[]'::jsonb)) loop
      insert into internal_product_registration.transport_segments (
        tenant_id, catalog_product_id, revision_id, package_id, section_index,
        variant_key, sequence_no, transport_type, leg, carrier_code, service_number,
        departure_place_code, arrival_place_code, departure_local_time,
        arrival_local_time, arrival_day_offset, departure_timezone, arrival_timezone,
        fact_state, source_field_path, source_hash, revision_hash, evidence
      ) values (
        v_tenant_id, v_catalog_product_id, v_revision_id, null,
        (v_row->>'section_index')::integer, v_row->>'variant_key', (v_row->>'sequence_no')::integer,
        v_row->>'transport_type', coalesce(nullif(v_row->>'leg', ''), 'unknown'),
        nullif(v_row->>'carrier_code', ''), nullif(v_row->>'service_number', ''),
        nullif(v_row->>'departure_place_code', ''), nullif(v_row->>'arrival_place_code', ''),
        nullif(v_row->>'departure_local_time', '')::time, nullif(v_row->>'arrival_local_time', '')::time,
        coalesce(nullif(v_row->>'arrival_day_offset', '')::smallint, 0),
        nullif(v_row->>'departure_timezone', ''), nullif(v_row->>'arrival_timezone', ''),
        coalesce(nullif(v_row->>'fact_state', ''), 'degraded'), v_row->>'source_field_path',
        p_payload->>'source_hash', p_payload->>'payload_hash', coalesce(v_row->'evidence', '[]'::jsonb)
      );
      v_domain_count := v_domain_count + 1;
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_payload->'lodging_stays', '[]'::jsonb)) loop
      insert into internal_product_registration.lodging_stays (
        tenant_id, catalog_product_id, revision_id, package_id, section_index,
        variant_key, day_index, nights, lodging_name, lodging_state,
        source_field_path, source_hash, revision_hash, evidence
      ) values (
        v_tenant_id, v_catalog_product_id, v_revision_id, null,
        (v_row->>'section_index')::integer, v_row->>'variant_key', (v_row->>'day_index')::integer,
        coalesce(nullif(v_row->>'nights', '')::smallint, 1), nullif(v_row->>'lodging_name', ''),
        coalesce(nullif(v_row->>'lodging_state', ''), 'to_be_confirmed'), v_row->>'source_field_path',
        p_payload->>'source_hash', p_payload->>'payload_hash', coalesce(v_row->'evidence', '[]'::jsonb)
      );
      v_fact_hash := encode(extensions.digest(convert_to(
        concat_ws('|', v_tenant_id::text, v_revision_id::text, v_row->>'section_index',
          v_row->>'variant_key', v_row->>'day_index', lower(coalesce(v_row->>'lodging_name', '')),
          p_payload->>'source_hash'), 'UTF8'), 'sha256'), 'hex');
      v_observation_id := null;
      execute $sql$
        insert into internal_product_registration.hotel_fact_observations (
          tenant_id, catalog_product_id, source_document_id, product_revision_id,
          source_kind, hotel_name_raw, normalized_name, source_weight, evidence,
          observation_hash, created_version
        ) values ($1, $2, $3, $4, 'current_source', $5, $5, 1.0, $6, $7,
          'product-registration-hotel-facts-1')
        on conflict (tenant_id, observation_hash) do nothing
        returning id
      $sql$ into v_observation_id using
        v_tenant_id, v_catalog_product_id, (p_payload->>'source_document_id')::uuid,
        v_revision_id, v_row->>'lodging_name', coalesce(v_row->'evidence', '[]'::jsonb), v_fact_hash;
      if v_observation_id is null then
        execute 'select id from internal_product_registration.hotel_fact_observations where tenant_id = $1 and observation_hash = $2'
          into v_observation_id using v_tenant_id, v_fact_hash;
      end if;
      execute $sql$
        insert into internal_product_registration.hotel_fact_resolutions (
          tenant_id, catalog_product_id, product_revision_id, section_index,
          variant_key, day_index, hotel_name_display, lodging_state,
          observation_ids, reasons, resolution_hash
        ) values ($1, $2, $3, $4, $5, $6, $7, $8,
          case when $9 is null then '{}'::uuid[] else array[$9]::uuid[] end,
          '[]'::jsonb, $10)
        on conflict (product_revision_id, section_index, variant_key, day_index, resolution_hash) do nothing
      $sql$ using
        v_tenant_id, v_catalog_product_id, v_revision_id,
        (v_row->>'section_index')::integer, v_row->>'variant_key', (v_row->>'day_index')::integer,
        nullif(v_row->>'lodging_name', ''), coalesce(nullif(v_row->>'lodging_state', ''), 'to_be_confirmed'),
        v_observation_id, v_fact_hash;
      v_domain_count := v_domain_count + 1;
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_payload->'golf_rounds', '[]'::jsonb)) loop
      insert into internal_product_registration.golf_rounds (
        tenant_id, catalog_product_id, revision_id, package_id, section_index,
        variant_key, day_index, course_name_raw, tee_time, holes,
        green_fee_inclusion, caddie_inclusion, cart_inclusion,
        source_hash, revision_hash, evidence
      ) values (
        v_tenant_id, v_catalog_product_id, v_revision_id, null,
        (v_row->>'section_index')::integer, v_row->>'variant_key', (v_row->>'day_index')::integer,
        v_row->>'course_name_raw', nullif(v_row->>'tee_time', '')::time,
        nullif(v_row->>'holes', '')::smallint, nullif(v_row->>'green_fee_inclusion', ''),
        nullif(v_row->>'caddie_inclusion', ''), nullif(v_row->>'cart_inclusion', ''),
        p_payload->>'source_hash', p_payload->>'payload_hash', coalesce(v_row->'evidence', '[]'::jsonb)
      ) returning id into v_golf_round_id;
      v_fact_hash := encode(extensions.digest(convert_to(
        concat_ws('|', v_tenant_id::text, lower(v_row->>'course_name_raw'),
          coalesce(v_row->>'holes', ''), p_payload->>'source_hash'), 'UTF8'), 'sha256'), 'hex');
      insert into internal_product_registration.golf_fact_observations (
        tenant_id, catalog_product_id, source_document_id, product_revision_id,
        source_kind, canonical_name, aliases, holes, source_weight,
        source_hash, revision_hash, evidence, observation_hash
      ) values (
        v_tenant_id, v_catalog_product_id, (p_payload->>'source_document_id')::uuid, v_revision_id,
        'current_source', v_row->>'course_name_raw', array[v_row->>'course_name_raw'],
        nullif(v_row->>'holes', '')::smallint, 1.0,
        p_payload->>'source_hash', p_payload->>'payload_hash',
        coalesce(v_row->'evidence', '[]'::jsonb), v_fact_hash
      ) on conflict (tenant_id, observation_hash) do update
        set observed_at = greatest(internal_product_registration.golf_fact_observations.observed_at, excluded.observed_at)
      returning id into v_observation_id;
      insert into internal_product_registration.golf_fact_resolutions (
        tenant_id, catalog_product_id, canonical_name, aliases, holes,
        observation_ids, resolution_state, source_hash, revision_hash, resolution_hash
      ) values (
        v_tenant_id, v_catalog_product_id, v_row->>'course_name_raw', array[v_row->>'course_name_raw'],
        nullif(v_row->>'holes', '')::smallint, array[v_observation_id], 'candidate',
        p_payload->>'source_hash', p_payload->>'payload_hash', v_fact_hash
      ) on conflict (tenant_id, resolution_hash) do update
        set observation_ids = (
          select array_agg(distinct value) from unnest(
            internal_product_registration.golf_fact_resolutions.observation_ids || excluded.observation_ids
          ) as value
        )
      returning id into v_resolution_id;
      update internal_product_registration.golf_rounds
      set golf_fact_resolution_id = v_resolution_id
      where id = v_golf_round_id;
      v_domain_count := v_domain_count + 1;
    end loop;

    for v_row in select value from jsonb_array_elements(coalesce(p_payload->'terms', '[]'::jsonb)) loop
      v_terms_id := null;
      execute $sql$
        insert into internal_product_registration.terms_revisions (
          tenant_id, catalog_product_id, product_revision_id, terms_type,
          terms_payload, source_hash, revision_hash, terms_hash, validation_state
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        on conflict (product_revision_id, terms_type, terms_hash) do nothing
        returning id
      $sql$ into v_terms_id using
        v_tenant_id, v_catalog_product_id, v_revision_id, v_row->>'terms_type',
        coalesce(v_row->'terms_payload', '{}'::jsonb), p_payload->>'source_hash',
        p_payload->>'payload_hash', v_row->>'terms_hash',
        coalesce(nullif(v_row->>'validation_state', ''), 'verified');
      if v_terms_id is null then
        execute 'select id from internal_product_registration.terms_revisions where product_revision_id = $1 and terms_type = $2 and terms_hash = $3'
          into v_terms_id using v_revision_id, v_row->>'terms_type', v_row->>'terms_hash';
      end if;
      for v_field_path in select value #>> '{}' from jsonb_array_elements(coalesce(v_row->'claim_field_paths', '[]'::jsonb)) loop
        execute $sql$
          insert into internal_product_registration.terms_claim_links (
            tenant_id, terms_revision_id, claim_id, terms_path
          )
          select $1, $2, c.id, $3
          from public.product_registration_v5_claims c
          where c.revision_id = $4 and c.field_path = $3
          on conflict (terms_revision_id, claim_id, terms_path) do nothing
        $sql$ using v_tenant_id, v_terms_id, v_field_path, v_revision_id;
      end loop;
      v_terms_count := v_terms_count + 1;
    end loop;
  end if;

  v_result := jsonb_build_object(
    'tenant_id', v_tenant_id,
    'catalog_product_id', v_catalog_product_id,
    'revision_id', v_revision_id,
    'revision_hash', p_payload->>'payload_hash',
    'inserted', v_inserted,
    'claim_count', v_claim_count,
    'price_rule_count', v_price_count,
    'itinerary_item_count', v_itinerary_count,
    'domain_row_count', v_domain_count,
    'terms_count', v_terms_count,
    'authority_mode', v_authority_mode
  );

  insert into internal_product_registration.registration_authority_events (
    tenant_id, catalog_product_id, revision_id, operation_key, writer_id,
    authority_mode, event_type, input_hash, result
  ) values (
    v_tenant_id, v_catalog_product_id, v_revision_id, v_operation_key,
    'registration-kernel', v_authority_mode, 'revision.committed', v_request_hash, v_result
  ) on conflict (tenant_id, operation_key, event_type) do nothing;

  return v_result;
end;
$$;

create or replace function public.commit_product_registration_revision_atomic(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
  select internal_product_registration.commit_revision_atomic(p_payload);
$$;

revoke all on function internal_product_registration.commit_revision_atomic(jsonb) from public, anon, authenticated;
revoke all on function public.commit_product_registration_revision_atomic(jsonb) from public, anon, authenticated;
grant execute on function internal_product_registration.commit_revision_atomic(jsonb) to service_role;
grant execute on function public.commit_product_registration_revision_atomic(jsonb) to service_role;

create or replace function internal_product_registration.bind_compatibility_projection_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_package_id uuid := nullif(p_payload->>'package_id', '')::uuid;
  v_internal_code text := nullif(btrim(p_payload->>'internal_code'), '');
  v_operation_key text := nullif(btrim(p_payload->>'operation_key'), '');
  v_revision public.product_registration_v5_revisions%rowtype;
  v_mode text;
  v_request_hash text;
  v_result jsonb;
begin
  perform set_config('app.product_registration_writer', 'compatibility-projection', true);
  if v_tenant_id is null or v_catalog_product_id is null or v_revision_id is null or v_package_id is null then
    raise exception 'REGISTRATION_COMPATIBILITY_LINEAGE_REQUIRED';
  end if;
  if v_operation_key is null then raise exception 'REGISTRATION_COMPATIBILITY_OPERATION_KEY_REQUIRED'; end if;

  select * into v_revision
  from public.product_registration_v5_revisions r
  where r.id = v_revision_id
    and r.tenant_id = v_tenant_id
    and r.catalog_product_id = v_catalog_product_id
  for share;
  if not found then raise exception 'REGISTRATION_COMPATIBILITY_REVISION_MISMATCH'; end if;
  if v_revision.payload_hash is distinct from p_payload->>'revision_hash' then
    raise exception 'REGISTRATION_COMPATIBILITY_REVISION_HASH_MISMATCH';
  end if;

  select authority_mode into v_mode
  from internal_product_registration.registration_authority_config
  where singleton = true
  for share;

  if exists (
    select 1 from public.travel_packages p
    where p.id = v_package_id
      and p.catalog_product_id is not null
      and p.catalog_product_id <> v_catalog_product_id
  ) then raise exception 'REGISTRATION_COMPATIBILITY_PACKAGE_IDENTITY_CONFLICT'; end if;

  update public.travel_packages
  set catalog_product_id = v_catalog_product_id,
      tenant_id = coalesce(tenant_id, v_tenant_id),
      canonical_revision_id = v_revision_id,
      canonical_payload_hash = v_revision.payload_hash,
      updated_at = now()
  where id = v_package_id
    and (tenant_id is null or tenant_id = v_tenant_id);
  if not found then raise exception 'REGISTRATION_COMPATIBILITY_PACKAGE_NOT_FOUND'; end if;

  if v_internal_code is not null then
    if exists (
      select 1 from public.products p
      where p.internal_code = v_internal_code
        and p.catalog_product_id is not null
        and p.catalog_product_id <> v_catalog_product_id
    ) then raise exception 'REGISTRATION_COMPATIBILITY_PRODUCT_IDENTITY_CONFLICT'; end if;

    update public.products
    set catalog_product_id = v_catalog_product_id,
        tenant_id = coalesce(tenant_id, v_tenant_id),
        updated_at = now()
    where internal_code = v_internal_code
      and (tenant_id is null or tenant_id = v_tenant_id);
  end if;

  v_request_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  v_result := jsonb_build_object(
    'tenant_id', v_tenant_id,
    'catalog_product_id', v_catalog_product_id,
    'revision_id', v_revision_id,
    'revision_hash', v_revision.payload_hash,
    'package_id', v_package_id,
    'internal_code', v_internal_code,
    'authority_mode', v_mode
  );

  insert into internal_product_registration.registration_authority_events (
    tenant_id, catalog_product_id, revision_id, package_id, operation_key,
    writer_id, authority_mode, event_type, input_hash, result
  ) values (
    v_tenant_id, v_catalog_product_id, v_revision_id, v_package_id,
    v_operation_key, 'compatibility-projection', v_mode,
    'compatibility.bound', v_request_hash, v_result
  ) on conflict (tenant_id, operation_key, event_type) do nothing;

  return v_result;
end;
$$;

create or replace function public.bind_product_registration_compatibility_projection_atomic(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
  select internal_product_registration.bind_compatibility_projection_atomic(p_payload);
$$;

revoke all on function internal_product_registration.bind_compatibility_projection_atomic(jsonb) from public, anon, authenticated;
revoke all on function public.bind_product_registration_compatibility_projection_atomic(jsonb) from public, anon, authenticated;
grant execute on function internal_product_registration.bind_compatibility_projection_atomic(jsonb) to service_role;
grant execute on function public.bind_product_registration_compatibility_projection_atomic(jsonb) to service_role;

create or replace function internal_product_registration.project_compatibility_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_operation_key text := nullif(btrim(p_payload->>'operation_key'), '');
  v_projection jsonb := coalesce(p_payload->'projection', '{}'::jsonb);
  v_revision public.product_registration_v5_revisions%rowtype;
  v_package_id uuid;
  v_internal_code text;
  v_count integer;
  v_mode text;
  v_request_hash text;
  v_result jsonb;
begin
  perform set_config('app.product_registration_writer', 'compatibility-projection', true);
  if v_tenant_id is null or v_catalog_product_id is null or v_revision_id is null
    or v_operation_key is null then raise exception 'REGISTRATION_COMPATIBILITY_LINEAGE_REQUIRED'; end if;
  if jsonb_typeof(v_projection) <> 'object' then raise exception 'REGISTRATION_COMPATIBILITY_PROJECTION_INVALID'; end if;

  select * into v_revision
  from public.product_registration_v5_revisions r
  where r.id = v_revision_id
    and r.tenant_id = v_tenant_id
    and r.catalog_product_id = v_catalog_product_id
    and r.payload_hash = p_payload->>'revision_hash'
    and r.source_hash = p_payload->>'source_hash'
  for share;
  if not found then raise exception 'REGISTRATION_COMPATIBILITY_REVISION_MISMATCH'; end if;

  select authority_mode into v_mode
  from internal_product_registration.registration_authority_config
  where singleton = true
  for share;

  select count(*), min(internal_code) into v_count, v_internal_code
  from public.products
  where catalog_product_id = v_catalog_product_id and tenant_id = v_tenant_id;
  if v_count > 1 then raise exception 'REGISTRATION_COMPATIBILITY_PRODUCT_IDENTITY_AMBIGUOUS'; end if;
  if v_internal_code is null then
    v_internal_code := 'KRN-' || upper(substr(replace(v_catalog_product_id::text, '-', ''), 1, 20));
    insert into public.products (
      tenant_id, catalog_product_id, internal_code, display_name, supplier_code,
      net_price, selling_price, margin_rate, departure_region, status,
      source_filename, raw_extracted_text
    ) values (
      v_tenant_id, v_catalog_product_id, v_internal_code,
      coalesce(nullif(v_projection->>'title', ''), v_internal_code),
      coalesce(nullif(p_payload->>'supplier_code', ''), 'KERNEL'),
      0,
      nullif(v_projection->>'price', '')::numeric,
      coalesce(nullif(p_payload->>'commission_rate', '')::numeric, 0) / 100,
      coalesce(nullif(v_projection->>'departure_region', ''), '미정'),
      'pending_review',
      null,
      null
    );
  end if;

  update public.products
  set display_name = coalesce(nullif(v_projection->>'title', ''), display_name),
      supplier_code = coalesce(nullif(p_payload->>'supplier_code', ''), supplier_code),
      selling_price = nullif(v_projection->>'price', '')::numeric,
      margin_rate = coalesce(nullif(p_payload->>'commission_rate', '')::numeric, 0) / 100,
      departure_region = coalesce(nullif(v_projection->>'departure_region', ''), departure_region),
      updated_at = now()
  where tenant_id = v_tenant_id
    and catalog_product_id = v_catalog_product_id
    and internal_code = v_internal_code;

  select count(*), min(id) into v_count, v_package_id
  from public.travel_packages
  where catalog_product_id = v_catalog_product_id and tenant_id = v_tenant_id;
  if v_count > 1 then raise exception 'REGISTRATION_COMPATIBILITY_PACKAGE_IDENTITY_AMBIGUOUS'; end if;
  if v_package_id is null then
    insert into public.travel_packages (
      tenant_id, catalog_product_id, internal_code, title, display_title,
      destination, duration, nights, price, price_dates, price_tiers,
      airline, inclusions, excludes, optional_tours, itinerary_data,
      customer_notes, notices_parsed, product_type, land_operator,
      commission_rate, parser_version, raw_text_hash, canonical_revision_id,
      canonical_payload_hash, package_revision, publication_state, status,
      audit_status, is_stub
    ) values (
      v_tenant_id, v_catalog_product_id, v_internal_code,
      coalesce(nullif(v_projection->>'title', ''), v_internal_code),
      nullif(v_projection->>'display_title', ''),
      nullif(v_projection->>'destination', ''),
      nullif(v_projection->>'duration', '')::integer,
      nullif(v_projection->>'nights', '')::integer,
      nullif(v_projection->>'price', '')::numeric,
      coalesce(v_projection->'price_dates', '[]'::jsonb),
      coalesce(v_projection->'price_tiers', '[]'::jsonb),
      nullif(v_projection->>'airline', ''),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_projection->'inclusions', '[]'::jsonb))), '{}'),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_projection->'excludes', '[]'::jsonb))), '{}'),
      coalesce(v_projection->'optional_tours', '[]'::jsonb),
      coalesce(v_projection->'itinerary_data', '{}'::jsonb),
      nullif(v_projection->>'customer_notes', ''),
      coalesce(v_projection->'notices_parsed', '[]'::jsonb),
      coalesce(nullif(v_projection->>'product_type', ''), 'package'),
      nullif(p_payload->>'land_operator', ''),
      nullif(p_payload->>'commission_rate', '')::numeric,
      'registration-kernel-projection-1',
      p_payload->>'source_hash',
      v_revision_id, v_revision.payload_hash, v_revision.revision_no,
      'draft', 'draft', 'pending', false
    ) returning id into v_package_id;
  end if;

  if exists (
    select 1
    from public.travel_packages p
    join public.product_registration_v5_revisions current_revision
      on current_revision.id = p.canonical_revision_id
    where p.id = v_package_id
      and current_revision.revision_no > v_revision.revision_no
  ) then
    raise exception 'REGISTRATION_COMPATIBILITY_STALE_REVISION';
  end if;

  update public.travel_packages
  set internal_code = v_internal_code,
      title = coalesce(nullif(v_projection->>'title', ''), title),
      display_title = nullif(v_projection->>'display_title', ''),
      destination = nullif(v_projection->>'destination', ''),
      duration = nullif(v_projection->>'duration', '')::integer,
      nights = nullif(v_projection->>'nights', '')::integer,
      price = nullif(v_projection->>'price', '')::numeric,
      price_dates = coalesce(v_projection->'price_dates', '[]'::jsonb),
      price_tiers = coalesce(v_projection->'price_tiers', '[]'::jsonb),
      airline = nullif(v_projection->>'airline', ''),
      inclusions = coalesce(array(select jsonb_array_elements_text(coalesce(v_projection->'inclusions', '[]'::jsonb))), '{}'),
      excludes = coalesce(array(select jsonb_array_elements_text(coalesce(v_projection->'excludes', '[]'::jsonb))), '{}'),
      optional_tours = coalesce(v_projection->'optional_tours', '[]'::jsonb),
      itinerary_data = coalesce(v_projection->'itinerary_data', '{}'::jsonb),
      customer_notes = nullif(v_projection->>'customer_notes', ''),
      notices_parsed = coalesce(v_projection->'notices_parsed', '[]'::jsonb),
      product_type = coalesce(nullif(v_projection->>'product_type', ''), 'package'),
      land_operator = nullif(p_payload->>'land_operator', ''),
      commission_rate = nullif(p_payload->>'commission_rate', '')::numeric,
      parser_version = 'registration-kernel-projection-1',
      raw_text_hash = p_payload->>'source_hash',
      canonical_revision_id = v_revision_id,
      canonical_payload_hash = v_revision.payload_hash,
      package_revision = v_revision.revision_no,
      updated_at = now()
  where id = v_package_id
    and tenant_id = v_tenant_id
    and catalog_product_id = v_catalog_product_id;

  update internal_product_registration.departure_instances
  set package_id = v_package_id
  where revision_id = v_revision_id and package_id is null;
  update internal_product_registration.transport_segments
  set package_id = v_package_id
  where revision_id = v_revision_id and package_id is null;
  update internal_product_registration.lodging_stays
  set package_id = v_package_id
  where revision_id = v_revision_id and package_id is null;
  update internal_product_registration.golf_rounds
  set package_id = v_package_id
  where revision_id = v_revision_id and package_id is null;

  v_request_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  v_result := jsonb_build_object(
    'tenant_id', v_tenant_id,
    'catalog_product_id', v_catalog_product_id,
    'revision_id', v_revision_id,
    'package_id', v_package_id,
    'internal_code', v_internal_code,
    'authority_mode', v_mode
  );
  insert into internal_product_registration.registration_authority_events (
    tenant_id, catalog_product_id, revision_id, package_id, operation_key,
    writer_id, authority_mode, event_type, input_hash, result
  ) values (
    v_tenant_id, v_catalog_product_id, v_revision_id, v_package_id,
    v_operation_key, 'compatibility-projection', v_mode,
    'compatibility.projected', v_request_hash, v_result
  ) on conflict (tenant_id, operation_key, event_type) do nothing;
  return v_result;
end;
$$;

create or replace function public.project_product_registration_compatibility_atomic(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
  select internal_product_registration.project_compatibility_atomic(p_payload);
$$;

revoke all on function internal_product_registration.project_compatibility_atomic(jsonb) from public, anon, authenticated;
revoke all on function public.project_product_registration_compatibility_atomic(jsonb) from public, anon, authenticated;
grant execute on function internal_product_registration.project_compatibility_atomic(jsonb) to service_role;
grant execute on function public.project_product_registration_compatibility_atomic(jsonb) to service_role;

create or replace function internal_product_registration.publish_snapshot_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_package_id uuid := nullif(p_payload->>'package_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_snapshot_id uuid := nullif(p_payload->>'snapshot_id', '')::uuid;
  v_proof_run_id uuid := nullif(p_payload->>'proof_run_id', '')::uuid;
  v_expected_pointer_version bigint := nullif(p_payload->>'expected_pointer_version', '')::bigint;
  v_operation_key text := nullif(btrim(p_payload->>'operation_key'), '');
  v_snapshot_hash text := p_payload->>'snapshot_hash';
  v_channel text := coalesce(nullif(p_payload->>'channel', ''), 'customer');
  v_locale text := coalesce(nullif(p_payload->>'locale', ''), 'ko-KR');
  v_policy_version text := p_payload->>'policy_version';
  v_outcome text := p_payload->>'outcome';
  v_revision public.product_registration_v5_revisions%rowtype;
  v_snapshot public.public_package_snapshots%rowtype;
  v_proof public.product_registration_v5_proof_runs%rowtype;
  v_pointer public.product_registration_v5_publication_pointers%rowtype;
  v_mode text;
  v_freeze boolean;
  v_supplier text;
  v_next_version bigint;
  v_request_hash text;
  v_existing_hash text;
  v_existing_status text;
  v_existing_response jsonb;
  v_inserted boolean := false;
  v_sale_blocked boolean := false;
  v_cohort_eligible boolean := false;
  v_result jsonb;
begin
  perform set_config('app.product_registration_writer', 'publication-kernel', true);
  if v_tenant_id is null or v_catalog_product_id is null or v_package_id is null
    or v_revision_id is null or v_snapshot_id is null or v_proof_run_id is null then
    raise exception 'REGISTRATION_PUBLICATION_LINEAGE_REQUIRED';
  end if;
  if v_snapshot_hash !~ '^[0-9a-f]{64}$' then raise exception 'REGISTRATION_PUBLICATION_SNAPSHOT_HASH_INVALID'; end if;
  if v_expected_pointer_version is null or v_expected_pointer_version < 0 then
    raise exception 'REGISTRATION_PUBLICATION_POINTER_VERSION_INVALID';
  end if;
  if v_operation_key is null then raise exception 'REGISTRATION_PUBLICATION_OPERATION_KEY_REQUIRED'; end if;
  if v_outcome not in ('published_verified', 'published_degraded') then
    raise exception 'REGISTRATION_PUBLICATION_OUTCOME_INVALID';
  end if;

  select authority_mode, publication_freeze into v_mode, v_freeze
  from internal_product_registration.registration_authority_config
  where singleton = true
  for share;
  if v_mode <> 'kernel' then raise exception 'REGISTRATION_PUBLICATION_KERNEL_AUTHORITY_REQUIRED'; end if;
  if v_freeze then raise exception 'REGISTRATION_PUBLICATION_FROZEN'; end if;

  v_request_hash := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.product_registration_v5_idempotency_ledger (
    operation_key, operation_type, tenant_id, aggregate_id, request_hash, status
  ) values (
    v_operation_key, 'publish_product_registration_snapshot_atomic', v_tenant_id,
    v_catalog_product_id, v_request_hash, 'started'
  ) on conflict (operation_key) do nothing
  returning true into v_inserted;

  select request_hash, status, response into v_existing_hash, v_existing_status, v_existing_response
  from public.product_registration_v5_idempotency_ledger
  where operation_key = v_operation_key;
  if v_existing_hash is distinct from v_request_hash then raise exception 'REGISTRATION_PUBLICATION_IDEMPOTENCY_REUSED'; end if;
  if v_existing_status = 'succeeded' then return coalesce(v_existing_response, '{}'::jsonb); end if;
  if not v_inserted then raise exception 'REGISTRATION_PUBLICATION_IDEMPOTENCY_IN_PROGRESS'; end if;

  select * into v_revision
  from public.product_registration_v5_revisions r
  where r.id = v_revision_id
    and r.tenant_id = v_tenant_id
    and r.catalog_product_id = v_catalog_product_id
  for share;
  if not found then raise exception 'REGISTRATION_PUBLICATION_REVISION_NOT_FOUND'; end if;
  if v_revision.status not in ('candidate', 'verified', 'approved', 'published') then
    raise exception 'REGISTRATION_PUBLICATION_REVISION_NOT_PUBLISHABLE:%', v_revision.status;
  end if;

  select p.land_operator into v_supplier
  from public.travel_packages p
  where p.id = v_package_id
    and p.catalog_product_id = v_catalog_product_id
    and p.tenant_id = v_tenant_id;
  if not found then raise exception 'REGISTRATION_PUBLICATION_PACKAGE_IDENTITY_MISMATCH'; end if;

  execute $sql$
    select coalesce((
      select q.publication_eligible
      from internal_product_registration.cohort_quality_metrics q
      where q.tenant_id = $1
        and (q.supplier_key = $2 or q.supplier_key is null)
        and (q.parser_version = $3 or q.parser_version is null)
        and q.policy_version = $4
        and q.critical_defect_count = 0
      order by
        (q.supplier_key is not null)::integer desc,
        (q.parser_version is not null)::integer desc,
        q.window_end desc
      limit 1
    ), false)
  $sql$ into v_cohort_eligible using
    v_tenant_id, v_supplier, v_revision.normalization_version, v_policy_version;
  if not v_cohort_eligible then raise exception 'REGISTRATION_PUBLICATION_COHORT_NOT_ELIGIBLE'; end if;

  execute $sql$
    select exists (
      select 1
      from internal_product_registration.package_availability_overlays a
      where a.tenant_id = $1
        and a.catalog_product_id = $2
        and a.channel = $3
        and a.sale_state in ('closed', 'sold_out', 'suspended')
        and (a.expires_at is null or a.expires_at > now())
    )
  $sql$ into v_sale_blocked using v_tenant_id, v_catalog_product_id, v_channel;
  if v_sale_blocked then raise exception 'REGISTRATION_PUBLICATION_SALE_BLOCKED'; end if;

  if exists (
    select 1 from public.product_registration_v5_kill_switches k
    where k.active and (k.expires_at is null or k.expires_at > now())
      and (
        k.scope = 'global'
        or (k.scope = 'product' and k.scope_key in (v_catalog_product_id::text, v_package_id::text, '*'))
        or (k.scope = 'supplier' and k.scope_key in (coalesce(v_supplier, ''), '*'))
        or (k.scope = 'parser' and k.scope_key in ('registration-kernel', 'product-registration-v6', '*'))
        or k.scope in ('model', 'ocr_provider', 'transport_provider')
      )
  ) then raise exception 'REGISTRATION_PUBLICATION_KILL_SWITCH_ACTIVE'; end if;

  select * into v_snapshot
  from public.public_package_snapshots s
  where s.id = v_snapshot_id
    and s.package_id = v_package_id
    and s.catalog_product_id = v_catalog_product_id
    and s.canonical_revision_id = v_revision_id
    and s.snapshot_hash = v_snapshot_hash
  for share;
  if not found then raise exception 'REGISTRATION_PUBLICATION_SNAPSHOT_MISMATCH'; end if;

  select * into v_proof
  from public.product_registration_v5_proof_runs p
  where p.id = v_proof_run_id
    and p.tenant_id = v_tenant_id
    and p.catalog_product_id = v_catalog_product_id
    and p.package_id = v_package_id
    and p.revision_id = v_revision_id
    and p.public_snapshot_id = v_snapshot_id
    and p.snapshot_hash = v_snapshot_hash
    and p.renderer_build_id = v_snapshot.renderer_build_id
    and p.status = 'passed';
  if not found then raise exception 'REGISTRATION_PUBLICATION_PROOF_MISMATCH'; end if;

  insert into public.product_registration_v5_publication_pointers (
    tenant_id, catalog_product_id, package_id, channel, locale, state, pointer_version
  ) values (
    v_tenant_id, v_catalog_product_id, v_package_id, v_channel, v_locale, 'draft', 0
  ) on conflict (package_id, channel, locale) do nothing;

  select * into v_pointer
  from public.product_registration_v5_publication_pointers p
  where p.package_id = v_package_id and p.channel = v_channel and p.locale = v_locale
  for update;
  if v_pointer.tenant_id is distinct from v_tenant_id
    or v_pointer.catalog_product_id is distinct from v_catalog_product_id then
    raise exception 'REGISTRATION_PUBLICATION_POINTER_IDENTITY_MISMATCH';
  end if;
  if v_pointer.pointer_version <> v_expected_pointer_version then
    raise exception 'REGISTRATION_PUBLICATION_POINTER_VERSION_CONFLICT:expected %, actual %',
      v_expected_pointer_version, v_pointer.pointer_version;
  end if;

  v_next_version := v_pointer.pointer_version + 1;
  update public.product_registration_v5_publication_pointers
  set current_revision_id = v_revision_id,
      current_snapshot_id = v_snapshot_id,
      state = 'published',
      pointer_version = v_next_version,
      updated_at = now()
  where package_id = v_package_id and channel = v_channel and locale = v_locale;

  update public.travel_packages
  set canonical_revision_id = v_revision_id,
      canonical_payload_hash = v_revision.payload_hash,
      publication_state = 'published',
      status = 'active',
      package_revision = greatest(package_revision, v_revision.revision_no),
      updated_at = now()
  where id = v_package_id and catalog_product_id = v_catalog_product_id;

  update public.public_package_snapshots
  set status = 'published', published_at = coalesce(published_at, now())
  where id = v_snapshot_id and status in ('candidate', 'approved', 'published');

  insert into public.package_publish_decisions (
    tenant_id, catalog_product_id, package_id, package_revision,
    public_snapshot_id, public_snapshot_hash, publication_state, publishable,
    canonical_revision_id, proof_run_id, policy_version, idempotency_key,
    mobile_proof_ref, decision_source
  ) values (
    v_tenant_id, v_catalog_product_id, v_package_id, v_revision.revision_no,
    v_snapshot_id, v_snapshot_hash, 'published', true,
    v_revision_id, v_proof_run_id, v_policy_version, v_operation_key,
    v_proof_run_id::text, 'registration-kernel-cas'
  );

  v_result := jsonb_build_object(
    'tenant_id', v_tenant_id,
    'catalog_product_id', v_catalog_product_id,
    'package_id', v_package_id,
    'revision_id', v_revision_id,
    'snapshot_id', v_snapshot_id,
    'snapshot_hash', v_snapshot_hash,
    'proof_run_id', v_proof_run_id,
    'channel', v_channel,
    'locale', v_locale,
    'pointer_version', v_next_version,
    'publication_state', 'published',
    'outcome', v_outcome,
    'policy_version', v_policy_version
  );

  insert into public.product_registration_v5_publication_outbox (
    tenant_id, catalog_product_id, aggregate_type, aggregate_id,
    event_type, dedupe_key, payload
  ) values (
    v_tenant_id, v_catalog_product_id, 'travel_package', v_package_id,
    'package.publication.pointer_committed', v_operation_key || ':surface-invalidation', v_result
  ) on conflict (dedupe_key) do nothing;

  if v_channel = 'customer' then
    execute $sql$
      insert into internal_product_registration.schedule_revalidation_jobs (
        tenant_id, catalog_product_id, product_revision_id, departure_date,
        checkpoint, due_at, provider_policy_version, operation_key
      )
      select $1, $2, $3, d.departure_date, checkpoint.value,
        greatest(now(), (d.departure_date::timestamp - checkpoint.offset_value)),
        $4,
        concat($3::text, ':', d.departure_date::text, ':', checkpoint.value)
      from internal_product_registration.departure_instances d
      cross join (values
        ('publish'::text, interval '0 days'),
        ('d90'::text, interval '90 days'),
        ('d30'::text, interval '30 days'),
        ('d7'::text, interval '7 days')
      ) as checkpoint(value, offset_value)
      where d.revision_id = $3 and d.tenant_id = $1
      on conflict (tenant_id, operation_key) do nothing
    $sql$ using v_tenant_id, v_catalog_product_id, v_revision_id,
      coalesce(nullif(v_policy_version, ''), 'product-registration-v6-policy-1');
  end if;

  insert into internal_product_registration.registration_authority_events (
    tenant_id, catalog_product_id, revision_id, package_id, operation_key,
    writer_id, authority_mode, event_type, input_hash, result
  ) values (
    v_tenant_id, v_catalog_product_id, v_revision_id, v_package_id,
    v_operation_key, 'publication-kernel', v_mode,
    'snapshot.published', v_request_hash, v_result
  ) on conflict (tenant_id, operation_key, event_type) do nothing;

  update public.product_registration_v5_idempotency_ledger
  set status = 'succeeded', response = v_result, completed_at = now()
  where operation_key = v_operation_key;

  return v_result;
end;
$$;

create or replace function public.publish_product_registration_snapshot_atomic(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
  select internal_product_registration.publish_snapshot_atomic(p_payload);
$$;

revoke all on function internal_product_registration.publish_snapshot_atomic(jsonb) from public, anon, authenticated;
revoke all on function public.publish_product_registration_snapshot_atomic(jsonb) from public, anon, authenticated;
grant execute on function internal_product_registration.publish_snapshot_atomic(jsonb) to service_role;
grant execute on function public.publish_product_registration_snapshot_atomic(jsonb) to service_role;

create or replace function internal_product_registration.set_revision_lineage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_revision_id uuid;
  v_tenant_id uuid;
  v_catalog_product_id uuid;
begin
  v_revision_id := nullif(to_jsonb(new)->>tg_argv[0], '')::uuid;
  if v_revision_id is null then return new; end if;
  select r.tenant_id, r.catalog_product_id into v_tenant_id, v_catalog_product_id
  from public.product_registration_v5_revisions r
  where r.id = v_revision_id;
  if not found then raise exception 'REGISTRATION_TYPED_REVISION_NOT_FOUND'; end if;
  if nullif(to_jsonb(new)->>'tenant_id', '')::uuid is not null
    and nullif(to_jsonb(new)->>'tenant_id', '')::uuid <> v_tenant_id then
    raise exception 'REGISTRATION_TYPED_TENANT_MISMATCH';
  end if;
  if nullif(to_jsonb(new)->>'catalog_product_id', '')::uuid is not null
    and nullif(to_jsonb(new)->>'catalog_product_id', '')::uuid <> v_catalog_product_id then
    raise exception 'REGISTRATION_TYPED_CATALOG_MISMATCH';
  end if;
  new := jsonb_populate_record(new, jsonb_build_object(
    'tenant_id', v_tenant_id,
    'catalog_product_id', v_catalog_product_id
  ));
  return new;
end;
$$;

do $$
declare
  v_table text;
  v_revision_column text;
begin
  for v_table, v_revision_column in
    select * from (values
      ('departure_instances', 'revision_id'),
      ('transport_segments', 'revision_id'),
      ('lodging_stays', 'revision_id'),
      ('golf_rounds', 'revision_id'),
      ('copy_revisions', 'product_revision_id'),
      ('transport_fact_resolutions', 'product_revision_id')
    ) as lineage(table_name, revision_column)
  loop
    execute format(
      'drop trigger if exists %I on internal_product_registration.%I',
      'trg_' || v_table || '_revision_lineage', v_table
    );
    execute format(
      'create trigger %I before insert on internal_product_registration.%I '
      || 'for each row execute function internal_product_registration.set_revision_lineage(%L)',
      'trg_' || v_table || '_revision_lineage', v_table, v_revision_column
    );
  end loop;
end;
$$;

create or replace function internal_product_registration.set_copy_link_lineage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_catalog_product_id uuid;
begin
  select c.tenant_id, c.catalog_product_id into v_tenant_id, v_catalog_product_id
  from internal_product_registration.copy_revisions c
  where c.id = new.copy_revision_id;
  if not found then raise exception 'REGISTRATION_COPY_REVISION_NOT_FOUND'; end if;
  new.tenant_id := v_tenant_id;
  new.catalog_product_id := v_catalog_product_id;
  return new;
end;
$$;

drop trigger if exists trg_copy_claim_links_lineage on internal_product_registration.copy_claim_links;
create trigger trg_copy_claim_links_lineage
  before insert on internal_product_registration.copy_claim_links
  for each row execute function internal_product_registration.set_copy_link_lineage();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'catalog_products',
    'registration_authority_config',
    'registration_authority_events'
  ] loop
    execute format('revoke all on table internal_product_registration.%I from public, anon, authenticated', v_table);
    execute format('grant all on table internal_product_registration.%I to service_role', v_table);
  end loop;
end;
$$;

revoke all on function internal_product_registration.set_revision_lineage() from public, anon, authenticated;
revoke all on function internal_product_registration.set_copy_link_lineage() from public, anon, authenticated;
grant execute on function internal_product_registration.set_revision_lineage() to service_role;
grant execute on function internal_product_registration.set_copy_link_lineage() to service_role;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'registration_authority_events'
  ] loop
    execute format(
      'drop trigger if exists %I on internal_product_registration.%I',
      'trg_' || v_table || '_immutable', v_table
    );
    execute format(
      'create trigger %I before update or delete on internal_product_registration.%I '
      || 'for each row execute function internal_product_registration.reject_mutation()',
      'trg_' || v_table || '_immutable', v_table
    );
  end loop;
end;
$$;






-- Existing immutable rows need a single controlled lineage backfill. The
-- triggers are restored before any new application write can run.
alter table public.product_registration_v5_segments disable trigger user;
alter table public.product_registration_v5_revisions disable trigger user;
alter table public.product_registration_v5_proof_runs disable trigger user;

-- Existing compatibility packages become one-to-one catalog identities.
insert into internal_product_registration.catalog_products (
  id, tenant_id, product_key, identity_status, source_channel, metadata
)
select
  p.id,
  coalesce(nullif(p.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), '00000000-0000-0000-0000-000000000001'::uuid),
  'legacy:travel-package:' || p.id::text,
  case
    when p.internal_code is not null and exists (
      select 1 from public.travel_packages p2
      where p2.internal_code = p.internal_code and p2.id <> p.id
    ) then 'conflicting'
    else 'resolved'
  end,
  'legacy_backfill',
  jsonb_build_object('travel_package_id', p.id, 'internal_code', p.internal_code)
from public.travel_packages p
on conflict (id) do nothing;

update public.travel_packages p
set catalog_product_id = p.id
where p.catalog_product_id is null;

-- A products row is linked to a package only when the old internal_code is
-- unambiguous. Orphans receive their own catalog identity; conflicts remain
-- explicitly quarantined instead of being guessed into a package.
update public.products pr
set catalog_product_id = match.catalog_product_id
from (
  select internal_code, min(catalog_product_id::text)::uuid as catalog_product_id
  from public.travel_packages
  where internal_code is not null and catalog_product_id is not null
  group by internal_code
  having count(*) = 1
) match
where pr.internal_code = match.internal_code
  and pr.catalog_product_id is null;

insert into internal_product_registration.catalog_products (
  tenant_id, product_key, identity_status, source_channel, metadata
)
select
  coalesce(nullif(pr.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), '00000000-0000-0000-0000-000000000001'::uuid),
  'legacy:product:' || pr.internal_code,
  case
    when exists (
      select 1 from public.travel_packages p where p.internal_code = pr.internal_code
    ) then 'conflicting'
    else 'orphaned'
  end,
  'legacy_backfill',
  jsonb_build_object('products_internal_code', pr.internal_code)
from public.products pr
where pr.catalog_product_id is null
on conflict (tenant_id, product_key) do nothing;

update public.products pr
set catalog_product_id = cp.id
from internal_product_registration.catalog_products cp
where pr.catalog_product_id is null
  and cp.tenant_id = coalesce(nullif(pr.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), '00000000-0000-0000-0000-000000000001'::uuid)
  and cp.product_key = 'legacy:product:' || pr.internal_code;

-- Revisions that already have a compatibility package inherit its stable ID.
-- Historical unbound witnesses get a quarantined catalog identity keyed by the
-- immutable revision ID; they are never silently attached to a package.
update public.product_registration_v5_revisions r
set catalog_product_id = p.catalog_product_id
from public.travel_packages p
where r.catalog_product_id is null
  and r.package_id = p.id;

insert into internal_product_registration.catalog_products (
  id, tenant_id, product_key, identity_status, lifecycle_state, source_channel, metadata
)
select
  r.id,
  coalesce(
    nullif(r.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    nullif(s.tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    '00000000-0000-0000-0000-000000000001'::uuid
  ),
  'legacy:unbound-revision:' || r.id::text,
  'quarantined',
  'quarantined',
  'legacy_backfill',
  jsonb_build_object('revision_id', r.id, 'reason', 'historical_unbound_revision')
from public.product_registration_v5_revisions r
left join public.product_source_documents s on s.id = r.source_document_id
where r.catalog_product_id is null
on conflict (id) do nothing;

update public.product_registration_v5_revisions r
set catalog_product_id = r.id
where r.catalog_product_id is null;

update public.public_package_snapshots s
set catalog_product_id = p.catalog_product_id
from public.travel_packages p
where s.catalog_product_id is null and s.package_id = p.id;

update public.product_registration_v5_proof_runs pr
set catalog_product_id = coalesce(
  (select r.catalog_product_id from public.product_registration_v5_revisions r where r.id = pr.revision_id),
  (select p.catalog_product_id from public.travel_packages p where p.id = pr.package_id)
)
where pr.catalog_product_id is null
  and coalesce(
    (select r.catalog_product_id from public.product_registration_v5_revisions r where r.id = pr.revision_id),
    (select p.catalog_product_id from public.travel_packages p where p.id = pr.package_id)
  ) is not null;

update public.product_registration_v5_publication_pointers ptr
set catalog_product_id = p.catalog_product_id
from public.travel_packages p
where ptr.catalog_product_id is null and ptr.package_id = p.id;

update public.package_publish_decisions d
set catalog_product_id = p.catalog_product_id
from public.travel_packages p
where d.catalog_product_id is null and d.package_id = p.id;

-- Tenant-scoped source deduplication replaces the unsafe global hash scope.
update public.product_source_documents
set tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
where tenant_id is null;

update public.product_document_extractions e
set tenant_id = s.tenant_id
from public.product_source_documents s
where e.source_document_id = s.id and e.tenant_id is null;

update public.upload_jobs j
set tenant_id = coalesce(s.tenant_id, '00000000-0000-0000-0000-000000000001'::uuid)
from public.product_source_documents s
where j.source_document_id = s.id and j.tenant_id is null;

update public.upload_jobs
set tenant_id = '00000000-0000-0000-0000-000000000001'::uuid
where tenant_id is null;

update public.product_registration_v4_normalizations n
set tenant_id = j.tenant_id
from public.upload_jobs j
where n.job_id = j.id and n.tenant_id is null;

update public.product_registration_v5_revisions r
set tenant_id = coalesce(
  (select s.tenant_id from public.product_source_documents s where s.id = r.source_document_id),
  (select p.tenant_id from public.travel_packages p where p.id = r.package_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
where r.tenant_id is null;

update public.product_registration_v5_segments seg
set tenant_id = s.tenant_id
from public.product_source_documents s
where seg.source_document_id = s.id and seg.tenant_id is null;

update public.product_registration_v5_proof_runs pr
set tenant_id = coalesce(
  (select r.tenant_id from public.product_registration_v5_revisions r where r.id = pr.revision_id),
  (select p.tenant_id from public.travel_packages p where p.id = pr.package_id),
  '00000000-0000-0000-0000-000000000001'::uuid
)
where pr.tenant_id is null;

update public.product_registration_v5_publication_pointers ptr
set tenant_id = coalesce(p.tenant_id, '00000000-0000-0000-0000-000000000001'::uuid)
from public.travel_packages p
where ptr.package_id = p.id and ptr.tenant_id is null;

alter table public.product_source_documents
  drop constraint if exists product_source_documents_sha256_byte_size_key;
drop index if exists public.product_source_documents_sha256_byte_size_key;

create unique index if not exists idx_product_source_documents_tenant_hash_size
  on public.product_source_documents(tenant_id, sha256, byte_size);
create unique index if not exists idx_product_source_documents_tenant_id_id
  on public.product_source_documents(tenant_id, id);
create unique index if not exists idx_product_document_extractions_tenant_id_id
  on public.product_document_extractions(tenant_id, id);
create unique index if not exists idx_product_registration_v5_revisions_tenant_id_id
  on public.product_registration_v5_revisions(tenant_id, id);
create unique index if not exists idx_catalog_products_product_projection
  on public.products(catalog_product_id)
  where catalog_product_id is not null;
create unique index if not exists idx_catalog_products_package_projection
  on public.travel_packages(catalog_product_id)
  where catalog_product_id is not null;
create unique index if not exists idx_product_registration_v5_revisions_catalog_no
  on public.product_registration_v5_revisions(catalog_product_id, revision_no);
create index if not exists idx_public_package_snapshots_catalog
  on public.public_package_snapshots(catalog_product_id, created_at desc);
create index if not exists idx_product_registration_v5_pointers_catalog
  on public.product_registration_v5_publication_pointers(catalog_product_id, channel, locale);

alter table public.product_source_documents alter column tenant_id set not null;
alter table public.product_document_extractions alter column tenant_id set not null;
alter table public.upload_jobs alter column tenant_id set not null;
alter table public.product_registration_v4_normalizations alter column tenant_id set not null;
alter table public.product_registration_v5_segments alter column tenant_id set not null;
alter table public.product_registration_v5_revisions alter column tenant_id set not null;
alter table public.product_registration_v5_revisions alter column catalog_product_id set not null;

alter table public.product_source_documents
  add constraint product_source_documents_tenant_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public.product_document_extractions
  add constraint product_document_extractions_tenant_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public.upload_jobs
  add constraint upload_jobs_tenant_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;
alter table public.product_registration_v4_normalizations
  add constraint product_registration_v4_normalizations_tenant_fkey
  foreign key (tenant_id) references public.tenants(id) on delete restrict;

alter table public.products
  add constraint products_catalog_product_fkey
  foreign key (catalog_product_id) references internal_product_registration.catalog_products(id) on delete restrict;
alter table public.travel_packages
  add constraint travel_packages_catalog_product_fkey
  foreign key (catalog_product_id) references internal_product_registration.catalog_products(id) on delete restrict;
alter table public.product_registration_v5_revisions
  add constraint product_registration_v5_revisions_catalog_product_fkey
  foreign key (catalog_product_id) references internal_product_registration.catalog_products(id) on delete restrict;
alter table public.public_package_snapshots
  add constraint public_package_snapshots_catalog_product_fkey
  foreign key (catalog_product_id) references internal_product_registration.catalog_products(id) on delete restrict;
alter table public.product_registration_v5_proof_runs
  add constraint product_registration_v5_proof_runs_catalog_product_fkey
  foreign key (catalog_product_id) references internal_product_registration.catalog_products(id) on delete restrict;
alter table public.product_registration_v5_publication_pointers
  add constraint product_registration_v5_pointers_catalog_product_fkey
  foreign key (catalog_product_id) references internal_product_registration.catalog_products(id) on delete restrict;

alter table public.product_registration_v5_segments enable trigger user;
alter table public.product_registration_v5_revisions enable trigger user;
alter table public.product_registration_v5_proof_runs enable trigger user;

-- Missing domain engines are revision-bound. They collect observations and
-- evidence, but never create customer-visible attraction/hotel/golf masters.
create table if not exists internal_product_registration.source_blobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size > 0),
  storage_bucket text not null,
  storage_path text not null,
  detected_mime text,
  created_at timestamptz not null default now(),
  unique (tenant_id, sha256, byte_size),
  unique (tenant_id, id)
);

create table if not exists internal_product_registration.source_document_uploads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  source_blob_id uuid not null references internal_product_registration.source_blobs(id) on delete restrict,
  source_document_id uuid not null references public.product_source_documents(id) on delete restrict,
  request_key text not null,
  source_channel text not null,
  original_filename text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, request_key)
);

insert into internal_product_registration.source_blobs (
  tenant_id, sha256, byte_size, storage_bucket, storage_path, detected_mime
)
select s.tenant_id, s.sha256, s.byte_size, s.storage_bucket, s.storage_path, s.detected_mime
from public.product_source_documents s
where s.tenant_id is not null
on conflict (tenant_id, sha256, byte_size) do nothing;

create table if not exists internal_product_registration.correction_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  base_revision_id uuid not null references public.product_registration_v5_revisions(id) on delete restrict,
  source_document_id uuid references public.product_source_documents(id) on delete restrict,
  workflow_job_id uuid references public.upload_jobs(id) on delete restrict,
  requested_changes jsonb not null check (jsonb_typeof(requested_changes) = 'array'),
  reason text not null,
  operation_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'blocked', 'failed')),
  resulting_revision_id uuid references public.product_registration_v5_revisions(id) on delete restrict,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, operation_key)
);

create table if not exists internal_product_registration.terms_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  product_revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  terms_type text not null
    check (terms_type in ('cancellation', 'refund', 'inclusion', 'exclusion', 'shopping', 'optional_tour', 'entry', 'general')),
  applies_from date,
  applies_to date,
  terms_payload jsonb not null check (jsonb_typeof(terms_payload) = 'object'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  terms_hash text not null check (terms_hash ~ '^[0-9a-f]{64}$'),
  validation_state text not null default 'candidate'
    check (validation_state in ('candidate', 'verified', 'blocked', 'conflicting')),
  created_version text not null default 'product-registration-terms-1',
  created_at timestamptz not null default now(),
  check (applies_from is null or applies_to is null or applies_from <= applies_to),
  unique (product_revision_id, terms_type, terms_hash)
);

create table if not exists internal_product_registration.terms_claim_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  terms_revision_id uuid not null references internal_product_registration.terms_revisions(id) on delete cascade,
  claim_id uuid not null references public.product_registration_v5_claims(id) on delete restrict,
  terms_path text not null,
  created_at timestamptz not null default now(),
  unique (terms_revision_id, claim_id, terms_path)
);

create table if not exists internal_product_registration.media_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  source_document_id uuid references public.product_source_documents(id) on delete restrict,
  storage_bucket text,
  storage_path text,
  external_url text,
  media_type text not null default 'image' check (media_type in ('image', 'video', 'document')),
  provenance_type text not null
    check (provenance_type in ('supplier_product', 'operator_product', 'destination_reference', 'licensed_stock', 'generated')),
  rights_status text not null default 'unverified'
    check (rights_status in ('verified', 'attribution_required', 'unverified', 'prohibited', 'expired')),
  rights_holder text,
  license_reference text,
  attribution_text text,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  check (storage_path is not null or external_url is not null),
  unique (tenant_id, sha256)
);

create table if not exists internal_product_registration.media_revision_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  product_revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  media_asset_id uuid not null references internal_product_registration.media_assets(id) on delete restrict,
  role text not null check (role in ('hero', 'gallery', 'itinerary', 'hotel', 'golf', 'reference')),
  customer_label text,
  sort_order integer not null default 0 check (sort_order >= 0),
  claim_id uuid references public.product_registration_v5_claims(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (product_revision_id, media_asset_id, role)
);

create table if not exists internal_product_registration.hotel_fact_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid references internal_product_registration.catalog_products(id) on delete restrict,
  source_document_id uuid references public.product_source_documents(id) on delete restrict,
  product_revision_id uuid references public.product_registration_v5_revisions(id) on delete restrict,
  source_kind text not null check (source_kind in ('current_source', 'verified_product', 'legacy_product', 'official', 'external_provider')),
  hotel_name_raw text not null,
  normalized_name text,
  country_code text,
  region text,
  address_text text,
  external_identity text,
  star_rating numeric(2,1),
  source_weight numeric(5,4) not null check (source_weight between 0 and 1),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  observation_hash text not null check (observation_hash ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null default now(),
  created_version text not null default 'product-registration-hotel-facts-1',
  unique (tenant_id, observation_hash)
);

create table if not exists internal_product_registration.hotel_fact_resolutions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  product_revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  section_index integer not null check (section_index >= 0),
  variant_key text not null,
  day_index integer not null check (day_index >= 1),
  hotel_name_display text,
  lodging_state text not null check (lodging_state in ('confirmed', 'equivalent', 'to_be_confirmed', 'conflicting')),
  master_hotel_id uuid,
  observation_ids uuid[] not null default '{}',
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  resolution_hash text not null check (resolution_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (product_revision_id, section_index, variant_key, day_index, resolution_hash)
);

create table if not exists internal_product_registration.supplier_layout_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  supplier_key text not null,
  document_family text not null,
  profile_version text not null,
  parser_routing jsonb not null default '{}'::jsonb check (jsonb_typeof(parser_routing) = 'object'),
  segmentation_rules jsonb not null default '{}'::jsonb check (jsonb_typeof(segmentation_rules) = 'object'),
  validation_policy jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_policy) = 'object'),
  activation_state text not null default 'shadow'
    check (activation_state in ('draft', 'shadow', 'active', 'blocked', 'retired')),
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (tenant_id, supplier_key, document_family, profile_version)
);

create table if not exists internal_product_registration.profile_benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  supplier_layout_profile_id uuid not null references internal_product_registration.supplier_layout_profiles(id) on delete restrict,
  corpus_version text not null,
  metrics jsonb not null check (jsonb_typeof(metrics) = 'object'),
  critical_false_publish_count integer not null default 0 check (critical_false_publish_count >= 0),
  exact_match_rate numeric(7,6) check (exact_match_rate is null or exact_match_rate between 0 and 1),
  passed boolean not null,
  build_id text,
  created_at timestamptz not null default now(),
  unique (supplier_layout_profile_id, corpus_version, build_id)
);

create table if not exists internal_product_registration.package_availability_overlays (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete cascade,
  channel text not null default 'customer',
  sale_state text not null default 'available'
    check (sale_state in ('available', 'request', 'closed', 'sold_out', 'suspended')),
  available_seats integer check (available_seats is null or available_seats >= 0),
  reason text,
  overlay_version bigint not null default 0 check (overlay_version >= 0),
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, catalog_product_id, channel)
);

create table if not exists internal_product_registration.schedule_revalidation_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete cascade,
  product_revision_id uuid not null references public.product_registration_v5_revisions(id) on delete restrict,
  departure_date date not null,
  checkpoint text not null check (checkpoint in ('publish', 'd90', 'd30', 'd7')),
  due_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'unchanged', 'revision_created', 'blocked', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  provider_policy_version text not null,
  operation_key text not null,
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, operation_key)
);

create table if not exists internal_product_registration.cohort_quality_metrics (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  supplier_key text,
  parser_version text,
  ocr_provider text,
  policy_version text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  sample_count integer not null check (sample_count >= 0),
  auto_publish_count integer not null default 0 check (auto_publish_count >= 0),
  critical_defect_count integer not null default 0 check (critical_defect_count >= 0),
  exact_match_rate numeric(7,6) check (exact_match_rate is null or exact_match_rate between 0 and 1),
  publication_eligible boolean not null default false,
  metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz not null default now(),
  check (window_start < window_end)
);

create index if not exists idx_pr_authority_events_catalog
  on internal_product_registration.registration_authority_events(catalog_product_id, created_at desc);
create index if not exists idx_pr_source_uploads_document
  on internal_product_registration.source_document_uploads(source_document_id, created_at desc);
create index if not exists idx_pr_terms_revision
  on internal_product_registration.terms_revisions(product_revision_id, terms_type, validation_state);
create index if not exists idx_pr_media_revision
  on internal_product_registration.media_revision_links(product_revision_id, sort_order);
create index if not exists idx_pr_hotel_observation_lookup
  on internal_product_registration.hotel_fact_observations(lower(hotel_name_raw), country_code, region, observed_at desc);
create index if not exists idx_pr_supplier_profile_active
  on internal_product_registration.supplier_layout_profiles(tenant_id, supplier_key, document_family, activation_state);
create index if not exists idx_pr_schedule_revalidation_due
  on internal_product_registration.schedule_revalidation_jobs(status, due_at)
  where status in ('pending', 'failed');
create index if not exists idx_pr_cohort_quality_lookup
  on internal_product_registration.cohort_quality_metrics(tenant_id, supplier_key, parser_version, ocr_provider, window_end desc);

create or replace function internal_product_registration.get_revision_aggregate(p_revision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select jsonb_build_object(
    'revision', jsonb_build_object(
      'id', r.id,
      'tenant_id', r.tenant_id,
      'catalog_product_id', r.catalog_product_id,
      'payload_hash', r.payload_hash,
      'source_hash', (select s.sha256 from public.product_source_documents s where s.id = r.source_document_id),
      'revision_no', r.revision_no,
      'canonical_payload', r.canonical_payload
    ),
    'departures', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.departure_date, d.variant_key)
      from internal_product_registration.departure_instances d
      where d.revision_id = r.id and d.tenant_id = r.tenant_id
    ), '[]'::jsonb),
    'transport_segments', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.section_index, t.variant_key, t.sequence_no)
      from internal_product_registration.transport_segments t
      where t.revision_id = r.id and t.tenant_id = r.tenant_id
    ), '[]'::jsonb),
    'lodging_stays', coalesce((
      select jsonb_agg(to_jsonb(l) order by l.section_index, l.variant_key, l.day_index)
      from internal_product_registration.lodging_stays l
      where l.revision_id = r.id and l.tenant_id = r.tenant_id
    ), '[]'::jsonb),
    'golf_rounds', coalesce((
      select jsonb_agg(to_jsonb(g) order by g.section_index, g.variant_key, g.day_index)
      from internal_product_registration.golf_rounds g
      where g.revision_id = r.id and g.tenant_id = r.tenant_id
    ), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(to_jsonb(tr) order by tr.terms_type, tr.created_at)
      from internal_product_registration.terms_revisions tr
      where tr.product_revision_id = r.id and tr.tenant_id = r.tenant_id
    ), '[]'::jsonb),
    'media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'role', ml.role,
          'customer_label', ml.customer_label,
          'sort_order', ml.sort_order,
          'external_url', a.external_url,
          'storage_bucket', a.storage_bucket,
          'storage_path', a.storage_path,
          'provenance_type', a.provenance_type,
          'rights_status', a.rights_status,
          'attribution_text', a.attribution_text
        ) order by ml.sort_order, a.created_at
      )
      from internal_product_registration.media_revision_links ml
      join internal_product_registration.media_assets a
        on a.id = ml.media_asset_id and a.tenant_id = ml.tenant_id
      where ml.product_revision_id = r.id
        and ml.tenant_id = r.tenant_id
        and a.rights_status in ('verified', 'attribution_required')
    ), '[]'::jsonb)
  )
  from public.product_registration_v5_revisions r
  where r.id = p_revision_id;
$$;

create or replace function public.get_product_registration_revision_aggregate(p_revision_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.get_revision_aggregate(p_revision_id);
$$;

revoke all on function internal_product_registration.get_revision_aggregate(uuid) from public, anon, authenticated;
revoke all on function public.get_product_registration_revision_aggregate(uuid) from public, anon, authenticated;
grant execute on function internal_product_registration.get_revision_aggregate(uuid) to service_role;
grant execute on function public.get_product_registration_revision_aggregate(uuid) to service_role;

create or replace function internal_product_registration.get_availability_overlays(
  p_catalog_product_ids uuid[],
  p_channel text default 'customer'
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
  from internal_product_registration.package_availability_overlays a
  where a.catalog_product_id = any(coalesce(p_catalog_product_ids, '{}'::uuid[]))
    and a.channel = p_channel
    and (a.expires_at is null or a.expires_at > now());
$$;

create or replace function public.get_product_registration_availability_overlays(
  p_catalog_product_ids uuid[],
  p_channel text default 'customer'
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.get_availability_overlays(p_catalog_product_ids, p_channel);
$$;

revoke all on function internal_product_registration.get_availability_overlays(uuid[], text) from public, anon, authenticated;
revoke all on function public.get_product_registration_availability_overlays(uuid[], text) from public, anon, authenticated;
grant execute on function internal_product_registration.get_availability_overlays(uuid[], text) to service_role;
grant execute on function public.get_product_registration_availability_overlays(uuid[], text) to service_role;

create or replace function internal_product_registration.record_source_upload_event(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_source_document_id uuid := nullif(p_payload->>'source_document_id', '')::uuid;
  v_blob_id uuid;
  v_upload_id uuid;
  v_source public.product_source_documents%rowtype;
begin
  if v_tenant_id is null or v_source_document_id is null
    or nullif(btrim(p_payload->>'request_key'), '') is null then
    raise exception 'REGISTRATION_SOURCE_UPLOAD_LINEAGE_REQUIRED';
  end if;
  select * into v_source
  from public.product_source_documents
  where id = v_source_document_id and tenant_id = v_tenant_id;
  if not found then raise exception 'REGISTRATION_SOURCE_UPLOAD_TENANT_MISMATCH'; end if;

  insert into internal_product_registration.source_blobs (
    tenant_id, sha256, byte_size, storage_bucket, storage_path, detected_mime
  ) values (
    v_tenant_id, v_source.sha256, v_source.byte_size,
    v_source.storage_bucket, v_source.storage_path, v_source.detected_mime
  ) on conflict (tenant_id, sha256, byte_size) do update
    set storage_bucket = excluded.storage_bucket,
        storage_path = excluded.storage_path
  returning id into v_blob_id;

  insert into internal_product_registration.source_document_uploads (
    tenant_id, source_blob_id, source_document_id, request_key,
    source_channel, original_filename, metadata
  ) values (
    v_tenant_id, v_blob_id, v_source_document_id, p_payload->>'request_key',
    coalesce(nullif(p_payload->>'source_channel', ''), 'upload'),
    v_source.original_filename, coalesce(p_payload->'metadata', '{}'::jsonb)
  ) on conflict (tenant_id, request_key) do update
    set source_document_id = excluded.source_document_id
  returning id into v_upload_id;

  return jsonb_build_object(
    'source_blob_id', v_blob_id,
    'source_document_upload_id', v_upload_id
  );
end;
$$;

create or replace function public.record_product_registration_source_upload_event(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.record_source_upload_event(p_payload);
$$;

revoke all on function internal_product_registration.record_source_upload_event(jsonb) from public, anon, authenticated;
revoke all on function public.record_product_registration_source_upload_event(jsonb) from public, anon, authenticated;
grant execute on function internal_product_registration.record_source_upload_event(jsonb) to service_role;
grant execute on function public.record_product_registration_source_upload_event(jsonb) to service_role;

create or replace function internal_product_registration.enqueue_correction(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_base_revision_id uuid := nullif(p_payload->>'base_revision_id', '')::uuid;
  v_source_document_id uuid := nullif(p_payload->>'source_document_id', '')::uuid;
  v_correction_id uuid;
  v_product_key text;
begin
  if v_tenant_id is null or v_catalog_product_id is null or v_base_revision_id is null
    or v_source_document_id is null or nullif(btrim(p_payload->>'operation_key'), '') is null
    or nullif(btrim(p_payload->>'reason'), '') is null
    or jsonb_typeof(p_payload->'requested_changes') is distinct from 'array'
    or jsonb_array_length(p_payload->'requested_changes') = 0 then
    raise exception 'REGISTRATION_CORRECTION_INPUT_INVALID';
  end if;
  select cp.product_key into v_product_key
  from internal_product_registration.catalog_products cp
  join public.product_registration_v5_revisions r
    on r.catalog_product_id = cp.id and r.tenant_id = cp.tenant_id
  where cp.id = v_catalog_product_id
    and cp.tenant_id = v_tenant_id
    and r.id = v_base_revision_id;
  if not found then raise exception 'REGISTRATION_CORRECTION_BASE_MISMATCH'; end if;
  if not exists (
    select 1 from public.product_source_documents s
    where s.id = v_source_document_id and s.tenant_id = v_tenant_id
      and s.status not in ('quarantined', 'deleted')
  ) then raise exception 'REGISTRATION_CORRECTION_SOURCE_INVALID'; end if;

  insert into internal_product_registration.correction_jobs (
    tenant_id, catalog_product_id, base_revision_id, source_document_id,
    requested_changes, reason, operation_key, created_by
  ) values (
    v_tenant_id, v_catalog_product_id, v_base_revision_id, v_source_document_id,
    p_payload->'requested_changes', p_payload->>'reason', p_payload->>'operation_key',
    nullif(p_payload->>'created_by', '')::uuid
  ) on conflict (tenant_id, operation_key) do nothing
  returning id into v_correction_id;
  if v_correction_id is null then
    select id into v_correction_id
    from internal_product_registration.correction_jobs
    where tenant_id = v_tenant_id and operation_key = p_payload->>'operation_key';
  end if;
  return jsonb_build_object(
    'correction_job_id', v_correction_id,
    'tenant_id', v_tenant_id,
    'catalog_product_id', v_catalog_product_id,
    'base_revision_id', v_base_revision_id,
    'source_document_id', v_source_document_id,
    'product_key', v_product_key
  );
end;
$$;

create or replace function public.enqueue_product_registration_correction(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$ select internal_product_registration.enqueue_correction(p_payload); $$;

create or replace function internal_product_registration.bind_correction_workflow(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_id uuid := nullif(p_payload->>'correction_job_id', '')::uuid;
  v_workflow_job_id uuid := nullif(p_payload->>'workflow_job_id', '')::uuid;
begin
  update internal_product_registration.correction_jobs c
  set workflow_job_id = v_workflow_job_id, status = 'processing'
  where c.id = v_id and c.status in ('queued', 'processing')
    and exists (
      select 1 from public.upload_jobs j
      where j.id = v_workflow_job_id and j.tenant_id = c.tenant_id
    );
  if not found then raise exception 'REGISTRATION_CORRECTION_WORKFLOW_BIND_FAILED'; end if;
  return jsonb_build_object('correction_job_id', v_id, 'workflow_job_id', v_workflow_job_id);
end;
$$;

create or replace function public.bind_product_registration_correction_workflow(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$ select internal_product_registration.bind_correction_workflow(p_payload); $$;

create or replace function internal_product_registration.finalize_correction(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_id uuid := nullif(p_payload->>'correction_job_id', '')::uuid;
  v_workflow_job_id uuid := nullif(p_payload->>'workflow_job_id', '')::uuid;
  v_revision_id uuid := nullif(p_payload->>'resulting_revision_id', '')::uuid;
  v_status text := p_payload->>'status';
begin
  if v_status not in ('completed', 'blocked', 'failed') then
    raise exception 'REGISTRATION_CORRECTION_FINAL_STATUS_INVALID';
  end if;
  update internal_product_registration.correction_jobs c
  set status = v_status,
      resulting_revision_id = v_revision_id,
      completed_at = now()
  where c.id = v_id
    and (
      c.workflow_job_id = v_workflow_job_id
      or (c.workflow_job_id is null and c.status = 'queued')
    )
    and c.status in ('queued', 'processing', 'blocked', 'failed');
  if not found then raise exception 'REGISTRATION_CORRECTION_FINALIZE_FAILED'; end if;
  if v_revision_id is not null and not exists (
    select 1 from public.product_registration_v5_revisions r
    where r.id = v_revision_id
      and r.catalog_product_id = (select catalog_product_id from internal_product_registration.correction_jobs where id = v_id)
  ) then raise exception 'REGISTRATION_CORRECTION_RESULT_IDENTITY_MISMATCH'; end if;
  return jsonb_build_object('correction_job_id', v_id, 'status', v_status, 'resulting_revision_id', v_revision_id);
end;
$$;

create or replace function public.finalize_product_registration_correction(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$ select internal_product_registration.finalize_correction(p_payload); $$;

revoke all on function internal_product_registration.enqueue_correction(jsonb) from public, anon, authenticated;
revoke all on function public.enqueue_product_registration_correction(jsonb) from public, anon, authenticated;
revoke all on function internal_product_registration.bind_correction_workflow(jsonb) from public, anon, authenticated;
revoke all on function public.bind_product_registration_correction_workflow(jsonb) from public, anon, authenticated;
revoke all on function internal_product_registration.finalize_correction(jsonb) from public, anon, authenticated;
revoke all on function public.finalize_product_registration_correction(jsonb) from public, anon, authenticated;
grant execute on function internal_product_registration.enqueue_correction(jsonb) to service_role;
grant execute on function public.enqueue_product_registration_correction(jsonb) to service_role;
grant execute on function internal_product_registration.bind_correction_workflow(jsonb) to service_role;
grant execute on function public.bind_product_registration_correction_workflow(jsonb) to service_role;
grant execute on function internal_product_registration.finalize_correction(jsonb) to service_role;
grant execute on function public.finalize_product_registration_correction(jsonb) to service_role;

create or replace function internal_product_registration.claim_schedule_revalidations(
  p_limit integer default 10,
  p_worker_id text default 'schedule-revalidation'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, internal_product_registration, pg_temp
as $$
declare
  v_rows jsonb;
begin
  with candidates as (
    select j.id
    from internal_product_registration.schedule_revalidation_jobs j
    where j.status in ('pending', 'failed')
      and j.due_at <= now()
      and j.attempt_count < 3
    order by j.due_at, j.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 50))
  ), claimed as (
    update internal_product_registration.schedule_revalidation_jobs j
    set status = 'processing',
        attempt_count = j.attempt_count + 1,
        last_error = null,
        result = j.result || jsonb_build_object('claimed_by', p_worker_id, 'claimed_at', now())
    from candidates c
    where j.id = c.id
    returning j.*
  )
  select coalesce(jsonb_agg(to_jsonb(claimed)), '[]'::jsonb) into v_rows from claimed;
  return v_rows;
end;
$$;

create or replace function public.claim_product_registration_schedule_revalidations(
  p_limit integer default 10,
  p_worker_id text default 'schedule-revalidation'
)
returns jsonb
language sql
security definer
set search_path = pg_catalog, internal_product_registration, pg_temp
as $$ select internal_product_registration.claim_schedule_revalidations(p_limit, p_worker_id); $$;

create or replace function internal_product_registration.complete_schedule_revalidation(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, internal_product_registration, pg_temp
as $$
declare
  v_id uuid := nullif(p_payload->>'job_id', '')::uuid;
  v_status text := p_payload->>'status';
begin
  if v_status not in ('unchanged', 'revision_created', 'blocked', 'failed') then
    raise exception 'REGISTRATION_SCHEDULE_REVALIDATION_STATUS_INVALID';
  end if;
  update internal_product_registration.schedule_revalidation_jobs
  set status = v_status,
      result = coalesce(p_payload->'result', '{}'::jsonb),
      last_error = nullif(p_payload->>'last_error', ''),
      completed_at = case when v_status = 'failed' and attempt_count < 3 then null else now() end
  where id = v_id and status = 'processing';
  if not found then raise exception 'REGISTRATION_SCHEDULE_REVALIDATION_NOT_CLAIMED'; end if;
  return jsonb_build_object('job_id', v_id, 'status', v_status);
end;
$$;

create or replace function public.complete_product_registration_schedule_revalidation(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, internal_product_registration, pg_temp
as $$ select internal_product_registration.complete_schedule_revalidation(p_payload); $$;

create or replace function internal_product_registration.set_availability_overlay(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, internal_product_registration, pg_temp
as $$
declare
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid := nullif(p_payload->>'catalog_product_id', '')::uuid;
  v_channel text := coalesce(nullif(p_payload->>'channel', ''), 'customer');
  v_sale_state text := p_payload->>'sale_state';
  v_expected_reason_prefix text := nullif(p_payload->>'expected_reason_prefix', '');
  v_existing_reason text;
  v_version bigint;
begin
  if v_tenant_id is null or v_catalog_product_id is null
    or v_sale_state not in ('available', 'request', 'closed', 'sold_out', 'suspended') then
    raise exception 'REGISTRATION_AVAILABILITY_OVERLAY_INVALID';
  end if;
  if v_expected_reason_prefix is not null then
    select reason into v_existing_reason
    from internal_product_registration.package_availability_overlays
    where tenant_id = v_tenant_id
      and catalog_product_id = v_catalog_product_id
      and channel = v_channel
    for update;
    if not found then
      return jsonb_build_object(
        'tenant_id', v_tenant_id,
        'catalog_product_id', v_catalog_product_id,
        'channel', v_channel,
        'sale_state', v_sale_state,
        'applied', false,
        'reason', 'OVERLAY_NOT_FOUND'
      );
    end if;
    if coalesce(v_existing_reason, '') not like v_expected_reason_prefix || '%' then
      return jsonb_build_object(
        'tenant_id', v_tenant_id,
        'catalog_product_id', v_catalog_product_id,
        'channel', v_channel,
        'sale_state', v_sale_state,
        'applied', false,
        'reason', 'OVERLAY_REASON_MISMATCH'
      );
    end if;
  end if;
  insert into internal_product_registration.package_availability_overlays (
    tenant_id, catalog_product_id, channel, sale_state, available_seats,
    reason, overlay_version, expires_at
  ) values (
    v_tenant_id, v_catalog_product_id, v_channel, v_sale_state,
    nullif(p_payload->>'available_seats', '')::integer,
    nullif(p_payload->>'reason', ''), 1,
    nullif(p_payload->>'expires_at', '')::timestamptz
  ) on conflict (tenant_id, catalog_product_id, channel) do update
    set sale_state = excluded.sale_state,
        available_seats = excluded.available_seats,
        reason = excluded.reason,
        expires_at = excluded.expires_at,
        overlay_version = internal_product_registration.package_availability_overlays.overlay_version + 1,
        updated_at = now()
  returning overlay_version into v_version;
  return jsonb_build_object(
    'tenant_id', v_tenant_id,
    'catalog_product_id', v_catalog_product_id,
    'channel', v_channel,
    'sale_state', v_sale_state,
    'applied', true,
    'overlay_version', v_version
  );
end;
$$;

create or replace function public.set_product_registration_availability_overlay(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, internal_product_registration, pg_temp
as $$ select internal_product_registration.set_availability_overlay(p_payload); $$;

revoke all on function internal_product_registration.claim_schedule_revalidations(integer, text) from public, anon, authenticated;
revoke all on function public.claim_product_registration_schedule_revalidations(integer, text) from public, anon, authenticated;
revoke all on function internal_product_registration.complete_schedule_revalidation(jsonb) from public, anon, authenticated;
revoke all on function public.complete_product_registration_schedule_revalidation(jsonb) from public, anon, authenticated;
revoke all on function internal_product_registration.set_availability_overlay(jsonb) from public, anon, authenticated;
revoke all on function public.set_product_registration_availability_overlay(jsonb) from public, anon, authenticated;
grant execute on function internal_product_registration.claim_schedule_revalidations(integer, text) to service_role;
grant execute on function public.claim_product_registration_schedule_revalidations(integer, text) to service_role;
grant execute on function internal_product_registration.complete_schedule_revalidation(jsonb) to service_role;
grant execute on function public.complete_product_registration_schedule_revalidation(jsonb) to service_role;
grant execute on function internal_product_registration.set_availability_overlay(jsonb) to service_role;
grant execute on function public.set_product_registration_availability_overlay(jsonb) to service_role;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'departure_instances',
    'transport_segments',
    'lodging_stays',
    'golf_rounds',
    'copy_revisions',
    'copy_claim_links',
    'transport_fact_observations',
    'transport_fact_resolutions',
    'golf_fact_observations',
    'golf_fact_resolutions',
    'workflow_stage_runs'
  ] loop
    execute format('alter table internal_product_registration.%I disable trigger user', v_table);
  end loop;
end;
$$;

-- Existing V6 rows get explicit tenant and catalog lineage. Common fact
-- observations may remain product-independent, but never tenant-independent.
update internal_product_registration.departure_instances t
set tenant_id = r.tenant_id, catalog_product_id = r.catalog_product_id
from public.product_registration_v5_revisions r
where t.revision_id = r.id and (t.tenant_id is null or t.catalog_product_id is null);

update internal_product_registration.transport_segments t
set tenant_id = r.tenant_id, catalog_product_id = r.catalog_product_id
from public.product_registration_v5_revisions r
where t.revision_id = r.id and (t.tenant_id is null or t.catalog_product_id is null);

update internal_product_registration.lodging_stays t
set tenant_id = r.tenant_id, catalog_product_id = r.catalog_product_id
from public.product_registration_v5_revisions r
where t.revision_id = r.id and (t.tenant_id is null or t.catalog_product_id is null);

update internal_product_registration.golf_rounds t
set tenant_id = r.tenant_id, catalog_product_id = r.catalog_product_id
from public.product_registration_v5_revisions r
where t.revision_id = r.id and (t.tenant_id is null or t.catalog_product_id is null);

update internal_product_registration.transport_fact_resolutions t
set tenant_id = r.tenant_id, catalog_product_id = r.catalog_product_id
from public.product_registration_v5_revisions r
where t.product_revision_id = r.id and (t.tenant_id is null or t.catalog_product_id is null);

update internal_product_registration.copy_revisions c
set tenant_id = r.tenant_id, catalog_product_id = r.catalog_product_id
from public.product_registration_v5_revisions r
where c.product_revision_id = r.id and (c.tenant_id is null or c.catalog_product_id is null);

update internal_product_registration.copy_claim_links l
set tenant_id = c.tenant_id, catalog_product_id = c.catalog_product_id
from internal_product_registration.copy_revisions c
where l.copy_revision_id = c.id and (l.tenant_id is null or l.catalog_product_id is null);

update internal_product_registration.transport_fact_observations o
set tenant_id = coalesce(
      (select r.tenant_id from public.product_registration_v5_revisions r where r.id = o.product_revision_id),
      (select s.tenant_id from public.product_source_documents s where s.id = o.source_document_id),
      '00000000-0000-0000-0000-000000000001'::uuid
    ),
    catalog_product_id = (
      select r.catalog_product_id from public.product_registration_v5_revisions r where r.id = o.product_revision_id
    )
where o.tenant_id is null or o.catalog_product_id is null;

update internal_product_registration.golf_fact_observations o
set tenant_id = coalesce(
      (select r.tenant_id from public.product_registration_v5_revisions r where r.id = o.product_revision_id),
      (select s.tenant_id from public.product_source_documents s where s.id = o.source_document_id),
      '00000000-0000-0000-0000-000000000001'::uuid
    ),
    catalog_product_id = (
      select r.catalog_product_id from public.product_registration_v5_revisions r where r.id = o.product_revision_id
    )
where o.tenant_id is null or o.catalog_product_id is null;

update internal_product_registration.provider_calls p
set tenant_id = coalesce(
      (select r.tenant_id from public.product_registration_v5_revisions r where r.id = p.product_revision_id),
      (select j.tenant_id from public.upload_jobs j where j.id = p.job_id),
      '00000000-0000-0000-0000-000000000001'::uuid
    ),
    catalog_product_id = (
      select r.catalog_product_id from public.product_registration_v5_revisions r where r.id = p.product_revision_id
    )
where p.tenant_id is null or p.catalog_product_id is null;

update internal_product_registration.workflow_stage_runs s
set tenant_id = j.tenant_id
from public.upload_jobs j
where s.job_id = j.id and s.tenant_id is null;

update internal_product_registration.dead_letter_jobs d
set tenant_id = j.tenant_id
from public.upload_jobs j
where d.job_id = j.id and d.tenant_id is null;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'departure_instances',
    'transport_segments',
    'lodging_stays',
    'golf_rounds',
    'copy_revisions',
    'copy_claim_links',
    'transport_fact_observations',
    'transport_fact_resolutions',
    'golf_fact_observations',
    'golf_fact_resolutions',
    'provider_calls',
    'workflow_stage_runs',
    'dead_letter_jobs'
  ] loop
    execute format(
      'update internal_product_registration.%I set tenant_id = %L::uuid where tenant_id is null',
      v_table,
      '00000000-0000-0000-0000-000000000001'
    );
    execute format('alter table internal_product_registration.%I alter column tenant_id set not null', v_table);
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'departure_instances',
    'transport_segments',
    'lodging_stays',
    'golf_rounds',
    'copy_revisions',
    'copy_claim_links',
    'transport_fact_observations',
    'transport_fact_resolutions',
    'golf_fact_observations',
    'golf_fact_resolutions',
    'workflow_stage_runs'
  ] loop
    execute format('alter table internal_product_registration.%I enable trigger user', v_table);
  end loop;
end;
$$;

-- Finalize lineage only after all historical rows have been backfilled and
-- append-only triggers have been restored.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'departure_instances',
    'transport_segments',
    'lodging_stays',
    'golf_rounds',
    'copy_revisions',
    'copy_claim_links',
    'transport_fact_resolutions'
  ] loop
    execute format('alter table internal_product_registration.%I alter column catalog_product_id set not null', v_table);
    execute format(
      'alter table internal_product_registration.%I add constraint %I '
      || 'foreign key (catalog_product_id) references internal_product_registration.catalog_products(id) on delete restrict',
      v_table, v_table || '_catalog_product_fkey'
    );
  end loop;

  foreach v_table in array array[
    'departure_instances',
    'transport_segments',
    'lodging_stays',
    'golf_rounds',
    'copy_revisions',
    'copy_claim_links',
    'transport_fact_observations',
    'transport_fact_resolutions',
    'golf_fact_observations',
    'golf_fact_resolutions',
    'provider_calls',
    'workflow_stage_runs',
    'dead_letter_jobs'
  ] loop
    execute format(
      'alter table internal_product_registration.%I add constraint %I '
      || 'foreign key (tenant_id) references public.tenants(id) on delete restrict',
      v_table, v_table || '_tenant_fkey'
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
  v_revision_column text;
begin
  for v_table, v_revision_column in
    select * from (values
      ('hotel_fact_resolutions', 'product_revision_id'),
      ('terms_revisions', 'product_revision_id'),
      ('media_revision_links', 'product_revision_id'),
      ('schedule_revalidation_jobs', 'product_revision_id')
    ) as lineage(table_name, revision_column)
  loop
    execute format(
      'drop trigger if exists %I on internal_product_registration.%I',
      'trg_' || v_table || '_revision_lineage', v_table
    );
    execute format(
      'create trigger %I before insert on internal_product_registration.%I '
      || 'for each row execute function internal_product_registration.set_revision_lineage(%L)',
      'trg_' || v_table || '_revision_lineage', v_table, v_revision_column
    );
  end loop;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'source_blobs',
    'source_document_uploads',
    'correction_jobs',
    'terms_revisions',
    'terms_claim_links',
    'media_assets',
    'media_revision_links',
    'hotel_fact_observations',
    'hotel_fact_resolutions',
    'supplier_layout_profiles',
    'profile_benchmark_runs',
    'package_availability_overlays',
    'schedule_revalidation_jobs',
    'cohort_quality_metrics'
  ] loop
    execute format('revoke all on table internal_product_registration.%I from public, anon, authenticated', v_table);
    execute format('grant all on table internal_product_registration.%I to service_role', v_table);
  end loop;

  foreach v_table in array array[
    'source_blobs',
    'source_document_uploads',
    'terms_revisions',
    'terms_claim_links',
    'media_revision_links',
    'hotel_fact_observations',
    'hotel_fact_resolutions',
    'profile_benchmark_runs',
    'cohort_quality_metrics'
  ] loop
    execute format(
      'drop trigger if exists %I on internal_product_registration.%I',
      'trg_' || v_table || '_immutable', v_table
    );
    execute format(
      'create trigger %I before update or delete on internal_product_registration.%I '
      || 'for each row execute function internal_product_registration.reject_mutation()',
      'trg_' || v_table || '_immutable', v_table
    );
  end loop;
end;
$$;
