-- Public blog read hotpath indexes.
-- These indexes keep /blog and /api/blog on narrow partial scans while DB IO is constrained.

CREATE INDEX IF NOT EXISTS idx_cc_public_blog_list_v2
  ON public.content_creatives (published_at DESC NULLS LAST)
  WHERE status = 'published'
    AND channel = 'naver_blog'
    AND slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cc_public_blog_destination_list_v2
  ON public.content_creatives (destination, published_at DESC NULLS LAST)
  WHERE status = 'published'
    AND channel = 'naver_blog'
    AND slug IS NOT NULL
    AND destination IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cc_public_blog_angle_list_v2
  ON public.content_creatives (angle_type, published_at DESC NULLS LAST)
  WHERE status = 'published'
    AND channel = 'naver_blog'
    AND slug IS NOT NULL
    AND angle_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cc_public_blog_slug_v2
  ON public.content_creatives (slug)
  WHERE status = 'published'
    AND channel = 'naver_blog'
    AND slug IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cc_public_blog_featured_v2
  ON public.content_creatives (featured_order ASC NULLS LAST, published_at DESC NULLS LAST)
  WHERE status = 'published'
    AND channel = 'naver_blog'
    AND slug IS NOT NULL
    AND featured = true;

ANALYZE public.content_creatives;
