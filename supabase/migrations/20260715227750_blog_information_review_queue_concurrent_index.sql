-- content_review_queue predates the information review workflow. Build its
-- additive lookup index without taking a write-blocking table lock.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_review_queue_information_case
  ON public.content_review_queue (information_review_case_id)
  WHERE information_review_case_id IS NOT NULL;
