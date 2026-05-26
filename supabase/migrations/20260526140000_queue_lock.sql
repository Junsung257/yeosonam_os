-- claim_queue_items: 블로그 발행 큐 항목을 안전하게 클레임
-- FOR UPDATE SKIP LOCKED 로 동시 크론 인스턴스의 중복 발행 방지
-- 상태 변경은 processQueueItem() 내부의 낙관적 락(status='queued' 조건)이 처리함
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
      AND target_publish_at <= NOW()
    ORDER BY priority DESC
    LIMIT limit_rows
    FOR UPDATE SKIP LOCKED
  );
END;
$$;
