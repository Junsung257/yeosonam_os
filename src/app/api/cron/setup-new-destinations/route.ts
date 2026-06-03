import { NextRequest } from 'next/server';
import { isCronAuthorized, cronUnauthorizedResponse } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

/**
 * 신규 여행지 자동 셋업 크론
 * active_destinations에 있지만 destination_metadata가 없는 도시에 대해:
 * 1. Haiku로 tagline/hero_tagline 자동 생성
 * 2. 사진은 photo_approved=false 상태로 저장 대기 (어드민 확인 후 승인)
 *
 * 실행: 매일 11:00 KST (next.config.js cron 설정)
 * 수동 트리거: POST /api/cron/setup-new-destinations (Authorization: Bearer {CRON_SECRET})
 */

export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return cronUnauthorizedResponse();
  }

  if (!isSupabaseConfigured || !supabaseAdmin) return apiResponse({ error: 'DB not configured' }, { status: 503 });

  const { generateDestinationTaglines } = await import('@/lib/destination-setup');

  // 1. active_destinations에서 메타데이터 없는 도시 조회
  const [{ data: allDests }, { data: existingMeta }] = await Promise.all([
    supabaseAdmin.from('active_destinations').select('destination').order('package_count', { ascending: false }),
    supabaseAdmin.from('destination_metadata').select('destination'),
  ]);

  if (!allDests) return apiResponse({ error: 'destinations lookup failed' }, { status: 500 });

  const existingSet = new Set((existingMeta || []).map((m: { destination: string }) => m.destination));
  const newDests = allDests
    .map((d: { destination: string }) => d.destination)
    .filter((d: string) => !existingSet.has(d));

  if (newDests.length === 0) {
    return apiResponse({ message: '신규 여행지 없음', processed: 0 });
  }

  const results: Array<{ destination: string; status: 'ok' | 'error'; tagline?: string; error?: string }> = [];

  for (const destination of newDests) {
    try {
      const { tagline, hero_tagline } = await generateDestinationTaglines(destination);

      const { error } = await supabaseAdmin
        .from('destination_metadata')
        .upsert({ destination, tagline, hero_tagline, photo_approved: false }, { onConflict: 'destination' });

      if (error) throw error;

      results.push({ destination, status: 'ok', tagline });
      await new Promise(r => setTimeout(r, 300)); // Rate limit 방어
    } catch (e) {
      results.push({ destination, status: 'error', error: sanitizeDbError(e) });
    }
  }

  const succeeded = results.filter(r => r.status === 'ok');
  const failed = results.filter(r => r.status === 'error');

  // message_logs에 알림 기록 (시스템 알림용)
  if (succeeded.length > 0) {
    try {
      await supabaseAdmin.from('message_logs').insert({
        channel: 'system',
        event_type: 'SYSTEM_ALERT',
        direction: 'outbound',
        content: `🗺️ 신규 여행지 ${succeeded.length}개 자동 셋업 완료\n검토 후 사진 승인 필요: /admin/destinations\n\n${succeeded.map(r => `• ${r.destination}: "${r.tagline}"`).join('\n')}`,
      });
    } catch { /* fire-and-forget */ }
  }

  return apiResponse({
    processed: results.length,
    succeeded: succeeded.length,
    failed: failed.length,
    results,
  });
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return cronUnauthorizedResponse();
  }
  return POST(req);
}
