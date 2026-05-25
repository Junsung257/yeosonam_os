CREATE OR REPLACE FUNCTION claim_queue_items(limit_rows int)
RETURNS SETOF blog_topic_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE blog_topic_queue
  SET status = 'processing'
  WHERE id IN (
    SELECT id FROM blog_topic_queue
    WHERE status = 'queued'
      AND target_publish_at <= NOW()
    ORDER BY priority DESC
    LIMIT limit_rows
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
