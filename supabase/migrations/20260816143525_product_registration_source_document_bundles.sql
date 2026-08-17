-- Complementary supplier source documents (for example a price sheet and a
-- separate itinerary) are recorded as immutable, tenant-scoped candidates.
-- This does not enable publication or change the current authority mode.

create table if not exists internal_product_registration.source_document_bundles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  bundle_hash text not null check (bundle_hash ~ '^[0-9a-f]{64}$'),
  resolver_version text not null,
  supplier_key text check (supplier_key is null or btrim(supplier_key) <> ''),
  grouping_authority text not null check (grouping_authority in ('supplier', 'upload_batch')),
  grouping_key text not null check (btrim(grouping_key) <> ''),
  score integer not null check (score between 0 and 100),
  ambiguity_margin integer not null check (ambiguity_margin between 0 and 100),
  state text not null default 'shadow_candidate'
    check (state in ('shadow_candidate', 'eligible', 'rejected', 'superseded')),
  resolution_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(resolution_metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, bundle_hash, resolver_version),
  unique (tenant_id, id),
  check (grouping_authority <> 'supplier' or supplier_key = grouping_key)
);

create table if not exists internal_product_registration.source_document_bundle_members (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  bundle_id uuid not null,
  source_document_id uuid not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  document_role text not null
    check (document_role in ('price_sheet', 'itinerary_sheet', 'terms_sheet')),
  evidence_scope jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence_scope) = 'object'),
  created_at timestamptz not null default now(),
  unique (bundle_id, source_document_id),
  foreign key (tenant_id, bundle_id)
    references internal_product_registration.source_document_bundles(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_document_id)
    references public.product_source_documents(tenant_id, id) on delete restrict
);

create table if not exists internal_product_registration.source_document_bundle_decisions (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  bundle_id uuid not null,
  decision text not null check (decision in ('eligible', 'rejected', 'superseded')),
  decision_reason text not null,
  policy_version text not null,
  benchmark_run_id uuid,
  decided_by uuid,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, bundle_id)
    references internal_product_registration.source_document_bundles(tenant_id, id) on delete restrict,
  foreign key (tenant_id, benchmark_run_id)
    references internal_product_registration.profile_benchmark_runs(tenant_id, id) on delete restrict
);

create table if not exists internal_product_registration.product_revision_source_bundles (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  product_revision_id uuid not null,
  source_bundle_id uuid not null,
  bundle_hash text not null check (bundle_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, product_revision_id),
  foreign key (tenant_id, product_revision_id)
    references public.product_registration_v5_revisions(tenant_id, id) on delete restrict,
  foreign key (tenant_id, source_bundle_id)
    references internal_product_registration.source_document_bundles(tenant_id, id) on delete restrict
);

create index if not exists idx_pr_source_bundles_grouping
  on internal_product_registration.source_document_bundles(tenant_id, grouping_authority, grouping_key, state, created_at desc);
create index if not exists idx_pr_source_uploads_batch
  on internal_product_registration.source_document_uploads(
    tenant_id,
    ((metadata->'sourceBatch'->>'id')),
    created_at desc
  ) where metadata->'sourceBatch'->>'id' is not null;
create index if not exists idx_pr_source_bundle_members_source
  on internal_product_registration.source_document_bundle_members(tenant_id, source_document_id, created_at desc);
create index if not exists idx_pr_source_bundle_decisions_bundle
  on internal_product_registration.source_document_bundle_decisions(tenant_id, bundle_id, created_at desc);
create index if not exists idx_pr_revision_source_bundle
  on internal_product_registration.product_revision_source_bundles(tenant_id, source_bundle_id, created_at desc);

create or replace function internal_product_registration.reject_source_bundle_immutable_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'PRODUCT_REGISTRATION_SOURCE_BUNDLE_APPEND_ONLY';
end;
$$;

create or replace function internal_product_registration.protect_source_bundle_content()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PRODUCT_REGISTRATION_SOURCE_BUNDLE_APPEND_ONLY';
  end if;
  if new.tenant_id is distinct from old.tenant_id
    or new.bundle_hash is distinct from old.bundle_hash
    or new.resolver_version is distinct from old.resolver_version
    or new.supplier_key is distinct from old.supplier_key
    or new.grouping_authority is distinct from old.grouping_authority
    or new.grouping_key is distinct from old.grouping_key
    or new.score is distinct from old.score
    or new.ambiguity_margin is distinct from old.ambiguity_margin
    or new.resolution_metadata is distinct from old.resolution_metadata
    or new.created_at is distinct from old.created_at then
    raise exception 'PRODUCT_REGISTRATION_SOURCE_BUNDLE_CONTENT_IMMUTABLE';
  end if;
  if not (
    (old.state = 'shadow_candidate' and new.state in ('shadow_candidate', 'eligible', 'rejected', 'superseded'))
    or (old.state = 'eligible' and new.state in ('eligible', 'superseded'))
    or (old.state = new.state)
  ) then
    raise exception 'PRODUCT_REGISTRATION_SOURCE_BUNDLE_STATE_TRANSITION_INVALID';
  end if;
  return new;
end;
$$;

create or replace function internal_product_registration.enforce_source_bundle_state_decision()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
begin
  if new.state <> 'shadow_candidate' and not exists (
    select 1
    from internal_product_registration.source_document_bundle_decisions d
    where d.tenant_id = new.tenant_id
      and d.bundle_id = new.id
      and d.decision = new.state
  ) then
    raise exception 'PRODUCT_REGISTRATION_SOURCE_BUNDLE_DECISION_REQUIRED';
  end if;
  return new;
end;
$$;

create or replace function internal_product_registration.enforce_revision_source_bundle_lineage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_bundle_hash text;
  v_bundle_state text;
  v_primary_source_document_id uuid;
begin
  select b.bundle_hash, b.state
    into v_bundle_hash, v_bundle_state
  from internal_product_registration.source_document_bundles b
  where b.tenant_id = new.tenant_id and b.id = new.source_bundle_id;
  if v_bundle_hash is null or v_bundle_hash <> new.bundle_hash or v_bundle_state <> 'eligible' then
    raise exception 'PRODUCT_REGISTRATION_SOURCE_BUNDLE_NOT_ELIGIBLE';
  end if;
  select r.source_document_id
    into v_primary_source_document_id
  from public.product_registration_v5_revisions r
  where r.tenant_id = new.tenant_id and r.id = new.product_revision_id;
  if v_primary_source_document_id is null or not exists (
    select 1
    from internal_product_registration.source_document_bundle_members m
    where m.tenant_id = new.tenant_id
      and m.bundle_id = new.source_bundle_id
      and m.source_document_id = v_primary_source_document_id
  ) then
    raise exception 'PRODUCT_REGISTRATION_REVISION_PRIMARY_SOURCE_NOT_IN_BUNDLE';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pr_source_bundle_immutable
  on internal_product_registration.source_document_bundles;
create trigger trg_pr_source_bundle_immutable
before update or delete on internal_product_registration.source_document_bundles
for each row execute function internal_product_registration.protect_source_bundle_content();

drop trigger if exists trg_pr_source_bundle_state_decision
  on internal_product_registration.source_document_bundles;
create constraint trigger trg_pr_source_bundle_state_decision
after insert or update on internal_product_registration.source_document_bundles
deferrable initially deferred
for each row execute function internal_product_registration.enforce_source_bundle_state_decision();

drop trigger if exists trg_pr_source_bundle_member_immutable
  on internal_product_registration.source_document_bundle_members;
create trigger trg_pr_source_bundle_member_immutable
before update or delete on internal_product_registration.source_document_bundle_members
for each row execute function internal_product_registration.reject_source_bundle_immutable_mutation();

drop trigger if exists trg_pr_source_bundle_decision_immutable
  on internal_product_registration.source_document_bundle_decisions;
create trigger trg_pr_source_bundle_decision_immutable
before update or delete on internal_product_registration.source_document_bundle_decisions
for each row execute function internal_product_registration.reject_source_bundle_immutable_mutation();

drop trigger if exists trg_pr_revision_source_bundle_immutable
  on internal_product_registration.product_revision_source_bundles;
create trigger trg_pr_revision_source_bundle_immutable
before update or delete on internal_product_registration.product_revision_source_bundles
for each row execute function internal_product_registration.reject_source_bundle_immutable_mutation();

drop trigger if exists trg_pr_revision_source_bundle_lineage
  on internal_product_registration.product_revision_source_bundles;
create trigger trg_pr_revision_source_bundle_lineage
before insert on internal_product_registration.product_revision_source_bundles
for each row execute function internal_product_registration.enforce_revision_source_bundle_lineage();

alter table internal_product_registration.source_document_bundles enable row level security;
alter table internal_product_registration.source_document_bundles force row level security;
alter table internal_product_registration.source_document_bundle_members enable row level security;
alter table internal_product_registration.source_document_bundle_members force row level security;
alter table internal_product_registration.source_document_bundle_decisions enable row level security;
alter table internal_product_registration.source_document_bundle_decisions force row level security;
alter table internal_product_registration.product_revision_source_bundles enable row level security;
alter table internal_product_registration.product_revision_source_bundles force row level security;

revoke all on table internal_product_registration.source_document_bundles from public, anon, authenticated;
revoke all on table internal_product_registration.source_document_bundle_members from public, anon, authenticated;
revoke all on table internal_product_registration.source_document_bundle_decisions from public, anon, authenticated;
revoke all on table internal_product_registration.product_revision_source_bundles from public, anon, authenticated;
grant all on table internal_product_registration.source_document_bundles to service_role;
grant all on table internal_product_registration.source_document_bundle_members to service_role;
grant all on table internal_product_registration.source_document_bundle_decisions to service_role;
grant all on table internal_product_registration.product_revision_source_bundles to service_role;
grant usage, select on sequence internal_product_registration.source_document_bundle_members_id_seq to service_role;
grant usage, select on sequence internal_product_registration.source_document_bundle_decisions_id_seq to service_role;

comment on table internal_product_registration.source_document_bundles is
  'Immutable shadow candidates joining complementary source documents within tenant-scoped supplier or explicit upload-batch search scope. Upload batch alone never proves product identity and this table is not publication authority.';
