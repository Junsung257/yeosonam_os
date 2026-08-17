-- Least-privilege public slug registry used only to return a real 404 before
-- the App Router starts streaming. The canonical eligibility view remains
-- service-role-only; anonymous clients can observe only public IDs and slugs.
begin;

drop view if exists public.public_blog_slug_registry;
create view public.public_blog_slug_registry
with (security_barrier = true)
as
select id, slug
from public.public_blog_content_creatives
where slug is not null;

alter view public.public_blog_slug_registry owner to postgres;
revoke all on table public.public_blog_slug_registry from public, anon, authenticated;
grant select on table public.public_blog_slug_registry to anon, authenticated, service_role;

comment on view public.public_blog_slug_registry is
  'Public id/slug projection of canonical blog eligibility; no draft, review, claim, or content fields.';

notify pgrst, 'reload schema';
commit;
