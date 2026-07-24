-- WWIS loads Guam forecasts and monthly climate normals from this first-party
-- machine-readable endpoint. Keeping the UI page as well preserves context.

UPDATE public.blog_information_official_source_registry
SET research_urls = ARRAY[
  'https://worldweather.wmo.int/kr/city.html?cityId=1954',
  'https://worldweather.wmo.int/kr/json/1954_kr.xml'
]
WHERE hostname = 'worldweather.wmo.int'
  AND source_type = 'meteorological_agency';
