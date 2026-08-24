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
    coalesce(
      nullif(source.card_projection->>'hero_image_url', ''),
      nullif(source.package_json->>'hero_image_url', '')
    ) as hero_image
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
  future_departures.minimum_price as price,
  case
    when future_departures.minimum_price is not null
      then to_char(future_departures.minimum_price, 'FM999,999,999,999') || '원부터'
    else null
  end as price_display,
  normalized.hero_image,
  coalesce(normalized.card_projection->'badges', '[]'::jsonb) as badges,
  coalesce(future_departures.available_dates, '[]'::jsonb) as available_dates,
  case
    when normalized.package_json->>'consultation_only' = 'true'
      or normalized.package_json->>'booking_mode' = 'consultation_only'
      then 'consultation_only'
    when normalized.package_json->>'price_confirmation_required' = 'true'
      or coalesce(future_departures.request_only_count, 0) > 0
      then 'price_check'
    else 'inquiry'
  end as booking_mode,
  normalized.last_verified_at,
  normalized.snapshot_id,
  normalized.snapshot_hash,
  normalized.revision_id,
  normalized.pointer_version,
  normalized.snapshot_json || jsonb_build_object(
    'package_revision', normalized.package_revision,
    'card_projection', normalized.card_projection,
    'lp_projection', normalized.lp_projection,
    'route_text_dump', normalized.route_text_dump,
    'renderer_build_id', normalized.renderer_build_id
  ) as public_detail
from normalized
cross join lateral (
  select
    jsonb_agg(
      jsonb_build_object(
        'date', departure.departure_date::text,
        'price', case
          when departure.pricing_state = 'PRICED' then departure.adult_selling_price
          else null
        end,
        'confirmed', false,
        'bookingMode', case
          when departure.sale_state = 'request' then 'price_check'
          else 'inquiry'
        end
      ) order by departure.departure_date, departure.variant_key
    ) as available_dates,
    min(departure.adult_selling_price)
      filter (where departure.pricing_state = 'PRICED') as minimum_price,
    count(*) filter (where departure.pricing_state = 'REQUEST_ONLY'
      or departure.sale_state = 'request') as request_only_count
  from public.product_registration_customer_departure_fact_view departure
  where departure.product_id = normalized.catalog_product_id
    and departure.package_id = normalized.package_id
    and departure.revision_id = normalized.revision_id
    and departure.snapshot_id = normalized.snapshot_id
    and departure.departure_date >= (now() at time zone 'Asia/Seoul')::date
    and departure.sale_state in ('available', 'request')
    and departure.booking_state in ('AVAILABLE', 'MANUAL_CONFIRMATION_REQUIRED')
    and departure.inventory_state in ('AVAILABLE', 'ON_REQUEST')
    and (
      (
        departure.pricing_state = 'PRICED'
        and departure.adult_selling_price is not null
        and departure.adult_selling_price > 0
        and departure.currency = 'KRW'
      )
      or departure.pricing_state = 'REQUEST_ONLY'
    )
) future_departures
where normalized.title is not null
  and jsonb_array_length(coalesce(future_departures.available_dates, '[]'::jsonb)) > 0
  and (
    nullif(normalized.package_json->>'ticketing_deadline', '') is null
    or (
      internal_product_registration.try_iso_date(left(normalized.package_json->>'ticketing_deadline', 10))
      >= (now() at time zone 'Asia/Seoul')::date
    )
  )
  and coalesce(nullif(normalized.package_json->>'status', ''), 'active') = 'active'
  and normalized.package_json->>'marketing_eligible' = 'true'
  and normalized.hero_image is not null
  and normalized.hero_image ~* '^(https?:)?//|^/'
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
