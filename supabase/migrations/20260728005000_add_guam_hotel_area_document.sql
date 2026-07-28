-- Persist a directly retrievable, destination-scoped hotel-area guide so the
-- hotel research gate has a second reviewed domain for location and family-fit
-- facts. Agoda remains an editorial-secondary source, never an official source.
update public.blog_information_reputable_source_registry
set
  source_types = (
    select array_agg(distinct source_type order by source_type)
    from unnest(
      public.blog_information_reputable_source_registry.source_types
      || array['reputable_price_source']
    ) as merged(source_type)
  ),
  intents = (
    select array_agg(distinct intent order by intent)
    from unnest(
      public.blog_information_reputable_source_registry.intents
      || array['hotel_areas']
    ) as merged(intent)
  ),
  research_urls = (
    select array_agg(distinct source_url order by source_url)
    from unnest(
      public.blog_information_reputable_source_registry.research_urls
      || array['https://www.agoda.com/ko-kr/travel-guides/guam/where-to-stay-in-guam-best-hotels/']
    ) as merged(source_url)
  ),
  research_destinations = (
    select array_agg(distinct destination order by destination)
    from unnest(
      public.blog_information_reputable_source_registry.research_destinations
      || array['괌']
    ) as merged(destination)
  ),
  reviewed_by = 'codex_live_source_availability_audit',
  reviewed_at = now(),
  review_note = 'Directly retrievable Guam hotel-area guide. Use only explicit checked-page location and family-facility facts; recheck hotel facilities before booking.',
  updated_at = now()
where hostname = 'agoda.com'
  and status = 'active';
