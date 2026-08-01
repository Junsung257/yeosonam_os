-- Complete the reviewed U.S. entry source set with pages that the server can
-- retrieve directly. The Korean consulate page covers return travel, lodging,
-- and travel funds; the static CBP page covers customs declarations.

begin;

insert into public.blog_information_official_source_registry (
  hostname, source_type, authority_level, allow_subdomains, status,
  reviewed_by, reviewed_at, review_note
)
values
  (
    'overseas.mofa.go.kr', 'embassy', 'official_primary', true, 'active',
    'codex_entry_supporting_customs_research', now(),
    'Official 2025 Korean consulate guidance for Korean travelers entering the United States.'
  ),
  (
    'cbp.gov', 'customs', 'official_primary', true, 'active',
    'codex_entry_supporting_customs_research', now(),
    'U.S. Customs and Border Protection traveler declaration guidance.'
  )
on conflict (hostname, source_type) do update
set authority_level = excluded.authority_level,
    allow_subdomains = excluded.allow_subdomains,
    status = excluded.status,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_note = excluded.review_note,
    updated_at = now();

insert into public.blog_information_official_research_documents (
  official_source_registry_id, source_url, intents, destinations, status,
  reviewed_by, reviewed_at, review_note
)
select r.id, v.source_url, array['entry_requirements'], array['미국'], 'active',
       'codex_entry_supporting_customs_research', now(), v.review_note
from public.blog_information_official_source_registry r
join (values
  (
    'overseas.mofa.go.kr', 'embassy',
    'https://overseas.mofa.go.kr/us-seattle-ko/brd/m_4733/view.do?seq=1342928',
    'Official 2025 consulate guidance covers return airfare, U.S. lodging details, and travel funds for Korean ESTA travelers.'
  ),
  (
    'cbp.gov', 'customs',
    'https://www.cbp.gov/travel/us-citizens/know-before-you-go/know-you-go-traveling-abroad',
    'Static CBP guidance lists agriculture, currency, and other declaration requirements for travelers entering the United States.'
  )
) as v(hostname, source_type, source_url, review_note)
  on r.hostname = v.hostname and r.source_type = v.source_type
on conflict (official_source_registry_id, source_url) do update
set intents = excluded.intents,
    destinations = excluded.destinations,
    status = excluded.status,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_note = excluded.review_note,
    updated_at = now();

commit;
