/**
 * 자동 정산 크론 — 매월 1일 실행 (전월 정산 자동 마감)
 * GET /api/cron/settlement-auto
 *
 * 모든 어필리에이트를 순회하며 전월 정산을 자동 실행합니다.
 * 출발일이 전월이고 귀국일이 지난 예약만 대상.
 * Vercel Cron 또는 수동 호출 가능.
 */
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { withCronGuard } from '@/lib/cron-auth';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import {
  applySettlementApproval,
  calculateDraftForAffiliate,
  resolvePreviousPeriod,
} from '@/lib/affiliate/settlement-calc';

/**
 * 2026-04-15 변경: 자비스 기안 전용 모드 기본값.
 * ENABLE_DIRECT_SETTLEMENT=true 환경변수가 있을 때만 기존 방식으로 직접 READY 마감.
 * 기본은 /api/cron/affiliate-settlement-draft가 agent_actions 기안 → 사장님 결재함 승인.
 */
export const dynamic = 'force-dynamic';
const getHandler = async () => {
  if (!isSupabaseConfigured || !supabaseAdmin) return apiResponse({ error: 'Supabase not configured' }, { status: 503 });

  if (process.env.ENABLE_DIRECT_SETTLEMENT !== 'true') {
    return apiResponse({
      skipped: true,
      message: '자비스 기안 모드 활성. /api/cron/affiliate-settlement-draft를 사용하세요.',
    });
  }

  try {
    const { period, periodStart, periodEnd, todayIso } = resolvePreviousPeriod();

    console.log(`[정산 크론] ${period} 자동 정산 시작`);

    // 모든 활성 어필리에이트 조회
    const { data: affiliates } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, payout_type, booking_count')
      .eq('is_active', true);

    if (!affiliates || affiliates.length === 0) {
      return apiResponse({ message: '활성 어필리에이트 없음', period });
    }

    let processed = 0;
    let qualified = 0;
    let carried = 0;
    let skipped = 0;
    const results: { affiliate_ref: string; status: string; amount: number; reason?: string }[] = [];

    for (const aff of affiliates) {
      const draft = await calculateDraftForAffiliate(aff, period, periodStart, periodEnd, todayIso);
      if (!draft) {
        skipped++;
        results.push({
          affiliate_ref: String(aff.id).slice(0, 8),
          status: 'SKIPPED',
          amount: 0,
          reason: 'locked_or_finalized',
        });
        continue;
      }

      await applySettlementApproval(draft);

      if (draft.qualified) {
        qualified++;
        results.push({ affiliate_ref: String(aff.id).slice(0, 8), status: 'READY', amount: draft.final_payout });
      } else {
        carried++;
        results.push({ affiliate_ref: String(aff.id).slice(0, 8), status: 'PENDING (이월)', amount: draft.total_amount });
      }
      processed++;
    }

    // audit_log
    await void(supabaseAdmin.from('audit_logs').insert([{
      action: 'SETTLEMENT_AUTO_CRON',
      target_type: 'settlement',
      description: `${period} 자동 정산: ${processed}명 처리 (확정 ${qualified}, 이월 ${carried}, 스킵 ${skipped})`,
      after_value: { period, processed, qualified, carried, skipped, results },
    }]));

    console.log(`[정산 크론] 완료: ${processed}명 (확정 ${qualified}, 이월 ${carried}, 스킵 ${skipped})`);

    return apiResponse({ period, processed, qualified, carried, skipped, results });
  } catch (err) {
    const message = sanitizeDbError(err, 'Settlement cron failed');
    console.error('[정산 크론 실패]', message);
    return apiResponse({ error: message }, { status: 500 });
  }
}

export const GET = withCronGuard(getHandler);
