-- Host review is not enough for stable automation: persist directly fetched,
-- destination-scoped research pages for reviewed secondary sources.
alter table public.blog_information_reputable_source_registry
  add column if not exists research_urls text[] not null default '{}'::text[],
  add column if not exists research_destinations text[] not null default '{}'::text[];

update public.blog_information_reputable_source_registry
set
  research_urls = array[
    'https://www.numbeo.com/cost-of-living/country_result.jsp?country=Guam'
  ],
  research_destinations = array['괌'],
  reviewed_by = 'codex_direct_fetch_audit',
  reviewed_at = now(),
  updated_at = now()
where hostname = 'numbeo.com'
  and status = 'active';

update public.blog_information_reputable_source_registry
set
  research_urls = array['https://en.wikivoyage.org/wiki/Guam'],
  research_destinations = array['괌'],
  reviewed_by = 'codex_direct_fetch_audit',
  reviewed_at = now(),
  updated_at = now()
where hostname = 'wikivoyage.org'
  and status = 'active';

-- Rome2Rio search pages are visible to search crawlers but returned HTTP 403
-- to the production reviewed-page worker. Search snippets are not evidence.
update public.blog_information_reputable_source_registry
set
  status = 'revoked',
  review_note = 'Revoked 2026-07-28: the production reviewed-page worker received HTTP 403. Search snippets and cached extracts are not accepted as evidence.',
  reviewed_by = 'codex_direct_fetch_audit',
  reviewed_at = now(),
  updated_at = now()
where hostname = 'rome2rio.com';

insert into public.blog_information_reputable_source_registry (
  hostname,
  source_types,
  intents,
  allow_subdomains,
  status,
  reviewed_by,
  reviewed_at,
  review_note,
  research_urls,
  research_destinations
)
values
  (
    'rootzguam.com',
    array['reputable_price_source'],
    array['food_budget'],
    true,
    'active',
    'codex_direct_fetch_audit',
    now(),
    'First-party restaurant menu. Prices are checked-date samples, not destination averages; service charges and availability must be stated.',
    array['https://www.rootzguam.com/menu'],
    array['괌']
  ),
  (
    'nanascafeguam.com',
    array['reputable_price_source'],
    array['food_budget'],
    true,
    'active',
    'codex_direct_fetch_audit',
    now(),
    'First-party restaurant lunch and dinner menu. Use as a checked-date sample and preserve price-change disclaimers.',
    array['https://nanascafeguam.com/menu'],
    array['괌']
  ),
  (
    'hiltonguamresort.com',
    array['reputable_price_source'],
    array['food_budget'],
    true,
    'active',
    'codex_direct_fetch_audit',
    now(),
    'First-party hotel restaurant menu. Use as a checked-date premium sample and include stated service charges.',
    array['https://www.hiltonguamresort.com/dining-venues/islander-terrace'],
    array['괌']
  )
on conflict (hostname) do update
set
  source_types = excluded.source_types,
  intents = excluded.intents,
  allow_subdomains = excluded.allow_subdomains,
  status = excluded.status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  review_note = excluded.review_note,
  research_urls = excluded.research_urls,
  research_destinations = excluded.research_destinations,
  updated_at = now();

-- Add directly retrievable Guam transit schedule/fare documents. These are
-- official GRTA PDFs and remain destination-scoped.
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
  array['airport_transport', 'itinerary'],
  array['괌'],
  'active',
  'codex_direct_fetch_audit',
  now(),
  document.review_note
from public.blog_information_official_source_registry registry
cross join (
  values
    (
      'https://www.grta.guam.gov/sites/default/files/master_-_fixed_route_schedule_updated112625.pdf',
      'Official GRTA fixed-route schedule published November 2025; verify the replacement notice and checked date.'
    ),
    (
      'https://grta.guam.gov/sites/default/files/grta_bus_pass_sales_information_sheet.pdf',
      'Official GRTA bus pass and fare rate sheet; values remain checked-date transit fares.'
    )
) as document(source_url, review_note)
where registry.hostname = 'grta.guam.gov'
  and registry.source_type = 'transport_operator'
on conflict (official_source_registry_id, source_url) do update
set
  intents = excluded.intents,
  destinations = excluded.destinations,
  status = excluded.status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  review_note = excluded.review_note,
  updated_at = now();

-- High-risk insurance research uses insurer first-party pages only and still
-- routes every candidate to mandatory human review before publication.
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
    'direct.samsungfire.com',
    'insurer_policy',
    'official_primary',
    true,
    'active',
    'codex_direct_fetch_audit',
    now(),
    'Samsung Fire first-party overseas travel insurance product page. Human review remains mandatory.'
  ),
  (
    'kbinsure.co.kr',
    'insurer_policy',
    'official_primary',
    true,
    'active',
    'codex_direct_fetch_audit',
    now(),
    'KB Insurance first-party overseas travel insurance policy and claim-document sources. Human review remains mandatory.'
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
  array['travel_insurance'],
  '{}'::text[],
  'active',
  'codex_direct_fetch_audit',
  now(),
  document.review_note
from public.blog_information_official_source_registry registry
join (
  values
    (
      'direct.samsungfire.com',
      'https://direct.samsungfire.com/m/fp/overseas.html',
      'First-party overseas travel insurance product page; confirm selected coverage, limits, exclusions, and current terms during human review.'
    ),
    (
      'kbinsure.co.kr',
      'https://www.kbinsure.co.kr/extrnl/clause/gnins/internet_15310.pdf',
      'First-party Korean overseas travel insurance terms and claim forms; final customer guidance requires human review.'
    )
) as document(hostname, source_url, review_note)
  on registry.hostname = document.hostname
 and registry.source_type = 'insurer_policy'
on conflict (official_source_registry_id, source_url) do update
set
  intents = excluded.intents,
  destinations = excluded.destinations,
  status = excluded.status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  review_note = excluded.review_note,
  updated_at = now();
