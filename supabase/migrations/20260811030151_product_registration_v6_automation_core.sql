-- Product Registration Engine V6 automation core.
--
-- V5 revision/publication tables remain authoritative during migration. New
-- domain projections and provider observations live in a non-exposed schema
-- and are reachable only through narrow service-role RPCs.

create schema if not exists internal_product_registration;

revoke all on schema internal_product_registration from public, anon, authenticated;
grant usage on schema internal_product_registration to service_role;

-- V5 owns the operational switch table. V6 extends that existing control
-- plane instead of introducing a competing set of switches.
alter table public.product_registration_v5_kill_switches
  drop constraint if exists product_registration_v5_kill_switches_scope_check;
alter table public.product_registration_v5_kill_switches
  add constraint product_registration_v5_kill_switches_scope_check
  check (scope in ('product', 'supplier', 'parser', 'model', 'ocr_provider', 'transport_provider', 'global'));

alter table public.upload_jobs
  add column if not exists v6_workflow_run_id text,
  add column if not exists v6_outcome text,
  add column if not exists v6_policy_version text not null default 'product-registration-v6-policy-1',
  add column if not exists v6_last_heartbeat_at timestamptz,
  add column if not exists v6_terminal_at timestamptz,
  add column if not exists v6_degraded_reasons jsonb not null default '[]'::jsonb,
  add column if not exists v6_blockers jsonb not null default '[]'::jsonb,
  add column if not exists v6_external_cost_krw numeric(12,2) not null default 0,
  add column if not exists v6_fencing_token bigint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'upload_jobs_v6_outcome_check'
      and conrelid = 'public.upload_jobs'::regclass
  ) then
    alter table public.upload_jobs add constraint upload_jobs_v6_outcome_check
      check (v6_outcome is null or v6_outcome in (
        'published_verified', 'published_degraded', 'blocked_action_required'
      ));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'upload_jobs_v6_degraded_reasons_array_check'
      and conrelid = 'public.upload_jobs'::regclass
  ) then
    alter table public.upload_jobs add constraint upload_jobs_v6_degraded_reasons_array_check
      check (jsonb_typeof(v6_degraded_reasons) = 'array');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'upload_jobs_v6_blockers_array_check'
      and conrelid = 'public.upload_jobs'::regclass
  ) then
    alter table public.upload_jobs add constraint upload_jobs_v6_blockers_array_check
      check (jsonb_typeof(v6_blockers) = 'array');
  end if;
end;
$$;

create index if not exists idx_upload_jobs_v6_workflow_run
  on public.upload_jobs(v6_workflow_run_id)
  where v6_workflow_run_id is not null;
create index if not exists idx_upload_jobs_v6_inflight
  on public.upload_jobs(v6_last_heartbeat_at, updated_at)
  where v6_outcome is null and status in ('queued', 'processing');

create table if not exists internal_product_registration.departure_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  package_id uuid references public.travel_packages(id) on delete set null,
  section_index integer not null check (section_index >= 0),
  variant_key text not null,
  departure_date date not null,
  sale_state text not null default 'available'
    check (sale_state in ('available', 'request', 'closed', 'sold_out', 'cancelled')),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  created_version text not null default 'product-registration-v6-1',
  created_at timestamptz not null default now(),
  unique (revision_id, section_index, variant_key, departure_date)
);

create table if not exists internal_product_registration.transport_segments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  package_id uuid references public.travel_packages(id) on delete set null,
  departure_instance_id uuid references internal_product_registration.departure_instances(id) on delete set null,
  section_index integer not null check (section_index >= 0),
  variant_key text not null,
  sequence_no integer not null check (sequence_no >= 0),
  transport_type text not null check (transport_type in ('flight', 'ferry', 'ground_transport', 'rail')),
  leg text not null default 'unknown' check (leg in ('outbound', 'inbound', 'intermediate', 'unknown')),
  carrier_code text,
  service_number text,
  departure_place_code text,
  arrival_place_code text,
  departure_local_time time,
  arrival_local_time time,
  arrival_day_offset smallint not null default 0 check (arrival_day_offset between -1 and 3),
  departure_timezone text,
  arrival_timezone text,
  fact_state text not null default 'source_confirmed'
    check (fact_state in ('source_confirmed', 'provider_confirmed', 'degraded', 'conflicting')),
  source_field_path text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  created_version text not null default 'product-registration-v6-1',
  created_at timestamptz not null default now(),
  unique (revision_id, section_index, variant_key, sequence_no, source_hash)
);

create table if not exists internal_product_registration.lodging_stays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  package_id uuid references public.travel_packages(id) on delete set null,
  section_index integer not null check (section_index >= 0),
  variant_key text not null,
  day_index integer not null check (day_index >= 1),
  nights smallint not null default 1 check (nights between 0 and 60),
  lodging_name text,
  lodging_state text not null default 'confirmed'
    check (lodging_state in ('confirmed', 'equivalent', 'to_be_confirmed')),
  source_field_path text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  created_version text not null default 'product-registration-v6-1',
  created_at timestamptz not null default now(),
  unique (revision_id, section_index, variant_key, day_index, source_hash)
);

create table if not exists internal_product_registration.golf_rounds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  package_id uuid references public.travel_packages(id) on delete set null,
  section_index integer not null check (section_index >= 0),
  variant_key text not null,
  day_index integer not null check (day_index >= 1),
  course_name_raw text not null,
  golf_fact_resolution_id uuid,
  tee_time time,
  holes smallint check (holes is null or holes between 1 and 72),
  green_fee_inclusion text check (green_fee_inclusion is null or green_fee_inclusion in ('included', 'excluded', 'unknown')),
  caddie_inclusion text check (caddie_inclusion is null or caddie_inclusion in ('included', 'excluded', 'unknown')),
  cart_inclusion text check (cart_inclusion is null or cart_inclusion in ('included', 'excluded', 'unknown')),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  created_version text not null default 'product-registration-v6-1',
  created_at timestamptz not null default now()
);

create table if not exists internal_product_registration.copy_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  product_revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  locale text not null default 'ko-KR',
  copy_payload jsonb not null check (jsonb_typeof(copy_payload) = 'object'),
  copy_hash text not null check (copy_hash ~ '^[0-9a-f]{64}$'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  model_id text,
  prompt_hash text,
  validation_state text not null default 'candidate'
    check (validation_state in ('candidate', 'verified', 'blocked')),
  created_version text not null default 'product-registration-v6-copy-1',
  created_at timestamptz not null default now(),
  unique (product_revision_id, locale, copy_hash)
);

create table if not exists internal_product_registration.copy_claim_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  copy_revision_id uuid not null references internal_product_registration.copy_revisions(id) on delete cascade,
  claim_id uuid not null references public.product_registration_v5_claims(id) on delete restrict,
  copy_path text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  created_version text not null default 'product-registration-v6-copy-1',
  created_at timestamptz not null default now(),
  unique (copy_revision_id, claim_id, copy_path)
);

create table if not exists internal_product_registration.transport_fact_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  source_document_id uuid references public.product_source_documents(id) on delete set null,
  product_revision_id uuid references public.product_registration_v5_revisions(id) on delete set null,
  package_id uuid references public.travel_packages(id) on delete set null,
  source_kind text not null check (source_kind in (
    'current_source', 'oag', 'cirium', 'verified_product', 'legacy_product'
  )),
  source_family text not null,
  carrier_code text,
  service_number text not null,
  departure_airport text not null,
  arrival_airport text not null,
  effective_start date,
  effective_end date,
  operating_weekdays smallint[] not null default '{}',
  departure_local_time time,
  arrival_local_time time,
  arrival_day_offset smallint not null default 0 check (arrival_day_offset between -1 and 3),
  departure_timezone text,
  arrival_timezone text,
  observed_at timestamptz not null default now(),
  verified_at timestamptz,
  source_weight numeric(5,4) not null check (source_weight between 0 and 1),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text check (revision_hash is null or revision_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  observation_hash text not null check (observation_hash ~ '^[0-9a-f]{64}$'),
  created_version text not null default 'product-registration-v6-facts-1',
  created_at timestamptz not null default now(),
  check (effective_start is null or effective_end is null or effective_start <= effective_end),
  unique (tenant_id, observation_hash)
);

create table if not exists internal_product_registration.transport_fact_resolutions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  product_revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  section_index integer not null check (section_index >= 0),
  variant_key text not null,
  leg text not null check (leg in ('outbound', 'inbound', 'intermediate')),
  departure_date date,
  service_number text,
  departure_airport text,
  arrival_airport text,
  departure_local_time time,
  arrival_local_time time,
  arrival_day_offset smallint not null default 0,
  resolution_state text not null check (resolution_state in ('source_confirmed', 'corroborated', 'degraded', 'conflicting')),
  observation_ids uuid[] not null default '{}',
  reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(reasons) = 'array'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  resolution_hash text not null check (resolution_hash ~ '^[0-9a-f]{64}$'),
  created_version text not null default 'product-registration-v6-facts-1',
  created_at timestamptz not null default now(),
  unique (product_revision_id, section_index, variant_key, leg, resolution_hash)
);

create table if not exists internal_product_registration.golf_fact_observations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  source_document_id uuid references public.product_source_documents(id) on delete set null,
  product_revision_id uuid references public.product_registration_v5_revisions(id) on delete set null,
  source_kind text not null check (source_kind in ('current_source', 'verified_product', 'legacy_product')),
  canonical_name text not null,
  aliases text[] not null default '{}',
  country_code text,
  region text,
  holes smallint check (holes is null or holes between 1 and 72),
  par smallint check (par is null or par between 1 and 100),
  length_meters integer check (length_meters is null or length_meters > 0),
  latitude numeric(9,6),
  longitude numeric(9,6),
  source_weight numeric(5,4) not null check (source_weight between 0 and 1),
  observed_at timestamptz not null default now(),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text check (revision_hash is null or revision_hash ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  observation_hash text not null check (observation_hash ~ '^[0-9a-f]{64}$'),
  created_version text not null default 'product-registration-v6-golf-1',
  created_at timestamptz not null default now(),
  unique (tenant_id, observation_hash)
);

create table if not exists internal_product_registration.golf_fact_resolutions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  canonical_name text not null,
  aliases text[] not null default '{}',
  country_code text,
  region text,
  holes smallint,
  par smallint,
  length_meters integer,
  latitude numeric(9,6),
  longitude numeric(9,6),
  observation_ids uuid[] not null default '{}',
  resolution_state text not null check (resolution_state in ('verified', 'candidate', 'conflicting')),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text check (revision_hash is null or revision_hash ~ '^[0-9a-f]{64}$'),
  resolution_hash text not null check (resolution_hash ~ '^[0-9a-f]{64}$'),
  created_version text not null default 'product-registration-v6-golf-1',
  created_at timestamptz not null default now(),
  unique (tenant_id, resolution_hash)
);

alter table internal_product_registration.golf_rounds
  drop constraint if exists golf_rounds_golf_fact_resolution_id_fkey;
alter table internal_product_registration.golf_rounds
  add constraint golf_rounds_golf_fact_resolution_id_fkey
  foreign key (golf_fact_resolution_id)
  references internal_product_registration.golf_fact_resolutions(id) on delete set null;

create table if not exists internal_product_registration.provider_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  job_id uuid references public.upload_jobs(id) on delete set null,
  product_revision_id uuid references public.product_registration_v5_revisions(id) on delete set null,
  provider text not null,
  operation text not null,
  operation_key text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response_hash text check (response_hash is null or response_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'started' check (status in ('started', 'succeeded', 'failed', 'indeterminate', 'skipped')),
  billed_units numeric(12,4),
  cost_krw numeric(12,2) not null default 0 check (cost_krw >= 0),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text check (revision_hash is null or revision_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null default '{}'::jsonb check (jsonb_typeof(result) = 'object'),
  created_version text not null default 'product-registration-v6-provider-1',
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, operation_key)
);

create table if not exists internal_product_registration.workflow_stage_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  job_id uuid not null references public.upload_jobs(id) on delete cascade,
  workflow_run_id text,
  fencing_token bigint not null,
  stage_name text not null,
  stage_version text not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('running', 'succeeded', 'failed')),
  output jsonb not null default '{}'::jsonb check (jsonb_typeof(output) = 'object'),
  error_code text,
  error_detail text,
  created_at timestamptz not null default now(),
  unique (job_id, fencing_token, stage_name, stage_version, input_hash, status)
);

create table if not exists internal_product_registration.dead_letter_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  job_id uuid not null references public.upload_jobs(id) on delete cascade,
  workflow_run_id text,
  failed_stage text not null,
  operation_key text not null,
  error_code text not null,
  error_detail text,
  source_hash text check (source_hash is null or source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text check (revision_hash is null or revision_hash ~ '^[0-9a-f]{64}$'),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status text not null default 'open' check (status in ('open', 'reprocessing', 'resolved', 'discarded')),
  created_version text not null default 'product-registration-v6-workflow-1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, operation_key)
);

create index if not exists idx_pr_v6_departures_revision
  on internal_product_registration.departure_instances(revision_id, departure_date);
create index if not exists idx_pr_v6_transport_revision
  on internal_product_registration.transport_segments(revision_id, section_index, variant_key, sequence_no);
create index if not exists idx_pr_v6_transport_observation_lookup
  on internal_product_registration.transport_fact_observations(
    service_number, departure_airport, arrival_airport, effective_start, effective_end, observed_at desc
  );
create unique index if not exists idx_pr_v6_transport_observation_idempotent
  on internal_product_registration.transport_fact_observations(
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), observation_hash
  );
create index if not exists idx_pr_v6_transport_resolution_revision
  on internal_product_registration.transport_fact_resolutions(product_revision_id, section_index, variant_key);
create index if not exists idx_pr_v6_golf_observation_name
  on internal_product_registration.golf_fact_observations(lower(canonical_name), observed_at desc);
create unique index if not exists idx_pr_v6_golf_round_idempotent
  on internal_product_registration.golf_rounds(
    revision_id, section_index, variant_key, day_index, lower(course_name_raw), coalesce(tee_time, '00:00'::time)
  );
create unique index if not exists idx_pr_v6_golf_observation_idempotent
  on internal_product_registration.golf_fact_observations(
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), observation_hash
  );
create index if not exists idx_pr_v6_provider_call_job
  on internal_product_registration.provider_calls(job_id, provider, started_at desc);
create unique index if not exists idx_pr_v6_provider_call_idempotent
  on internal_product_registration.provider_calls(
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), operation_key
  );
create index if not exists idx_pr_v6_workflow_stage_job
  on internal_product_registration.workflow_stage_runs(job_id, fencing_token, created_at);
create index if not exists idx_pr_v6_dead_letter_open
  on internal_product_registration.dead_letter_jobs(status, created_at)
  where status in ('open', 'reprocessing');
create unique index if not exists idx_pr_v6_dead_letter_idempotent
  on internal_product_registration.dead_letter_jobs(
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), operation_key
  );

create or replace function internal_product_registration.reject_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception '% is append-only; insert a new V6 record instead', tg_table_name;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
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
    execute format(
      'drop trigger if exists %I on internal_product_registration.%I',
      'trg_' || table_name || '_immutable', table_name
    );
    execute format(
      'create trigger %I before update or delete on internal_product_registration.%I for each row execute function internal_product_registration.reject_mutation()',
      'trg_' || table_name || '_immutable', table_name
    );
  end loop;
end;
$$;

revoke all on all tables in schema internal_product_registration from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema internal_product_registration to service_role;
alter default privileges in schema internal_product_registration revoke all on tables from public, anon, authenticated;
alter default privileges in schema internal_product_registration grant select, insert, update, delete on tables to service_role;
revoke all on function internal_product_registration.reject_mutation() from public, anon, authenticated;
grant execute on function internal_product_registration.reject_mutation() to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'departure_instances', 'transport_segments', 'lodging_stays', 'golf_rounds',
    'copy_revisions', 'copy_claim_links', 'transport_fact_observations',
    'transport_fact_resolutions', 'golf_fact_observations', 'golf_fact_resolutions',
    'provider_calls', 'workflow_stage_runs', 'dead_letter_jobs'
  ] loop
    execute format('alter table internal_product_registration.%I enable row level security', table_name);
    execute format('drop policy if exists %I on internal_product_registration.%I', table_name || '_service_role', table_name);
    execute format(
      'create policy %I on internal_product_registration.%I for all to service_role using (true) with check (true)',
      table_name || '_service_role', table_name
    );
  end loop;
end;
$$;

create or replace function public.record_product_registration_v6_transport_observation(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = internal_product_registration, public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'V6_TRANSPORT_OBSERVATION_PAYLOAD_INVALID';
  end if;

  insert into internal_product_registration.transport_fact_observations (
    tenant_id, source_document_id, product_revision_id, package_id,
    source_kind, source_family, carrier_code, service_number,
    departure_airport, arrival_airport, effective_start, effective_end,
    operating_weekdays, departure_local_time, arrival_local_time,
    arrival_day_offset, departure_timezone, arrival_timezone,
    observed_at, verified_at, source_weight, source_hash, revision_hash,
    evidence, observation_hash, created_version
  ) values (
    nullif(p_payload->>'tenant_id', '')::uuid,
    nullif(p_payload->>'source_document_id', '')::uuid,
    nullif(p_payload->>'product_revision_id', '')::uuid,
    nullif(p_payload->>'package_id', '')::uuid,
    p_payload->>'source_kind', p_payload->>'source_family',
    nullif(p_payload->>'carrier_code', ''), upper(p_payload->>'service_number'),
    upper(p_payload->>'departure_airport'), upper(p_payload->>'arrival_airport'),
    nullif(p_payload->>'effective_start', '')::date,
    nullif(p_payload->>'effective_end', '')::date,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'operating_weekdays', '[]'::jsonb))::smallint), '{}'),
    nullif(p_payload->>'departure_local_time', '')::time,
    nullif(p_payload->>'arrival_local_time', '')::time,
    coalesce((p_payload->>'arrival_day_offset')::smallint, 0),
    nullif(p_payload->>'departure_timezone', ''),
    nullif(p_payload->>'arrival_timezone', ''),
    coalesce(nullif(p_payload->>'observed_at', '')::timestamptz, now()),
    nullif(p_payload->>'verified_at', '')::timestamptz,
    (p_payload->>'source_weight')::numeric,
    p_payload->>'source_hash', nullif(p_payload->>'revision_hash', ''),
    coalesce(p_payload->'evidence', '[]'::jsonb), p_payload->>'observation_hash',
    coalesce(nullif(p_payload->>'created_version', ''), 'product-registration-v6-facts-1')
  ) on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from internal_product_registration.transport_fact_observations
    where tenant_id is not distinct from nullif(p_payload->>'tenant_id', '')::uuid
      and observation_hash = p_payload->>'observation_hash';
  end if;
  return jsonb_build_object('id', v_id, 'observation_hash', p_payload->>'observation_hash');
end;
$$;

create or replace function public.claim_product_registration_v6_workflow(p_job_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_job public.upload_jobs%rowtype;
begin
  update public.upload_jobs
  set status = 'processing',
      v6_fencing_token = v6_fencing_token + 1,
      v6_outcome = null,
      v6_terminal_at = null,
      v6_degraded_reasons = '[]'::jsonb,
      v6_blockers = '[]'::jsonb,
      v6_last_heartbeat_at = now(),
      v6_workflow_run_id = null,
      updated_at = now()
  where id = p_job_id
  returning * into v_job;
  if not found then raise exception 'V6_JOB_NOT_FOUND'; end if;
  return jsonb_build_object('job_id', v_job.id, 'fencing_token', v_job.v6_fencing_token);
end;
$$;

create or replace function public.bind_product_registration_v6_workflow_run(
  p_job_id uuid,
  p_fencing_token bigint,
  p_workflow_run_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_job public.upload_jobs%rowtype;
begin
  if coalesce(btrim(p_workflow_run_id), '') = '' then raise exception 'V6_WORKFLOW_RUN_ID_REQUIRED'; end if;
  update public.upload_jobs
  set v6_workflow_run_id = p_workflow_run_id,
      v6_last_heartbeat_at = now(),
      updated_at = now()
  where id = p_job_id
    and v6_fencing_token = p_fencing_token
    and v6_outcome is null
    and (v6_workflow_run_id is null or v6_workflow_run_id = p_workflow_run_id)
  returning * into v_job;
  if not found then raise exception 'V6_WORKFLOW_BIND_FENCING_CONFLICT'; end if;
  return jsonb_build_object('job_id', v_job.id, 'workflow_run_id', v_job.v6_workflow_run_id, 'fencing_token', v_job.v6_fencing_token);
end;
$$;

create or replace function public.add_product_registration_v6_external_cost(
  p_job_id uuid,
  p_expected_fencing_token bigint,
  p_cost_krw numeric
)
returns numeric
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_total numeric;
begin
  if p_cost_krw < 0 then raise exception 'V6_EXTERNAL_COST_NEGATIVE'; end if;
  update public.upload_jobs
  set v6_external_cost_krw = v6_external_cost_krw + p_cost_krw,
      updated_at = now()
  where id = p_job_id and v6_fencing_token = p_expected_fencing_token
  returning v6_external_cost_krw into v_total;
  if not found then raise exception 'V6_EXTERNAL_COST_FENCING_CONFLICT'; end if;
  if v_total > 2000 then raise exception 'V6_DOCUMENT_EXTERNAL_COST_LIMIT_EXCEEDED'; end if;
  return v_total;
end;
$$;

create or replace function public.publish_product_registration_v6_snapshot_atomic(
  p_package_id uuid,
  p_revision_id uuid,
  p_snapshot_id uuid,
  p_snapshot_hash text,
  p_proof_run_id uuid,
  p_expected_pointer_version bigint,
  p_idempotency_key text,
  p_policy_version text,
  p_v6_outcome text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_response jsonb;
  v_supplier text;
begin
  if p_v6_outcome not in ('published_verified', 'published_degraded') then
    raise exception 'V6_PUBLICATION_OUTCOME_INVALID';
  end if;

  select land_operator into v_supplier
  from public.travel_packages
  where id = p_package_id;

  if exists (
    select 1
    from public.product_registration_v5_kill_switches k
    where k.active
      and (k.expires_at is null or k.expires_at > now())
      and (
        k.scope = 'global'
        or (k.scope = 'product' and k.scope_key in (p_package_id::text, '*'))
        or (k.scope = 'supplier' and k.scope_key in (coalesce(v_supplier, ''), '*'))
        or (k.scope = 'parser' and k.scope_key in ('product-registration-v6', '*'))
        or k.scope in ('model', 'ocr_provider', 'transport_provider')
      )
  ) then
    raise exception 'V6_KILL_SWITCH_ACTIVE';
  end if;

  v_response := public.publish_product_registration_v5_snapshot_atomic(
    p_package_id => p_package_id,
    p_revision_id => p_revision_id,
    p_snapshot_id => p_snapshot_id,
    p_snapshot_hash => p_snapshot_hash,
    p_proof_run_id => p_proof_run_id,
    p_expected_pointer_version => p_expected_pointer_version,
    p_idempotency_key => p_idempotency_key,
    p_actor_id => null,
    p_channel => 'customer',
    p_locale => 'ko-KR',
    p_policy_version => p_policy_version,
    p_publication_state => 'published'
  );

  update public.public_package_snapshots
  set status = 'published', published_at = coalesce(published_at, now())
  where id = p_snapshot_id
    and package_id = p_package_id
    and canonical_revision_id = p_revision_id
    and snapshot_hash = p_snapshot_hash
    and status in ('candidate', 'approved', 'published');
  if not found then raise exception 'V6_PUBLICATION_SNAPSHOT_STATE_CONFLICT'; end if;

  return v_response || jsonb_build_object('v6_outcome', p_v6_outcome);
end;
$$;

create or replace function public.list_product_registration_v6_transport_observations(
  p_tenant_id uuid,
  p_service_number text,
  p_departure_airport text,
  p_arrival_airport text,
  p_departure_date date,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security invoker
set search_path = internal_product_registration, public, extensions, pg_temp
as $$
  select coalesce(jsonb_agg(to_jsonb(o) order by o.observed_at desc), '[]'::jsonb)
  from (
    select *
    from internal_product_registration.transport_fact_observations
    where tenant_id is not distinct from p_tenant_id
      and service_number = upper(p_service_number)
      and departure_airport = upper(p_departure_airport)
      and arrival_airport = upper(p_arrival_airport)
      and (effective_start is null or effective_start <= p_departure_date)
      and (effective_end is null or effective_end >= p_departure_date)
      and (
        cardinality(operating_weekdays) = 0
        or extract(dow from p_departure_date)::smallint = any(operating_weekdays)
      )
    order by observed_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) o;
$$;

create or replace function public.record_product_registration_v6_transport_resolution(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = internal_product_registration, public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into internal_product_registration.transport_fact_resolutions (
    tenant_id, product_revision_id, section_index, variant_key, leg, departure_date,
    service_number, departure_airport, arrival_airport, departure_local_time,
    arrival_local_time, arrival_day_offset, resolution_state, observation_ids,
    reasons, source_hash, revision_hash, resolution_hash, created_version
  ) values (
    nullif(p_payload->>'tenant_id', '')::uuid,
    (p_payload->>'product_revision_id')::uuid,
    (p_payload->>'section_index')::integer,
    p_payload->>'variant_key', p_payload->>'leg',
    nullif(p_payload->>'departure_date', '')::date,
    nullif(p_payload->>'service_number', ''),
    nullif(p_payload->>'departure_airport', ''),
    nullif(p_payload->>'arrival_airport', ''),
    nullif(p_payload->>'departure_local_time', '')::time,
    nullif(p_payload->>'arrival_local_time', '')::time,
    coalesce((p_payload->>'arrival_day_offset')::smallint, 0),
    p_payload->>'resolution_state',
    coalesce(array(select jsonb_array_elements_text(coalesce(p_payload->'observation_ids', '[]'::jsonb))::uuid), '{}'),
    coalesce(p_payload->'reasons', '[]'::jsonb),
    p_payload->>'source_hash', p_payload->>'revision_hash', p_payload->>'resolution_hash',
    coalesce(nullif(p_payload->>'created_version', ''), 'product-registration-v6-facts-1')
  ) on conflict (product_revision_id, section_index, variant_key, leg, resolution_hash) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from internal_product_registration.transport_fact_resolutions
    where product_revision_id = (p_payload->>'product_revision_id')::uuid
      and section_index = (p_payload->>'section_index')::integer
      and variant_key = p_payload->>'variant_key'
      and leg = p_payload->>'leg'
      and resolution_hash = p_payload->>'resolution_hash';
  end if;
  return jsonb_build_object('id', v_id, 'resolution_hash', p_payload->>'resolution_hash');
end;
$$;

create or replace function public.record_product_registration_v6_terminal_outcome(
  p_job_id uuid,
  p_workflow_run_id text,
  p_expected_fencing_token bigint,
  p_outcome text,
  p_policy_version text,
  p_degraded_reasons jsonb default '[]'::jsonb,
  p_blockers jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_job public.upload_jobs%rowtype;
begin
  if p_outcome not in ('published_verified', 'published_degraded', 'blocked_action_required') then
    raise exception 'V6_TERMINAL_OUTCOME_INVALID';
  end if;
  if jsonb_typeof(p_degraded_reasons) is distinct from 'array'
     or jsonb_typeof(p_blockers) is distinct from 'array' then
    raise exception 'V6_TERMINAL_REASONS_INVALID';
  end if;

  update public.upload_jobs
  set v6_workflow_run_id = coalesce(v6_workflow_run_id, p_workflow_run_id),
      v6_outcome = p_outcome,
      v6_policy_version = p_policy_version,
      v6_degraded_reasons = p_degraded_reasons,
      v6_blockers = p_blockers,
      v6_terminal_at = now(),
      v6_last_heartbeat_at = now(),
      status = case when p_outcome = 'blocked_action_required' then 'failed' else 'done' end,
      v4_stage = case when p_outcome = 'blocked_action_required' then 'needs_review' else 'published' end,
      updated_at = now()
  where id = p_job_id
    and v6_fencing_token = p_expected_fencing_token
    and (v6_workflow_run_id is null or v6_workflow_run_id = p_workflow_run_id)
    and (v6_outcome is null or v6_outcome = p_outcome)
  returning * into v_job;

  if not found then
    raise exception 'V6_TERMINAL_FENCING_CONFLICT';
  end if;
  return jsonb_build_object(
    'job_id', v_job.id,
    'outcome', v_job.v6_outcome,
    'terminal_at', v_job.v6_terminal_at,
    'fencing_token', v_job.v6_fencing_token
  );
end;
$$;

create or replace function public.record_product_registration_v6_dead_letter(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = internal_product_registration, public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into internal_product_registration.dead_letter_jobs (
    tenant_id, job_id, workflow_run_id, failed_stage, operation_key,
    error_code, error_detail, source_hash, revision_hash, payload,
    status, created_version
  ) values (
    nullif(p_payload->>'tenant_id', '')::uuid,
    (p_payload->>'job_id')::uuid,
    nullif(p_payload->>'workflow_run_id', ''),
    p_payload->>'failed_stage',
    p_payload->>'operation_key',
    p_payload->>'error_code',
    nullif(p_payload->>'error_detail', ''),
    nullif(p_payload->>'source_hash', ''),
    nullif(p_payload->>'revision_hash', ''),
    coalesce(p_payload->'payload', '{}'::jsonb),
    'open',
    coalesce(nullif(p_payload->>'created_version', ''), 'product-registration-v6-workflow-1')
  ) on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id
    from internal_product_registration.dead_letter_jobs
    where tenant_id is not distinct from nullif(p_payload->>'tenant_id', '')::uuid
      and operation_key = p_payload->>'operation_key';
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.record_product_registration_v6_stage_run(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = internal_product_registration, public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into internal_product_registration.workflow_stage_runs (
    tenant_id, job_id, workflow_run_id, fencing_token, stage_name,
    stage_version, input_hash, status, output, error_code, error_detail
  ) values (
    nullif(p_payload->>'tenant_id', '')::uuid,
    (p_payload->>'job_id')::uuid,
    nullif(p_payload->>'workflow_run_id', ''),
    (p_payload->>'fencing_token')::bigint,
    p_payload->>'stage_name', p_payload->>'stage_version', p_payload->>'input_hash',
    p_payload->>'status', coalesce(p_payload->'output', '{}'::jsonb),
    nullif(p_payload->>'error_code', ''), nullif(p_payload->>'error_detail', '')
  ) on conflict do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from internal_product_registration.workflow_stage_runs
    where job_id = (p_payload->>'job_id')::uuid
      and fencing_token = (p_payload->>'fencing_token')::bigint
      and stage_name = p_payload->>'stage_name'
      and stage_version = p_payload->>'stage_version'
      and input_hash = p_payload->>'input_hash'
      and status = p_payload->>'status';
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.persist_product_registration_v6_domain_projection(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = internal_product_registration, public, extensions, pg_temp
as $$
declare
  v_revision public.product_registration_v5_revisions%rowtype;
  v_row jsonb;
  v_departures integer := 0;
  v_transport integer := 0;
  v_lodging integer := 0;
  v_golf integer := 0;
begin
  select * into v_revision
  from public.product_registration_v5_revisions
  where id = (p_payload->>'revision_id')::uuid
  for share;
  if not found then raise exception 'V6_DOMAIN_REVISION_NOT_FOUND'; end if;
  if v_revision.payload_hash is distinct from p_payload->>'revision_hash' then
    raise exception 'V6_DOMAIN_REVISION_HASH_MISMATCH';
  end if;
  if v_revision.tenant_id is distinct from nullif(p_payload->>'tenant_id', '')::uuid then
    raise exception 'V6_DOMAIN_TENANT_MISMATCH';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'departures', '[]'::jsonb)) loop
    if v_revision.package_id is distinct from nullif(v_row->>'package_id', '')::uuid then raise exception 'V6_DOMAIN_PACKAGE_MISMATCH'; end if;
    insert into internal_product_registration.departure_instances (
      tenant_id, revision_id, package_id, section_index, variant_key,
      departure_date, sale_state, source_hash, revision_hash, evidence
    ) values (
      v_revision.tenant_id, v_revision.id, v_revision.package_id,
      (v_row->>'section_index')::integer, v_row->>'variant_key',
      (v_row->>'departure_date')::date, coalesce(v_row->>'sale_state', 'available'),
      p_payload->>'source_hash', v_revision.payload_hash, coalesce(v_row->'evidence', '[]'::jsonb)
    ) on conflict do nothing;
    v_departures := v_departures + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'transport_segments', '[]'::jsonb)) loop
    if v_revision.package_id is distinct from nullif(v_row->>'package_id', '')::uuid then raise exception 'V6_DOMAIN_PACKAGE_MISMATCH'; end if;
    insert into internal_product_registration.transport_segments (
      tenant_id, revision_id, package_id, section_index, variant_key, sequence_no,
      transport_type, leg, carrier_code, service_number, departure_place_code,
      arrival_place_code, departure_local_time, arrival_local_time, arrival_day_offset,
      departure_timezone, arrival_timezone, fact_state, source_field_path,
      source_hash, revision_hash, evidence
    ) values (
      v_revision.tenant_id, v_revision.id, v_revision.package_id,
      (v_row->>'section_index')::integer, v_row->>'variant_key', (v_row->>'sequence_no')::integer,
      v_row->>'transport_type', coalesce(v_row->>'leg', 'unknown'), nullif(v_row->>'carrier_code', ''),
      nullif(v_row->>'service_number', ''), nullif(v_row->>'departure_place_code', ''),
      nullif(v_row->>'arrival_place_code', ''), nullif(v_row->>'departure_local_time', '')::time,
      nullif(v_row->>'arrival_local_time', '')::time, coalesce(nullif(v_row->>'arrival_day_offset', '')::smallint, 0),
      nullif(v_row->>'departure_timezone', ''), nullif(v_row->>'arrival_timezone', ''),
      coalesce(v_row->>'fact_state', 'degraded'), v_row->>'source_field_path',
      p_payload->>'source_hash', v_revision.payload_hash, coalesce(v_row->'evidence', '[]'::jsonb)
    ) on conflict do nothing;
    v_transport := v_transport + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'lodging_stays', '[]'::jsonb)) loop
    if v_revision.package_id is distinct from nullif(v_row->>'package_id', '')::uuid then raise exception 'V6_DOMAIN_PACKAGE_MISMATCH'; end if;
    insert into internal_product_registration.lodging_stays (
      tenant_id, revision_id, package_id, section_index, variant_key, day_index,
      nights, lodging_name, lodging_state, source_field_path, source_hash, revision_hash, evidence
    ) values (
      v_revision.tenant_id, v_revision.id, v_revision.package_id,
      (v_row->>'section_index')::integer, v_row->>'variant_key', (v_row->>'day_index')::integer,
      coalesce(nullif(v_row->>'nights', '')::smallint, 1), nullif(v_row->>'lodging_name', ''),
      coalesce(v_row->>'lodging_state', 'to_be_confirmed'), v_row->>'source_field_path',
      p_payload->>'source_hash', v_revision.payload_hash, coalesce(v_row->'evidence', '[]'::jsonb)
    ) on conflict do nothing;
    v_lodging := v_lodging + 1;
  end loop;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'golf_rounds', '[]'::jsonb)) loop
    if v_revision.package_id is distinct from nullif(v_row->>'package_id', '')::uuid then raise exception 'V6_DOMAIN_PACKAGE_MISMATCH'; end if;
    insert into internal_product_registration.golf_rounds (
      tenant_id, revision_id, package_id, section_index, variant_key, day_index,
      course_name_raw, tee_time, holes, green_fee_inclusion, caddie_inclusion,
      cart_inclusion, source_hash, revision_hash, evidence
    ) values (
      v_revision.tenant_id, v_revision.id, v_revision.package_id,
      (v_row->>'section_index')::integer, v_row->>'variant_key', (v_row->>'day_index')::integer,
      v_row->>'course_name_raw', nullif(v_row->>'tee_time', '')::time,
      nullif(v_row->>'holes', '')::smallint, nullif(v_row->>'green_fee_inclusion', ''),
      nullif(v_row->>'caddie_inclusion', ''), nullif(v_row->>'cart_inclusion', ''),
      p_payload->>'source_hash', v_revision.payload_hash, coalesce(v_row->'evidence', '[]'::jsonb)
    ) on conflict do nothing;
    v_golf := v_golf + 1;
  end loop;

  return jsonb_build_object('departures', v_departures, 'transport_segments', v_transport, 'lodging_stays', v_lodging, 'golf_rounds', v_golf);
end;
$$;

create or replace function public.persist_product_registration_v6_copy_revision(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = internal_product_registration, public, extensions, pg_temp
as $$
declare
  v_revision public.product_registration_v5_revisions%rowtype;
  v_copy_id uuid;
  v_link jsonb;
begin
  select * into v_revision
  from public.product_registration_v5_revisions
  where id = (p_payload->>'product_revision_id')::uuid
  for share;
  if not found then raise exception 'V6_COPY_REVISION_NOT_FOUND'; end if;
  if v_revision.payload_hash is distinct from p_payload->>'revision_hash' then raise exception 'V6_COPY_REVISION_HASH_MISMATCH'; end if;
  if v_revision.tenant_id is distinct from nullif(p_payload->>'tenant_id', '')::uuid then raise exception 'V6_COPY_TENANT_MISMATCH'; end if;

  insert into internal_product_registration.copy_revisions (
    tenant_id, product_revision_id, locale, copy_payload, copy_hash,
    source_hash, revision_hash, validation_state
  ) values (
    v_revision.tenant_id, v_revision.id, coalesce(p_payload->>'locale', 'ko-KR'),
    p_payload->'copy_payload', p_payload->>'copy_hash', p_payload->>'source_hash',
    v_revision.payload_hash, p_payload->>'validation_state'
  ) on conflict do nothing
  returning id into v_copy_id;
  if v_copy_id is null then
    select id into v_copy_id
    from internal_product_registration.copy_revisions
    where product_revision_id = v_revision.id
      and locale = coalesce(p_payload->>'locale', 'ko-KR')
      and copy_hash = p_payload->>'copy_hash';
  end if;

  for v_link in select value from jsonb_array_elements(coalesce(p_payload->'claim_links', '[]'::jsonb)) loop
    if not exists (
      select 1 from public.product_registration_v5_claims c
      where c.id = (v_link->>'claim_id')::uuid and c.revision_id = v_revision.id
    ) then raise exception 'V6_COPY_CLAIM_LINEAGE_MISMATCH'; end if;
    insert into internal_product_registration.copy_claim_links (
      tenant_id, copy_revision_id, claim_id, copy_path, source_hash, revision_hash
    ) values (
      v_revision.tenant_id, v_copy_id, (v_link->>'claim_id')::uuid,
      v_link->>'copy_path', p_payload->>'source_hash', v_revision.payload_hash
    ) on conflict do nothing;
  end loop;
  return jsonb_build_object('copy_revision_id', v_copy_id, 'copy_hash', p_payload->>'copy_hash');
end;
$$;

create or replace function public.get_product_registration_v6_verified_copy(p_revision_id uuid, p_locale text default 'ko-KR')
returns jsonb
language sql
stable
security invoker
set search_path = internal_product_registration, public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'copy_revision_id', c.id,
    'copy_hash', c.copy_hash,
    'copy_payload', c.copy_payload,
    'revision_hash', c.revision_hash
  )
  from internal_product_registration.copy_revisions c
  where c.product_revision_id = p_revision_id
    and c.locale = p_locale
    and c.validation_state = 'verified'
  order by c.created_at desc
  limit 1
$$;

create or replace function public.record_product_registration_v6_provider_call(p_payload jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = internal_product_registration, public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_inserted boolean := true;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'V6_PROVIDER_CALL_PAYLOAD_INVALID';
  end if;
  insert into internal_product_registration.provider_calls (
    tenant_id, job_id, product_revision_id, provider, operation,
    operation_key, request_hash, response_hash, status, billed_units,
    cost_krw, source_hash, revision_hash, result, completed_at, created_version
  ) values (
    nullif(p_payload->>'tenant_id', '')::uuid,
    nullif(p_payload->>'job_id', '')::uuid,
    nullif(p_payload->>'product_revision_id', '')::uuid,
    p_payload->>'provider', p_payload->>'operation', p_payload->>'operation_key',
    p_payload->>'request_hash', nullif(p_payload->>'response_hash', ''),
    p_payload->>'status', nullif(p_payload->>'billed_units', '')::numeric,
    coalesce(nullif(p_payload->>'cost_krw', '')::numeric, 0),
    p_payload->>'source_hash', nullif(p_payload->>'revision_hash', ''),
    coalesce(p_payload->'result', '{}'::jsonb), now(),
    coalesce(nullif(p_payload->>'created_version', ''), 'product-registration-v6-provider-1')
  ) on conflict do nothing
  returning id into v_id;
  if v_id is null then
    v_inserted := false;
    select id into v_id
    from internal_product_registration.provider_calls
    where tenant_id is not distinct from nullif(p_payload->>'tenant_id', '')::uuid
      and operation_key = p_payload->>'operation_key';
  end if;
  return jsonb_build_object('id', v_id, 'inserted', v_inserted);
end;
$$;

do $$
declare
  function_signature text;
begin
  foreach function_signature in array array[
    'public.claim_product_registration_v6_workflow(uuid)',
    'public.bind_product_registration_v6_workflow_run(uuid,bigint,text)',
    'public.add_product_registration_v6_external_cost(uuid,bigint,numeric)',
    'public.record_product_registration_v6_transport_observation(jsonb)',
    'public.list_product_registration_v6_transport_observations(uuid,text,text,text,date,integer)',
    'public.record_product_registration_v6_transport_resolution(jsonb)',
    'public.record_product_registration_v6_terminal_outcome(uuid,text,bigint,text,text,jsonb,jsonb)',
    'public.record_product_registration_v6_dead_letter(jsonb)',
    'public.record_product_registration_v6_stage_run(jsonb)',
    'public.record_product_registration_v6_provider_call(jsonb)',
    'public.persist_product_registration_v6_domain_projection(jsonb)',
    'public.persist_product_registration_v6_copy_revision(jsonb)',
    'public.get_product_registration_v6_verified_copy(uuid,text)',
    'public.publish_product_registration_v6_snapshot_atomic(uuid,uuid,uuid,text,uuid,bigint,text,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', function_signature);
    execute format('grant execute on function %s to service_role', function_signature);
  end loop;
end;
$$;

comment on schema internal_product_registration is
  'Private V6 product-registration projections, shared-fact observations, provider ledger, and dead letters.';
