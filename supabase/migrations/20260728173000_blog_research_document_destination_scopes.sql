-- Reviewed URLs added after the original destination-scope migration must not
-- inherit an empty/global scope. Local documents are explicit allowlists.

UPDATE public.blog_information_official_research_documents AS document
SET destinations = ARRAY[
  regexp_replace(document.review_note, '^.* for (.+)\.$', '\1')
]
FROM public.blog_information_official_source_registry AS registry
WHERE registry.id = document.official_source_registry_id
  AND registry.hostname = 'worldweather.wmo.int'
  AND document.review_note ~ ' for .+\.$';

UPDATE public.blog_information_official_research_documents AS document
SET destinations = ARRAY['괌', 'guam']
FROM public.blog_information_official_source_registry AS registry
WHERE registry.id = document.official_source_registry_id
  AND (
    registry.hostname IN (
      'guamairport.com',
      'grta.guam.gov',
      'visitguam.com',
      'cqa.guam.gov'
    )
    OR document.source_url ILIKE '%guam%'
    OR document.review_note ~* '(Guam|G-CNMI)'
  );

UPDATE public.blog_information_official_research_documents
SET destinations = ARRAY['세부', 'cebu']
WHERE source_url ILIKE '%/cebu-province/%'
   OR source_url ILIKE '%/MACTAN.pdf';

UPDATE public.blog_information_official_research_documents
SET destinations = ARRAY['보홀', 'bohol']
WHERE source_url ILIKE '%tourism.bohol.gov.ph%'
   OR source_url ILIKE '%/TAGBILARAN-DAUIS.pdf';

UPDATE public.blog_information_official_research_documents
SET destinations = ARRAY['세부', 'cebu', '보홀', 'bohol']
WHERE source_url = 'https://www.pagasa.dost.gov.ph/climate/climatological-normals';

COMMENT ON COLUMN public.blog_information_official_research_documents.destinations IS
  'Normalized destination names or aliases for which this reviewed document is relevant. Empty means destination-global.';
