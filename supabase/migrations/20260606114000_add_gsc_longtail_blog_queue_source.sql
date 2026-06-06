-- Add a first-class source for GSC-driven longtail expansion.
-- Existing code uses a CHECK constraint instead of a Postgres enum.

BEGIN;

ALTER TABLE blog_topic_queue DROP CONSTRAINT IF EXISTS blog_topic_queue_source_check;
ALTER TABLE blog_topic_queue ADD CONSTRAINT blog_topic_queue_source_check
  CHECK (source IN (
    'seasonal',
    'coverage_gap',
    'user_seed',
    'product',
    'trend',
    'pillar',
    'card_news',
    'programmatic_seo',
    'auto_heal',
    'gsc_longtail'
  ));

COMMIT;
