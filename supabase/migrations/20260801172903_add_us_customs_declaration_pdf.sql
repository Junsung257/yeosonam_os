-- Add a server-retrievable CBP declaration form whose exact question text can
-- be promoted deterministically into the U.S. entry evidence bundle.

begin;

insert into public.blog_information_official_research_documents (
  official_source_registry_id, source_url, intents, destinations, status,
  reviewed_by, reviewed_at, review_note
)
select r.id,
       'https://www.cbp.gov/sites/default/files/2025-07/25_0718_cbp_form_6059_sample_ndc_1.pdf',
       array['entry_requirements'], array['미국'], 'active',
       'codex_entry_deterministic_evidence', now(),
       'Official CBP Form 6059B sample listing declaration categories for arriving travelers.'
from public.blog_information_official_source_registry r
where r.hostname = 'cbp.gov'
  and r.source_type = 'customs'
  and r.status = 'active'
on conflict (official_source_registry_id, source_url) do update
set intents = excluded.intents,
    destinations = excluded.destinations,
    status = excluded.status,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_note = excluded.review_note,
    updated_at = now();

commit;
