-- Manual rollback. The full eligibility view remains service-role only.
begin;
drop function if exists public.is_blog_public_slug_eligible_v3(text);
commit;
