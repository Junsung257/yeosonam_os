-- Product registration customer readiness V3.
--
-- Keeps source price meaning, raises the customer-copy threshold, and makes
-- documentary product media an explicit customer-publication requirement.

alter table internal_product_registration.departure_instances
  add column if not exists source_price_kind text,
  add column if not exists source_amount numeric(12,2),
  add column if not exists net_price numeric(12,2),
  add column if not exists margin_policy_version text,
  add column if not exists commission_rate_applied numeric(7,4),
  add column if not exists commission_fixed_amount_applied numeric(12,2);

alter table internal_product_registration.price_date_overrides
  add column if not exists source_price_kind text,
  add column if not exists source_amount numeric(12,2),
  add column if not exists net_price numeric(12,2),
  add column if not exists margin_policy_version text,
  add column if not exists commission_rate_applied numeric(7,4),
  add column if not exists commission_fixed_amount_applied numeric(12,2);

alter table internal_product_registration.departure_instances
  drop constraint if exists departure_instances_source_price_kind_check,
  drop constraint if exists departure_instances_source_price_contract_check,
  add constraint departure_instances_source_price_kind_check
    check (source_price_kind is null or source_price_kind in ('NET', 'SELLING', 'REQUEST_ONLY')),
  add constraint departure_instances_source_price_contract_check check (
    source_price_kind is null
    or (pricing_state = 'PRICED' and (
      (source_price_kind = 'NET' and source_amount is not null and net_price = source_amount and adult_selling_price is not null)
      or (source_price_kind = 'SELLING' and source_amount is not null and net_price is null and adult_selling_price = source_amount)
    ))
    or (pricing_state <> 'PRICED' and (
      source_price_kind is null
      or (source_price_kind = 'NET' and (net_price is null or net_price = source_amount))
      or (source_price_kind = 'SELLING' and net_price is null)
      or (source_price_kind = 'REQUEST_ONLY' and source_amount is null and net_price is null and adult_selling_price is null)
    ))
  );

alter table internal_product_registration.price_date_overrides
  drop constraint if exists price_date_overrides_source_price_kind_check,
  drop constraint if exists price_date_overrides_source_price_contract_check,
  add constraint price_date_overrides_source_price_kind_check
    check (source_price_kind is null or source_price_kind in ('NET', 'SELLING', 'REQUEST_ONLY')),
  add constraint price_date_overrides_source_price_contract_check check (
    source_price_kind is null
    or (pricing_state = 'PRICED' and (
      (source_price_kind = 'NET' and source_amount is not null and net_price = source_amount and adult_selling_price is not null)
      or (source_price_kind = 'SELLING' and source_amount is not null and net_price is null and adult_selling_price = source_amount)
    ))
    or (pricing_state <> 'PRICED' and (
      source_price_kind is null
      or (source_price_kind = 'NET' and (net_price is null or net_price = source_amount))
      or (source_price_kind = 'SELLING' and net_price is null)
      or (source_price_kind = 'REQUEST_ONLY' and source_amount is null and net_price is null and adult_selling_price is null)
    ))
  );

-- V6 facts are append-only. Price meaning therefore lives in a separate,
-- immutable 1:1 extension instead of being patched onto departure_instances
-- after the registration kernel has inserted it.
create table if not exists internal_product_registration.departure_price_lineage (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  catalog_product_id uuid not null
    references internal_product_registration.catalog_products(id) on delete cascade,
  revision_id uuid not null
    references public.product_registration_v5_revisions(id) on delete cascade,
  departure_instance_id uuid not null unique
    references internal_product_registration.departure_instances(id) on delete cascade,
  price_override_id uuid
    references internal_product_registration.price_date_overrides(id) on delete restrict,
  price_override_key text,
  adult_selling_price numeric(12,2),
  child_selling_price numeric(12,2),
  currency text not null default 'KRW' check (currency ~ '^[A-Z]{3}$'),
  pricing_state text not null
    check (pricing_state in ('PRICED', 'REQUEST_ONLY', 'CONFLICTING', 'MISSING', 'UNRESOLVED')),
  booking_state text not null
    check (booking_state in ('AVAILABLE', 'MANUAL_CONFIRMATION_REQUIRED', 'SALES_CLOSED', 'SOLD_OUT', 'CANCELLED', 'UNKNOWN')),
  inventory_state text not null
    check (inventory_state in ('AVAILABLE', 'ON_REQUEST', 'SOLD_OUT', 'CLOSED', 'UNKNOWN')),
  price_rule_id uuid references public.product_registration_v5_price_rules(id) on delete restrict,
  price_rule_hash text,
  source_ref_ids text[] not null default '{}',
  source_confidence numeric(5,4)
    check (source_confidence is null or (source_confidence >= 0 and source_confidence <= 1)),
  price_revision text,
  source_price_kind text
    check (source_price_kind is null or source_price_kind in ('NET', 'SELLING', 'REQUEST_ONLY')),
  source_amount numeric(12,2),
  net_price numeric(12,2),
  margin_policy_version text,
  commission_rate_applied numeric(7,4),
  commission_fixed_amount_applied numeric(12,2),
  source_hash text not null check (source_hash ~ '^[0-9a-f]{64}$'),
  revision_hash text not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  created_version text not null default 'product-registration-price-authority-v3',
  created_at timestamptz not null default now(),
  constraint departure_price_lineage_override_contract check (
    (price_override_key is null and price_override_id is null)
    or (price_override_key is not null and price_override_id is not null)
  ),
  constraint departure_price_lineage_source_contract check (
    (pricing_state = 'PRICED' and (
      (source_price_kind = 'NET'
        and source_amount is not null
        and net_price = source_amount
        and adult_selling_price is not null
        and adult_selling_price > 0
        and margin_policy_version is not null)
      or (source_price_kind = 'SELLING'
        and source_amount is not null
        and net_price is null
        and adult_selling_price = source_amount
        and adult_selling_price > 0)
    ))
    or (pricing_state = 'REQUEST_ONLY'
      and source_price_kind = 'REQUEST_ONLY'
      and source_amount is null
      and net_price is null
      and adult_selling_price is null
      and child_selling_price is null)
    or (pricing_state in ('CONFLICTING', 'MISSING', 'UNRESOLVED'))
  )
);

create index if not exists idx_pr_departure_price_lineage_revision
  on internal_product_registration.departure_price_lineage(revision_id, pricing_state);
create index if not exists idx_pr_departure_price_lineage_catalog
  on internal_product_registration.departure_price_lineage(catalog_product_id, revision_id);

alter table internal_product_registration.departure_price_lineage enable row level security;
revoke all on internal_product_registration.departure_price_lineage
  from public, anon, authenticated, service_role;
grant select on internal_product_registration.departure_price_lineage to service_role;

drop trigger if exists trg_pr_departure_price_lineage_immutable
  on internal_product_registration.departure_price_lineage;
create trigger trg_pr_departure_price_lineage_immutable
  before update or delete on internal_product_registration.departure_price_lineage
  for each row execute function internal_product_registration.reject_mutation();

create or replace function internal_product_registration.commit_revision_v62_customer_readiness_atomic(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_revision_id uuid;
  v_catalog_product_id uuid;
  v_row jsonb;
  v_source_price_kind text;
  v_pricing_state text;
  v_departure_instance_id uuid;
  v_price_override_id uuid;
  v_price_rule_id uuid;
begin
  v_result := internal_product_registration.commit_revision_v61_knowledge_atomic(p_payload);
  v_revision_id := nullif(v_result->>'revision_id', '')::uuid;
  v_catalog_product_id := nullif(v_result->>'catalog_product_id', '')::uuid;

  for v_row in
    select value from pg_catalog.jsonb_array_elements(coalesce(p_payload->'departure_instances', '[]'::jsonb))
  loop
    v_source_price_kind := nullif(v_row->>'source_price_kind', '');
    v_pricing_state := coalesce(nullif(v_row->>'pricing_state', ''), 'UNRESOLVED');
    if v_pricing_state = 'PRICED'
      and (v_source_price_kind is null or v_source_price_kind not in ('NET', 'SELLING')) then
      raise exception 'REGISTRATION_V62_SOURCE_PRICE_KIND_REQUIRED:%', v_row->>'departure_date';
    end if;
    if v_pricing_state = 'REQUEST_ONLY' and v_source_price_kind is distinct from 'REQUEST_ONLY' then
      raise exception 'REGISTRATION_V62_REQUEST_ONLY_LINEAGE_REQUIRED:%', v_row->>'departure_date';
    end if;
    if v_pricing_state = 'PRICED' and v_source_price_kind = 'NET'
      and (nullif(v_row->>'net_price', '') is null or nullif(v_row->>'margin_policy_version', '') is null) then
      raise exception 'REGISTRATION_V62_NET_LINEAGE_REQUIRED:%', v_row->>'departure_date';
    end if;
    if v_source_price_kind = 'SELLING' and nullif(v_row->>'net_price', '') is not null then
      raise exception 'REGISTRATION_V62_SYNTHETIC_NET_FORBIDDEN:%', v_row->>'departure_date';
    end if;
    if v_source_price_kind = 'REQUEST_ONLY' and (
      nullif(v_row->>'source_amount', '') is not null
      or nullif(v_row->>'net_price', '') is not null
      or nullif(v_row->>'adult_selling_price', '') is not null
      or nullif(v_row->>'child_selling_price', '') is not null
    ) then
      raise exception 'REGISTRATION_V62_REQUEST_ONLY_NUMERIC_PRICE_FORBIDDEN:%', v_row->>'departure_date';
    end if;

    select departure.id
    into strict v_departure_instance_id
    from internal_product_registration.departure_instances departure
    where departure.revision_id = v_revision_id
      and departure.catalog_product_id = v_catalog_product_id
      and departure.section_index = (v_row->>'section_index')::integer
      and departure.variant_key = v_row->>'variant_key'
      and departure.departure_date = (v_row->>'departure_date')::date;

    if not exists (
      select 1
      from internal_product_registration.departure_instances departure
      where departure.id = v_departure_instance_id
        and departure.source_hash = p_payload->>'source_hash'
        and departure.revision_hash = p_payload->>'payload_hash'
    ) then
      raise exception 'REGISTRATION_V62_DEPARTURE_LINEAGE_HASH_MISMATCH:%', v_row->>'departure_date';
    end if;

    v_price_override_id := null;
    if nullif(v_row->>'price_override_key', '') is not null then
      select price_override.id
      into strict v_price_override_id
      from internal_product_registration.price_date_overrides price_override
      where price_override.revision_id = v_revision_id
        and price_override.override_key = v_row->>'price_override_key'
        and price_override.departure_date = (v_row->>'departure_date')::date
        and price_override.variant_key = v_row->>'variant_key';
    end if;

    v_price_rule_id := null;
    if nullif(v_row->>'price_rule_hash', '') is not null then
      select price_rule.id
      into strict v_price_rule_id
      from public.product_registration_v5_price_rules price_rule
      where price_rule.revision_id = v_revision_id
        and price_rule.rule_hash = v_row->>'price_rule_hash';
    end if;

    insert into internal_product_registration.departure_price_lineage (
      tenant_id, catalog_product_id, revision_id, departure_instance_id,
      price_override_id, price_override_key, adult_selling_price,
      child_selling_price, currency, pricing_state, booking_state,
      inventory_state, price_rule_id, price_rule_hash, source_ref_ids,
      source_confidence, price_revision, source_price_kind, source_amount,
      net_price, margin_policy_version, commission_rate_applied,
      commission_fixed_amount_applied, source_hash, revision_hash
    ) values (
      nullif(p_payload->>'tenant_id', '')::uuid, v_catalog_product_id,
      v_revision_id, v_departure_instance_id, v_price_override_id,
      nullif(v_row->>'price_override_key', ''),
      nullif(v_row->>'adult_selling_price', '')::numeric,
      nullif(v_row->>'child_selling_price', '')::numeric,
      coalesce(nullif(v_row->>'currency', ''), 'KRW'), v_pricing_state,
      coalesce(nullif(v_row->>'booking_state', ''), 'UNKNOWN'),
      coalesce(nullif(v_row->>'inventory_state', ''), 'UNKNOWN'),
      v_price_rule_id, nullif(v_row->>'price_rule_hash', ''),
      coalesce(array(select pg_catalog.jsonb_array_elements_text(coalesce(v_row->'source_ref_ids', '[]'::jsonb))), '{}'::text[]),
      nullif(v_row->>'source_confidence', '')::numeric,
      nullif(v_row->>'price_revision', ''), v_source_price_kind,
      nullif(v_row->>'source_amount', '')::numeric,
      nullif(v_row->>'net_price', '')::numeric,
      nullif(v_row->>'margin_policy_version', ''),
      nullif(v_row->>'commission_rate_applied', '')::numeric,
      nullif(v_row->>'commission_fixed_amount_applied', '')::numeric,
      p_payload->>'source_hash', p_payload->>'payload_hash'
    ) on conflict (departure_instance_id) do nothing;

    if not exists (
      select 1
      from internal_product_registration.departure_price_lineage lineage
      where lineage.departure_instance_id = v_departure_instance_id
        and lineage.tenant_id = nullif(p_payload->>'tenant_id', '')::uuid
        and lineage.catalog_product_id = v_catalog_product_id
        and lineage.revision_id = v_revision_id
        and lineage.price_override_id is not distinct from v_price_override_id
        and lineage.price_override_key is not distinct from nullif(v_row->>'price_override_key', '')
        and lineage.adult_selling_price is not distinct from nullif(v_row->>'adult_selling_price', '')::numeric
        and lineage.child_selling_price is not distinct from nullif(v_row->>'child_selling_price', '')::numeric
        and lineage.currency = coalesce(nullif(v_row->>'currency', ''), 'KRW')
        and lineage.pricing_state = v_pricing_state
        and lineage.booking_state = coalesce(nullif(v_row->>'booking_state', ''), 'UNKNOWN')
        and lineage.inventory_state = coalesce(nullif(v_row->>'inventory_state', ''), 'UNKNOWN')
        and lineage.price_rule_id is not distinct from v_price_rule_id
        and lineage.price_rule_hash is not distinct from nullif(v_row->>'price_rule_hash', '')
        and lineage.source_ref_ids = coalesce(
          array(select pg_catalog.jsonb_array_elements_text(coalesce(v_row->'source_ref_ids', '[]'::jsonb))),
          '{}'::text[]
        )
        and lineage.source_confidence is not distinct from nullif(v_row->>'source_confidence', '')::numeric
        and lineage.price_revision is not distinct from nullif(v_row->>'price_revision', '')
        and lineage.source_price_kind is not distinct from v_source_price_kind
        and lineage.source_amount is not distinct from nullif(v_row->>'source_amount', '')::numeric
        and lineage.net_price is not distinct from nullif(v_row->>'net_price', '')::numeric
        and lineage.margin_policy_version is not distinct from nullif(v_row->>'margin_policy_version', '')
        and lineage.commission_rate_applied is not distinct from nullif(v_row->>'commission_rate_applied', '')::numeric
        and lineage.commission_fixed_amount_applied is not distinct from nullif(v_row->>'commission_fixed_amount_applied', '')::numeric
        and lineage.source_hash = p_payload->>'source_hash'
        and lineage.revision_hash = p_payload->>'payload_hash'
    ) then
      raise exception 'REGISTRATION_V62_PRICE_LINEAGE_IDEMPOTENCY_CONFLICT:%', v_row->>'departure_date';
    end if;
  end loop;

  return v_result || pg_catalog.jsonb_build_object(
    'price_authority_version', 'product-registration-price-authority-v3',
    'margin_policy_version', 'product-registration-margin-policy-v1'
  );
end;
$$;

revoke all on function internal_product_registration.commit_revision_v62_customer_readiness_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function internal_product_registration.commit_revision_v62_customer_readiness_atomic(jsonb)
  to service_role;

create or replace function public.commit_product_registration_revision_v62_atomic(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select internal_product_registration.commit_revision_v62_customer_readiness_atomic(p_payload);
$$;

revoke all on function public.commit_product_registration_revision_v62_atomic(jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_product_registration_revision_v62_atomic(jsonb)
  to service_role;

create or replace function public.get_product_registration_v6_cached_copy(
  p_revision_id uuid,
  p_locale text,
  p_copy_policy_version text,
  p_deterministic_facts_hash text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'copy_payload', copy.copy_payload,
    'copy_hash', copy.copy_hash,
    'copy_policy_version', copy.copy_policy_version,
    'deterministic_facts_hash', copy.deterministic_facts_hash,
    'generation_state', copy.generation_state,
    'quality_score', copy.quality_score,
    'model_id', copy.model_id,
    'prompt_hash', copy.prompt_hash,
    'revision_hash', copy.revision_hash,
    'source_hash', copy.source_hash
  )
  from internal_product_registration.copy_revisions copy
  where copy.product_revision_id = p_revision_id
    and copy.locale = p_locale
    and copy.copy_policy_version = p_copy_policy_version
    and copy.deterministic_facts_hash = p_deterministic_facts_hash
    and copy.validation_state = 'verified'
    and copy.quality_score >= 82
  order by copy.created_at desc
  limit 1;
$$;

create or replace function public.get_product_registration_v6_verified_copy(
  p_revision_id uuid,
  p_locale text default 'ko-KR'
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'copy_payload', copy.copy_payload,
    'copy_hash', copy.copy_hash,
    'copy_policy_version', copy.copy_policy_version,
    'deterministic_facts_hash', copy.deterministic_facts_hash,
    'generation_state', copy.generation_state,
    'quality_score', copy.quality_score,
    'model_id', copy.model_id,
    'prompt_hash', copy.prompt_hash,
    'revision_hash', copy.revision_hash,
    'source_hash', copy.source_hash
  )
  from internal_product_registration.copy_revisions copy
  where copy.product_revision_id = p_revision_id
    and copy.locale = p_locale
    and copy.validation_state = 'verified'
    and copy.copy_policy_version = 'product-registration-customer-copy-v3'
    and copy.quality_score >= 82
  order by copy.created_at desc
  limit 1;
$$;

revoke all on function public.get_product_registration_v6_cached_copy(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_product_registration_v6_verified_copy(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_product_registration_v6_cached_copy(uuid, text, text, text)
  to service_role;
grant execute on function public.get_product_registration_v6_verified_copy(uuid, text)
  to service_role;

-- Append the source-price lineage to the existing customer departure contract.
-- Existing column order is preserved so dependent readers remain compatible.
create or replace view public.product_registration_customer_departure_fact_view
with (security_invoker = true)
as
select
  fact.product_id,
  fact.package_id,
  fact.revision_id,
  fact.snapshot_id,
  fact.snapshot_hash,
  fact.browser_proofs,
  departure.id as departure_instance_id,
  departure.departure_date,
  departure.variant_key,
  lineage.adult_selling_price,
  lineage.child_selling_price,
  lineage.currency,
  lineage.pricing_state,
  lineage.booking_state,
  lineage.inventory_state,
  departure.sale_state,
  lineage.price_rule_hash,
  lineage.price_override_id,
  lineage.price_override_key,
  lineage.source_ref_ids,
  lineage.source_confidence,
  lineage.price_revision,
  departure.evidence,
  lineage.source_price_kind,
  lineage.source_amount,
  lineage.net_price,
  lineage.margin_policy_version,
  lineage.commission_rate_applied,
  lineage.commission_fixed_amount_applied
from public.product_registration_customer_fact_view fact
join internal_product_registration.departure_instances departure
  on departure.revision_id = fact.revision_id
 and departure.catalog_product_id = fact.product_id
join internal_product_registration.departure_price_lineage lineage
  on lineage.departure_instance_id = departure.id
 and lineage.revision_id = departure.revision_id
 and lineage.catalog_product_id = departure.catalog_product_id;

revoke all on public.product_registration_customer_departure_fact_view
  from public, anon, authenticated;
grant select on public.product_registration_customer_departure_fact_view
  to service_role;

-- Rebuild the exact public catalog with customer-content and documentary-media
-- readiness. The public view remains service-role only.
create or replace view public.public_catalog_view
with (security_invoker = true)
as
with source as (
  select
    fact.tenant_id,
    fact.product_id as catalog_product_id,
    fact.package_id,
    fact.revision_id,
    fact.snapshot_id,
    fact.snapshot_hash,
    fact.pointer_version,
    fact.card_projection,
    fact.lp_projection,
    fact.snapshot_json,
    snapshot.created_at as last_verified_at,
    snapshot.package_revision,
    snapshot.route_text_dump,
    snapshot.renderer_build_id,
    coalesce(fact.snapshot_json->'package', '{}'::jsonb) as package_json
  from public.product_registration_customer_fact_view fact
  join public.public_package_snapshots snapshot
    on snapshot.id = fact.snapshot_id
   and snapshot.snapshot_hash = fact.snapshot_hash
   and snapshot.status = 'published'
), normalized as (
  select
    source.*,
    coalesce(nullif(source.card_projection->>'title', ''), nullif(source.package_json->>'display_title', ''), nullif(source.package_json->>'title', '')) as title,
    coalesce(nullif(source.card_projection->>'destination', ''), nullif(source.package_json->>'destination', '')) as destination,
    case when jsonb_typeof(source.card_projection->'duration') = 'number' then (source.card_projection->>'duration')::integer
      when jsonb_typeof(source.package_json->'duration') = 'number' then (source.package_json->>'duration')::integer else null end as duration,
    case when jsonb_typeof(source.package_json->'nights') = 'number' then (source.package_json->>'nights')::integer else null end as nights,
    coalesce(nullif(source.card_projection->>'hero_image_url', ''), nullif(source.package_json->>'hero_image_url', '')) as hero_image,
    coalesce(source.package_json->'product_registration_copy', '{}'::jsonb) as customer_copy
  from source
)
select
  normalized.tenant_id,
  normalized.package_id as id,
  normalized.catalog_product_id,
  coalesce(nullif(normalized.package_json->>'slug', ''), normalized.package_id::text) as slug,
  coalesce(nullif(normalized.package_json->>'product_kind', ''), nullif(normalized.package_json->>'product_type', ''), 'package') as product_kind,
  normalized.title,
  normalized.destination,
  nullif(normalized.package_json->>'country', '') as country,
  nullif(normalized.package_json->>'departure_airport', '') as departure_airport,
  normalized.duration,
  normalized.nights,
  future_departures.minimum_price as price,
  case when future_departures.minimum_price is not null then to_char(future_departures.minimum_price, 'FM999,999,999,999') || '원부터' else null end as price_display,
  normalized.hero_image,
  coalesce(normalized.card_projection->'badges', '[]'::jsonb) as badges,
  coalesce(future_departures.available_dates, '[]'::jsonb) as available_dates,
  case when normalized.package_json->>'consultation_only' = 'true' or normalized.package_json->>'booking_mode' = 'consultation_only' then 'consultation_only'
    when normalized.package_json->>'price_confirmation_required' = 'true' or coalesce(future_departures.request_only_count, 0) > 0 then 'price_check'
    else 'inquiry' end as booking_mode,
  normalized.last_verified_at,
  normalized.snapshot_id,
  normalized.snapshot_hash,
  normalized.revision_id,
  normalized.pointer_version,
  normalized.snapshot_json || pg_catalog.jsonb_build_object(
    'package_revision', normalized.package_revision,
    'card_projection', normalized.card_projection,
    'lp_projection', normalized.lp_projection,
    'route_text_dump', normalized.route_text_dump,
    'renderer_build_id', normalized.renderer_build_id
  ) as public_detail,
  md5(normalized.snapshot_hash || ':' || normalized.pointer_version::text) as catalog_generation_id,
  case when normalized.package_json->>'minimum_departure_pax' ~ '^\d+$'
    then (normalized.package_json->>'minimum_departure_pax')::integer else null end as minimum_departure_pax,
  nullif(normalized.package_json->>'lodging_state', '') as lodging_state,
  case when normalized.package_json->>'shopping_count' ~ '^\d+$'
    then (normalized.package_json->>'shopping_count')::integer else null end as shopping_count,
  normalized.package_json->'mandatory_local_costs' as mandatory_local_costs,
  case when normalized.package_json->>'mandatory_local_cost_krw' ~ '^\d+(?:\.\d+)?$'
    then (normalized.package_json->>'mandatory_local_cost_krw')::numeric else null end as mandatory_local_cost_krw,
  nullif(normalized.customer_copy->>'itinerary_intensity', '') as itinerary_intensity,
  nullif(normalized.customer_copy->>'recommended_for', '') as companion_fit,
  case when normalized.customer_copy->>'quality_score' ~ '^\d+$'
    then (normalized.customer_copy->>'quality_score')::integer else null end as copy_quality_score,
  nullif(normalized.package_json->>'media_readiness_state', '') as media_readiness_state
from normalized
cross join lateral (
  select
    jsonb_agg(jsonb_build_object(
      'date', departure.departure_date::text,
      'price', case when departure.pricing_state = 'PRICED' then departure.adult_selling_price else null end,
      'confirmed', false,
      'bookingMode', case when departure.sale_state = 'request' then 'price_check' else 'inquiry' end
    ) order by departure.departure_date, departure.variant_key) as available_dates,
    min(departure.adult_selling_price) filter (where departure.pricing_state = 'PRICED') as minimum_price,
    count(*) filter (where departure.pricing_state = 'REQUEST_ONLY' or departure.sale_state = 'request') as request_only_count
  from public.product_registration_customer_departure_fact_view departure
  where departure.product_id = normalized.catalog_product_id
    and departure.package_id = normalized.package_id
    and departure.revision_id = normalized.revision_id
    and departure.snapshot_id = normalized.snapshot_id
    and departure.departure_date >= (now() at time zone 'Asia/Seoul')::date
    and departure.sale_state in ('available', 'request')
    and departure.booking_state in ('AVAILABLE', 'MANUAL_CONFIRMATION_REQUIRED')
    and departure.inventory_state in ('AVAILABLE', 'ON_REQUEST')
    and ((
      departure.pricing_state = 'PRICED'
      and departure.adult_selling_price > 0
      and departure.currency = 'KRW'
      and departure.source_price_kind in ('NET', 'SELLING')
      and departure.source_amount is not null
      and (
        (departure.source_price_kind = 'NET'
          and departure.net_price = departure.source_amount
          and departure.margin_policy_version is not null)
        or (departure.source_price_kind = 'SELLING' and departure.net_price is null)
      )
    ) or (
      departure.pricing_state = 'REQUEST_ONLY'
      and departure.source_price_kind = 'REQUEST_ONLY'
      and departure.source_amount is null
      and departure.net_price is null
      and departure.adult_selling_price is null
    ))
) future_departures
where normalized.title is not null
  and jsonb_array_length(coalesce(future_departures.available_dates, '[]'::jsonb)) > 0
  and (nullif(normalized.package_json->>'ticketing_deadline', '') is null
    or internal_product_registration.try_iso_date(left(normalized.package_json->>'ticketing_deadline', 10)) >= (now() at time zone 'Asia/Seoul')::date)
  and coalesce(nullif(normalized.package_json->>'status', ''), 'active') = 'active'
  and normalized.package_json->>'marketing_eligible' = 'true'
  and normalized.customer_copy->>'copy_policy_version' = 'product-registration-customer-copy-v3'
  and case when normalized.customer_copy->>'quality_score' ~ '^\d+$'
    then (normalized.customer_copy->>'quality_score')::integer else 0 end >= 82
  and normalized.package_json->>'media_readiness_state' = 'verified_documentary'
  and normalized.hero_image is not null
  and normalized.hero_image ~* '^(https?:)?//|^/'
  and normalized.hero_image !~* '(^|/)logo(?:[._/-]|$)'
  and not exists (
    select 1 from public.product_registration_v5_kill_switches kill_switch
    where kill_switch.tenant_id = normalized.tenant_id
      and kill_switch.active = true
      and (kill_switch.expires_at is null or kill_switch.expires_at > now())
      and (kill_switch.scope = 'global'
        or (kill_switch.scope = 'product' and kill_switch.scope_key in ('*', normalized.package_id::text, normalized.catalog_product_id::text))
        or (kill_switch.scope = 'supplier' and kill_switch.scope_key in ('*', coalesce(normalized.package_json->>'land_operator', ''))))
  );

revoke all on public.public_catalog_view from public, anon, authenticated;
grant select on public.public_catalog_view to service_role;

comment on view public.public_catalog_view is
  'Exact published customer catalog with V3 grounded-copy and documentary-media readiness.';

-- Extend the admin truth read model without changing the underlying state
-- authorities. These are readiness facts, not writable publication states.
create or replace view internal_product_registration.admin_package_customer_readiness_v3
with (security_invoker = true)
as
select
  truth.*,
  coalesce(departure.future_departure_count, 0) as future_departure_count,
  coalesce(departure.priced_departure_count, 0) as priced_departure_count,
  coalesce(departure.request_only_departure_count, 0) as request_only_departure_count,
  coalesce(departure.invalid_price_lineage_count, 0) as invalid_price_lineage_count,
  copy.copy_policy_version,
  copy.quality_score as copy_quality_score,
  coalesce(media.documentary_product_media_count, 0) as documentary_product_media_count,
  truth.actual_customer_public
    and coalesce(departure.future_departure_count, 0) > 0
    and coalesce(departure.invalid_price_lineage_count, 0) = 0
    and copy.copy_policy_version = 'product-registration-customer-copy-v3'
    and coalesce(copy.quality_score, 0) >= 82
    and coalesce(media.documentary_product_media_count, 0) > 0
    as actual_customer_catalog_public,
  array_remove(array[
    case when coalesce(departure.future_departure_count, 0) = 0
      then 'CUSTOMER_FUTURE_DEPARTURES_MISSING' end,
    case when coalesce(departure.invalid_price_lineage_count, 0) > 0
      then 'SOURCE_PRICE_LINEAGE_INVALID' end,
    case when copy.product_revision_id is null
      or copy.copy_policy_version is distinct from 'product-registration-customer-copy-v3'
      or coalesce(copy.quality_score, 0) < 82
      then 'GROUNDED_CUSTOMER_COPY_REQUIRED' end,
    case when coalesce(media.documentary_product_media_count, 0) = 0
      then 'DOCUMENTARY_PRODUCT_MEDIA_REQUIRED' end
  ]::text[], null) as customer_readiness_blocker_codes
from internal_product_registration.admin_package_publication_truth_v truth
left join lateral (
  select
    count(*) filter (
      where departure.departure_date >= (now() at time zone 'Asia/Seoul')::date
        and departure.sale_state in ('available', 'request')
    )::integer as future_departure_count,
    count(*) filter (
      where departure.departure_date >= (now() at time zone 'Asia/Seoul')::date
        and lineage.pricing_state = 'PRICED'
        and lineage.source_price_kind in ('NET', 'SELLING')
        and lineage.adult_selling_price > 0
    )::integer as priced_departure_count,
    count(*) filter (
      where departure.departure_date >= (now() at time zone 'Asia/Seoul')::date
        and lineage.pricing_state = 'REQUEST_ONLY'
    )::integer as request_only_departure_count,
    count(*) filter (
      where departure.departure_date >= (now() at time zone 'Asia/Seoul')::date
        and departure.sale_state in ('available', 'request')
        and (
          lineage.id is null
          or lineage.pricing_state not in ('PRICED', 'REQUEST_ONLY')
          or (lineage.pricing_state = 'PRICED' and (
            lineage.source_price_kind is null
            or lineage.source_price_kind not in ('NET', 'SELLING')
            or lineage.source_amount is null
            or lineage.adult_selling_price is null
            or lineage.adult_selling_price <= 0
            or (lineage.source_price_kind = 'NET' and (
              lineage.net_price is distinct from lineage.source_amount
              or lineage.margin_policy_version is null
            ))
            or (lineage.source_price_kind = 'SELLING' and (
              lineage.net_price is not null
              or lineage.adult_selling_price is distinct from lineage.source_amount
            ))
          ))
          or (lineage.pricing_state = 'REQUEST_ONLY' and (
            lineage.source_price_kind is distinct from 'REQUEST_ONLY'
            or lineage.source_amount is not null
            or lineage.net_price is not null
            or lineage.adult_selling_price is not null
            or lineage.child_selling_price is not null
          ))
        )
    )::integer as invalid_price_lineage_count
  from internal_product_registration.departure_instances departure
  left join internal_product_registration.departure_price_lineage lineage
    on lineage.departure_instance_id = departure.id
   and lineage.revision_id = departure.revision_id
  where departure.revision_id = truth.latest_revision_id
) departure on true
left join lateral (
  select copy_row.product_revision_id, copy_row.copy_policy_version, copy_row.quality_score
  from internal_product_registration.copy_revisions copy_row
  where copy_row.product_revision_id = truth.latest_revision_id
    and copy_row.locale = 'ko-KR'
  order by copy_row.created_at desc
  limit 1
) copy on true
left join lateral (
  select count(*)::integer as documentary_product_media_count
  from internal_product_registration.media_revision_links media_link
  join internal_product_registration.media_assets media_asset
    on media_asset.id = media_link.media_asset_id
   and media_asset.tenant_id = media_link.tenant_id
  where media_link.product_revision_id = truth.latest_revision_id
    and media_asset.provenance_type in ('supplier_product', 'operator_product')
    and media_asset.rights_status in ('verified', 'attribution_required')
    and media_asset.reference_only = false
    and media_asset.content_safety_state = 'safe'
    and media_asset.relevance_state = 'verified'
) media on true;

revoke all on internal_product_registration.admin_package_customer_readiness_v3
  from public, anon, authenticated;
grant select on internal_product_registration.admin_package_customer_readiness_v3
  to service_role;

create or replace function public.get_product_registration_admin_publication_truth(
  p_tenant_id uuid,
  p_catalog_product_id uuid default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(truth) order by truth.product_key), '[]'::jsonb)
  from (
    select *
    from internal_product_registration.admin_package_customer_readiness_v3 view_row
    where view_row.tenant_id = p_tenant_id
      and (p_catalog_product_id is null or view_row.catalog_product_id = p_catalog_product_id)
    order by view_row.product_key
    limit least(greatest(p_limit, 1), 200)
    offset greatest(p_offset, 0)
  ) truth;
$$;

revoke all on function public.get_product_registration_admin_publication_truth(uuid, uuid, integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_product_registration_admin_publication_truth(uuid, uuid, integer, integer)
  to service_role;

comment on view internal_product_registration.admin_package_customer_readiness_v3 is
  'Read-only admin projection for price lineage, grounded copy, documentary media, proof and exact customer publication truth.';
