-- Directly fetch only reviewed first-party pages when search grounding does not
-- surface the approved authority. The application still validates every URL
-- and redirect against the registry hostname before reading the response.

BEGIN;

ALTER TABLE public.blog_information_official_source_registry
  ADD COLUMN research_urls text[] NOT NULL DEFAULT '{}';

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://www.guamairport.com/passenger/ground-transportation',
  'https://www.guamairport.com/passenger/ground-transportation/taxis'
]
WHERE hostname = 'guamairport.com'
  AND source_type = 'airport';

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://grta.guam.gov/list_lines'
]
WHERE hostname = 'grta.guam.gov'
  AND source_type = 'transport_operator';

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://worldweather.wmo.int/kr/city.html?cityId=1954'
]
WHERE hostname = 'worldweather.wmo.int'
  AND source_type = 'meteorological_agency';

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://www.kakaomobility.com/service-kakaot/guam-taxi'
]
WHERE hostname = 'kakaomobility.com'
  AND source_type = 'transport_operator';

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://www.visitguam.com/about-guam/entry-and-exit-formalities/'
]
WHERE hostname = 'visitguam.com'
  AND source_type = 'official_tourism';

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://www.cbp.gov/travel/international-visitors/esta'
]
WHERE hostname = 'cbp.gov'
  AND source_type = 'immigration';

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://www.cbp.gov/travel/international-visitors/know-before-you-visit/customs-duty-information'
]
WHERE hostname = 'cbp.gov'
  AND source_type = 'customs';

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://cqa.guam.gov/'
]
WHERE hostname = 'cqa.guam.gov'
  AND source_type = 'customs';

COMMENT ON COLUMN public.blog_information_official_source_registry.research_urls IS
  'Admin-reviewed first-party HTML pages eligible for bounded direct research fetches.';

COMMIT;
