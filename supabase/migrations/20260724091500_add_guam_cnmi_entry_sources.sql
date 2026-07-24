-- Guam-CNMI has a distinct visa-waiver and eTA path. These CBP documents keep
-- the Korean-traveler entry brief from collapsing into generic ESTA guidance.

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://www.cbp.gov/travel/international-visitors/esta',
  'https://www.help.cbp.gov/s/article/Article-1441?language=en_US',
  'https://www.cbp.gov/sites/default/files/2025-03/guam-cnmi_20241125.pdf'
]
WHERE hostname = 'cbp.gov'
  AND source_type = 'immigration';
