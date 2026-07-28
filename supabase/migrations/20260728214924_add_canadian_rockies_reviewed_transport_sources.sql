-- Reviewed 2026 Canadian Rockies transit sources. These documents are scoped
-- to the specific region so Banff facts cannot leak into unrelated Canada posts.
begin;

insert into public.blog_information_official_source_registry (
  hostname,
  source_type,
  authority_level,
  allow_subdomains,
  status,
  reviewed_by,
  reviewed_at,
  review_note
)
values
  (
    'parks.canada.ca',
    'government',
    'official_primary',
    true,
    'active',
    'codex_live_source_availability_audit',
    now(),
    'Parks Canada first-party Banff National Park transit, reservation, and fee guidance.'
  ),
  (
    'roamtransit.com',
    'transport_operator',
    'official_primary',
    true,
    'active',
    'codex_live_source_availability_audit',
    now(),
    'Bow Valley Regional Transit Services Commission first-party route, schedule, fare, and reservation guidance.'
  )
on conflict (hostname, source_type) do update
set
  authority_level = excluded.authority_level,
  allow_subdomains = excluded.allow_subdomains,
  status = excluded.status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  review_note = excluded.review_note,
  updated_at = now();

insert into public.blog_information_official_research_documents (
  official_source_registry_id,
  source_url,
  intents,
  destinations,
  status,
  reviewed_by,
  reviewed_at,
  review_note
)
select
  registry.id,
  document.source_url,
  document.intents,
  document.destinations,
  'active',
  'codex_live_source_availability_audit',
  now(),
  document.review_note
from public.blog_information_official_source_registry registry
join (
  values
    (
      'parks.canada.ca',
      'government',
      'https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise',
      array['airport_transport', 'itinerary'],
      array['캐나다 로키산맥', '밴프', '레이크 루이스'],
      'Parks Canada 2026 Lake Louise and Moraine Lake shuttle routes, operating dates, frequency, booking rules, and access restrictions.'
    ),
    (
      'parks.canada.ca',
      'government',
      'https://www.parks.canada.ca/pn-np/ab/banff/visit/tarifs-fees',
      array['airport_transport', 'family_budget'],
      array['캐나다 로키산맥', '밴프', '레이크 루이스'],
      'Parks Canada 2026 Banff admission, shuttle, reservation, and parking fees.'
    ),
    (
      'parks.canada.ca',
      'government',
      'https://parks.canada.ca/pn-np/ab/banff/visit/parkbus',
      array['airport_transport', 'itinerary'],
      array['캐나다 로키산맥', '밴프'],
      'Parks Canada current Banff car-free access and licensed transit overview.'
    ),
    (
      'roamtransit.com',
      'transport_operator',
      'https://roamtransit.com/fares/',
      array['airport_transport', 'family_budget'],
      array['캐나다 로키산맥', '밴프', '레이크 루이스'],
      'Roam Transit current local and regional single-ride, day-pass, and rider-category fares.'
    ),
    (
      'roamtransit.com',
      'transport_operator',
      'https://roamtransit.com/schedules-routes/lake-louise-banff-express-route-8x/',
      array['airport_transport', 'itinerary'],
      array['캐나다 로키산맥', '밴프', '레이크 루이스'],
      'Roam Transit Route 8X official route, 2026 fares, service scope, and reservation guidance.'
    ),
    (
      'roamtransit.com',
      'transport_operator',
      'https://roamtransit.com/wp-content/uploads/2026/03/2026.Route-8x-Schedule-Summer.pdf',
      array['airport_transport', 'itinerary'],
      array['캐나다 로키산맥', '밴프', '레이크 루이스'],
      'Roam Transit Route 8X summer 2026 official timetable; derive durations from paired departure and arrival times only.'
    ),
    (
      'roamtransit.com',
      'transport_operator',
      'https://roamtransit.com/fares/reservations/',
      array['airport_transport'],
      array['캐나다 로키산맥', '밴프', '레이크 루이스'],
      'Roam Transit 2026 summer reservation availability, walk-up limits, and Route 10 closure notice.'
    )
) as document(hostname, source_type, source_url, intents, destinations, review_note)
  on registry.hostname = document.hostname
 and registry.source_type = document.source_type
on conflict (official_source_registry_id, source_url) do update
set
  intents = excluded.intents,
  destinations = excluded.destinations,
  status = excluded.status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  review_note = excluded.review_note,
  updated_at = now();

commit;
