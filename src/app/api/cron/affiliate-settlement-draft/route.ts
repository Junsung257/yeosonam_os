/**
 * 어필리에이트 월별 정산 기안 크론 — 매월 1일 02:00
 * GET /api/cron/affiliate-settlement-draft
 *
 * 자비스 권한 = 기안만. 계산 결과를 agent_actions에 pending INSERT하고
 * 사장님이 /admin/jarvis 결재함에서 승인하면
 * executor의 approve_monthly_settlement 핸들러가 settlements를 READY로 UPSERT.
 */
import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { withCronGuard } from '@/lib/cron-auth';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { logError } from '@/lib/sentry-logger';
import { reportAffiliateCronFailure, reportAffiliateCronSuccess } from '@/lib/affiliate/cron-monitor';
import {
  resolvePreviousPeriod,
  calculateDraftForAffiliate,
} from '@/lib/affiliate/settlement-calc';

export const dynamic = 'force-dynamic';

interface AffiliateRow {
  id: string;
  name: string;
  payout_type: string;
  booking_count: number;
}

function settlementActionKey(period: string, affiliateId: string): string {
  return `affiliate-settlement:${period}:${affiliateId}`;
}

const getHandler = async (_request: NextRequest) => {
  if (!isSupabaseConfigured) {
    return apiResponse({ error: 'Supabase 미설정' }, { status: 503 });
  }

  try {
    const { period, periodStart, periodEnd, todayIso } = resolvePreviousPeriod();

    const { data: rawAffiliates } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, payout_type, booking_count')
      .eq('is_active', true);
    const affiliates = rawAffiliates as AffiliateRow[] | null;

    if (!affiliates || affiliates.length === 0) {
      return apiResponse({ message: '활성 어필리에이트 없음', period });
    }

    const drafted: string[] = [];
    const skipped: string[] = [];
    const carried: string[] = [];
    const failed: Array<{ affiliate: string; error: string }> = [];

    // 어필리에이트별 처리 — Supabase RPC/INSERT 부하를 고려해 chunk=10 동시성.
    // 각 어필리에이트 작업은 서로 독립 (같은 affiliate_id 중복 호출 없음).
    // calculateDraftForAffiliate 가 외부 API 호출을 포함하지 않으므로 병렬 안전.
    const CHUNK = 10;
    async function processAffiliate(aff: NonNullable<typeof affiliates>[number]) {
      const idempotencyKey = settlementActionKey(period, aff.id);
      const { data: existingAction, error: existingActionError } = await supabaseAdmin
        .from('agent_actions')
        .select('id')
        .eq('action_type', 'approve_monthly_settlement')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      if (existingActionError) throw existingActionError;
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

      const hasSettlementValue =
        draft.qualified ||
        draft.total_amount !== 0 ||
        draft.carryover_balance !== 0 ||
        draft.adjustment_amount !== 0;
      if (!hasSettlementValue) {
        skipped.push(aff.name);
        return;
      }

      const summary = draft.qualified
        ? `${period} ${draft.affiliate_name} 정산 ${draft.final_payout.toLocaleString()}원 (${draft.qualified_booking_count}건) 기안`
        : `${period} ${draft.affiliate_name} 이월 처리 (커미션 ${draft.total_amount.toLocaleString()}원, 최소조건 미달)`;

      const { error: insertError } = await supabaseAdmin.from('agent_actions').insert({
        agent_type: 'finance',
        action_type: 'approve_monthly_settlement',
        summary,
        payload: draft as unknown as Record<string, unknown>,
        requested_by: 'jarvis',
        status: 'pending',
        priority: draft.qualified && draft.final_payout >= 1_000_000 ? 'high' : 'normal',
        idempotency_key: idempotencyKey,
      } as never);
      if (insertError) {
        if (insertError.code === '23505') {
          skipped.push(aff.name);
          return;
        }
        throw insertError;
      }

      if (draft.qualified) drafted.push(draft.affiliate_name);
      else carried.push(draft.affiliate_name);
    }

    for (let i = 0; i < affiliates.length; i += CHUNK) {
      const batch = affiliates.slice(i, i + CHUNK);
      const settled = await Promise.allSettled(batch.map(processAffiliate));
      settled.forEach((result, index) => {
        if (result.status === 'rejected') {
          failed.push({
            affiliate: batch[index]?.name ?? batch[index]?.id ?? 'unknown',
            error: result.reason instanceof Error ? result.reason.message : String(result.reason),
          });
        }
      });
    }

    await void(supabaseAdmin.from('audit_logs').insert({
      action: 'AFFILIATE_SETTLEMENT_DRAFT',
      target_type: 'settlement',
      description: `${period} 정산 기안: ${drafted.length}건 확정, ${carried.length}건 이월, ${skipped.length}건 스킵, ${failed.length}건 실패`,
      after_value: { period, drafted, carried, skipped, failed } as unknown as Record<string, unknown>,
    }));

    await reportAffiliateCronSuccess('affiliate-settlement-draft', {
      period,
      drafted: drafted.length,
      carried: carried.length,
      skipped: skipped.length,
      failed: failed.length,
    });
    return apiResponse({
      period,
      drafted: drafted.length,
      carried: carried.length,
      skipped: skipped.length,
      failed: failed.length,
      details: { drafted, carried, skipped, failed },
    });
  } catch (err) {
    logError('[cron/affiliate-settlement-draft] settlement draft failed', err);
    await reportAffiliateCronFailure('affiliate-settlement-draft', err);
    return apiResponse(
      { error: sanitizeDbError(err, '정산 기안 크론 실패') },
      { status: 500 },
    );
  }
};

export const GET = withCronGuard(getHandler);
