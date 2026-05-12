/**
 * 어필리에이트 휴면 자동 처리
 * 매월 1일 실행 — 6개월 이상 전환 없는 파트너 자동 비활성
 * GET /api/cron/affiliate-dormant?secret=CRON_SECRET
 */
import { NextRequest, NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';

const DORMANT_MONTHS = parseInt(process.env.DORMANT_MONTHS || '6');

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true, message: 'DB 미설정' });

  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - DORMANT_MONTHS);
    const cutoffStr = cutoff.toISOString();

    // 6개월 이상 전환 없는 활성 파트너 조회
    const { data: dormants, error } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, last_conversion_at')
      .eq('is_active', true)
      .or(`last_conversion_at.is.null,last_conversion_at.lt.${cutoffStr}`) as { data: { id: string; name: string; last_conversion_at: string | null }[] | null; error: any };

    if (error) throw error;

    if (!dormants?.length) {
      await reportAffiliateCronSuccess('affiliate-dormant', { processed: 0, reason: 'no_dormant_targets' });
      return NextResponse.json({ ok: true, processed: 0, message: '휴면 대상 없음' });
    }

    // 일괄 비활성 처리
    const ids = dormants.map(d => d.id) as string[];
    const { error: updateErr } = await supabaseAdmin
      .from('affiliates')
      .update({ is_active: false })
      .in('id', ids);

    if (updateErr) throw updateErr;

    // 감사 로그
    await supabaseAdmin.from('audit_logs').insert(
      dormants.map(d => ({
        action: 'AFFILIATE_DORMANT',
        target_type: 'affiliate',
        target_id: d.id,
        description: `${d.name} — ${DORMANT_MONTHS}개월 무전환으로 자동 비활성 처리 (마지막 전환: ${d.last_conversion_at || '없음'})`,
      }))
    );

    console.log(`[Affiliate Dormant] ${dormants.length}명 비활성 처리`);
    await reportAffiliateCronSuccess('affiliate-dormant', { processed: dormants.length });
    return NextResponse.json({
      ok: true,
      processed: dormants.length,
      names: dormants.map(d => d.name),
    });
  } catch (err) {
    console.error('[Affiliate Dormant]', err);
    await reportAffiliateCronFailure('affiliate-dormant', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : '처리 실패' }, { status: 500 });
  }
}
