begin;

-- Emergency rollback only. Reintroducing this function also reintroduces the
-- exposed SECURITY DEFINER warning, so prefer rolling the application forward.
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

revoke all on function public.is_blog_public_slug_eligible_v3(text) from public;
grant execute on function public.is_blog_public_slug_eligible_v3(text) to anon, service_role;

commit;
