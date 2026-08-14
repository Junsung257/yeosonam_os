-- Manual rollback. Run only when the foreign-key lookup is no longer used.
drop index concurrently if exists public.idx_blog_url_dispositions_creative;

