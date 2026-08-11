-- Product registration authority hardening.
-- This is intentionally forward-only and assumes the additive V6 core and
-- authority-convergence migrations are present. It does not publish data or
-- change the authority mode/publication freeze defaults.

alter table public.upload_jobs
  add column if not exists v6_analysis_outcome text,
  add column if not exists v6_publication_state text,
  add column if not exists v6_publication_blockers jsonb not null default '[]'::jsonb;

alter table public.upload_jobs
  drop constraint if exists upload_jobs_v6_analysis_outcome_check,
  add constraint upload_jobs_v6_analysis_outcome_check
    check (v6_analysis_outcome is null or v6_analysis_outcome in ('verified', 'degraded', 'blocked')),
  drop constraint if exists upload_jobs_v6_publication_state_check,
  add constraint upload_jobs_v6_publication_state_check
    check (v6_publication_state is null or v6_publication_state in (
      'not_requested', 'frozen', 'blocked', 'proof_passed',
      'pointer_committed', 'converged', 'convergence_failed'
    )),
  drop constraint if exists upload_jobs_v6_publication_blockers_array_check,
  add constraint upload_jobs_v6_publication_blockers_array_check
    check (jsonb_typeof(v6_publication_blockers) = 'array');

update public.upload_jobs
set v6_analysis_outcome = case v6_outcome
      when 'published_verified' then 'verified'
      when 'published_degraded' then 'degraded'
      when 'blocked_action_required' then 'blocked'
      else v6_analysis_outcome
    end,
    v6_publication_state = case v6_outcome
      when 'published_verified' then 'converged'
      when 'published_degraded' then 'converged'
      when 'blocked_action_required' then coalesce(v6_publication_state, 'not_requested')
      else v6_publication_state
    end
where v6_outcome is not null
  and (v6_analysis_outcome is null or v6_publication_state is null);

create table if not exists internal_product_registration.registration_schema_manifest (
  id uuid primary key default gen_random_uuid(),
  component text not null,
  schema_version text not null,
  migration_version text not null,
  expected_object_fingerprint text not null,
  applied_object_fingerprint text,
  verification_state text not null default 'pending'
    check (verification_state in ('pending', 'verified', 'mismatch', 'superseded')),
  verified_at timestamptz,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  unique (component, schema_version)
);

insert into internal_product_registration.registration_schema_manifest (
  component, schema_version, migration_version, expected_object_fingerprint,
  verification_state, details
) values (
  'registration-kernel',
  'product-registration-authority-hardened-1',
  '20260811112045',
  encode(extensions.digest(convert_to(
    'catalog+tenant-fk+dual-outcome+global-freeze+single-publication-rpc',
    'UTF8'
  ), 'sha256'), 'hex'),
  'pending',
  jsonb_build_object('publication_freeze_required', true, 'authority_default', 'shadow')
) on conflict (component, schema_version) do nothing;

alter table internal_product_registration.registration_schema_manifest enable row level security;
revoke all on table internal_product_registration.registration_schema_manifest from public, anon, authenticated;
revoke all on table internal_product_registration.registration_schema_manifest from service_role;
grant select on table internal_product_registration.registration_schema_manifest to service_role;

create or replace function internal_product_registration.record_terminal_state(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_job_id uuid := nullif(p_payload->>'job_id', '')::uuid;
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_workflow_run_id text := nullif(p_payload->>'workflow_run_id', '');
  v_fencing_token bigint := nullif(p_payload->>'expected_fencing_token', '')::bigint;
  v_analysis_outcome text := p_payload->>'analysis_outcome';
  v_publication_state text := p_payload->>'publication_state';
  v_compatibility_outcome text := p_payload->>'compatibility_outcome';
  v_policy_version text := p_payload->>'policy_version';
  v_degraded_reasons jsonb := coalesce(p_payload->'degraded_reasons', '[]'::jsonb);
  v_blockers jsonb := coalesce(p_payload->'blockers', '[]'::jsonb);
  v_publication_blockers jsonb := coalesce(p_payload->'publication_blockers', '[]'::jsonb);
  v_job public.upload_jobs%rowtype;
begin
  if v_job_id is null or v_tenant_id is null or v_workflow_run_id is null or v_fencing_token is null then
    raise exception 'V6_TERMINAL_LINEAGE_REQUIRED';
  end if;
  if v_analysis_outcome not in ('verified', 'degraded', 'blocked') then
    raise exception 'V6_ANALYSIS_OUTCOME_INVALID';
  end if;
  if v_publication_state not in (
    'not_requested', 'frozen', 'blocked', 'proof_passed',
    'pointer_committed', 'converged', 'convergence_failed'
  ) then raise exception 'V6_PUBLICATION_STATE_INVALID'; end if;
  if v_compatibility_outcome not in ('published_verified', 'published_degraded', 'blocked_action_required') then
    raise exception 'V6_TERMINAL_OUTCOME_INVALID';
  end if;
  if jsonb_typeof(v_degraded_reasons) <> 'array'
    or jsonb_typeof(v_blockers) <> 'array'
    or jsonb_typeof(v_publication_blockers) <> 'array' then
    raise exception 'V6_TERMINAL_REASONS_INVALID';
  end if;
  if v_analysis_outcome = 'blocked' and v_compatibility_outcome <> 'blocked_action_required' then
    raise exception 'V6_TERMINAL_ANALYSIS_COMPATIBILITY_MISMATCH';
  end if;

  update public.upload_jobs
  set v6_workflow_run_id = coalesce(v6_workflow_run_id, v_workflow_run_id),
      v6_analysis_outcome = v_analysis_outcome,
      v6_publication_state = v_publication_state,
      v6_publication_blockers = v_publication_blockers,
      v6_outcome = v_compatibility_outcome,
      v6_policy_version = v_policy_version,
      v6_degraded_reasons = v_degraded_reasons,
      v6_blockers = v_blockers,
      v6_terminal_at = now(),
      v6_last_heartbeat_at = now(),
      status = case when v_analysis_outcome = 'blocked' then 'failed' else 'done' end,
      v4_stage = case
        when v_analysis_outcome = 'blocked' then 'needs_review'
        when v_publication_state = 'converged' then 'published'
        when v_publication_state in ('proof_passed', 'frozen', 'blocked', 'convergence_failed') then 'proofed'
        else 'verified'
      end,
      updated_at = now()
  where id = v_job_id
    and tenant_id = v_tenant_id
    and v6_fencing_token = v_fencing_token
    and (v6_workflow_run_id is null or v6_workflow_run_id = v_workflow_run_id)
    and v6_analysis_outcome is null
  returning * into v_job;

  if not found then
    select * into v_job
    from public.upload_jobs
    where id = v_job_id and tenant_id = v_tenant_id;
    if not found
      or v_job.v6_fencing_token <> v_fencing_token
      or v_job.v6_workflow_run_id is distinct from v_workflow_run_id
      or v_job.v6_analysis_outcome is distinct from v_analysis_outcome
      or v_job.v6_publication_state is distinct from v_publication_state then
      raise exception 'V6_TERMINAL_FENCING_CONFLICT';
    end if;
  end if;

  return jsonb_build_object(
    'job_id', v_job.id,
    'analysis_outcome', v_job.v6_analysis_outcome,
    'publication_state', v_job.v6_publication_state,
    'compatibility_outcome', v_job.v6_outcome,
    'terminal_at', v_job.v6_terminal_at,
    'fencing_token', v_job.v6_fencing_token
  );
end;
$$;

create or replace function public.record_product_registration_v6_terminal_state(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
  select internal_product_registration.record_terminal_state(p_payload);
$$;

revoke all on function internal_product_registration.record_terminal_state(jsonb) from public, anon, authenticated;
revoke all on function public.record_product_registration_v6_terminal_state(jsonb) from public, anon, authenticated;
grant execute on function public.record_product_registration_v6_terminal_state(jsonb) to service_role;

create or replace function internal_product_registration.assert_publication_not_frozen()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_freeze boolean := true;
  v_public_transition boolean := false;
begin
  select publication_freeze into v_freeze
  from internal_product_registration.registration_authority_config
  where singleton = true;
  if coalesce(v_freeze, true) is false then return new; end if;

  if tg_table_name = 'travel_packages' then
    v_public_transition := (
      coalesce(new.publication_state, '') in ('approved', 'published')
      or coalesce(new.status, '') = 'active'
    ) and (
      tg_op = 'INSERT'
      or old.publication_state is distinct from new.publication_state
      or old.status is distinct from new.status
    );
  elsif tg_table_name = 'product_registration_v5_publication_pointers' then
    v_public_transition := coalesce(new.state, '') = 'published'
      and (tg_op = 'INSERT' or old.state is distinct from new.state or old.current_snapshot_id is distinct from new.current_snapshot_id);
  elsif tg_table_name = 'public_package_snapshots' then
    v_public_transition := coalesce(new.status, '') = 'published'
      and (tg_op = 'INSERT' or old.status is distinct from new.status);
  elsif tg_table_name = 'package_publish_decisions' then
    v_public_transition := coalesce(new.publishable, false)
      and coalesce(new.publication_state, '') in ('approved', 'published')
      and (tg_op = 'INSERT' or old.publication_state is distinct from new.publication_state or old.publishable is distinct from new.publishable);
  end if;

  if v_public_transition then raise exception 'REGISTRATION_PUBLICATION_FROZEN'; end if;
  return new;
end;
$$;

drop trigger if exists trg_registration_publication_freeze_package on public.travel_packages;
create trigger trg_registration_publication_freeze_package
before insert or update of publication_state, status on public.travel_packages
for each row execute function internal_product_registration.assert_publication_not_frozen();

drop trigger if exists trg_registration_publication_freeze_pointer on public.product_registration_v5_publication_pointers;
create trigger trg_registration_publication_freeze_pointer
before insert or update of state, current_snapshot_id on public.product_registration_v5_publication_pointers
for each row execute function internal_product_registration.assert_publication_not_frozen();

drop trigger if exists trg_registration_publication_freeze_snapshot on public.public_package_snapshots;
create trigger trg_registration_publication_freeze_snapshot
before insert or update of status on public.public_package_snapshots
for each row execute function internal_product_registration.assert_publication_not_frozen();

drop trigger if exists trg_registration_publication_freeze_decision on public.package_publish_decisions;
create trigger trg_registration_publication_freeze_decision
before insert or update of publication_state, publishable on public.package_publish_decisions
for each row execute function internal_product_registration.assert_publication_not_frozen();

create unique index if not exists idx_catalog_products_tenant_id_id
  on internal_product_registration.catalog_products(tenant_id, id);
create unique index if not exists idx_travel_packages_tenant_id_id
  on public.travel_packages(tenant_id, id);
create unique index if not exists idx_public_snapshots_tenant_id_id
  on public.public_package_snapshots(tenant_id, id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'v5_revisions_tenant_catalog_fk') then
    alter table public.product_registration_v5_revisions
      add constraint v5_revisions_tenant_catalog_fk
      foreign key (tenant_id, catalog_product_id)
      references internal_product_registration.catalog_products(tenant_id, id)
      on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'public_snapshots_tenant_catalog_fk') then
    alter table public.public_package_snapshots
      add constraint public_snapshots_tenant_catalog_fk
      foreign key (tenant_id, catalog_product_id)
      references internal_product_registration.catalog_products(tenant_id, id)
      on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'publication_pointers_tenant_catalog_fk') then
    alter table public.product_registration_v5_publication_pointers
      add constraint publication_pointers_tenant_catalog_fk
      foreign key (tenant_id, catalog_product_id)
      references internal_product_registration.catalog_products(tenant_id, id)
      on delete restrict not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'publish_decisions_tenant_catalog_fk') then
    alter table public.package_publish_decisions
      add constraint publish_decisions_tenant_catalog_fk
      foreign key (tenant_id, catalog_product_id)
      references internal_product_registration.catalog_products(tenant_id, id)
      on delete restrict not valid;
  end if;
end;
$$;

-- This transition is deliberately explicit. Installing the additive schema
-- in shadow mode must not silently remove the legacy rollback path. The
-- operator invokes this RPC only while publication is frozen and after the
-- tenant/catalog preflight is clean. It validates the cross-tenant guards,
-- revokes every superseded publication RPC and seals the schema manifest.
create or replace function public.finalize_product_registration_authority_hardening(
  p_expected_schema_version text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_freeze boolean;
  v_signature text;
  v_expected_fingerprint text;
  v_blocking_rows bigint;
begin
  if p_expected_schema_version is distinct from 'product-registration-authority-hardened-1' then
    raise exception 'REGISTRATION_SCHEMA_VERSION_MISMATCH';
  end if;
  select publication_freeze into v_freeze
  from internal_product_registration.registration_authority_config
  where singleton = true
  for update;
  if coalesce(v_freeze, true) is not true then
    raise exception 'REGISTRATION_FINALIZE_REQUIRES_PUBLICATION_FREEZE';
  end if;

  select (
    (select count(*) from public.products where tenant_id is null or catalog_product_id is null)
    + (select count(*) from public.travel_packages where tenant_id is null or catalog_product_id is null)
    + (select count(*) from public.product_registration_v5_revisions where tenant_id is null or catalog_product_id is null)
    + (select count(*) from public.public_package_snapshots where tenant_id is null or catalog_product_id is null)
    + (select count(*) from public.product_registration_v5_publication_pointers where tenant_id is null or catalog_product_id is null)
    + (select count(*) from public.package_publish_decisions where tenant_id is null or catalog_product_id is null)
  ) into v_blocking_rows;
  if v_blocking_rows > 0 then
    raise exception 'REGISTRATION_TENANT_CATALOG_PREFLIGHT_BLOCKED:%', v_blocking_rows;
  end if;

  alter table public.products
    validate constraint products_tenant_catalog_product_fk;
  alter table public.travel_packages
    validate constraint travel_packages_tenant_catalog_product_fk;
  alter table public.product_registration_v5_revisions
    validate constraint v5_revisions_tenant_catalog_fk;
  alter table public.public_package_snapshots
    validate constraint public_snapshots_tenant_catalog_fk;
  alter table public.product_registration_v5_publication_pointers
    validate constraint publication_pointers_tenant_catalog_fk;
  alter table public.package_publish_decisions
    validate constraint publish_decisions_tenant_catalog_fk;

  for v_signature in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'publish_package_snapshot_atomic',
        'publish_product_registration_v5_snapshot_atomic',
        'publish_product_registration_v6_snapshot_atomic'
      )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', v_signature);
  end loop;

  select expected_object_fingerprint into v_expected_fingerprint
  from internal_product_registration.registration_schema_manifest
  where component = 'registration-kernel'
    and schema_version = p_expected_schema_version
  for update;
  if v_expected_fingerprint is null then raise exception 'REGISTRATION_SCHEMA_MANIFEST_MISSING'; end if;

  update internal_product_registration.registration_schema_manifest
  set applied_object_fingerprint = v_expected_fingerprint,
      verification_state = 'verified',
      verified_at = now(),
      details = details || jsonb_build_object(
        'legacy_publication_rpcs_revoked', true,
        'tenant_foreign_keys_validated', true,
        'finalized_at', now()
      )
  where component = 'registration-kernel'
    and schema_version = p_expected_schema_version;

  return jsonb_build_object(
    'schema_version', p_expected_schema_version,
    'verification_state', 'verified',
    'legacy_publication_rpcs_revoked', true,
    'tenant_foreign_keys_validated', true
  );
end;
$$;

revoke all on function public.finalize_product_registration_authority_hardening(text)
  from public, anon, authenticated;
grant execute on function public.finalize_product_registration_authority_hardening(text)
  to service_role;

create or replace function public.get_product_registration_authority_readiness()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_mode text;
  v_freeze boolean;
  v_manifest internal_product_registration.registration_schema_manifest%rowtype;
  v_unvalidated_fks integer;
begin
  select authority_mode, publication_freeze into v_mode, v_freeze
  from internal_product_registration.registration_authority_config
  where singleton = true;
  select * into v_manifest
  from internal_product_registration.registration_schema_manifest
  where component = 'registration-kernel'
  order by created_at desc
  limit 1;
  select count(*)::integer into v_unvalidated_fks
  from pg_catalog.pg_constraint
  where conname in (
    'products_tenant_catalog_product_fk',
    'travel_packages_tenant_catalog_product_fk',
    'v5_revisions_tenant_catalog_fk',
    'public_snapshots_tenant_catalog_fk',
    'publication_pointers_tenant_catalog_fk',
    'publish_decisions_tenant_catalog_fk'
  ) and not convalidated;
  return jsonb_build_object(
    'authority_mode', v_mode,
    'publication_freeze', coalesce(v_freeze, true),
    'schema_version', v_manifest.schema_version,
    'schema_verification_state', v_manifest.verification_state,
    'unvalidated_tenant_foreign_keys', v_unvalidated_fks,
    'legacy_publication_rpcs_executable', exists (
      select 1
      from pg_catalog.pg_proc p
      join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in (
          'publish_package_snapshot_atomic',
          'publish_product_registration_v5_snapshot_atomic',
          'publish_product_registration_v6_snapshot_atomic'
        )
        and has_function_privilege('service_role', p.oid, 'EXECUTE')
    )
  );
end;
$$;

revoke all on function public.get_product_registration_authority_readiness() from public, anon, authenticated;
grant execute on function public.get_product_registration_authority_readiness() to service_role;

revoke all on function internal_product_registration.assert_publication_not_frozen() from public, anon, authenticated;
