-- Read-only Busan/Gimhae offer candidate evidence.
-- Never returns supplier raw text; only source-presence booleans and non-PII product facts.
with future_price as (
  select
    tp.id,
    min((d->>'date')::date) filter (
      where (d->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and (d->>'date')::date >= current_date
    ) as next_departure_date,
    min(coalesce(
      nullif(d->>'adult_selling_price', '')::numeric,
      nullif(d->>'selling_price', '')::numeric,
      nullif(d->>'price', '')::numeric
    )) filter (
      where (d->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and (d->>'date')::date >= current_date
    ) as next_price,
    bool_or(coalesce((d->>'confirmed')::boolean, false)) filter (
      where (d->>'date') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and (d->>'date')::date >= current_date
    ) as any_confirmed_future_date
  from public.travel_packages tp
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(tp.price_dates) = 'array' then tp.price_dates else '[]'::jsonb end
  ) d
  group by tp.id
)
select
  now() as observed_at,
  tp.id,
  tp.short_code,
  tp.internal_code,
  tp.title,
  tp.destination,
  p.departure_region,
  fp.next_departure_date,
  fp.next_price,
  fp.any_confirmed_future_date,
  coalesce(tp.seats_held, 0) - coalesce(tp.seats_confirmed, 0) as remaining_recorded_seats,
  tp.status,
  tp.publication_state,
  tp.audit_status,
  length(coalesce(tp.raw_text, '')) >= 100 as has_supplier_source_text,
  tp.raw_text_hash is not null as has_source_hash,
  coalesce(array_length(tp.inclusions, 1), 0) > 0 as has_inclusions,
  coalesce(array_length(tp.excludes, 1), 0) > 0 as has_exclusions,
  tp.cancellation_policy is not null and tp.cancellation_policy <> '{}'::jsonb as has_cancellation_policy,
  tp.land_operator_id is not null or nullif(tp.land_operator, '') is not null as has_operator,
  p.supplier_code,
  p.margin_rate
from public.travel_packages tp
left join public.products p on p.internal_code = tp.internal_code
left join future_price fp on fp.id = tp.id
where lower(coalesce(p.departure_region, '')) in ('부산', '김해', 'busan', 'gimhae', 'pus')
   or tp.title ilike '%부산%'
   or tp.title ilike '%김해%'
order by
  (tp.status <> 'archived') desc,
  (fp.next_departure_date >= current_date + 7) desc,
  fp.any_confirmed_future_date desc nulls last,
  ((coalesce(tp.seats_held, 0) - coalesce(tp.seats_confirmed, 0)) > 0) desc,
  fp.next_departure_date asc nulls last;
