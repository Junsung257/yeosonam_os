-- Customer catalog SSOT.
--
-- This view deliberately projects only exact, currently published snapshots
-- that already passed the Registration Kernel pointer/proof/availability gate.
-- Customer routes must not rebuild eligibility from compatibility tables.

create or replace function internal_product_registration.try_iso_date(p_value text)
returns date
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
begin
  if p_value is null or p_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p_value::date;
exception when others then
  return null;
end;
$$;

revoke all on function internal_product_registration.try_iso_date(text)
  from public, anon, authenticated;
grant execute on function internal_product_registration.try_iso_date(text)
  to service_role;

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
    coalesce(fact.snapshot_json->'package', '{}'::jsonb) as package_json
  from public.product_registration_customer_fact_view fact
  join public.public_package_snapshots snapshot
    on snapshot.id = fact.snapshot_id
   and snapshot.snapshot_hash = fact.snapshot_hash
   and snapshot.status = 'published'
), normalized as (
  select
    source.*,
    coalesce(
      nullif(source.card_projection->>'title', ''),
      nullif(source.package_json->>'display_title', ''),
      nullif(source.package_json->>'title', '')
    ) as title,
    coalesce(
      nullif(source.card_projection->>'destination', ''),
      nullif(source.package_json->>'destination', '')
    ) as destination,
    case
      when jsonb_typeof(source.card_projection->'duration') = 'number'
        then (source.card_projection->>'duration')::integer
      when jsonb_typeof(source.package_json->'duration') = 'number'
        then (source.package_json->>'duration')::integer
      else null
    end as duration,
    case
      when jsonb_typeof(source.package_json->'nights') = 'number'
        then (source.package_json->>'nights')::integer
      else null
    end as nights,
    case
      when jsonb_typeof(source.card_projection->'price') = 'number'
        then (source.card_projection->>'price')::numeric
      when jsonb_typeof(source.package_json->'price') = 'number'
        then (source.package_json->>'price')::numeric
      else null
    end as price,
    coalesce(source.package_json->'price_dates', '[]'::jsonb) as raw_price_dates
  from source
)
select
  normalized.tenant_id,
  normalized.package_id as id,
  normalized.catalog_product_id,
  coalesce(
    nullif(normalized.package_json->>'slug', ''),
    normalized.package_id::text
  ) as slug,
  coalesce(
    nullif(normalized.package_json->>'product_kind', ''),
    nullif(normalized.package_json->>'product_type', ''),
    'package'
  ) as product_kind,
  normalized.title,
  normalized.destination,
  nullif(normalized.package_json->>'country', '') as country,
  nullif(normalized.package_json->>'departure_airport', '') as departure_airport,
  normalized.duration,
  normalized.nights,
  normalized.price,
  coalesce(
    nullif(normalized.card_projection->>'price_display', ''),
    nullif(normalized.snapshot_json->>'price_display', '')
  ) as price_display,
  coalesce(
    nullif(normalized.card_projection->>'hero_image_url', ''),
    nullif(normalized.package_json->>'hero_image_url', '')
  ) as hero_image,
  coalesce(normalized.card_projection->'badges', '[]'::jsonb) as badges,
  coalesce(future_dates.available_dates, '[]'::jsonb) as available_dates,
  case
    when normalized.package_json->>'consultation_only' = 'true'
      or normalized.package_json->>'booking_mode' = 'consultation_only'
      then 'consultation_only'
    when normalized.package_json->>'price_confirmation_required' = 'true'
      then 'price_check'
    else 'inquiry'
  end as booking_mode,
  normalized.last_verified_at,
  normalized.snapshot_id,
  normalized.snapshot_hash,
  normalized.revision_id,
  normalized.pointer_version,
  normalized.snapshot_json as public_detail
from normalized
cross join lateral (
  select jsonb_agg(item order by item->>'date') as available_dates
  from jsonb_array_elements(
    case
      when jsonb_typeof(normalized.raw_price_dates) = 'array'
        then normalized.raw_price_dates
      else '[]'::jsonb
    end
  ) item
  where internal_product_registration.try_iso_date(item->>'date')
    >= (now() at time zone 'Asia/Seoul')::date
) future_dates
where normalized.title is not null
  and (
    jsonb_array_length(coalesce(future_dates.available_dates, '[]'::jsonb)) > 0
    or normalized.package_json->>'booking_mode' = 'consultation_only'
    or normalized.package_json->>'consultation_only' = 'true'
  )
  and (
    nullif(normalized.package_json->>'ticketing_deadline', '') is null
    or (
      internal_product_registration.try_iso_date(left(normalized.package_json->>'ticketing_deadline', 10))
      >= (now() at time zone 'Asia/Seoul')::date
    )
  )
  and coalesce(nullif(normalized.package_json->>'status', ''), 'active') = 'active'
  and normalized.package_json->>'marketing_eligible' = 'true'
  and coalesce(
    nullif(normalized.card_projection->>'hero_image_url', ''),
    nullif(normalized.package_json->>'hero_image_url', '')
  ) is not null
  and not exists (
    select 1
    from public.product_registration_v5_kill_switches kill_switch
    where kill_switch.tenant_id = normalized.tenant_id
      and kill_switch.active = true
      and (kill_switch.expires_at is null or kill_switch.expires_at > now())
      and (
        kill_switch.scope = 'global'
        or (
          kill_switch.scope = 'product'
          and kill_switch.scope_key in (
            '*',
            normalized.package_id::text,
            normalized.catalog_product_id::text
          )
        )
        or (
          kill_switch.scope = 'supplier'
          and kill_switch.scope_key in (
            '*',
            coalesce(normalized.package_json->>'land_operator', '')
          )
        )
      )
  );

revoke all on public.public_catalog_view from public, anon, authenticated;
grant select on public.public_catalog_view to service_role;

comment on view public.public_catalog_view is
  'Exact published customer catalog. Source for home, listing, detail, destinations, sitemap, search, recommendations, content links and customer AI.';
