-- Reviewed first-party tourism sources for the initial Da Nang decision article.
-- The documents are deliberately scoped to itinerary + Da Nang so their
-- destination facts cannot be reused as evidence for unrelated articles.
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
    'vietnam.travel',
    'official_tourism',
    'official_primary',
    true,
    'active',
    'codex_live_source_availability_audit_20260816',
    now(),
    'Official website of the Viet Nam National Authority of Tourism; direct fetch returned HTTP 200 on 2026-08-16.'
  ),
  (
    'danangfantasticity.com',
    'official_tourism',
    'official_primary',
    true,
    'active',
    'codex_live_source_availability_audit_20260816',
    now(),
    'Official Da Nang City tourism information portal managed by the Da Nang Tourism Promotion Center; authority cross-checked against vietnamtourism.gov.vn and direct fetch returned HTTP 200 on 2026-08-16.'
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
  'codex_live_source_availability_audit_20260816',
  now(),
  document.review_note
from public.blog_information_official_source_registry registry
join (
  values
    (
      'vietnam.travel',
      'official_tourism',
      'https://www.vietnam.travel/places-to-go/central-vietnam/da-nang',
      array['itinerary'],
      array['다낭'],
      'National tourism authority Da Nang destination overview; use for attraction identity, geographic grouping, and transport context, not unlisted prices or opening hours.'
    ),
    (
      'vietnam.travel',
      'official_tourism',
      'https://vietnam.travel/things-to-do/must-visit-places-in-da-nang',
      array['itinerary'],
      array['다낭'],
      'National tourism authority attraction overview; use for destination-specific selection details, not third-party quotations or stale event facts.'
    ),
    (
      'vietnam.travel',
      'official_tourism',
      'https://www.vietnam.travel/things-to-do/must-do-da-nang-an-insider-list',
      array['itinerary'],
      array['다낭'],
      'National tourism authority first-visit activity overview; use only claims present in the directly fetched page.'
    ),
    (
      'danangfantasticity.com',
      'official_tourism',
      'https://danangfantasticity.com/en/category/diem-du-lich?id=12879',
      array['itinerary'],
      array['다낭'],
      'Da Nang City tourism portal attraction index; use as a current first-party discovery source and verify claims against the retrieved body.'
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

