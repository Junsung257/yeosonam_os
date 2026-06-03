/**
 * ══════════════════════════════════════════════════════════
 * Trend Cleanup — 만료된 external_trend_posts 정리
 * ══════════════════════════════════════════════════════════
 *
 * 매일 03:30 UTC 실행 (vercel.json cron)
 * - external_trend_posts 중 expires_at < now() 인 row 삭제
 * - DB 함수 cleanup_expired_trend_posts() 호출
 */

import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) return cronUnauthorizedResponse();

  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase not configured' }, { status: 503 });
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('cleanup_expired_trend_posts');

    if (error) {
      console.error('[trend-cleanup] RPC error:', sanitizeDbError(error));

      // RPC 실패 시 직접 삭제 (fallback)
      const { count, error: delError } = await supabaseAdmin
        .from('external_trend_posts')
        .delete({ count: 'exact' })
        .lt('expires_at', new Date().toISOString());

      if (delError) {
        return apiResponse({ error: sanitizeDbError(delError) }, { status: 500 });
      }

      return apiResponse({ deleted: count ?? 0, method: 'direct_delete' });
    }

    const deletedCount = typeof data === 'number' ? data : (data as { cleanup_expired_trend_posts: number } | null)?.cleanup_expired_trend_posts ?? 0;

    return apiResponse({ deleted: deletedCount, method: 'rpc' });
  } catch (err) {
    return apiResponse({ error: sanitizeDbError(err, 'Trend cleanup failed') }, { status: 500 });
  }
}
