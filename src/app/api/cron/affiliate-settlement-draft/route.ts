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
import { logError } from '@/lib/sentry-logger';
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

interface AffiliateRow {
      id: string;
      name: string;
      payout_type: string;
      booking_count: number;
    }
    const { data: rawAffiliates } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, payout_type, booking_count')
      .eq('is_active', true);
    const affiliates = rawAffiliates as AffiliateRow[] | null;

    if (!affiliates || affiliates.length === 0) {
      return NextResponse.json({ message: '활성 어필리에이트 없음', period });
    }

    const drafted: string[] = [];
    const skipped: string[] = [];
    const carried: string[] = [];

    // 어필리에이트별 처리 — Supabase RPC/INSERT 부하를 고려해 chunk=10 동시성.
    // 각 어필리에이트 작업은 서로 독립 (같은 affiliate_id 중복 호출 없음).
    // calculateDraftForAffiliate 가 외부 API 호출을 포함하지 않으므로 병렬 안전.
    const CHUNK = 10;
    async function processAffiliate(aff: NonNullable<typeof affiliates>[number]) {
      const { data: existingAction } = await supabaseAdmin
        .from('agent_actions')
        .select('id')
        .eq('action_type', 'approve_monthly_settlement')
        .eq('status', 'pending')
        .contains('payload', { affiliate_id: aff.id, period })
        .maybeSingle();
      if (existingAction) {
        skipped.push(aff.name);
        return;
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
        return;
      }

      const summary = draft.qualified
        ? `${period} ${draft.affiliate_name} 정산 ${draft.final_payout.toLocaleString()}원 (${draft.qualified_booking_count}건) 기안`
        : `${period} ${draft.affiliate_name} 이월 처리 (커미션 ${draft.total_amount.toLocaleString()}원, 최소조건 미달)`;

      await supabaseAdmin.from('agent_actions').insert({
        agent_type: 'finance',
        action_type: 'approve_monthly_settlement',
        summary,
        payload: draft as unknown as Record<string, unknown>,
        requested_by: 'jarvis',
        priority: draft.qualified && draft.final_payout >= 1_000_000 ? 'high' : 'normal',
      });

      if (draft.qualified) drafted.push(draft.affiliate_name);
      else carried.push(draft.affiliate_name);
    }

    for (let i = 0; i < affiliates.length; i += CHUNK) {
      const batch = affiliates.slice(i, i + CHUNK);
      await Promise.allSettled(batch.map(processAffiliate));
    }

    await void(supabaseAdmin.from('audit_logs').insert({
      action: 'AFFILIATE_SETTLEMENT_DRAFT',
      target_type: 'settlement',
      description: `${period} 정산 기안: ${drafted.length}건 확정, ${carried.length}건 이월, ${skipped.length}건 스킵`,
      after_value: { period, drafted, carried, skipped } as unknown as Record<string, unknown>,
    }));

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
    logError('[cron/affiliate-settlement-draft] settlement draft failed', err);
    await reportAffiliateCronFailure('affiliate-settlement-draft', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '정산 기안 크론 실패' },
      { status: 500 },
    );
  }
}
