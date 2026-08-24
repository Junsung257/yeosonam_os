-- Product Registration V6.1 knowledge ledger.
--
-- The immutable source and revision remain the authority. This migration adds
-- typed departure facts, canonical entity relations, supplier/product overlays,
-- and service-role-only read models for Jarvis, blog, and comparison surfaces.
-- It never inserts or promotes a canonical attraction automatically.

create schema if not exists internal_product_registration;
revoke all on schema internal_product_registration from public, anon, authenticated;
grant usage on schema internal_product_registration to service_role;

alter table internal_product_registration.departure_instances
  add column if not exists adult_selling_price numeric(12,2),
  add column if not exists child_selling_price numeric(12,2),
  add column if not exists currency text not null default 'KRW',
  add column if not exists pricing_state text not null default 'UNRESOLVED',
  add column if not exists booking_state text not null default 'UNKNOWN',
  add column if not exists inventory_state text not null default 'UNKNOWN',
  add column if not exists price_rule_id uuid,
  add column if not exists price_rule_hash text,
  add column if not exists price_override_id uuid,
  add column if not exists price_override_key text,
  add column if not exists source_ref_ids text[] not null default '{}',
  add column if not exists source_confidence numeric(5,4),
  add column if not exists price_revision text;

alter table internal_product_registration.departure_instances
  drop constraint if exists departure_instances_currency_check,
  drop constraint if exists departure_instances_pricing_state_check,
  drop constraint if exists departure_instances_booking_state_check,
  drop constraint if exists departure_instances_inventory_state_check,
  drop constraint if exists departure_instances_source_confidence_check;

alter table internal_product_registration.departure_instances
  add constraint departure_instances_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  add constraint departure_instances_pricing_state_check
    check (pricing_state in ('PRICED', 'REQUEST_ONLY', 'CONFLICTING', 'MISSING', 'UNRESOLVED')),
  add constraint departure_instances_booking_state_check
    check (booking_state in ('AVAILABLE', 'MANUAL_CONFIRMATION_REQUIRED', 'SALES_CLOSED', 'SOLD_OUT', 'CANCELLED', 'UNKNOWN')),
  add constraint departure_instances_inventory_state_check
    check (inventory_state in ('AVAILABLE', 'ON_REQUEST', 'SOLD_OUT', 'CLOSED', 'UNKNOWN')),
  add constraint departure_instances_source_confidence_check
    check (source_confidence is null or (source_confidence >= 0 and source_confidence <= 1));

create table if not exists internal_product_registration.price_date_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  catalog_product_id uuid,
  revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  section_index integer not null check (section_index >= 0),
  variant_key text not null,
  departure_date date not null,
  override_key text not null,
  raw_amount text,
  adult_selling_price numeric(12,2),
  child_selling_price numeric(12,2),
  currency text not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  pricing_state text not null check (pricing_state in ('PRICED', 'REQUEST_ONLY', 'CONFLICTING', 'MISSING', 'UNRESOLVED')),
  booking_state text not null check (booking_state in ('AVAILABLE', 'MANUAL_CONFIRMATION_REQUIRED', 'SALES_CLOSED', 'SOLD_OUT', 'CANCELLED', 'UNKNOWN')),
  source_field_path text not null,
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  source_ref_ids text[] not null default '{}',
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  created_version text not null default 'product-registration-v61-knowledge-1',
  created_at timestamptz not null default now(),
  unique (revision_id, override_key)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'departure_instances_price_override_fk'
      and conrelid = 'internal_product_registration.departure_instances'::regclass
  ) then
    alter table internal_product_registration.departure_instances
      add constraint departure_instances_price_override_fk
      foreign key (price_override_id) references internal_product_registration.price_date_overrides(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'departure_instances_price_rule_fk'
      and conrelid = 'internal_product_registration.departure_instances'::regclass
  ) then
    alter table internal_product_registration.departure_instances
      add constraint departure_instances_price_rule_fk
      foreign key (price_rule_id) references public.product_registration_v5_price_rules(id) on delete restrict;
  end if;
end;
$$;

create index if not exists idx_pr_v61_departure_fact_lookup
  on internal_product_registration.departure_instances(catalog_product_id, departure_date, pricing_state, booking_state);
create index if not exists idx_pr_v61_departure_revision_fact
  on internal_product_registration.departure_instances(revision_id, variant_key, departure_date);
create index if not exists idx_pr_v61_departure_price_rule
  on internal_product_registration.departure_instances(price_rule_id);

-- Entity master is deliberately separate from the existing attractions SSOT.
-- A compiler may create relation candidates, but only approved admin data may
-- populate canonical_attraction_id or a published catalog_entity revision.
create table if not exists internal_product_registration.catalog_entities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  entity_type text not null check (entity_type in ('lodging', 'golf_course', 'airline', 'airport', 'property_complex')),
  canonical_name text not null,
  normalized_name text not null,
  country text,
  region text,
  address text,
  verification_state text not null default 'candidate'
    check (verification_state in ('candidate', 'approved', 'blocked')),
  created_at timestamptz not null default now(),
  unique (tenant_id, entity_type, normalized_name)
);

create table if not exists internal_product_registration.catalog_entity_revisions (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references internal_product_registration.catalog_entities(id) on delete restrict,
  revision_no integer not null check (revision_no > 0),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'candidate' check (status in ('candidate', 'verified', 'blocked')),
  created_at timestamptz not null default now(),
  unique (entity_id, revision_no)
);

create table if not exists internal_product_registration.catalog_entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references internal_product_registration.catalog_entities(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  approval_state text not null default 'candidate'
    check (approval_state in ('candidate', 'approved', 'rejected')),
  approved_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (entity_id, normalized_alias)
);

create table if not exists internal_product_registration.product_entity_relations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  catalog_product_id uuid,
  product_revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  entity_type text not null check (entity_type in ('lodging', 'golf_course', 'airline', 'airport', 'attraction', 'property_complex')),
  role text not null,
  source_mention text not null,
  source_field_path text not null,
  canonical_entity_id uuid references internal_product_registration.catalog_entities(id) on delete restrict,
  entity_revision_id uuid references internal_product_registration.catalog_entity_revisions(id) on delete restrict,
  canonical_attraction_id uuid references public.attractions(id) on delete restrict,
  approved_alias_id bigint references public.attractions_aliases(id) on delete restrict,
  match_state text not null default 'REVIEW_REQUIRED'
    check (match_state in ('APPROVED', 'REVIEW_REQUIRED', 'NOT_FOUND', 'CONFLICTING')),
  match_method text not null default 'UNRESOLVED'
    check (match_method in ('EXACT_NORMALIZED', 'APPROVED_ALIAS', 'MANUAL', 'FUZZY_CANDIDATE', 'UNRESOLVED')),
  day_indexes integer[] not null default '{}',
  candidates jsonb not null default '[]'::jsonb check (jsonb_typeof(candidates) = 'array'),
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (product_revision_id, entity_type, source_field_path, source_mention)
);

create index if not exists idx_pr_v61_entity_relation_review
  on internal_product_registration.product_entity_relations(match_state, entity_type, created_at desc);
create index if not exists idx_pr_v61_entity_relation_revision
  on internal_product_registration.product_entity_relations(product_revision_id, entity_type);

create table if not exists internal_product_registration.supplier_overlays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  supplier_key text not null,
  overlay_type text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'candidate' check (status in ('candidate', 'verified', 'blocked')),
  created_at timestamptz not null default now(),
  unique (tenant_id, supplier_key, overlay_type, source_hash)
);

create table if not exists internal_product_registration.product_revision_overlays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  product_revision_id uuid not null references public.product_registration_v5_revisions(id) on delete cascade,
  overlay_type text not null,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (product_revision_id, overlay_type, source_hash)
);

-- Read models are public-schema views with service_role-only grants. They use
-- the current publication pointer and immutable snapshot; travel_packages is
-- not an authority input. Under-review overlays are excluded before facts join.
create or replace view public.product_registration_customer_fact_view
with (security_invoker = true)
as
select
  p.tenant_id,
  p.catalog_product_id as product_id,
  p.package_id,
  p.current_revision_id as revision_id,
  p.current_snapshot_id as snapshot_id,
  s.snapshot_hash,
  s.card_projection,
  s.lp_projection,
  s.snapshot_json,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'proof_id', proof.id,
      'route', proof.route,
      'status', proof.status,
      'snapshot_hash', proof.snapshot_hash,
      'renderer_build_id', proof.renderer_build_id,
      'viewport', proof.viewport,
      'screenshot_hash', proof.screenshot_hash,
      'checked_at', proof.checked_at
    ) order by proof.route)
    from public.product_registration_v5_proof_runs proof
    where proof.revision_id = p.current_revision_id
      and proof.public_snapshot_id = p.current_snapshot_id
      and proof.snapshot_hash = s.snapshot_hash
      and proof.status = 'passed'
  ), '[]'::jsonb) as browser_proofs,
  p.pointer_version
from public.product_registration_v5_publication_pointers p
join public.public_package_snapshots s
  on s.id = p.current_snapshot_id
 and s.catalog_product_id = p.catalog_product_id
 and s.canonical_revision_id = p.current_revision_id
left join internal_product_registration.package_availability_overlays overlay
  on overlay.tenant_id = p.tenant_id
 and overlay.catalog_product_id = p.catalog_product_id
 and overlay.channel = p.channel
where p.channel = 'customer'
  and p.locale = 'ko-KR'
  and p.state = 'published'
  and exists (
    select 1 from public.product_registration_v5_proof_runs proof_gate
    where proof_gate.revision_id = p.current_revision_id
      and proof_gate.public_snapshot_id = p.current_snapshot_id
      and proof_gate.snapshot_hash = s.snapshot_hash
      and proof_gate.status = 'passed'
  )
  and coalesce(overlay.customer_visibility_state, 'public') = 'public'
  and (overlay.expires_at is null or overlay.expires_at > now());

create or replace view public.product_registration_customer_departure_fact_view
with (security_invoker = true)
as
select
  f.product_id,
  f.package_id,
  f.revision_id,
  f.snapshot_id,
  f.snapshot_hash,
  f.browser_proofs,
  d.id as departure_instance_id,
  d.departure_date,
  d.variant_key,
  d.adult_selling_price,
  d.child_selling_price,
  d.currency,
  d.pricing_state,
  d.booking_state,
  d.inventory_state,
  d.sale_state,
  d.price_rule_hash,
  d.price_override_id,
  d.price_override_key,
  d.source_ref_ids,
  d.source_confidence,
  d.price_revision,
  d.evidence
from public.product_registration_customer_fact_view f
join internal_product_registration.departure_instances d
  on d.revision_id = f.revision_id
 and d.catalog_product_id = f.product_id;

create or replace view public.product_registration_jarvis_fact_view
with (security_invoker = true)
as
select
  f.product_id,
  f.package_id,
  f.revision_id,
  f.snapshot_id,
  f.snapshot_hash,
  f.pointer_version,
  f.browser_proofs,
  f.card_projection,
  f.lp_projection,
  coalesce((
    select jsonb_agg(to_jsonb(d) order by d.departure_date)
    from public.product_registration_customer_departure_fact_view d
    where d.product_id = f.product_id and d.revision_id = f.revision_id
  ), '[]'::jsonb) as departure_instances,
  coalesce((
    select jsonb_agg(to_jsonb(r) order by r.entity_type, r.source_mention)
    from internal_product_registration.product_entity_relations r
    where r.product_revision_id = f.revision_id
  ), '[]'::jsonb) as entity_relations
from public.product_registration_customer_fact_view f;

create or replace view public.product_registration_blog_content_fact_view
with (security_invoker = true)
as
select
  j.product_id,
  j.package_id,
  j.revision_id as source_revision_id,
  j.snapshot_id,
  j.snapshot_hash,
  j.card_projection,
  j.lp_projection,
  j.departure_instances,
  j.entity_relations,
  now() as as_of_date,
  now() + interval '24 hours' as refresh_required_at
from public.product_registration_jarvis_fact_view j;

create or replace view public.product_registration_comparison_fact_view
with (security_invoker = true)
as
select
  j.product_id,
  j.package_id,
  j.revision_id,
  j.snapshot_id,
  j.snapshot_hash,
  j.card_projection,
  j.lp_projection,
  j.departure_instances,
  j.entity_relations
from public.product_registration_jarvis_fact_view j;

revoke all on public.product_registration_customer_fact_view from public, anon, authenticated;
revoke all on public.product_registration_customer_departure_fact_view from public, anon, authenticated;
revoke all on public.product_registration_jarvis_fact_view from public, anon, authenticated;
revoke all on public.product_registration_blog_content_fact_view from public, anon, authenticated;
revoke all on public.product_registration_comparison_fact_view from public, anon, authenticated;
grant select on public.product_registration_customer_fact_view to service_role;
grant select on public.product_registration_customer_departure_fact_view to service_role;
grant select on public.product_registration_jarvis_fact_view to service_role;
grant select on public.product_registration_blog_content_fact_view to service_role;
grant select on public.product_registration_comparison_fact_view to service_role;

comment on view public.product_registration_jarvis_fact_view is
  'V6.1 Jarvis authority read model. It is pointer/snapshot/departure/entity bound and never reads legacy product projections.';
comment on view public.product_registration_blog_content_fact_view is
  'V6.1 verified blog content fact view. It excludes supplier raw, net cost, drafts, and proofless products.';
comment on view public.product_registration_comparison_fact_view is
  'V6.1 comparison read model. Compare published departure facts and verified entity relations, not title/minimum legacy price alone.';

-- The V6 convergence function remains the compatibility-compatible kernel. This
-- wrapper extends the same transaction with typed price facts and exact-date
-- overrides. It deliberately performs no correction: malformed source amounts
-- remain CONFLICTING and therefore cannot become customer-visible.
create or replace function internal_product_registration.commit_revision_v61_knowledge_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_result jsonb;
  v_revision_id uuid;
  v_tenant_id uuid := nullif(p_payload->>'tenant_id', '')::uuid;
  v_catalog_product_id uuid;
  v_revision_hash text := p_payload->>'payload_hash';
  v_source_hash text := p_payload->>'source_hash';
  v_row jsonb;
  v_override_id uuid;
  v_override_key text;
begin
  perform set_config('app.product_registration_writer', 'registration-kernel', true);
  v_result := internal_product_registration.commit_revision_atomic(p_payload);
  v_revision_id := nullif(v_result->>'revision_id', '')::uuid;
  v_catalog_product_id := nullif(v_result->>'catalog_product_id', '')::uuid;
  if v_revision_id is null or v_catalog_product_id is null then
    raise exception 'REGISTRATION_V61_REVISION_RESULT_INVALID';
  end if;
  if coalesce(v_source_hash, '') !~ '^[0-9a-f]{64}$'
    or coalesce(v_revision_hash, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'REGISTRATION_V61_LINEAGE_HASH_INVALID';
  end if;

  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'departure_instances', '[]'::jsonb)) loop
    v_override_id := null;
    v_override_key := nullif(v_row->>'price_override_key', '');
    if v_override_key is not null then
      insert into internal_product_registration.price_date_overrides (
        tenant_id, catalog_product_id, revision_id, section_index, variant_key,
        departure_date, override_key, raw_amount, adult_selling_price,
        child_selling_price, currency, pricing_state, booking_state,
        source_field_path, source_hash, revision_hash, source_ref_ids, evidence
      ) values (
        v_tenant_id, v_catalog_product_id, v_revision_id,
        (v_row->>'section_index')::integer, v_row->>'variant_key',
        (v_row->>'departure_date')::date, v_override_key,
        nullif(v_row->>'raw_amount', ''), nullif(v_row->>'adult_selling_price', '')::numeric,
        nullif(v_row->>'child_selling_price', '')::numeric,
        coalesce(nullif(v_row->>'currency', ''), 'KRW'),
        coalesce(nullif(v_row->>'pricing_state', ''), 'UNRESOLVED'),
        coalesce(nullif(v_row->>'booking_state', ''), 'UNKNOWN'),
        coalesce(nullif(v_row->>'source_field_path', ''), v_override_key),
        v_source_hash, v_revision_hash,
        coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'source_ref_ids', '[]'::jsonb))), '{}'::text[]),
        coalesce(v_row->'evidence', '[]'::jsonb)
      )
      on conflict (revision_id, override_key) do update set
        raw_amount = excluded.raw_amount,
        adult_selling_price = excluded.adult_selling_price,
        child_selling_price = excluded.child_selling_price,
        currency = excluded.currency,
        pricing_state = excluded.pricing_state,
        booking_state = excluded.booking_state,
        source_field_path = excluded.source_field_path,
        source_ref_ids = excluded.source_ref_ids,
        evidence = excluded.evidence
      returning id into v_override_id;
      if v_override_id is null then
        select id into v_override_id
        from internal_product_registration.price_date_overrides
        where revision_id = v_revision_id and override_key = v_override_key;
      end if;
    end if;

    update internal_product_registration.departure_instances
    set adult_selling_price = nullif(v_row->>'adult_selling_price', '')::numeric,
        child_selling_price = nullif(v_row->>'child_selling_price', '')::numeric,
        currency = coalesce(nullif(v_row->>'currency', ''), 'KRW'),
        pricing_state = coalesce(nullif(v_row->>'pricing_state', ''), 'UNRESOLVED'),
        booking_state = coalesce(nullif(v_row->>'booking_state', ''), 'UNKNOWN'),
        inventory_state = coalesce(nullif(v_row->>'inventory_state', ''), 'UNKNOWN'),
        price_rule_id = (
          select id from public.product_registration_v5_price_rules
          where revision_id = v_revision_id
            and rule_hash = nullif(v_row->>'price_rule_hash', '')
          limit 1
        ),
        price_rule_hash = nullif(v_row->>'price_rule_hash', ''),
        price_override_id = v_override_id,
        price_override_key = v_override_key,
        source_ref_ids = coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'source_ref_ids', '[]'::jsonb))), '{}'::text[]),
        source_confidence = nullif(v_row->>'source_confidence', '')::numeric,
        price_revision = nullif(v_row->>'price_revision', '')
    where revision_id = v_revision_id
      and catalog_product_id = v_catalog_product_id
      and section_index = (v_row->>'section_index')::integer
      and variant_key = v_row->>'variant_key'
      and departure_date = (v_row->>'departure_date')::date;
    if not found then
      raise exception 'REGISTRATION_V61_DEPARTURE_FACT_MISSING:%', v_row->>'departure_date';
    end if;
  end loop;

  -- Relation candidates are compiler artifacts. Exact/approved matches may
  -- carry an existing canonical ID; fuzzy candidates remain review-only.
  for v_row in select value from jsonb_array_elements(coalesce(p_payload->'entity_relations', '[]'::jsonb)) loop
    insert into internal_product_registration.product_entity_relations (
      tenant_id, catalog_product_id, product_revision_id, entity_type, role,
      source_mention, source_field_path, canonical_entity_id, entity_revision_id,
      canonical_attraction_id, approved_alias_id, match_state, match_method,
      day_indexes, candidates, evidence, source_hash
    ) values (
      v_tenant_id, v_catalog_product_id, v_revision_id,
      v_row->>'entity_type', coalesce(nullif(v_row->>'role', ''), 'UNSPECIFIED'),
      v_row->>'source_mention', v_row->>'source_field_path',
      nullif(v_row->>'canonical_entity_id', '')::uuid,
      nullif(v_row->>'entity_revision_id', '')::uuid,
      nullif(v_row->>'canonical_attraction_id', '')::uuid,
      nullif(v_row->>'approved_alias_id', '')::bigint,
      coalesce(nullif(v_row->>'match_state', ''), 'REVIEW_REQUIRED'),
      coalesce(nullif(v_row->>'match_method', ''), 'UNRESOLVED'),
      coalesce(array(select jsonb_array_elements_text(coalesce(v_row->'day_indexes', '[]'::jsonb))), '{}'::integer[]),
      coalesce(v_row->'candidates', '[]'::jsonb),
      coalesce(v_row->'evidence', '[]'::jsonb),
      coalesce(nullif(v_row->>'source_hash', ''), v_source_hash)
    ) on conflict (product_revision_id, entity_type, source_field_path, source_mention) do update set
      canonical_entity_id = excluded.canonical_entity_id,
      entity_revision_id = excluded.entity_revision_id,
      canonical_attraction_id = excluded.canonical_attraction_id,
      approved_alias_id = excluded.approved_alias_id,
      match_state = excluded.match_state,
      match_method = excluded.match_method,
      day_indexes = excluded.day_indexes,
      candidates = excluded.candidates,
      evidence = excluded.evidence;
  end loop;
  return v_result || jsonb_build_object('knowledge_ledger_version', 'product-registration-v61-knowledge-1');
end;
$$;

create or replace function public.commit_product_registration_revision_v61_atomic(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
  select internal_product_registration.commit_revision_v61_knowledge_atomic(p_payload);
$$;

revoke all on function internal_product_registration.commit_revision_v61_knowledge_atomic(jsonb) from public, anon, authenticated;
revoke all on function public.commit_product_registration_revision_v61_atomic(jsonb) from public, anon, authenticated;
grant execute on function internal_product_registration.commit_revision_v61_knowledge_atomic(jsonb) to service_role;
grant execute on function public.commit_product_registration_revision_v61_atomic(jsonb) to service_role;
