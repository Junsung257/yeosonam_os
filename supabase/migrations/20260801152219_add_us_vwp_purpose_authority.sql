-- Register the current DHS Visa Waiver Program page that explicitly states
-- both the permitted travel purposes and the maximum stay. The entry writer
-- must not infer either value from a generic ESTA or admission page.

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
  'dhs.gov',
  'government',
  'official_primary',
  true,
  'active',
  'codex_entry_purpose_research',
  now(),
  'United States Department of Homeland Security Visa Waiver Program guidance.'
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
  'https://www.dhs.gov/visa-waiver-program',
  array['entry_requirements'],
  array['미국'],
  'active',
  'codex_entry_purpose_research',
  now(),
  'Current DHS VWP page; direct-fetch verified 2026-08-01 and explicitly states business or tourism for stays up to 90 days.'
from public.blog_information_official_source_registry as registry
where registry.hostname = 'dhs.gov'
  and registry.source_type = 'government'
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
