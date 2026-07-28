-- Keep unapproved product-backed blog candidates outside the failed queue.
-- Deferred rows are rechecked by publisher recovery and become queued only
-- after their package is customer-visible and its evidence contract passes.

BEGIN;

ALTER TABLE public.blog_topic_queue
  DROP CONSTRAINT IF EXISTS blog_topic_queue_status_check;

ALTER TABLE public.blog_topic_queue
  ADD CONSTRAINT blog_topic_queue_status_check
  CHECK (status IN (
    'queued',
    'generating',
    'deferred',
    'pending_review',
    'published',
    'failed',
    'skipped'
  ));

COMMENT ON COLUMN public.blog_topic_queue.status IS
  'Blog lifecycle. deferred is approval inventory; pending_review has a private draft; neither state is public or indexable.';

COMMIT;
