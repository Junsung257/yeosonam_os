-- Separate destination-local transit guidance from airport-arrival guidance.
-- The application, canonical representative, publication RPC, CTA telemetry,
-- and reviewed Canadian Rockies sources must accept the same intent set.

begin;

alter table public.blog_information_representatives
  drop constraint if exists blog_information_representatives_intent_v2_check;

alter table public.blog_information_representatives
  drop constraint if exists blog_information_representatives_intent_v3_check;

alter table public.blog_information_representatives
  add constraint blog_information_representatives_intent_v3_check
  check (intent in (
    'food_budget',
    'monthly_weather',
    'airport_transport',
    'local_transport',
    'hotel_areas',
    'family_budget',
    'itinerary',
    'shopping_souvenirs',
    'currency_payment',
    'entry_requirements',
    'travel_insurance'
  )) not valid;

comment on constraint blog_information_representatives_intent_v3_check
  on public.blog_information_representatives is
  'New rows use the eleven canonical information intents. Validate only after legacy reconciliation.';

alter table public.blog_information_cta_events
  drop constraint if exists blog_information_cta_events_intent_check;

alter table public.blog_information_cta_events
  drop constraint if exists blog_information_cta_events_intent_v2_check;

alter table public.blog_information_cta_events
  add constraint blog_information_cta_events_intent_v2_check
  check (intent in (
    'food_budget',
    'monthly_weather',
    'airport_transport',
    'local_transport',
    'hotel_areas',
    'family_budget',
    'itinerary',
    'shopping_souvenirs',
    'currency_payment',
    'entry_requirements',
    'travel_insurance'
  ));

do $migration$
declare
  function_definition text;
  old_fragment constant text :=
    '''monthly_weather'', ''airport_transport'', ''hotel_areas''';
  new_fragment constant text :=
    '''monthly_weather'', ''airport_transport'', ''local_transport'', ''hotel_areas''';
begin
  select pg_get_functiondef(proc.oid)
    into function_definition
  from pg_proc proc
  join pg_namespace namespace on namespace.oid = proc.pronamespace
  where namespace.nspname = 'public'
    and proc.proname = 'publish_blog_information_atomically';

  if function_definition is null then
    raise exception 'publish_blog_information_atomically was not found';
  end if;

  if position(old_fragment in function_definition) = 0 then
    raise exception 'publish_blog_information_atomically intent guard changed unexpectedly';
  end if;

  execute replace(function_definition, old_fragment, new_fragment);
end;
$migration$;

update public.blog_information_official_research_documents
set
  intents = array_append(intents, 'local_transport'),
  reviewed_by = 'codex_local_transport_taxonomy_audit',
  reviewed_at = now(),
  updated_at = now()
where source_url in (
  'https://parks.canada.ca/pn-np/ab/banff/visit/parkbus/louise',
  'https://www.parks.canada.ca/pn-np/ab/banff/visit/tarifs-fees',
  'https://parks.canada.ca/pn-np/ab/banff/visit/parkbus',
  'https://roamtransit.com/fares/',
  'https://roamtransit.com/schedules-routes/lake-louise-banff-express-route-8x/',
  'https://roamtransit.com/wp-content/uploads/2026/03/2026.Route-8x-Schedule-Summer.pdf',
  'https://roamtransit.com/fares/reservations/'
)
and not ('local_transport' = any(intents));

commit;
