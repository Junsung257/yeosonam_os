-- Add current, directly retrievable primary pages for child-friendly Guam
-- itinerary/family decisions and authentic-souvenir verification.
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
  array['괌'],
  'active',
  'codex_live_source_availability_audit',
  now(),
  document.review_note
from public.blog_information_official_source_registry registry
cross join (
  values
    (
      'https://www.visitguam.com/things-to-do/family-fun/',
      array['family_budget', 'itinerary'],
      'Guam Visitors Bureau family-activity index. Use for child/family fit and locations; confirm operator-specific hours and prices separately.'
    ),
    (
      'https://www.visitguam.com/listing/%EC%96%B8%EB%8D%94%EC%9B%8C%ED%84%B0-%EC%9B%94%EB%93%9C/1272/',
      array['family_budget', 'itinerary'],
      'Guam Visitors Bureau UnderWater World listing with stated child ages, admission samples, and hours. Recheck before publication.'
    ),
    (
      'https://www.visitguam.com/about-guam/safety-tips/',
      array['family_budget', 'itinerary'],
      'Guam Visitors Bureau family safety guidance, including child-supervision and tropical-sun precautions.'
    ),
    (
      'https://www.visitguam.com/blog/post/3376/',
      array['shopping_souvenirs'],
      'Guam Visitors Bureau guidance for authentic Made in Guam products, the product seal, and purchase locations.'
    )
) as document(source_url, intents, review_note)
where registry.hostname = 'visitguam.com'
  and registry.source_type = 'official_tourism'
  and registry.status = 'active'
on conflict (official_source_registry_id, source_url) do update
set
  intents = excluded.intents,
  destinations = excluded.destinations,
  status = excluded.status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  review_note = excluded.review_note,
  updated_at = now();

-- First-party Guam retailers are checked-date product-price samples, not
-- destination-wide averages. A second domain and customs source remain
-- mandatory for shopping publication.
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
    'memoriesofguam.com',
    array['reputable_price_source'],
    array['shopping_souvenirs'],
    true,
    'active',
    'codex_live_source_availability_audit',
    now(),
    'First-party Guam souvenir retailer. Treat availability and prices as checked-date product samples; do not imply island-wide averages.',
    array['https://www.memoriesofguam.com/collections/made-in-guam'],
    array['괌']
  ),
  (
    'guamroute.com',
    array['reputable_price_source'],
    array['shopping_souvenirs'],
    true,
    'active',
    'codex_live_source_availability_audit',
    now(),
    'First-party Guam-made gift retailer. Treat sale prices and availability as checked-date samples and preserve sale-price conditions.',
    array['https://guamroute.com/'],
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
