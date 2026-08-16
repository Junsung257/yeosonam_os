begin;

drop view if exists public.public_blog_slug_registry;
drop function if exists public.list_public_blog_slug_registry_v1();

create view public.public_blog_slug_registry
with (security_barrier = true)
as
select id, slug
from public.public_blog_content_creatives
where slug is not null;

alter view public.public_blog_slug_registry owner to postgres;
revoke all on table public.public_blog_slug_registry
  from public, anon, authenticated;
grant select on table public.public_blog_slug_registry
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
commit;
