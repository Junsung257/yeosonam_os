-- Post-deploy index found by Supabase's unindexed-foreign-key advisor.
-- The table is service-role only and initially empty, but CONCURRENTLY keeps
-- this migration safe when replayed after dispositions have accumulated.
create index concurrently if not exists idx_blog_url_dispositions_creative
  on public.blog_url_dispositions(creative_id);
