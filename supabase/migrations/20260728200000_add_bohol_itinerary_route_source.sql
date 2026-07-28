-- Add a first-party Bohol route-duration source so itinerary research cannot
-- satisfy its duration gate with unrelated hotel-night or visa-stay values.
begin;

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
  'https://www.tourism.gov.ph/explore/chocolate-hills/',
  array['itinerary'],
  array['보홀'],
  'active',
  'codex_live_source_availability_audit',
  now(),
  'Philippine Department of Tourism first-party Chocolate Hills page; includes the Panglao-to-Carmen drive duration and current attraction context.'
from public.blog_information_official_source_registry registry
where registry.hostname = 'tourism.gov.ph'
  and registry.source_type = 'official_tourism'
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
