-- MenuGuam hosts the current House of Chin Fe menu and is directly
-- retrievable by the production worker. The breakfast section includes
-- explicit dollar prices and serving hours; use only as a checked-date sample.
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
values (
  'menuguam.com',
  array['reputable_price_source'],
  array['food_budget'],
  true,
  'active',
  'codex_live_source_availability_audit',
  now(),
  'Restaurant-menu hosting page with explicit breakfast prices and hours. Treat every value as a checked-date restaurant sample, not a destination average.',
  array['https://chinfe.menuguam.com/'],
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
