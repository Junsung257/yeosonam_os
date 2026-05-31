-- Blog autopublish repair
-- 1) restore every queue source used by current code paths
-- 2) let publisher claim legacy queued rows whose target_publish_at is NULL
--    (new rows now receive an immediate timestamp from the admin queue API)

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
    'auto_heal'
  ));

CREATE OR REPLACE FUNCTION claim_queue_items(limit_rows int)
RETURNS SETOF blog_topic_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM blog_topic_queue
  WHERE id IN (
    SELECT id FROM blog_topic_queue
    WHERE status = 'queued'
      AND (target_publish_at IS NULL OR target_publish_at <= NOW())
    ORDER BY
      COALESCE(target_publish_at, NOW()) ASC,
      priority DESC,
      created_at ASC
    LIMIT limit_rows
    FOR UPDATE SKIP LOCKED
  );
END;
$$;

COMMIT;
