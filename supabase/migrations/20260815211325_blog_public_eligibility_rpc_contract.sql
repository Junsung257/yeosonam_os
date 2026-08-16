begin;

-- The App Router now performs the eligibility decision with the canonical,
-- service-role-only view and a risk-bounded durable snapshot. Keeping a
-- SECURITY DEFINER function executable by anon would expose an unnecessary
-- policy oracle in the public API schema and add a database round trip to
-- every article request.
revoke all on function public.is_blog_public_slug_eligible_v3(text)
  from public, anon, authenticated, service_role;
drop function if exists public.is_blog_public_slug_eligible_v3(text);

-- Reassert the actual public boundary. Server code reaches this view only
-- through a service-role client; no article or review data is exposed to anon.
revoke all on table public.public_blog_content_creatives
  from public, anon, authenticated;
grant select on table public.public_blog_content_creatives to service_role;

commit;
