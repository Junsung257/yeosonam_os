-- The PAGASA folder name says 1991-2020, but the Tagbilaran-Dauis PDF body
-- states PERIOD: 1991 - MARCH 2013. Keep the reviewed-source note exact.
update public.blog_information_official_research_documents documents
set
  review_note = 'PAGASA Tagbilaran-Dauis station monthly normals. The PDF body states PERIOD: 1991 - MARCH 2013; use the document body period, not the folder name.',
  reviewed_by = 'codex_live_source_availability_audit',
  reviewed_at = now(),
  updated_at = now()
from public.blog_information_official_source_registry registry
where documents.official_source_registry_id = registry.id
  and registry.hostname = 'pagasa.dost.gov.ph'
  and documents.source_url = 'https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/cad/CLIMATOLOGICAL%20NORMALS%20%281991-2020%29/TAGBILARAN-DAUIS.pdf';
