-- Add specific, directly reviewed Da Nang City Tourism pages that can support
-- itinerary decisions. This is an additive data-only migration: no schema or
-- existing article rows are changed, and older application versions ignore it.
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
  document.source_url,
  array['itinerary'],
  array['다낭'],
  'active',
  'codex_danang_itinerary_decision_source_audit_20260817',
  now(),
  document.review_note
from public.blog_information_official_source_registry as registry
join (
  values
    (
      'https://danangfantasticity.com/en/new-tourism-products-in-da-nang-2026',
      'Da Nang Tourism Promotion Center page published 2025-12-17; directly reviewed 2026-08-17. Use the stated 2026 Ba Na Hills operating hours as a current itinerary constraint, not as a guarantee against same-day operator changes.'
    ),
    (
      'https://danangfantasticity.com/en/the-marble-mountains',
      'Da Nang Tourism Promotion Center page published 2025-08-02; directly reviewed 2026-08-17. Use its route duration, suggested visit duration, stair/elevator choice, and named attraction sequence for itinerary decisions.'
    ),
    (
      'https://danangfantasticity.com/en/di-san-canh-quan/ban-dao-son-tra',
      'Da Nang Tourism Promotion Center Son Tra page directly reviewed 2026-08-17. Use its seasonal access windows and wet-season road warning as time-bounded itinerary constraints; require departure-day recheck.'
    )
) as document(source_url, review_note)
  on registry.hostname = 'danangfantasticity.com'
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

-- Dry-run verification (read-only):
-- select source_url, intents, destinations, status, reviewed_by
-- from public.blog_information_official_research_documents
-- where source_url in (
--   'https://danangfantasticity.com/en/new-tourism-products-in-da-nang-2026',
--   'https://danangfantasticity.com/en/the-marble-mountains',
--   'https://danangfantasticity.com/en/di-san-canh-quan/ban-dao-son-tra'
-- );
-- Expected: exactly 3 active rows, scoped only to itinerary + 다낭.

-- Rollback (manual, only if these reviewed documents must be withdrawn):
-- delete from public.blog_information_official_research_documents
-- where reviewed_by = 'codex_danang_itinerary_decision_source_audit_20260817'
--   and source_url in (
--     'https://danangfantasticity.com/en/new-tourism-products-in-da-nang-2026',
--     'https://danangfantasticity.com/en/the-marble-mountains',
--     'https://danangfantasticity.com/en/di-san-canh-quan/ban-dao-son-tra'
--   );
