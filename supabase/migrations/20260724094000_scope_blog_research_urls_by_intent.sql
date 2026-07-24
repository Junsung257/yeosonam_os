-- A trusted organization can publish many unrelated pages. Direct research
-- pages are therefore scoped to the informational intent they were reviewed
-- for, preventing cross-category evidence attachment.

ALTER TABLE public.blog_information_official_source_registry
  ADD COLUMN research_intents text[] NOT NULL DEFAULT '{}';

UPDATE public.blog_information_official_source_registry
SET research_intents = CASE
  WHEN hostname = 'worldweather.wmo.int' AND source_type = 'meteorological_agency'
    THEN ARRAY['monthly_weather']
  WHEN hostname = 'guamairport.com' AND source_type = 'airport'
    THEN ARRAY['airport_transport']
  WHEN hostname = 'kakaomobility.com' AND source_type = 'transport_operator'
    THEN ARRAY['airport_transport']
  WHEN hostname = 'grta.guam.gov' AND source_type = 'transport_operator'
    THEN ARRAY['airport_transport', 'itinerary']
  WHEN hostname = 'cbp.gov' AND source_type = 'immigration'
    THEN ARRAY['entry_requirements']
  WHEN hostname = 'cbp.gov' AND source_type = 'customs'
    THEN ARRAY['entry_requirements', 'shopping_souvenirs']
  WHEN hostname = 'cqa.guam.gov' AND source_type = 'customs'
    THEN ARRAY['entry_requirements', 'shopping_souvenirs']
  WHEN hostname = 'ecfr.gov' AND source_type = 'government'
    THEN ARRAY['entry_requirements']
  WHEN hostname = 'visitguam.com' AND source_type = 'official_tourism'
    THEN ARRAY['entry_requirements']
  ELSE ARRAY[]::text[]
END;

COMMENT ON COLUMN public.blog_information_official_source_registry.research_intents IS
  'Informational intents for which the reviewed direct URLs may be fetched and attached as evidence.';
