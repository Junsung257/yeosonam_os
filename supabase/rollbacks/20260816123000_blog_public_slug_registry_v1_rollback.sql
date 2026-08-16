begin;
drop view if exists public.public_blog_slug_registry;
notify pgrst, 'reload schema';
commit;
