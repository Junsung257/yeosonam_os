-- Bootstrap only legacy flight facts whose date, route, flight number and
-- both local times are explicitly present in the saved source text. Products
-- from the same source file share one source_family and therefore cannot
-- falsely satisfy the independent-two-source rule by duplication.

create or replace function internal_product_registration.seed_verified_legacy_transport_observations(
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, internal_product_registration, extensions, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
  perform set_config('app.product_registration_writer', 'registration-kernel', true);

  with source_rows as (
    select
      p.tenant_id,
      p.catalog_product_id,
      p.internal_code,
      p.source_filename,
      p.departure_date::date as departure_date,
      upper(p.flight_info->>'flight_no') as service_number,
      upper((regexp_match(upper(p.internal_code), '^([A-Z]{3})-[A-Z]+-([A-Z]{3})-'))[1]) as departure_airport,
      upper((regexp_match(upper(p.internal_code), '^([A-Z]{3})-[A-Z]+-([A-Z]{3})-'))[2]) as arrival_airport,
      p.flight_info->>'depart' as departure_local_time,
      p.flight_info->>'arrive' as arrival_local_time,
      coalesce(p.updated_at, p.created_at, now()) as observed_at,
      encode(extensions.digest(convert_to(coalesce(p.raw_extracted_text, ''), 'UTF8'), 'sha256'), 'hex') as source_hash,
      'verified-product-source:' || substr(encode(extensions.digest(convert_to(
        coalesce(p.source_filename, '') || E'\n' || coalesce(p.raw_extracted_text, ''),
        'UTF8'
      ), 'sha256'), 'hex'), 1, 32) as source_family
    from public.products p
    where p.tenant_id is not null
      and p.catalog_product_id is not null
      and p.departure_date is not null
      and jsonb_typeof(p.flight_info) = 'object'
      and upper(coalesce(p.internal_code, '')) ~ '^[A-Z]{3}-[A-Z]+-[A-Z]{3}-'
      and upper(coalesce(p.flight_info->>'flight_no', '')) ~ '^[A-Z0-9]{2,3}[0-9]{1,4}[A-Z]?$'
      and coalesce(p.flight_info->>'depart', '') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
      and coalesce(p.flight_info->>'arrive', '') ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'
      and position(upper(p.flight_info->>'flight_no') in upper(coalesce(p.raw_extracted_text, ''))) > 0
      and position(p.flight_info->>'depart' in coalesce(p.raw_extracted_text, '')) > 0
      and position(p.flight_info->>'arrive' in coalesce(p.raw_extracted_text, '')) > 0
  ), candidates as (
    select s.*,
      case
        when s.departure_local_time::time >= time '18:00'
         and s.arrival_local_time::time <= time '12:00' then 1
        else 0
      end as arrival_day_offset,
      encode(extensions.digest(convert_to(concat_ws('|',
        s.tenant_id::text, s.source_family, s.service_number,
        s.departure_airport, s.arrival_airport, s.departure_date::text,
        s.departure_local_time, s.arrival_local_time
      ), 'UTF8'), 'sha256'), 'hex') as observation_hash
    from source_rows s
  ), pending as (
    select c.*
    from candidates c
    where not exists (
      select 1
      from internal_product_registration.transport_fact_observations o
      where o.tenant_id = c.tenant_id and o.observation_hash = c.observation_hash
    )
    order by c.observed_at desc, c.internal_code
    limit greatest(1, least(coalesce(p_limit, 500), 5000))
  )
  insert into internal_product_registration.transport_fact_observations (
    tenant_id, source_kind, source_family, carrier_code, service_number,
    departure_airport, arrival_airport, effective_start, effective_end,
    departure_local_time, arrival_local_time, arrival_day_offset,
    observed_at, verified_at, source_weight, source_hash, evidence,
    observation_hash, created_version
  )
  select
    tenant_id, 'verified_product', source_family,
    (regexp_match(service_number, '^([A-Z0-9]{2,3})[0-9]'))[1], service_number,
    departure_airport, arrival_airport, departure_date, departure_date,
    departure_local_time::time, arrival_local_time::time, arrival_day_offset,
    observed_at, now(), 0.8000, source_hash,
    jsonb_build_array(jsonb_build_object(
      'source_table', 'products',
      'internal_code', internal_code,
      'catalog_product_id', catalog_product_id,
      'source_filename_hash', encode(extensions.digest(convert_to(coalesce(source_filename, ''), 'UTF8'), 'sha256'), 'hex'),
      'verified_fields', jsonb_build_array('departure_date', 'route', 'flight_no', 'depart', 'arrive')
    )),
    observation_hash, 'product-registration-v6-legacy-flight-seed-1'
  from pending
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return jsonb_build_object('inserted', v_inserted);
end;
$$;

revoke all on function internal_product_registration.seed_verified_legacy_transport_observations(integer)
  from public, anon, authenticated;
grant execute on function internal_product_registration.seed_verified_legacy_transport_observations(integer)
  to service_role;

-- The current inventory is below this bound. The function remains replay-safe
-- for operational re-runs because observation_hash is tenant-scoped unique.
select internal_product_registration.seed_verified_legacy_transport_observations(5000);
