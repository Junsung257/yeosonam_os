-- Repair the first Dubai weather publication without breaking its original URL.
-- The application keeps a permanent redirect from the old slug; this migration
-- atomically moves the canonical row and queues the corrected URL for indexing.

begin;

do $$
declare
  v_creative_id constant uuid := 'a73b8a4b-039d-46f0-9229-c769f625bacd';
  v_old_slug constant text := 'weather-checklist-july';
  v_new_slug constant text := 'dubai-july-weather-preparation';
  v_current_slug text;
begin
  if exists (
    select 1
    from public.content_creatives
    where slug = v_new_slug
      and id <> v_creative_id
  ) then
    raise exception 'Dubai canonical slug is already owned by another creative';
  end if;

  select slug
  into v_current_slug
  from public.content_creatives
  where id = v_creative_id
  for update;

  if not found then
    raise exception 'Dubai creative % was not found', v_creative_id;
  end if;

  if v_current_slug not in (v_old_slug, v_new_slug) then
    raise exception 'Unexpected Dubai slug: %', v_current_slug;
  end if;

  update public.content_creatives
  set
    slug = v_new_slug,
    generation_meta =
      coalesce(generation_meta, '{}'::jsonb)
      || jsonb_build_object(
        'information_representative',
        coalesce(generation_meta -> 'information_representative', '{}'::jsonb)
        || jsonb_build_object('canonical_slug', v_new_slug)
      ),
    updated_at = now()
  where id = v_creative_id
    and slug = v_old_slug;

  update public.blog_information_representatives
  set
    canonical_slug = v_new_slug,
    updated_at = now()
  where canonical_creative_id = v_creative_id
    and canonical_slug is distinct from v_new_slug;

  insert into public.blog_indexing_jobs (
    content_creative_id,
    slug,
    url,
    source,
    type,
    status,
    next_attempt_at,
    updated_at,
    idempotency_key
  )
  values (
    v_creative_id,
    v_new_slug,
    'https://www.yeosonam.com/blog/' || v_new_slug,
    'canonical_slug_repair',
    'URL_UPDATED',
    'pending',
    now(),
    now(),
    'canonical_slug_repair:' || v_creative_id::text || ':' || v_new_slug
  )
  on conflict do nothing;
end
$$;

commit;
