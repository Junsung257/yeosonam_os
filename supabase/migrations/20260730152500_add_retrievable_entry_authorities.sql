-- Add current official entry pages whose full text was verified through the
-- production direct-fetch path on 2026-07-30.

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
    'kr.emb-japan.go.jp',
    'embassy',
    'official_primary',
    false,
    'active',
    'codex_live_entry_source_expansion',
    now(),
    'Embassy of Japan in Korea; current Korean-language visa and short-stay guidance.'
  ),
  (
    'dhs.gov',
    'government',
    'official_primary',
    true,
    'active',
    'codex_live_entry_source_expansion',
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

with reviewed_documents(
  hostname,
  source_type,
  source_url,
  destinations,
  review_note
) as (
  values
    (
      'kr.emb-japan.go.jp',
      'embassy',
      'https://www.kr.emb-japan.go.jp/itpr_ko/visa_application.html',
      array['일본'],
      'Updated 2026-03-20; states the Korean ordinary-passport short-stay visa exemption and 90-day scope.'
    ),
    (
      'dhs.gov',
      'government',
      'https://www.dhs.gov/visa-waiver-program-and-guam-cnmi-visa-waiver-program',
      array['미국'],
      'Official VWP and Guam-CNMI comparison; includes ESTA and 90-day program rules.'
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
  array['entry_requirements'],
  document.destinations,
  'active',
  'codex_live_entry_source_expansion',
  now(),
  document.review_note
from reviewed_documents as document
join public.blog_information_official_source_registry as registry
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
