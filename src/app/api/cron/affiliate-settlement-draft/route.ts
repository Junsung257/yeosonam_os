/**
 * 어필리에이트 월별 정산 기안 크론 — 매월 1일 02:00
 * GET /api/cron/affiliate-settlement-draft
 *
 * 자비스 권한 = 기안만. 계산 결과를 agent_actions에 pending INSERT하고
 * 사장님이 /admin/jarvis 결재함에서 승인하면
 * executor의 approve_monthly_settlement 핸들러가 settlements를 READY로 UPSERT.
 */
import { NextResponse } from 'next/server';
import { cronUnauthorizedResponse, isCronAuthorized } from '@/lib/cron-auth';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';
import {
  resolvePreviousPeriod,
  calculateDraftForAffiliate,
} from '@/lib/affiliate/settlement-calc';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 503 });
  }
  if (!isCronAuthorized(request)) {
    return cronUnauthorizedResponse();
  }

  try {
    const { period, periodStart, periodEnd, todayIso } = resolvePreviousPeriod();

    const { data: affiliates } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, payout_type, booking_count')
      .eq('is_active', true);

    if (!affiliates || affiliates.length === 0) {
      return NextResponse.json({ message: '활성 어필리에이트 없음', period });
    }

    const drafted: string[] = [];
    const skipped: string[] = [];
    const carried: string[] = [];

    for (const aff of affiliates) {
      const { data: existingAction } = await supabaseAdmin
        .from('agent_actions')
        .select('id')
        .eq('action_type', 'approve_monthly_settlement')
        .eq('status', 'pending')
        .contains('payload', { affiliate_id: aff.id, period })
        .maybeSingle();
      if (existingAction) {
        skipped.push(aff.name);
        continue;
      }

      const draft = await calculateDraftForAffiliate(
        aff,
        period,
        periodStart,
        periodEnd,
        todayIso,
      );
      if (!draft) {
        skipped.push(aff.name);
        continue;
      }

      const summary = draft.qualified
        ? `${period} ${draft.affiliate_name} 정산 ${draft.final_payout.toLocaleString()}원 (${draft.qualified_booking_count}건) 기안`
        : `${period} ${draft.affiliate_name} 이월 처리 (커미션 ${draft.total_amount.toLocaleString()}원, 최소조건 미달)`;

      await supabaseAdmin.from('agent_actions').insert({
        agent_type: 'finance',
        action_type: 'approve_monthly_settlement',
        summary,
        payload: draft as any,
        requested_by: 'jarvis',
        priority: draft.qualified && draft.final_payout >= 1_000_000 ? 'high' : 'normal',
      });

      if (draft.qualified) drafted.push(draft.affiliate_name);
      else carried.push(draft.affiliate_name);
    }

    await supabaseAdmin.from('audit_logs').insert({
      action: 'AFFILIATE_SETTLEMENT_DRAFT',
      target_type: 'settlement',
      description: `${period} 정산 기안: ${drafted.length}건 확정, ${carried.length}건 이월, ${skipped.length}건 스킵`,
      after_value: { period, drafted, carried, skipped } as any,
    }).then(() => {}).catch(() => {});

    await reportAffiliateCronSuccess('affiliate-settlement-draft', {
      period,
      drafted: drafted.length,
      carried: carried.length,
      skipped: skipped.length,
    });
    return NextResponse.json({
      period,
      drafted: drafted.length,
      carried: carried.length,
      skipped: skipped.length,
      details: { drafted, carried, skipped },
    });
  } catch (err) {
    console.error('[정산 기안 크론 실패]', err);
    await reportAffiliateCronFailure('affiliate-settlement-draft', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '정산 기안 크론 실패' },
      { status: 500 },
    );
  }
}
