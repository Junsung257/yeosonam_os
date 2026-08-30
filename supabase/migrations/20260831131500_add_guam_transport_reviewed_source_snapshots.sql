-- Keep airport-transport research fail-closed when an approved official host
-- blocks the production runtime. These are short, immutable excerpts fetched
-- from the exact reviewed URLs on 2026-08-31 and expire after 30 days.

begin;

with snapshot_seed(
  source_key,
  hostname,
  source_type,
  source_url,
  publisher,
  snapshot_content
) as (
  values
    (
      'reviewed-registry-snapshot-guamairport-ground-transport-v1',
      'guamairport.com',
      'airport',
      'https://www.guamairport.com/passenger/ground-transportation',
      'A.B. Won Pat International Airport Authority, Guam',
      'There are a number of public transportation services you can use to get from the Airport to your destination of choice. A taxi counter is conveniently located outside the West Arrival terminal building and can assist you with the first available taxi. There are several car rental reservation and tour group counters located outside the baggage claim area for your convenience.'
    ),
    (
      'reviewed-registry-snapshot-visitguam-transportation-v1',
      'visitguam.com',
      'official_tourism',
      'https://www.visitguam.com/planning/transportation/',
      'Guam Visitors Bureau',
      'All taxis have regulated meters. The standard flag rate is $2.40, $4.00 for the first mile, and $0.80 every ¼ mile thereafter. In addition to Guam Mass Transit Authority, transportation is available to select areas by bus route. Transportation on the line includes most major shopping centers as well as the hotels in Tumon and Hagatna.'
    )
), resolved as (
  select
    seed.*,
    registry.id as registry_id,
    registry.authority_level
  from snapshot_seed seed
  join public.blog_information_official_source_registry registry
    on registry.hostname = seed.hostname
   and registry.source_type = seed.source_type
   and registry.status = 'active'
)
insert into public.blog_information_sources (
  tenant_id,
  site_scope,
  source_key,
  source_type,
  authority_level,
  official_source_registry_id,
  source_url,
  publisher,
  retrieved_at,
  valid_from,
  valid_until,
  destination,
  country,
  claim_types,
  risk_level,
  status,
  metadata
)
select
  null,
  'www.yeosonam.com',
  source_key,
  source_type,
  authority_level,
  registry_id,
  source_url,
  publisher,
  now(),
  now(),
  now() + interval '30 days',
  '괌',
  '괌',
  array['price', 'factual']::text[],
  'MEDIUM',
  'active',
  jsonb_build_object(
    'acquisition', 'reviewed_registry_snapshot',
    'snapshot_version', 'guam_airport_transport_v1',
    'reviewed_by', 'codex_official_source_audit',
    'reviewed_at', '2026-08-31T00:00:00Z',
    'refresh_after_days', 30
  )
from resolved
on conflict (tenant_scope_key, source_key) do update
set
  source_type = excluded.source_type,
  authority_level = excluded.authority_level,
  official_source_registry_id = excluded.official_source_registry_id,
  source_url = excluded.source_url,
  publisher = excluded.publisher,
  retrieved_at = excluded.retrieved_at,
  valid_from = excluded.valid_from,
  valid_until = excluded.valid_until,
  destination = excluded.destination,
  country = excluded.country,
  claim_types = excluded.claim_types,
  risk_level = excluded.risk_level,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = now();

with snapshot_seed(
  source_key,
  hostname,
  source_type,
  source_url,
  publisher,
  snapshot_content
) as (
  values
    (
      'reviewed-registry-snapshot-guamairport-ground-transport-v1',
      'guamairport.com',
      'airport',
      'https://www.guamairport.com/passenger/ground-transportation',
      'A.B. Won Pat International Airport Authority, Guam',
      'There are a number of public transportation services you can use to get from the Airport to your destination of choice. A taxi counter is conveniently located outside the West Arrival terminal building and can assist you with the first available taxi. There are several car rental reservation and tour group counters located outside the baggage claim area for your convenience.'
    ),
    (
      'reviewed-registry-snapshot-visitguam-transportation-v1',
      'visitguam.com',
      'official_tourism',
      'https://www.visitguam.com/planning/transportation/',
      'Guam Visitors Bureau',
      'All taxis have regulated meters. The standard flag rate is $2.40, $4.00 for the first mile, and $0.80 every ¼ mile thereafter. In addition to Guam Mass Transit Authority, transportation is available to select areas by bus route. Transportation on the line includes most major shopping centers as well as the hotels in Tumon and Hagatna.'
    )
), resolved as (
  select
    seed.*,
    registry.id as registry_id,
    registry.authority_level,
    source.id as source_id,
    encode(extensions.digest(convert_to(seed.snapshot_content, 'UTF8'), 'sha256'), 'hex') as content_hash
  from snapshot_seed seed
  join public.blog_information_official_source_registry registry
    on registry.hostname = seed.hostname
   and registry.source_type = seed.source_type
   and registry.status = 'active'
  join public.blog_information_sources source
    on source.tenant_id is null
   and source.site_scope = 'www.yeosonam.com'
   and source.source_key = seed.source_key
)
insert into public.blog_information_source_versions (
  tenant_id,
  source_id,
  site_scope,
  version_key,
  content_hash,
  snapshot_content,
  source_type,
  authority_level,
  official_source_registry_id,
  source_url,
  publisher,
  retrieved_at,
  valid_from,
  valid_until,
  destination,
  country,
  claim_types,
  risk_level,
  status,
  metadata
)
select
  null,
  source_id,
  'www.yeosonam.com',
  encode(extensions.digest(concat_ws(E'\n', source_key, source_url, 'reviewed_registry_snapshot_v1', content_hash), 'sha256'), 'hex'),
  content_hash,
  snapshot_content,
  source_type,
  authority_level,
  registry_id,
  source_url,
  publisher,
  now(),
  now(),
  now() + interval '30 days',
  '괌',
  '괌',
  array['price', 'factual']::text[],
  'MEDIUM',
  'active',
  jsonb_build_object(
    'acquisition', 'reviewed_registry_snapshot',
    'snapshot_version', 'guam_airport_transport_v1',
    'reviewed_by', 'codex_official_source_audit',
    'reviewed_at', '2026-08-31T00:00:00Z',
    'refresh_after_days', 30
  )
from resolved
on conflict (source_id, version_key) do nothing;

commit;
