-- Guam Visitors Bureau publishes the island's regulated taxi-meter rates and
-- confirms that public-transport lines serve Tumon hotels. Scope this reviewed
-- first-party page to Guam airport transport research only.

do $$
declare
  visit_guam_registry_id uuid;
  transportation_url constant text := 'https://www.visitguam.com/planning/transportation/';
begin
  select id
  into visit_guam_registry_id
  from public.blog_information_official_source_registry
  where hostname = 'visitguam.com'
    and source_type = 'official_tourism'
    and status = 'active'
  limit 1;

  if visit_guam_registry_id is null then
    raise exception 'active Guam Visitors Bureau official source registry is required';
  end if;

  update public.blog_information_official_source_registry
  set
    research_urls = case
      when transportation_url = any(coalesce(research_urls, array[]::text[])) then research_urls
      else array_append(coalesce(research_urls, array[]::text[]), transportation_url)
    end,
    research_intents = case
      when 'airport_transport' = any(coalesce(research_intents, array[]::text[])) then research_intents
      else array_append(coalesce(research_intents, array[]::text[]), 'airport_transport')
    end,
    reviewed_by = 'codex_official_source_audit',
    reviewed_at = now(),
    review_note = 'Guam Visitors Bureau official destination and transportation guidance.',
    updated_at = now()
  where id = visit_guam_registry_id;

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
    visit_guam_registry_id,
    transportation_url,
    array['airport_transport'],
    'active',
    'codex_official_source_audit',
    now(),
    'Official Guam Visitors Bureau transportation page. Use its regulated taxi-meter rates and Tumon transit coverage; re-fetch and fail closed if the reviewed text changes.',
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
