-- Reviewed Philippine primary sources for Cebu and Bohol. Documents are
-- destination-scoped so their facts cannot leak into unrelated articles.
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
    'tourism.gov.ph',
    'official_tourism',
    'official_primary',
    true,
    'active',
    'codex_live_source_availability_audit',
    now(),
    'Philippine Department of Tourism first-party destination pages.'
  ),
  (
    'tourism.bohol.gov.ph',
    'official_tourism',
    'official_primary',
    false,
    'active',
    'codex_live_source_availability_audit',
    now(),
    'Bohol Provincial Tourism Office first-party destination pages.'
  ),
  (
    'tourism.bohol.gov.ph',
    'government',
    'official_primary',
    false,
    'active',
    'codex_live_source_availability_audit',
    now(),
    'Bohol Provincial Tourism Office first-party practical transport guidance.'
  ),
  (
    'pagasa.dost.gov.ph',
    'meteorological_agency',
    'official_primary',
    true,
    'active',
    'codex_live_source_availability_audit',
    now(),
    'PAGASA first-party climate normals and station files.'
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
      'tourism.gov.ph',
      'official_tourism',
      'https://www.tourism.gov.ph/destination/central-visayas/cebu-province/',
      array['itinerary'],
      array['세부'],
      'Philippine Department of Tourism Cebu destination page; use for place identity and itinerary fit, not prices or operating hours.'
    ),
    (
      'tourism.gov.ph',
      'official_tourism',
      'https://www.tourism.gov.ph/destination/central-visayas/',
      array['itinerary'],
      array['세부', '보홀'],
      'Philippine Department of Tourism Central Visayas page; use for official destination and attraction context.'
    ),
    (
      'tourism.bohol.gov.ph',
      'official_tourism',
      'https://tourism.bohol.gov.ph/visitbohol-panglao/',
      array['itinerary'],
      array['보홀'],
      'Bohol Provincial Tourism Office Panglao page; use for place identity and activity context, not unstated prices.'
    ),
    (
      'tourism.bohol.gov.ph',
      'government',
      'https://tourism.bohol.gov.ph/moving-around-bohol/',
      array['airport_transport', 'itinerary'],
      array['보홀'],
      'Bohol Provincial Tourism Office moving-around guidance; recheck availability statements at generation time.'
    ),
    (
      'pagasa.dost.gov.ph',
      'meteorological_agency',
      'https://www.pagasa.dost.gov.ph/climate/climatological-normals',
      array['monthly_weather'],
      array['세부', '보홀'],
      'PAGASA definition and index for 1991-2020 climatological normals.'
    ),
    (
      'pagasa.dost.gov.ph',
      'meteorological_agency',
      'https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/cad/CLIMATOLOGICAL%20NORMALS%20%281991-2020%29/MACTAN.pdf',
      array['monthly_weather'],
      array['세부'],
      'PAGASA Mactan International Airport station monthly normals for 1991-2020.'
    ),
    (
      'pagasa.dost.gov.ph',
      'meteorological_agency',
      'https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/cad/CLIMATOLOGICAL%20NORMALS%20%281991-2020%29/TAGBILARAN-DAUIS.pdf',
      array['monthly_weather'],
      array['보홀'],
      'PAGASA Tagbilaran-Dauis station monthly normals. The PDF body states PERIOD: 1991 - MARCH 2013; use the document body period, not the folder name.'
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
