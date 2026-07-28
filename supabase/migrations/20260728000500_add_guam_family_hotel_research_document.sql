-- The Booking.com Guam family page is directly retrievable by the production
-- reviewed-source worker and exposes checked-date nightly samples plus region
-- and family-hotel context. It is an editorial-secondary price source only.
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
      || array['hotel_areas', 'family_budget']
    ) as merged(intent)
  ),
  research_urls = (
    select array_agg(distinct source_url order by source_url)
    from unnest(
      public.blog_information_reputable_source_registry.research_urls
      || array['https://www.booking.com/family/country/gu.ko.html']
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
  review_note = 'Directly retrievable Guam family-hotel page with checked-date nightly samples. Prices vary by dates, occupancy, taxes, and availability; never present them as guaranteed quotes.',
  updated_at = now()
where hostname = 'booking.com'
  and status = 'active';
