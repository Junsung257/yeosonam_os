import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  // 직접 REST API로 SQL 실행
  const sql = `
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
  `;

  const res = await fetch(
    process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/rpc/',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ sql }),
    },
  );
  console.log('REST SQL 실행 결과:', res.status, await res.text().then(t=>t.substring(0,200)));

  // RPC 호출 테스트
  const { data, error } = await supabase.rpc('claim_queue_items', { limit_rows: 3 });
  if (error) {
    console.log('RPC 호출 실패:', error.message);
    return;
  }
  console.log('RPC 성공:', (data || []).length + '건 claim됨');
  for (const row of data || []) {
    console.log('  -', row.topic?.substring(0, 50), '(source=', row.source, ')');
  }
}

main().catch(console.error);
