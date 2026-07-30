-- First-party entry and visa documents reviewed live on 2026-07-30.
-- Every document is destination-scoped so policy evidence cannot leak into
-- another country's article.

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
    'vnembassy-seoul.mofa.gov.vn',
    'embassy',
    'official_primary',
    true,
    'active',
    'codex_live_entry_source_audit',
    now(),
    'Vietnam Ministry of Foreign Affairs embassy portal.'
  ),
  (
    'travel-europe.europa.eu',
    'government',
    'official_primary',
    true,
    'active',
    'codex_live_entry_source_audit',
    now(),
    'Official European Union travel portal for EES and ETIAS.'
  ),
  (
    'mofa.go.jp',
    'government',
    'official_primary',
    true,
    'active',
    'codex_live_entry_source_audit',
    now(),
    'Ministry of Foreign Affairs of Japan visa and entry guidance.'
  ),
  (
    'seoul.thaiembassy.org',
    'embassy',
    'official_primary',
    true,
    'active',
    'codex_live_entry_source_audit',
    now(),
    'Royal Thai Embassy in Seoul visa-exemption guidance.'
  ),
  (
    'tdac.immigration.go.th',
    'immigration',
    'official_primary',
    true,
    'active',
    'codex_live_entry_source_audit',
    now(),
    'Thailand Immigration Bureau digital arrival card manual.'
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

with reviewed_documents(hostname, source_type, source_url, destinations, review_note) as (
  values
    (
      'vnembassy-seoul.mofa.gov.vn',
      'embassy',
      'https://vnembassy-seoul.mofa.gov.vn/vi/web/guest/tin-chi-tiet/chi-tiet/danh-muc-mien-thi-thuc-cua-viet-nam-voi-cac-nuoc-57162-596.html',
      array['베트남'],
      'Vietnam MFA visa-exemption list: Republic of Korea, 45 days, passport validity and entry conditions.'
    ),
    (
      'travel-europe.europa.eu',
      'government',
      'https://travel-europe.europa.eu/en/etias',
      array['유럽'],
      'Official EU ETIAS status, launch window, application fee and validity guidance.'
    ),
    (
      'cbp.gov',
      'immigration',
      'https://www.help.cbp.gov/s/article/Article-1282?language=en_US',
      array['미국'],
      'CBP ESTA application fee, payment deadline and processing guidance.'
    ),
    (
      'cbp.gov',
      'immigration',
      'https://www.help.cbp.gov/s/article/Article-1281?language=en_US',
      array['미국'],
      'CBP ESTA approval validity and multiple-entry guidance.'
    ),
    (
      'mofa.go.jp',
      'government',
      'https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html',
      array['일본'],
      'Japan MOFA short-stay visa-exemption country list.'
    ),
    (
      'seoul.thaiembassy.org',
      'embassy',
      'https://seoul.thaiembassy.org/en/publicservice/thailand-s-visa-exemption-scheme',
      array['태국'],
      'Royal Thai Embassy visa-exemption duration and TDAC notice for Korean travelers.'
    ),
    (
      'tdac.immigration.go.th',
      'immigration',
      'https://tdac.immigration.go.th/manual/kr/index.html',
      array['태국'],
      'Thailand Immigration Bureau Korean TDAC submission manual.'
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
  'codex_live_entry_source_audit',
  now(),
  document.review_note
from reviewed_documents document
join public.blog_information_official_source_registry registry
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
