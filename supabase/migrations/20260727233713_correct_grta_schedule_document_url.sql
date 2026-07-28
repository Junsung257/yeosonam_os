-- The reviewed-page allowlist uses the exact registry hostname
-- grta.guam.gov. The same PDF is available without the unapproved www
-- subdomain, so replace the document URL instead of loosening hostname trust.
update public.blog_information_official_research_documents document
set
  source_url = 'https://grta.guam.gov/sites/default/files/master_-_fixed_route_schedule_updated112625.pdf',
  reviewed_by = 'codex_direct_fetch_audit',
  reviewed_at = now(),
  review_note = 'Official GRTA fixed-route schedule published November 2025; exact reviewed hostname corrected after production direct-fetch verification.',
  updated_at = now()
from public.blog_information_official_source_registry registry
where document.official_source_registry_id = registry.id
  and registry.hostname = 'grta.guam.gov'
  and document.source_url = 'https://www.grta.guam.gov/sites/default/files/master_-_fixed_route_schedule_updated112625.pdf';
