-- Destination-exact PAGASA station normals for legacy weather recovery.
-- Both PDFs were fetched live and expose all twelve monthly values for
-- rainfall, rainy days, maximum temperature, and minimum temperature.
-- The period declared inside each PDF is authoritative.

begin;

with reviewed_documents(source_url, destinations, review_note) as (
  values
    (
      'https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/cad/CLIMATOLOGICAL%20NORMALS%20%281991-2020%29/NAIA.pdf',
      array['마닐라'],
      'PAGASA NAIA station 1991-2020 monthly normals; the PDF body identifies Ninoy Aquino International Airport in Metro Manila.'
    ),
    (
      'https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/cad/CLIMATOLOGICAL%20NORMALS%20%281991-2020%29/CLARK.pdf',
      array['클락'],
      'PAGASA Clark station monthly normals. The PDF body states 1997-2020 despite the 1991-2020 folder name; use only for the exact Clark destination scope.'
    )
)
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
  array['monthly_weather'],
  document.destinations,
  'active',
  'codex_live_climate_source_audit',
  now(),
  document.review_note
from reviewed_documents document
join public.blog_information_official_source_registry registry
  on registry.hostname = 'pagasa.dost.gov.ph'
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
