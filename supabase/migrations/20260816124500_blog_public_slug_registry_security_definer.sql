-- Repair the least-privilege public slug registry used by Next.js 15
-- middleware to return a real HTTP 404 before App Router streaming starts.
--
-- Schema investigation:
--   public.public_blog_content_creatives is intentionally SECURITY INVOKER and
--   service-role-only. A public view layered directly on it therefore fails
--   for anon with `permission denied for table content_creatives` and makes
--   middleware fail open to a streamed 200/noindex soft-404.
-- Backward compatibility:
--   The public registry keeps the same two-column (id, slug) contract. It
--   exposes no content, review state, evidence, or generation metadata.
-- Backfill:
--   None. The function reads the canonical eligibility view at request time.
-- Rollback:
--   See the matching rollback file. Rolling back restores the previous view,
--   which intentionally returns to soft-404 behavior until this fix is re-run.

begin;

drop view if exists public.public_blog_slug_registry;

create or replace function public.list_public_blog_slug_registry_v1()
returns table(id uuid, slug text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select eligible.id, eligible.slug
  from public.public_blog_content_creatives eligible
  where eligible.slug is not null;
$$;

alter function public.list_public_blog_slug_registry_v1() owner to postgres;
revoke all on function public.list_public_blog_slug_registry_v1()
  from public, authenticated;
grant execute on function public.list_public_blog_slug_registry_v1()
  to anon, service_role;

create view public.public_blog_slug_registry
with (security_barrier = true)
as
select id, slug
from public.list_public_blog_slug_registry_v1();

alter view public.public_blog_slug_registry owner to postgres;
revoke all on table public.public_blog_slug_registry
  from public, anon, authenticated;
grant select on table public.public_blog_slug_registry
  to anon, authenticated, service_role;

comment on function public.list_public_blog_slug_registry_v1() is
  'SECURITY DEFINER projection of canonical public blog IDs/slugs only; used for pre-stream hard 404 checks.';
comment on view public.public_blog_slug_registry is
  'Public id/slug-only projection of canonical blog eligibility; no draft, review, claim, or content fields.';

notify pgrst, 'reload schema';
commit;
