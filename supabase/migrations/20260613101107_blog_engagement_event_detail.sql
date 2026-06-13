-- Add event-level detail to blog engagement logs while preserving the
-- existing summary rows used by Ad OS learning/performance jobs.

ALTER TABLE public.blog_engagement_logs
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'summary',
  ADD COLUMN IF NOT EXISTS cta_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cta_placement text,
  ADD COLUMN IF NOT EXISTS cta_href text,
  ADD COLUMN IF NOT EXISTS event_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.blog_engagement_logs
  DROP CONSTRAINT IF EXISTS blog_engagement_logs_event_type_check;

ALTER TABLE public.blog_engagement_logs
  ADD CONSTRAINT blog_engagement_logs_event_type_check
  CHECK (
    event_type IN (
      'summary',
      'scroll_25',
      'scroll_50',
      'scroll_75',
      'scroll_90',
      'cta_impression',
      'cta_click'
    )
  );

CREATE INDEX IF NOT EXISTS idx_blog_engagement_logs_event_type_created
  ON public.blog_engagement_logs(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_engagement_logs_creative_event_created
  ON public.blog_engagement_logs(content_creative_id, event_type, created_at DESC)
  WHERE content_creative_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_blog_engagement_logs_session_creative_event
  ON public.blog_engagement_logs(session_id, content_creative_id, event_type, created_at DESC)
  WHERE session_id IS NOT NULL AND content_creative_id IS NOT NULL;
