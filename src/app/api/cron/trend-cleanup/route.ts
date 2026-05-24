/**
 * ══════════════════════════════════════════════════════════
 * Trend Cleanup — 만료된 external_trend_posts 정리
 * ══════════════════════════════════════════════════════════
 *
 * 매일 03:30 UTC 실행 (vercel.json cron)
 * - external_trend_posts 중 expires_at < now() 인 row 삭제
 * - DB 함수 cleanup_expired_trend_posts() 호출
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
  }

  const supabase = createClient(url, key);

  try {
    const { data, error } = await supabase.rpc('cleanup_expired_trend_posts');

    if (error) {
      console.error('[trend-cleanup] RPC error:', error.message);

      // RPC 실패 시 직접 삭제 (fallback)
      const { count, error: delError } = await supabase
        .from('external_trend_posts')
        .delete({ count: 'exact' })
        .lt('expires_at', new Date().toISOString());

      if (delError) {
        return NextResponse.json({ error: delError.message }, { status: 500 });
      }

      return NextResponse.json({ deleted: count ?? 0, method: 'direct_delete' });
    }

    const deletedCount = typeof data === 'number' ? data : (data as { cleanup_expired_trend_posts: number } | null)?.cleanup_expired_trend_posts ?? 0;

    return NextResponse.json({ deleted: deletedCount, method: 'rpc' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
