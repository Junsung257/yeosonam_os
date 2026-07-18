-- Persist the queue's content lane as an explicit discriminator.
-- Product auto-heal rows historically use source='auto_heal' with product_id,
-- so source alone is not sufficient to choose the writer pipeline.

BEGIN;

ALTER TABLE public.blog_topic_queue
  ADD COLUMN IF NOT EXISTS content_lane text
  GENERATED ALWAYS AS (
    CASE
      WHEN source = 'card_news' THEN 'card_news_bridge'
      WHEN product_id IS NOT NULL OR source = 'product' THEN 'product'
      ELSE 'informational'
    END
  ) STORED;

ALTER TABLE public.blog_topic_queue
  DROP CONSTRAINT IF EXISTS blog_topic_queue_content_lane_check;

ALTER TABLE public.blog_topic_queue
  ADD CONSTRAINT blog_topic_queue_content_lane_check
  CHECK (content_lane IN ('informational', 'product', 'card_news_bridge'));

COMMENT ON COLUMN public.blog_topic_queue.content_lane IS
  'Explicit generated writer lane. Uses both source and product/card-news identifiers so auto_heal can safely serve information and product flows.';

COMMIT;
