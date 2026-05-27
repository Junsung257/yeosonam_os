import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { db: { schema: 'public' } }
);

const SQL = `CREATE OR REPLACE FUNCTION public.claim_queue_items(limit_rows int)
RETURNS SETOF public.blog_topic_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.blog_topic_queue
  SET status = 'processing'
  WHERE id IN (
    SELECT id FROM public.blog_topic_queue
    WHERE status = 'queued'
      AND target_publish_at <= NOW()
    ORDER BY priority DESC
    LIMIT limit_rows
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;`;

async function main() {
  // Supabase REST API의 /rest/v1/query 는 raw SQL을 지원하지 않음
  // 대신 supabase-js의 .rpc() 호출 or management API 사용
  // Management API v1로 SQL 실행
  const projectRef = process.env.NEXT_PUBLIC_SUPABASE_URL?.match(/https:\/\/(.+)\.supabase\.co/)?.[1];
  
  if (!projectRef) {
    console.error('Could not extract project ref from SUPABASE_URL');
    return;
  }
  
  console.log('Project ref:', projectRef);
  
  // Supabase Management API token 필요
  const mgmtToken = process.env.SUPABASE_MANAGEMENT_TOKEN || process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${mgmtToken}`,
      },
      body: JSON.stringify({ query: SQL }),
    });
    
    const body = await res.text();
    console.log('Status:', res.status);
    console.log('Response:', body.substring(0, 500));
    
    if (res.ok) {
      // RPC 생성 성공, 테스트
      const { data, error } = await supabase.rpc('claim_queue_items', { limit_rows: 3 });
      if (error) {
        console.log('RPC test failed:', error.message);
      } else {
        console.log('\nRPC test OK:', (data || []).length, 'items claimed');
        (data || []).forEach((r, i) => console.log(`  ${i+1}. ${r.topic?.substring(0, 50)}`));
      }
    }
  } catch (e) {
    console.error('Failed:', e.message);
    console.log('\n--- SQL to run manually in Supabase SQL Editor ---');
    console.log(SQL);
  }
}

main().catch(console.error);
