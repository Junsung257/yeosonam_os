-- The public Kakao Mobility FAQ API is the first-party, machine-readable
-- source for Guam taxi reservation, baggage, delay, and fee conditions.
-- Keep it destination/intent scoped so unrelated blog jobs cannot consume it.

do $$
declare
  kakao_registry_id uuid;
  faq_url constant text := 'https://service.kakaomobility.com/api/cs/v1/faqs/categories/44/contents?recordsPerPage=100&currentPageNo=1';
begin
  select id
  into kakao_registry_id
  from public.blog_information_official_source_registry
  where hostname = 'kakaomobility.com'
    and source_type = 'transport_operator'
    and status = 'active'
  limit 1;

  if kakao_registry_id is null then
    raise exception 'active Kakao Mobility official source registry is required';
  end if;

  update public.blog_information_official_source_registry
  set
    research_urls = case
      when faq_url = any(research_urls) then research_urls
      else array_append(research_urls, faq_url)
    end,
    reviewed_by = 'codex_official_source_audit',
    reviewed_at = now(),
    review_note = 'Kakao Mobility first-party Guam taxi service page and machine-readable customer FAQ.',
    updated_at = now()
  where id = kakao_registry_id;

  insert into public.blog_information_official_research_documents (
    official_source_registry_id,
    source_url,
    intents,
    status,
    reviewed_by,
    reviewed_at,
    review_note,
    destinations
  ) values (
    kakao_registry_id,
    faq_url,
    array['airport_transport'],
    'active',
    'codex_official_source_audit',
    now(),
    'First-party Kakao T Guam taxi FAQ API. Use for baggage capacity, reservation timing, flight-delay handling, payment, and fee conditions; fail closed when the reviewed fields change.',
    array['괌', 'guam']
  )
  on conflict (official_source_registry_id, source_url) do update
  set
    intents = excluded.intents,
    status = excluded.status,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    review_note = excluded.review_note,
    destinations = excluded.destinations,
    updated_at = now();
end
$$;

