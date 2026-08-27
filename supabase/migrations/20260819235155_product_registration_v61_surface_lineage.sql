-- Product Registration V6.1: hash hierarchy, compatibility projection lineage,
-- explicit source fact states, attraction review candidates, and positive-path
-- benchmark outcomes.

alter table public.product_registration_v5_revisions
  add column if not exists revision_content_hash text,
  add column if not exists workflow_version text,
  add column if not exists parser_version text,
  add column if not exists normalizer_version text,
  add column if not exists publication_policy_version text,
  add column if not exists customer_wording_rules_version text,
  add column if not exists engine_commit_sha text;

alter table public.product_registration_v5_revisions
  disable trigger trg_product_registration_v5_revisions_immutable;
update public.product_registration_v5_revisions
set revision_content_hash = coalesce(revision_content_hash, payload_hash),
    workflow_version = coalesce(workflow_version, 'v6-legacy'),
    parser_version = coalesce(parser_version, normalization_version),
    normalizer_version = coalesce(normalizer_version, normalization_version),
    publication_policy_version = coalesce(publication_policy_version, 'v6-policy-legacy'),
    customer_wording_rules_version = coalesce(customer_wording_rules_version, 'v6-wording-legacy')
where revision_content_hash is null
   or workflow_version is null
   or parser_version is null
   or normalizer_version is null
   or publication_policy_version is null
   or customer_wording_rules_version is null;
alter table public.product_registration_v5_revisions
  enable trigger trg_product_registration_v5_revisions_immutable;

alter table public.product_registration_v5_revisions
  alter column revision_content_hash set not null,
  alter column workflow_version set not null,
  alter column parser_version set not null,
  alter column normalizer_version set not null,
  alter column publication_policy_version set not null,
  alter column customer_wording_rules_version set not null;

create or replace function internal_product_registration.stamp_v61_revision_versions()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
begin
  new.revision_content_hash := coalesce(new.revision_content_hash, new.payload_hash);
  new.workflow_version := coalesce(nullif(new.workflow_version, ''), 'v6.1-recompile');
  new.parser_version := coalesce(nullif(new.parser_version, ''), new.normalization_version, 'v6-parser-unknown');
  new.normalizer_version := coalesce(nullif(new.normalizer_version, ''), new.normalization_version, 'v6-normalizer-unknown');
  new.publication_policy_version := coalesce(
    nullif(new.publication_policy_version, ''),
    'product-registration-v6-policy-12-v61-release-authorization'
  );
  new.customer_wording_rules_version := coalesce(
    nullif(new.customer_wording_rules_version, ''),
    'product-registration-v6-wording-4-typed-ir'
  );
  return new;
end;
$$;

drop trigger if exists trg_product_registration_v5_revisions_v61_versions
  on public.product_registration_v5_revisions;
create trigger trg_product_registration_v5_revisions_v61_versions
before insert on public.product_registration_v5_revisions
for each row execute function internal_product_registration.stamp_v61_revision_versions();
alter table public.product_registration_v5_revisions
  drop constraint if exists product_registration_v5_revisions_revision_content_hash_check;
alter table public.product_registration_v5_revisions
  add constraint product_registration_v5_revisions_revision_content_hash_check
  check (revision_content_hash ~ '^[0-9a-f]{64}$');

alter table public.public_package_snapshots
  add column if not exists revision_content_hash text,
  add column if not exists customer_snapshot_hash text,
  add column if not exists publication_policy_version text,
  add column if not exists customer_wording_rules_version text;

update public.public_package_snapshots s
set revision_content_hash = coalesce(s.revision_content_hash, r.revision_content_hash, s.snapshot_hash),
    customer_snapshot_hash = coalesce(s.customer_snapshot_hash, s.snapshot_hash),
    publication_policy_version = coalesce(s.publication_policy_version, r.publication_policy_version, 'v6-policy-legacy'),
    customer_wording_rules_version = coalesce(s.customer_wording_rules_version, r.customer_wording_rules_version, 'v6-wording-legacy')
from public.product_registration_v5_revisions r
where r.id = s.canonical_revision_id
  and (
    s.revision_content_hash is null or s.customer_snapshot_hash is null
    or s.publication_policy_version is null or s.customer_wording_rules_version is null
  );

update public.public_package_snapshots
set revision_content_hash = coalesce(revision_content_hash, snapshot_hash),
    customer_snapshot_hash = coalesce(customer_snapshot_hash, snapshot_hash),
    publication_policy_version = coalesce(publication_policy_version, 'v6-policy-legacy'),
    customer_wording_rules_version = coalesce(customer_wording_rules_version, 'v6-wording-legacy')
where revision_content_hash is null or customer_snapshot_hash is null
   or publication_policy_version is null or customer_wording_rules_version is null;

alter table public.public_package_snapshots
  alter column revision_content_hash set not null,
  alter column customer_snapshot_hash set not null,
  alter column publication_policy_version set not null,
  alter column customer_wording_rules_version set not null;
alter table public.public_package_snapshots
  drop constraint if exists public_package_snapshots_revision_content_hash_check,
  drop constraint if exists public_package_snapshots_customer_snapshot_hash_check;
alter table public.public_package_snapshots
  add constraint public_package_snapshots_revision_content_hash_check
    check (revision_content_hash ~ '^[0-9a-f]{64}$'),
  add constraint public_package_snapshots_customer_snapshot_hash_check
    check (customer_snapshot_hash ~ '^[0-9a-f]{64}$');

create table if not exists internal_product_registration.surface_render_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  catalog_product_id uuid not null references internal_product_registration.catalog_products(id) on delete restrict,
  package_id uuid not null references public.travel_packages(id) on delete restrict,
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete restrict,
  snapshot_id uuid not null references public.public_package_snapshots(id) on delete restrict,
  revision_content_hash text not null check (revision_content_hash ~ '^[0-9a-f]{64}$'),
  customer_snapshot_hash text not null check (customer_snapshot_hash ~ '^[0-9a-f]{64}$'),
  renderer_build_id text not null check (btrim(renderer_build_id) <> ''),
  publication_policy_version text not null check (btrim(publication_policy_version) <> ''),
  customer_wording_rules_version text not null check (btrim(customer_wording_rules_version) <> ''),
  surface_name text not null check (surface_name in (
    'package_listing_card', 'package_detail', 'landing_page', 'a4_artifact'
  )),
  artifact_kind text not null check (artifact_kind in ('normalized_dom_text', 'html', 'pdf', 'component_projection')),
  surface_render_hash text not null check (surface_render_hash ~ '^[0-9a-f]{64}$'),
  normalized_dom_text_hash text check (normalized_dom_text_hash is null or normalized_dom_text_hash ~ '^[0-9a-f]{64}$'),
  artifact_bytes_hash text check (artifact_bytes_hash is null or artifact_bytes_hash ~ '^[0-9a-f]{64}$'),
  artifact_uri text,
  created_at timestamptz not null default now(),
  unique (snapshot_id, renderer_build_id, publication_policy_version, customer_wording_rules_version, surface_name, surface_render_hash)
);

alter table public.product_registration_v5_proof_runs
  add column if not exists surface_render_id uuid references internal_product_registration.surface_render_artifacts(id) on delete restrict,
  add column if not exists surface_render_hash text,
  add column if not exists browser_version text,
  add column if not exists interaction_result_hash text,
  add column if not exists publication_policy_version text,
  add column if not exists customer_wording_rules_version text;

alter table public.product_registration_v5_proof_runs
  drop constraint if exists product_registration_v5_proof_runs_surface_render_hash_check,
  drop constraint if exists product_registration_v5_proof_runs_interaction_result_hash_check;
alter table public.product_registration_v5_proof_runs
  add constraint product_registration_v5_proof_runs_surface_render_hash_check
    check (surface_render_hash is null or surface_render_hash ~ '^[0-9a-f]{64}$'),
  add constraint product_registration_v5_proof_runs_interaction_result_hash_check
    check (interaction_result_hash is null or interaction_result_hash ~ '^[0-9a-f]{64}$');

create table if not exists internal_product_registration.browser_proof_surface_links (
  proof_id uuid not null references public.product_registration_v5_proof_runs(id) on delete restrict,
  surface_render_id uuid not null references internal_product_registration.surface_render_artifacts(id) on delete restrict,
  linked_at timestamptz not null default now(),
  primary key (proof_id, surface_render_id)
);

create table if not exists internal_product_registration.attraction_match_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete restrict,
  itinerary_item_id uuid references public.product_registration_v5_itinerary_items(id) on delete restrict,
  raw_label text not null check (btrim(raw_label) <> ''),
  normalized_label text not null check (btrim(normalized_label) <> ''),
  destination_scope text,
  match_method text not null check (match_method in ('fuzzy', 'llm_candidate')),
  candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates) = 'array'),
  ambiguity_code text not null check (ambiguity_code in ('ATTRACTION_MATCH_AMBIGUOUS', 'ATTRACTION_NOT_FOUND')),
  review_state text not null default 'pending' check (review_state in ('pending', 'approved_alias', 'rejected')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (revision_id, itinerary_item_id, normalized_label, match_method)
);

alter table public.product_registration_v5_price_rules
  add column if not exists fact_state text not null default 'CONFIRMED';
alter table public.product_registration_v5_itinerary_items
  add column if not exists fact_state text not null default 'CONFIRMED',
  add column if not exists customer_text_origin text not null default 'STANDARD_RENDERER';

alter table public.product_registration_v5_price_rules
  drop constraint if exists product_registration_v5_price_rules_fact_state_check;
alter table public.product_registration_v5_price_rules
  add constraint product_registration_v5_price_rules_fact_state_check check (
    fact_state in ('CONFIRMED', 'SOURCE_DECLARED_PENDING', 'MISSING', 'CONFLICTING', 'INFERRED_UNSUPPORTED')
  );

create or replace function internal_product_registration.stamp_v61_typed_fact_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_fact_state text := upper(coalesce(new.evidence_ref #>> '{v61,fact_state}', 'CONFIRMED'));
  v_customer_origin text := upper(coalesce(new.evidence_ref #>> '{v61,customer_text_origin}', 'STANDARD_RENDERER'));
begin
  if v_fact_state not in ('CONFIRMED', 'SOURCE_DECLARED_PENDING', 'MISSING', 'CONFLICTING', 'INFERRED_UNSUPPORTED') then
    raise exception 'REGISTRATION_FACT_STATE_INVALID';
  end if;
  new.fact_state := v_fact_state;
  if tg_table_name = 'product_registration_v5_itinerary_items' then
    if v_customer_origin not in ('STANDARD_RENDERER', 'APPROVED_TEMPLATE') then
      raise exception 'REGISTRATION_CUSTOMER_TEXT_ORIGIN_INVALID';
    end if;
    new.customer_text_origin := v_customer_origin;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_product_registration_v5_price_rules_v61_fact_state
  on public.product_registration_v5_price_rules;
create trigger trg_product_registration_v5_price_rules_v61_fact_state
before insert on public.product_registration_v5_price_rules
for each row execute function internal_product_registration.stamp_v61_typed_fact_state();
drop trigger if exists trg_product_registration_v5_itinerary_items_v61_fact_state
  on public.product_registration_v5_itinerary_items;
create trigger trg_product_registration_v5_itinerary_items_v61_fact_state
before insert on public.product_registration_v5_itinerary_items
for each row execute function internal_product_registration.stamp_v61_typed_fact_state();
alter table public.product_registration_v5_itinerary_items
  drop constraint if exists product_registration_v5_itinerary_items_fact_state_check,
  drop constraint if exists product_registration_v5_itinerary_items_customer_text_origin_check,
  drop constraint if exists product_registration_v5_itinerary_items_item_type_check;
alter table public.product_registration_v5_itinerary_items
  add constraint product_registration_v5_itinerary_items_fact_state_check check (
    fact_state in ('CONFIRMED', 'SOURCE_DECLARED_PENDING', 'MISSING', 'CONFLICTING', 'INFERRED_UNSUPPORTED')
  ),
  add constraint product_registration_v5_itinerary_items_customer_text_origin_check check (
    customer_text_origin in ('STANDARD_RENDERER', 'APPROVED_TEMPLATE')
  ),
  add constraint product_registration_v5_itinerary_items_item_type_check check (
    item_type in (
      'flight', 'ferry', 'ground_transport', 'attraction', 'meal', 'lodging',
      'hotel_checkin', 'rest', 'shopping', 'optional_tour', 'free_time',
      'meeting', 'notice', 'terms', 'note', 'unknown'
    )
  );

alter table public.products
  add column if not exists source_revision_id uuid references public.product_registration_v5_revisions(id) on delete restrict,
  add column if not exists source_snapshot_id uuid references public.public_package_snapshots(id) on delete restrict,
  add column if not exists projection_hash text,
  add column if not exists projected_at timestamptz,
  add column if not exists projected_by_authority_event_id uuid references internal_product_registration.registration_authority_events(id) on delete restrict;
alter table public.travel_packages
  add column if not exists source_revision_id uuid references public.product_registration_v5_revisions(id) on delete restrict,
  add column if not exists source_snapshot_id uuid references public.public_package_snapshots(id) on delete restrict,
  add column if not exists projection_hash text,
  add column if not exists projected_at timestamptz,
  add column if not exists projected_by_authority_event_id uuid references internal_product_registration.registration_authority_events(id) on delete restrict;
alter table public.product_prices
  add column if not exists source_revision_id uuid references public.product_registration_v5_revisions(id) on delete restrict,
  add column if not exists source_snapshot_id uuid references public.public_package_snapshots(id) on delete restrict,
  add column if not exists projection_hash text,
  add column if not exists projected_at timestamptz,
  add column if not exists projected_by_authority_event_id uuid references internal_product_registration.registration_authority_events(id) on delete restrict;

alter table public.products
  drop constraint if exists products_projection_hash_check;
alter table public.products
  add constraint products_projection_hash_check check (projection_hash is null or projection_hash ~ '^[0-9a-f]{64}$');
alter table public.travel_packages
  drop constraint if exists travel_packages_projection_hash_check;
alter table public.travel_packages
  add constraint travel_packages_projection_hash_check check (projection_hash is null or projection_hash ~ '^[0-9a-f]{64}$');
alter table public.product_prices
  drop constraint if exists product_prices_projection_hash_check;
alter table public.product_prices
  add constraint product_prices_projection_hash_check check (projection_hash is null or projection_hash ~ '^[0-9a-f]{64}$');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'internal_product_registration.package_availability_overlays'::regclass
      and conname = 'package_availability_overlays_visibility_manifest_item_fkey'
  ) then
    alter table internal_product_registration.package_availability_overlays
      add constraint package_availability_overlays_visibility_manifest_item_fkey
      foreign key (visibility_manifest_item_id)
      references internal_product_registration.publication_freeze_manifest_items(id)
      on delete restrict;
  end if;
end;
$$;

create index if not exists idx_pr_v61_surface_render_snapshot
  on internal_product_registration.surface_render_artifacts(snapshot_id, surface_name, created_at desc);
create index if not exists idx_pr_v61_attraction_candidates_review
  on internal_product_registration.attraction_match_candidates(review_state, created_at)
  where review_state = 'pending';
create index if not exists idx_products_projection_lineage
  on public.products(source_revision_id, source_snapshot_id);
create index if not exists idx_travel_packages_projection_lineage
  on public.travel_packages(source_revision_id, source_snapshot_id);
create index if not exists idx_product_prices_projection_lineage
  on public.product_prices(source_revision_id, source_snapshot_id);

alter table internal_product_registration.surface_render_artifacts enable row level security;
alter table internal_product_registration.browser_proof_surface_links enable row level security;
alter table internal_product_registration.attraction_match_candidates enable row level security;
revoke all on table internal_product_registration.surface_render_artifacts from public, anon, authenticated;
revoke all on table internal_product_registration.browser_proof_surface_links from public, anon, authenticated;
revoke all on table internal_product_registration.attraction_match_candidates from public, anon, authenticated;
grant select, insert on table internal_product_registration.surface_render_artifacts to service_role;
grant select, insert on table internal_product_registration.browser_proof_surface_links to service_role;
grant select, insert, update on table internal_product_registration.attraction_match_candidates to service_role;

create or replace function internal_product_registration.reject_immutable_surface_lineage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception 'REGISTRATION_SURFACE_LINEAGE_IMMUTABLE:%', tg_table_name;
end;
$$;

drop trigger if exists trg_surface_render_artifacts_immutable
  on internal_product_registration.surface_render_artifacts;
create trigger trg_surface_render_artifacts_immutable
before update or delete on internal_product_registration.surface_render_artifacts
for each row execute function internal_product_registration.reject_immutable_surface_lineage();
drop trigger if exists trg_browser_proof_surface_links_immutable
  on internal_product_registration.browser_proof_surface_links;
create trigger trg_browser_proof_surface_links_immutable
before update or delete on internal_product_registration.browser_proof_surface_links
for each row execute function internal_product_registration.reject_immutable_surface_lineage();

create or replace function internal_product_registration.record_surface_render(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_snapshot public.public_package_snapshots%rowtype;
  v_revision public.product_registration_v5_revisions%rowtype;
  v_id uuid;
begin
  select * into v_snapshot
  from public.public_package_snapshots s
  where s.id = nullif(p_payload->>'snapshot_id', '')::uuid
  for share;
  if not found then raise exception 'REGISTRATION_SURFACE_SNAPSHOT_NOT_FOUND'; end if;
  select * into v_revision
  from public.product_registration_v5_revisions r
  where r.id = v_snapshot.canonical_revision_id
  for share;
  if not found
    or v_revision.revision_content_hash is distinct from p_payload->>'revision_content_hash'
    or v_snapshot.customer_snapshot_hash is distinct from p_payload->>'customer_snapshot_hash'
    or v_snapshot.renderer_build_id is distinct from p_payload->>'renderer_build_id'
    or v_snapshot.publication_policy_version is distinct from p_payload->>'publication_policy_version'
    or v_snapshot.customer_wording_rules_version is distinct from p_payload->>'customer_wording_rules_version' then
    raise exception 'REGISTRATION_SURFACE_LINEAGE_MISMATCH';
  end if;
  if p_payload->>'surface_render_hash' !~ '^[0-9a-f]{64}$' then
    raise exception 'REGISTRATION_SURFACE_HASH_INVALID';
  end if;

  insert into internal_product_registration.surface_render_artifacts (
    tenant_id, catalog_product_id, package_id, revision_id, snapshot_id,
    revision_content_hash, customer_snapshot_hash, renderer_build_id,
    publication_policy_version, customer_wording_rules_version,
    surface_name, artifact_kind, surface_render_hash,
    normalized_dom_text_hash, artifact_bytes_hash, artifact_uri
  ) values (
    v_snapshot.tenant_id, v_snapshot.catalog_product_id, v_snapshot.package_id,
    v_snapshot.canonical_revision_id, v_snapshot.id,
    v_snapshot.revision_content_hash, v_snapshot.customer_snapshot_hash,
    v_snapshot.renderer_build_id, v_snapshot.publication_policy_version,
    v_snapshot.customer_wording_rules_version,
    p_payload->>'surface_name', p_payload->>'artifact_kind', p_payload->>'surface_render_hash',
    nullif(p_payload->>'normalized_dom_text_hash', ''),
    nullif(p_payload->>'artifact_bytes_hash', ''), nullif(p_payload->>'artifact_uri', '')
  ) on conflict (
    snapshot_id, renderer_build_id, publication_policy_version,
    customer_wording_rules_version, surface_name, surface_render_hash
  ) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
    from internal_product_registration.surface_render_artifacts a
    where a.snapshot_id = v_snapshot.id
      and a.renderer_build_id = v_snapshot.renderer_build_id
      and a.publication_policy_version = v_snapshot.publication_policy_version
      and a.customer_wording_rules_version = v_snapshot.customer_wording_rules_version
      and a.surface_name = p_payload->>'surface_name'
      and a.surface_render_hash = p_payload->>'surface_render_hash';
  end if;
  return jsonb_build_object('surface_render_id', v_id, 'surface_render_hash', p_payload->>'surface_render_hash');
end;
$$;

create or replace function public.record_product_registration_surface_render(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.record_surface_render(p_payload);
$$;

create or replace function internal_product_registration.link_browser_proof_surface(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_proof public.product_registration_v5_proof_runs%rowtype;
  v_surface internal_product_registration.surface_render_artifacts%rowtype;
begin
  select * into v_proof from public.product_registration_v5_proof_runs
  where id = nullif(p_payload->>'proof_id', '')::uuid for share;
  select * into v_surface from internal_product_registration.surface_render_artifacts
  where id = nullif(p_payload->>'surface_render_id', '')::uuid for share;
  if v_proof.id is null or v_surface.id is null
    or v_proof.public_snapshot_id is distinct from v_surface.snapshot_id
    or v_proof.revision_id is distinct from v_surface.revision_id
    or v_proof.snapshot_hash is distinct from v_surface.customer_snapshot_hash
    or v_proof.renderer_build_id is distinct from v_surface.renderer_build_id then
    raise exception 'REGISTRATION_BROWSER_PROOF_SURFACE_MISMATCH';
  end if;
  insert into internal_product_registration.browser_proof_surface_links(proof_id, surface_render_id)
  values (v_proof.id, v_surface.id)
  on conflict do nothing;
  return jsonb_build_object('proof_id', v_proof.id, 'surface_render_id', v_surface.id);
end;
$$;

create or replace function public.link_product_registration_browser_proof_surface(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  select internal_product_registration.link_browser_proof_surface(p_payload);
$$;

create or replace function internal_product_registration.stamp_projection_lineage()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_writer text := current_setting('app.product_registration_writer', true);
  v_revision_id uuid := nullif(current_setting('app.product_registration_projection_revision_id', true), '')::uuid;
  v_snapshot_id uuid := nullif(current_setting('app.product_registration_projection_snapshot_id', true), '')::uuid;
  v_projection_hash text := nullif(current_setting('app.product_registration_projection_hash', true), '');
  v_event_id uuid := nullif(current_setting('app.product_registration_projection_event_id', true), '')::uuid;
begin
  if v_writer <> 'compatibility-projection' then return new; end if;
  if v_revision_id is null or v_projection_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'REGISTRATION_PROJECTION_LINEAGE_REQUIRED';
  end if;
  new.source_revision_id := v_revision_id;
  new.source_snapshot_id := v_snapshot_id;
  new.projection_hash := v_projection_hash;
  new.projected_at := now();
  new.projected_by_authority_event_id := v_event_id;
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['products', 'travel_packages', 'product_prices'] loop
    execute format('drop trigger if exists trg_pr_v61_projection_lineage on public.%I', v_table);
    execute format(
      'create trigger trg_pr_v61_projection_lineage before insert or update on public.%I for each row execute function internal_product_registration.stamp_projection_lineage()',
      v_table
    );
  end loop;
end;
$$;

create or replace function public.project_product_registration_compatibility_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_event_id uuid;
begin
  if p_payload->>'revision_id' is null
    or p_payload->>'projection_hash' !~ '^[0-9a-f]{64}$' then
    raise exception 'REGISTRATION_PROJECTION_LINEAGE_REQUIRED';
  end if;
  perform set_config('app.product_registration_writer', 'compatibility-projection', true);
  perform set_config('app.product_registration_projection_revision_id', p_payload->>'revision_id', true);
  perform set_config('app.product_registration_projection_snapshot_id', '', true);
  perform set_config('app.product_registration_projection_hash', p_payload->>'projection_hash', true);
  perform set_config('app.product_registration_projection_event_id', '', true);
  v_result := internal_product_registration.project_compatibility_atomic(p_payload);

  select e.id into v_event_id
  from internal_product_registration.registration_authority_events e
  where e.operation_key = p_payload->>'operation_key'
  order by e.created_at desc
  limit 1;
  if v_event_id is not null then
    perform set_config('app.product_registration_projection_event_id', v_event_id::text, true);
    update public.products
      set projected_by_authority_event_id = v_event_id
      where source_revision_id = (p_payload->>'revision_id')::uuid;
    update public.travel_packages
      set projected_by_authority_event_id = v_event_id
      where source_revision_id = (p_payload->>'revision_id')::uuid;
    update public.product_prices
      set projected_by_authority_event_id = v_event_id
      where source_revision_id = (p_payload->>'revision_id')::uuid;
  end if;
  return v_result || jsonb_build_object(
    'projection_hash', p_payload->>'projection_hash',
    'authority_event_id', v_event_id
  );
end;
$$;

create or replace function public.link_product_registration_projection_snapshot_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_revision_id uuid := nullif(p_payload->>'revision_id', '')::uuid;
  v_snapshot_id uuid := nullif(p_payload->>'snapshot_id', '')::uuid;
  v_projection_hash text := p_payload->>'projection_hash';
  v_snapshot public.public_package_snapshots%rowtype;
  v_products integer;
  v_packages integer;
  v_prices integer;
begin
  select * into v_snapshot from public.public_package_snapshots
  where id = v_snapshot_id and canonical_revision_id = v_revision_id for share;
  if not found or v_projection_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'REGISTRATION_PROJECTION_SNAPSHOT_LINEAGE_INVALID';
  end if;
  perform set_config('app.product_registration_writer', 'compatibility-projection', true);
  perform set_config('app.product_registration_projection_revision_id', v_revision_id::text, true);
  perform set_config('app.product_registration_projection_snapshot_id', v_snapshot_id::text, true);
  perform set_config('app.product_registration_projection_hash', v_projection_hash, true);
  perform set_config('app.product_registration_projection_event_id', '', true);

  update public.products set source_snapshot_id = v_snapshot_id
  where source_revision_id = v_revision_id and projection_hash = v_projection_hash;
  get diagnostics v_products = row_count;
  update public.travel_packages set source_snapshot_id = v_snapshot_id
  where source_revision_id = v_revision_id and projection_hash = v_projection_hash;
  get diagnostics v_packages = row_count;
  update public.product_prices set source_snapshot_id = v_snapshot_id
  where source_revision_id = v_revision_id and projection_hash = v_projection_hash;
  get diagnostics v_prices = row_count;
  if v_products = 0 or v_packages = 0 then
    raise exception 'REGISTRATION_PROJECTION_SNAPSHOT_TARGET_MISSING';
  end if;
  return jsonb_build_object(
    'revision_id', v_revision_id, 'snapshot_id', v_snapshot_id,
    'products', v_products, 'packages', v_packages, 'prices', v_prices
  );
end;
$$;

create or replace function public.audit_product_registration_projection_lineage(
  p_tenant_id uuid,
  p_limit integer default 500
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
  with pointer_rows as (
    select p.catalog_product_id, p.package_id, p.current_revision_id, p.current_snapshot_id
    from public.product_registration_v5_publication_pointers p
    where p.tenant_id = p_tenant_id and p.channel = 'customer'
    order by p.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 500), 5000))
  ), checks as (
    select pr.catalog_product_id, pr.package_id,
      tp.source_revision_id, tp.source_snapshot_id, tp.projection_hash,
      case
        when tp.source_revision_id is null or tp.projection_hash is null then 'LINEAGE_MISSING'
        when tp.source_revision_id <> pr.current_revision_id then 'REVISION_DRIFT'
        when tp.source_snapshot_id is distinct from pr.current_snapshot_id then 'SNAPSHOT_DRIFT'
        when exists (
          select 1 from public.product_prices pp
          where pp.source_revision_id = tp.source_revision_id
            and pp.projection_hash is distinct from tp.projection_hash
        ) then 'PROJECTION_HASH_DRIFT'
        else 'OK'
      end as result
    from pointer_rows pr
    left join public.travel_packages tp on tp.id = pr.package_id
  )
  select jsonb_build_object(
    'checked', count(*),
    'drift_count', count(*) filter (where result <> 'OK'),
    'rows', coalesce(jsonb_agg(to_jsonb(checks) order by catalog_product_id), '[]'::jsonb)
  ) from checks;
$$;

-- The compatibility tables are no longer general write authorities. Preserve
-- only narrowly-scoped operational counter updates outside SECURITY DEFINER
-- projection RPCs.
revoke insert, update, delete on table public.products from service_role;
revoke insert, update, delete on table public.travel_packages from service_role;
revoke insert, update, delete on table public.product_prices from service_role;
grant update (view_count, inquiry_count, embedding, updated_at) on table public.products to service_role;
grant update (view_count, view_count_snap_at, view_count_weekly_snap, inquiry_count, embedding, updated_at)
  on table public.travel_packages to service_role;

alter table internal_product_registration.benchmark_ground_truth_sections
  add column if not exists expected_outcome text;
alter table internal_product_registration.benchmark_ground_truth_sections
  drop constraint if exists benchmark_ground_truth_sections_expected_outcome_check;
alter table internal_product_registration.benchmark_ground_truth_sections
  add constraint benchmark_ground_truth_sections_expected_outcome_check check (
    expected_outcome is null or expected_outcome in (
      'EXPECTED_PUBLISHABLE', 'EXPECTED_REVIEW_REQUIRED',
      'EXPECTED_SOURCE_INCOMPLETE', 'EXPECTED_NON_PRODUCT'
    )
  );

alter table internal_product_registration.benchmark_case_results
  add column if not exists expected_outcome text,
  add column if not exists outcome_exact boolean,
  add column if not exists critical_source_span_exact boolean;
alter table internal_product_registration.benchmark_case_results
  drop constraint if exists benchmark_case_results_expected_outcome_check;
alter table internal_product_registration.benchmark_case_results
  add constraint benchmark_case_results_expected_outcome_check check (
    expected_outcome is null or expected_outcome in (
      'EXPECTED_PUBLISHABLE', 'EXPECTED_REVIEW_REQUIRED',
      'EXPECTED_SOURCE_INCOMPLETE', 'EXPECTED_NON_PRODUCT'
    )
  );

create or replace function internal_product_registration.stamp_v61_benchmark_expected_outcome()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, internal_product_registration, pg_temp
as $$
begin
  new.expected_outcome := coalesce(new.expected_outcome, new.ground_truth->>'expectedOutcome');
  if new.expected_outcome not in (
    'EXPECTED_PUBLISHABLE', 'EXPECTED_REVIEW_REQUIRED',
    'EXPECTED_SOURCE_INCOMPLETE', 'EXPECTED_NON_PRODUCT'
  ) then raise exception 'BENCHMARK_EXPECTED_OUTCOME_REQUIRED'; end if;
  return new;
end;
$$;

drop trigger if exists trg_benchmark_ground_truth_v61_expected_outcome
  on internal_product_registration.benchmark_ground_truth_sections;
create trigger trg_benchmark_ground_truth_v61_expected_outcome
before insert on internal_product_registration.benchmark_ground_truth_sections
for each row execute function internal_product_registration.stamp_v61_benchmark_expected_outcome();

create or replace function public.persist_product_registration_benchmark_case_v2(
  p_tenant_id uuid,
  p_benchmark_run_id uuid,
  p_payload jsonb
) returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare v_id bigint;
begin
  if p_payload->>'expectedOutcome' not in (
    'EXPECTED_PUBLISHABLE', 'EXPECTED_REVIEW_REQUIRED',
    'EXPECTED_SOURCE_INCOMPLETE', 'EXPECTED_NON_PRODUCT'
  ) or p_payload->>'predictedExpectedOutcome' not in (
    'EXPECTED_PUBLISHABLE', 'EXPECTED_REVIEW_REQUIRED',
    'EXPECTED_SOURCE_INCOMPLETE', 'EXPECTED_NON_PRODUCT'
  ) then raise exception 'BENCHMARK_EXPECTED_OUTCOME_REQUIRED'; end if;
  insert into internal_product_registration.benchmark_case_results (
    tenant_id, benchmark_run_id, corpus_source_id, ground_truth_section_id,
    input_kind, build_id, parser_version, profile_version, policy_version,
    predicted_outcome, extraction_succeeded, segment_exact, safe_open,
    critical_false_publish, critical_field_count, critical_exact_count,
    parser_fallback_used, parser_disagreement, field_diffs, metrics,
    expected_outcome, outcome_exact, critical_source_span_exact
  ) values (
    p_tenant_id, p_benchmark_run_id,
    (p_payload->>'corpusSourceId')::uuid, (p_payload->>'groundTruthSectionId')::uuid,
    p_payload->>'inputKind', p_payload->>'buildId', p_payload->>'parserVersion',
    nullif(p_payload->>'profileVersion', ''), p_payload->>'policyVersion',
    p_payload->>'predictedOutcome', coalesce((p_payload->>'extractionSucceeded')::boolean, false),
    coalesce((p_payload->>'segmentExact')::boolean, false), coalesce((p_payload->>'safeOpen')::boolean, false),
    coalesce((p_payload->>'criticalFalsePublish')::boolean, false),
    coalesce((p_payload->>'criticalFieldCount')::integer, 0), coalesce((p_payload->>'criticalExactCount')::integer, 0),
    coalesce((p_payload->>'parserFallbackUsed')::boolean, false), coalesce((p_payload->>'parserDisagreement')::boolean, false),
    coalesce(p_payload->'fieldDiffs', '[]'::jsonb), coalesce(p_payload->'metrics', '{}'::jsonb),
    p_payload->>'expectedOutcome', coalesce((p_payload->>'outcomeExact')::boolean, false),
    coalesce((p_payload->>'criticalSourceSpanExact')::boolean, false)
  ) on conflict (benchmark_run_id, ground_truth_section_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from internal_product_registration.benchmark_case_results
    where benchmark_run_id = p_benchmark_run_id
      and ground_truth_section_id = (p_payload->>'groundTruthSectionId')::uuid;
  end if;
  return v_id;
end;
$$;

create or replace function internal_product_registration.assert_release_surface_proofs()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, pg_temp
as $$
declare
  v_surface_count integer;
begin
  select count(distinct a.surface_name) into v_surface_count
  from internal_product_registration.browser_proof_surface_links l
  join internal_product_registration.surface_render_artifacts a
    on a.id = l.surface_render_id
  where l.proof_id = new.proof_id
    and a.snapshot_id = new.snapshot_id
    and a.revision_id = new.revision_id
    and a.surface_name in ('package_detail', 'landing_page')
    and a.publication_policy_version = new.policy_version;
  if v_surface_count <> 2 then
    raise exception 'REGISTRATION_RELEASE_SURFACE_PROOFS_REQUIRED';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_release_authorization_surface_proofs
  on internal_product_registration.publication_release_authorizations;
create trigger trg_release_authorization_surface_proofs
before insert on internal_product_registration.publication_release_authorizations
for each row execute function internal_product_registration.assert_release_surface_proofs();

revoke all on function internal_product_registration.reject_immutable_surface_lineage()
  from public, anon, authenticated;
revoke all on function internal_product_registration.stamp_v61_revision_versions()
  from public, anon, authenticated;
revoke all on function internal_product_registration.stamp_v61_typed_fact_state()
  from public, anon, authenticated;
revoke all on function internal_product_registration.record_surface_render(jsonb)
  from public, anon, authenticated;
revoke all on function public.record_product_registration_surface_render(jsonb)
  from public, anon, authenticated;
revoke all on function internal_product_registration.link_browser_proof_surface(jsonb)
  from public, anon, authenticated;
revoke all on function public.link_product_registration_browser_proof_surface(jsonb)
  from public, anon, authenticated;
revoke all on function internal_product_registration.stamp_projection_lineage()
  from public, anon, authenticated;
revoke all on function internal_product_registration.project_compatibility_atomic(jsonb)
  from service_role;
revoke all on function public.project_product_registration_compatibility_atomic(jsonb)
  from public, anon, authenticated;
revoke all on function public.link_product_registration_projection_snapshot_atomic(jsonb)
  from public, anon, authenticated;
revoke all on function public.audit_product_registration_projection_lineage(uuid, integer)
  from public, anon, authenticated;
revoke all on function internal_product_registration.assert_release_surface_proofs()
  from public, anon, authenticated;
revoke all on function internal_product_registration.stamp_v61_benchmark_expected_outcome()
  from public, anon, authenticated;

grant execute on function public.record_product_registration_surface_render(jsonb) to service_role;
grant execute on function public.link_product_registration_browser_proof_surface(jsonb) to service_role;
grant execute on function public.project_product_registration_compatibility_atomic(jsonb) to service_role;
grant execute on function public.link_product_registration_projection_snapshot_atomic(jsonb) to service_role;
grant execute on function public.audit_product_registration_projection_lineage(uuid, integer) to service_role;

comment on table internal_product_registration.attraction_match_candidates is
  'Fuzzy/LLM attraction results are review candidates only. This table never inserts or links attraction masters.';
comment on table internal_product_registration.surface_render_artifacts is
  'Per-surface deterministic render hashes bound to an exact revision, canonical customer snapshot, renderer, policy, and wording rules.';
