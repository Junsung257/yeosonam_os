-- content_review_queue predates the information review workflow. Keep this
-- additive lookup index compatible with Supabase CLI migration replay.

CREATE INDEX IF NOT EXISTS idx_content_review_queue_information_case
  ON public.content_review_queue (information_review_case_id)
  WHERE information_review_case_id IS NOT NULL;
