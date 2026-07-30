-- Destination-exact Singapore monthly climate normals for published weather
-- recovery. The source table was fetched live and exposes all twelve monthly
-- maximum/minimum temperatures, rainfall totals, and rain-day counts for the
-- 1991-2020 Changi Climate Station reference period.

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
values (
  'weather.gov.sg',
  'meteorological_agency',
  'official_primary',
  true,
  'active',
  'codex_live_climate_source_audit',
  now(),
  'Meteorological Service Singapore first-party climate normals and current weather portal.'
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
  'https://www.weather.gov.sg/climate-climate-of-singapore/',
  array['monthly_weather'],
  array['싱가포르'],
  'active',
  'codex_live_climate_source_audit',
  now(),
  'MSS Changi Climate Station table with 1991-2020 monthly rainfall, rain days, and mean daily maximum/minimum temperatures.'
from public.blog_information_official_source_registry registry
where registry.hostname = 'weather.gov.sg'
  and registry.source_type = 'meteorological_agency'
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
