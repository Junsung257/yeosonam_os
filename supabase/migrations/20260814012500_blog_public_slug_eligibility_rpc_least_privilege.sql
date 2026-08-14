begin;

-- The edge probe uses the anonymous key. Signed-in clients do not need this
-- SECURITY DEFINER capability, so remove that redundant grant explicitly on
-- already-migrated environments.
revoke execute on function public.is_blog_public_slug_eligible_v3(text) from authenticated;

commit;
