-- Information blog review handoff
--
-- Automatic informational candidates that require a human fact check must be
-- durably distinguishable from published queue rows. The public truth remains
-- content_creatives.status='draft' + review_status='pending_review'.

BEGIN;

ALTER TABLE public.blog_topic_queue
  DROP CONSTRAINT IF EXISTS blog_topic_queue_status_check;

ALTER TABLE public.blog_topic_queue
  ADD CONSTRAINT blog_topic_queue_status_check
  CHECK (status IN (
    'queued',
    'generating',
    'pending_review',
    'published',
    'failed',
    'skipped'
  ));

COMMENT ON COLUMN public.blog_topic_queue.status IS
  'Information pipeline lifecycle. pending_review means a private content_creatives draft exists and must not be indexed.';

COMMIT;
