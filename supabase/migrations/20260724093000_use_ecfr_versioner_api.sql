-- The public HTML may present an anti-bot challenge to server requests. The
-- documented eCFR versioner API serves the same current regulation as XML.

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://www.ecfr.gov/api/versioner/v1/full/2026-07-22/title-8.xml?part=212'
]
WHERE hostname = 'ecfr.gov'
  AND source_type = 'government';
