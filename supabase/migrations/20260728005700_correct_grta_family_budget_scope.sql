-- The canonical schedule URL is non-www after the availability correction.
-- Add both official GRTA documents to family-budget research scope and expose
-- the reviewed breakfast menu as a family meal sample.
update public.blog_information_official_research_documents documents
set
  intents = (
    select array_agg(distinct intent order by intent)
    from unnest(documents.intents || array['family_budget']) as merged(intent)
  ),
  reviewed_by = 'codex_transit_conflict_audit',
  reviewed_at = now(),
  updated_at = now()
from public.blog_information_official_source_registry registry
where documents.official_source_registry_id = registry.id
  and registry.hostname = 'grta.guam.gov'
  and registry.source_type = 'transport_operator'
  and documents.status = 'active'
  and documents.source_url in (
    'https://grta.guam.gov/sites/default/files/master_-_fixed_route_schedule_updated112625.pdf',
    'https://grta.guam.gov/sites/default/files/grta_bus_pass_sales_information_sheet.pdf'
  );

update public.blog_information_reputable_source_registry
set
  intents = (
    select array_agg(distinct intent order by intent)
    from unnest(
      public.blog_information_reputable_source_registry.intents
      || array['family_budget']
    ) as merged(intent)
  ),
  reviewed_by = 'codex_family_budget_meal_audit',
  reviewed_at = now(),
  review_note = 'First-party breakfast menu. Use only exact checked-date family meal samples and preserve change disclaimers.',
  updated_at = now()
where hostname = 'chinfe.menuguam.com'
  and status = 'active';
