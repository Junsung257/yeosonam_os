-- Durable blog indexing outbox.
-- Publishing paths enqueue here; /api/cron/blog-indexing-worker performs
-- external Google/Naver/IndexNow requests and records provider evidence.

CREATE TABLE IF NOT EXISTS public.blog_indexing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_creative_id UUID REFERENCES public.content_creatives(id) ON DELETE SET NULL,
  slug TEXT NOT NULL,
  url TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'publish',
  type TEXT NOT NULL DEFAULT 'URL_UPDATED'
    CHECK (type IN ('URL_UPDATED', 'URL_DELETED')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'retry', 'processing', 'succeeded', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 6 CHECK (max_attempts > 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_error TEXT,
  last_report JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  succeeded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_indexing_jobs_active_url_type
  ON public.blog_indexing_jobs(url, type)
  WHERE status IN ('pending', 'retry', 'processing');

CREATE INDEX IF NOT EXISTS idx_blog_indexing_jobs_due
  ON public.blog_indexing_jobs(next_attempt_at, created_at)
  WHERE status IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS idx_blog_indexing_jobs_processing
  ON public.blog_indexing_jobs(locked_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_blog_indexing_jobs_creative
  ON public.blog_indexing_jobs(content_creative_id)
  WHERE content_creative_id IS NOT NULL;

ALTER TABLE public.blog_indexing_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blog_indexing_jobs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.blog_indexing_jobs TO service_role;

DROP POLICY IF EXISTS blog_indexing_jobs_service_role_all ON public.blog_indexing_jobs;
CREATE POLICY blog_indexing_jobs_service_role_all
  ON public.blog_indexing_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
