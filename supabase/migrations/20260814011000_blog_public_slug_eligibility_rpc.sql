begin;

-- Middleware needs a hard 404 decision before the App Router starts streaming,
-- but the full eligibility view must remain service-role only. Expose only the
-- Boolean result of the canonical SQL policy through a narrow SECURITY DEFINER
-- function. No article metadata or review state is returned to anonymous users.
create or replace function public.is_blog_public_slug_eligible_v3(p_slug text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when nullif(btrim(coalesce(p_slug, '')), '') is null then false
    else exists (
      select 1
      from public.public_blog_content_creatives
      where slug = btrim(p_slug)
    )
  end;
$$;

revoke all on public.public_blog_content_creatives from public, anon, authenticated;
revoke all on function public.is_blog_public_slug_eligible_v3(text) from public;
grant execute on function public.is_blog_public_slug_eligible_v3(text) to anon, service_role;

comment on function public.is_blog_public_slug_eligible_v3(text) is
  'Boolean-only public slug eligibility probe for edge middleware; delegates to the canonical server-only V3 view.';

commit;
