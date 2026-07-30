-- Expand high-risk entry research with pages that the production direct-fetch
-- pipeline retrieved successfully on 2026-07-30. Each destination has at
-- least two official domains so a single authority or renderer cannot satisfy
-- the cross-domain evidence gate by itself.

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
    'home-affairs.ec.europa.eu',
    'government',
    'official_primary',
    true,
    'active',
    'codex_live_entry_source_expansion',
    now(),
    'European Commission Directorate-General for Migration and Home Affairs.'
  ),
  (
    'eur-lex.europa.eu',
    'government',
    'official_secondary',
    true,
    'active',
    'codex_live_entry_source_expansion',
    now(),
    'Official European Union law portal; used to corroborate ETIAS legal rules.'
  ),
  (
    'evisa.immigration.gov.vn',
    'immigration',
    'official_primary',
    true,
    'active',
    'codex_live_entry_source_expansion',
    now(),
    'Vietnam Immigration Department national electronic visa portal.'
  ),
  (
    'moj.go.jp',
    'immigration',
    'official_primary',
    true,
    'active',
    'codex_live_entry_source_expansion',
    now(),
    'Immigration Services Agency of Japan, Ministry of Justice.'
  ),
  (
    'ecfr.gov',
    'government',
    'official_secondary',
    true,
    'active',
    'codex_live_entry_source_expansion',
    now(),
    'Official current United States Code of Federal Regulations service.'
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

-- These pages are official but return only a client shell to the production
-- fetcher. Keeping them active would create false confidence and empty
-- grounding failures.
update public.blog_information_official_research_documents as document
set
  status = 'revoked',
  reviewed_by = 'codex_live_entry_source_expansion',
  reviewed_at = now(),
  review_note = concat(
    coalesce(document.review_note, ''),
    ' Revoked 2026-07-30: production direct-fetch returned content_too_short.'
  ),
  updated_at = now()
where document.source_url in (
  'https://travel-europe.europa.eu/en/etias',
  'https://www.help.cbp.gov/s/article/Article-1281?language=en_US',
  'https://www.help.cbp.gov/s/article/Article-1282?language=en_US'
);

with reviewed_documents(
  hostname,
  source_type,
  source_url,
  destinations,
  review_note
) as (
  values
    (
      'seoul.thaiembassy.org',
      'embassy',
      'https://seoul.thaiembassy.org/en/publicservice/visa-exemption-scheme?cate=5fa4b5e3c34b8f749474d312',
      array['태국'],
      'Royal Thai Embassy visa-exemption details; production direct-fetch verified 2026-07-30.'
    ),
    (
      'tdac.immigration.go.th',
      'immigration',
      'https://tdac.immigration.go.th/manual/kr/faq.html',
      array['태국'],
      'Thailand Immigration Bureau Korean TDAC FAQ; production direct-fetch verified 2026-07-30.'
    ),
    (
      'mofa.go.jp',
      'government',
      'https://www.mofa.go.jp/j_info/visit/visa/faq.html',
      array['일본'],
      'Japan MOFA visa FAQ; production direct-fetch verified 2026-07-30.'
    ),
    (
      'moj.go.jp',
      'immigration',
      'https://www.moj.go.jp/isa/applications/status/temporaryvisitor.html',
      array['일본'],
      'Japan Immigration Services Agency temporary-visitor status and stay periods; production direct-fetch verified 2026-07-30.'
    ),
    (
      'vnembassy-seoul.mofa.gov.vn',
      'embassy',
      'https://vnembassy-seoul.mofa.gov.vn/vi/web/guest/tin-chi-tiet/chi-tiet/viet-nam-39-s-visa-exemption-list-57163-172.html',
      array['베트남'],
      'Vietnam MFA embassy visa-exemption conditions; production direct-fetch verified 2026-07-30.'
    ),
    (
      'evisa.immigration.gov.vn',
      'immigration',
      'https://evisa.immigration.gov.vn/trang-chu-ttdt',
      array['베트남'],
      'Vietnam Immigration Department e-visa validity and entry guidance; production direct-fetch verified 2026-07-30.'
    ),
    (
      'cbp.gov',
      'immigration',
      'https://www.cbp.gov/travel/international-visitors/esta?language=pt',
      array['미국'],
      'CBP Visa Waiver Program and ESTA guidance; production direct-fetch verified 2026-07-30.'
    ),
    (
      'cbp.gov',
      'immigration',
      'https://www.cbp.gov/travel/international-visitors/i-94?language=es',
      array['미국'],
      'CBP I-94 admission record guidance; production direct-fetch verified 2026-07-30.'
    ),
    (
      'ecfr.gov',
      'government',
      'https://www.ecfr.gov/api/versioner/v1/full/2026-07-22/title-8.xml?part=217',
      array['미국'],
      'Official 8 CFR Part 217 Visa Waiver Program XML snapshot; production direct-fetch verified 2026-07-30.'
    ),
    (
      'home-affairs.ec.europa.eu',
      'government',
      'https://home-affairs.ec.europa.eu/news/main-differences-between-ees-and-etias-what-travellers-need-know-2026-04-28_en',
      array['유럽'],
      'European Commission current EES and ETIAS distinction and rollout guidance; production direct-fetch verified 2026-07-30.'
    ),
    (
      'eur-lex.europa.eu',
      'government',
      'https://eur-lex.europa.eu/EN/legal-content/summary/the-european-travel-information-and-authorisation-system-etias.html',
      array['유럽'],
      'EUR-Lex ETIAS legal summary; production direct-fetch verified 2026-07-30.'
    ),
    (
      'eur-lex.europa.eu',
      'government',
      'https://eur-lex.europa.eu/eli/reg/2018/1240/2026-06-12/eng',
      array['유럽'],
      'EUR-Lex consolidated ETIAS regulation; production direct-fetch verified 2026-07-30.'
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
