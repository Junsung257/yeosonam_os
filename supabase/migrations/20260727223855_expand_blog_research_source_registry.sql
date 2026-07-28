-- Expand reviewed evidence coverage beyond weather/hotels without weakening
-- the evidence gate. These are editorial-secondary sources only: every value
-- remains freshness-, destination-, claim-, and multi-domain-gated in code.

insert into public.blog_information_reputable_source_registry (
  hostname,
  source_types,
  intents,
  allow_subdomains,
  status,
  reviewed_by,
  reviewed_at,
  review_note
)
values
  (
    'numbeo.com',
    array['reputable_price_source', 'reputable_local_source'],
    array['food_budget', 'family_budget', 'hotel_areas', 'shopping_souvenirs'],
    true,
    'active',
    'codex_reputable_source_audit',
    now(),
    'Crowdsourced and manually collected cost data. Publish only as a checked-date estimate with sample and freshness limitations.'
  ),
  (
    'budgetyourtrip.com',
    array['reputable_price_source', 'reputable_local_source'],
    array['food_budget', 'family_budget', 'hotel_areas', 'itinerary', 'shopping_souvenirs'],
    true,
    'active',
    'codex_reputable_source_audit',
    now(),
    'Traveler-submitted budget data with documented outlier filtering. Publish only as a checked-date estimate, never a guaranteed live price.'
  ),
  (
    'rome2rio.com',
    array['reputable_price_source', 'reputable_local_source'],
    array['airport_transport', 'itinerary'],
    true,
    'active',
    'codex_reputable_source_audit',
    now(),
    'Route-planning estimates and ranges may use partner or similar-route data. Require a second domain and label values as estimates.'
  ),
  (
    'wikivoyage.org',
    array['reputable_local_source'],
    array['airport_transport', 'hotel_areas', 'family_budget', 'itinerary', 'shopping_souvenirs'],
    true,
    'active',
    'codex_reputable_source_audit',
    now(),
    'Collaboratively maintained destination guidance. Use only for corroboration with a second reviewed domain, never as sole high-risk evidence.'
  )
on conflict (hostname) do update
set
  source_types = (
    select array_agg(distinct source_type order by source_type)
    from unnest(
      public.blog_information_reputable_source_registry.source_types
      || excluded.source_types
    ) as merged(source_type)
  ),
  intents = (
    select array_agg(distinct intent order by intent)
    from unnest(
      public.blog_information_reputable_source_registry.intents
      || excluded.intents
    ) as merged(intent)
  ),
  allow_subdomains = excluded.allow_subdomains,
  status = excluded.status,
  reviewed_by = excluded.reviewed_by,
  reviewed_at = excluded.reviewed_at,
  review_note = excluded.review_note,
  updated_at = now();
