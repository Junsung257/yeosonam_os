-- Keep the public blog list query aligned with Supabase/PostgREST ordering:
-- .order('published_at', { ascending: false, nullsFirst: false })
CREATE INDEX IF NOT EXISTS idx_cc_published_blog_nulls_last
  ON public.content_creatives (published_at DESC NULLS LAST)
  WHERE status = 'published'
    AND channel = 'naver_blog'
    AND slug IS NOT NULL;
