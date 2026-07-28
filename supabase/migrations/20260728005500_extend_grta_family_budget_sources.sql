-- Family-budget articles must use the reviewed current GRTA schedule and fare
-- sheet instead of secondary cost-of-living transit samples.
update public.blog_information_official_research_documents documents
set
  intents = (
    select array_agg(distinct intent order by intent)
    from unnest(documents.intents || array['family_budget']) as merged(intent)
  ),
  reviewed_by = 'codex_transit_conflict_audit',
  reviewed_at = now(),
  review_note = case
    when documents.source_url like '%grta_bus_pass_sales_information_sheet.pdf'
      then 'Official GRTA fare sheet. Family-budget transit claims must supersede conflicting secondary-source fare samples.'
    else 'Official GRTA fixed-route schedule. Use exact reviewed stop times and recompute elapsed minutes.'
  end,
  updated_at = now()
from public.blog_information_official_source_registry registry
where documents.official_source_registry_id = registry.id
  and registry.hostname = 'grta.guam.gov'
  and registry.source_type = 'transport_operator'
  and documents.status = 'active'
  and documents.source_url in (
    'https://www.grta.guam.gov/sites/default/files/master_-_fixed_route_schedule_updated112625.pdf',
    'https://grta.guam.gov/sites/default/files/grta_bus_pass_sales_information_sheet.pdf'
  );
