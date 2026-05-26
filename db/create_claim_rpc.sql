CREATE OR REPLACE FUNCTION public.claim_queue_items(limit_rows int)
RETURNS SETOF public.blog_topic_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT *
  FROM public.blog_topic_queue
  WHERE id IN (
    SELECT id FROM public.blog_topic_queue
    WHERE status = 'queued'
      AND target_publish_at <= NOW()
    ORDER BY priority DESC
    LIMIT limit_rows
    FOR UPDATE SKIP LOCKED
  );
END;
$$;
