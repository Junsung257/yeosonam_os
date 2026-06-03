import { NextRequest } from 'next/server';
import { requireAdminRequest } from '@/lib/admin-guard';
import { errorResponse, successResponse } from '@/lib/api-response';
import {
  applySettlementApproval,
  calculateDraftForAffiliate,
} from '@/lib/affiliate/settlement-calc';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

type AffiliateForSettlement = {
  id: string;
  name: string;
  payout_type: string;
};

type SettlementWithAffiliate = {
  id: string;
  affiliate_id: string;
  settlement_period: string;
  status: string | null;
  qualified_booking_count: number | null;
  total_amount: number | null;
  carryover_balance: number | null;
  final_total: number | null;
  tax_deduction: number | null;
  final_payout: number | null;
  affiliates: { id: string; name: string; booking_count: number | null } | null;
};

const SETTLEMENT_STATUSES = ['COMPLETED', 'VOID', 'PENDING', 'READY', 'HOLD'] as const;
type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];

const ALLOWED_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  PENDING: ['READY'],
  READY: ['HOLD', 'COMPLETED', 'VOID'],
  HOLD: ['READY'],
  COMPLETED: ['VOID'],
  VOID: [],
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveSettlementPeriodRange(period: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  return {
    periodStart: `${year}-${String(month).padStart(2, '0')}-01`,
    periodEnd: new Date(Date.UTC(year, month, 0)).toISOString().split('T')[0],
    todayIso: new Date().toISOString().split('T')[0],
  };
}

function requiredText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidIsoDate(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time);
}

function isValidEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSettlementStatus(value: string): value is SettlementStatus {
  return SETTLEMENT_STATUSES.includes(value as SettlementStatus);
}

function canTransition(from: string | null, to: SettlementStatus): boolean {
  const current = isSettlementStatus(from || '') ? (from as SettlementStatus) : 'PENDING';
  return ALLOWED_TRANSITIONS[current].includes(to);
}

function amountDelta(a: number, b: number): number {
  return Math.abs(Number(a || 0) - Number(b || 0));
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminRequest(request);
  if (guard) return guard;

  if (!isSupabaseConfigured) {
    return errorResponse('SERVICE_UNAVAILABLE', 'Supabase 미설정', 503);
  }

  const { searchParams } = new URL(request.url);
  const affiliateId = searchParams.get('affiliateId');
  const period = searchParams.get('period');

  try {
    if (affiliateId && !UUID_RE.test(affiliateId)) {
      return successResponse({ settlements: [] });
    }

    let query = supabaseAdmin
      .from('settlements')
      .select('*, affiliates(id, name, referral_code, grade, payout_type)')
      .order('settlement_period', { ascending: false });

    if (affiliateId) query = query.eq('affiliate_id', affiliateId);
    if (period) query = query.eq('settlement_period', period);

    const { data, error } = await query;
    if (error) throw error;

    return successResponse({ settlements: data || [] });
  } catch (err) {
    return errorResponse('FETCH_FAILED', err instanceof Error ? err.message : '조회 실패', 500);
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdminRequest(request);
  if (guard) return guard;

  if (!isSupabaseConfigured) {
    return errorResponse('SERVICE_UNAVAILABLE', 'Supabase 미설정', 503);
  }

  try {
    const body = await request.json();
    const affiliateId = requiredText(body.affiliateId);
    const period = requiredText(body.period);

    if (!affiliateId) return errorResponse('MISSING_FIELD', 'affiliateId가 필요합니다.', 400);
    if (!period) return errorResponse('MISSING_FIELD', 'period가 필요합니다. 예: 2026-03', 400);

    const range = resolveSettlementPeriodRange(period);
    if (!range) return errorResponse('INVALID_PERIOD', 'period는 YYYY-MM 형식이어야 합니다.', 400);

    const { data: affiliate, error: affiliateErr } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, payout_type')
      .eq('id', affiliateId)
      .single();
    if (affiliateErr || !affiliate) {
      return errorResponse('NOT_FOUND', '어필리에이트를 찾을 수 없습니다.', 404);
    }

    const draft = await calculateDraftForAffiliate(
      affiliate as AffiliateForSettlement,
      period,
      range.periodStart,
      range.periodEnd,
      range.todayIso,
    );
    if (!draft) {
      return errorResponse('ALREADY_FINALIZED', '이미 READY/COMPLETED 상태인 정산입니다.', 409);
    }

    await applySettlementApproval(draft);

    const { data: settlement, error: settlementErr } = await supabaseAdmin
      .from('settlements')
      .select('*')
      .eq('affiliate_id', affiliateId)
      .eq('settlement_period', period)
      .single();
    if (settlementErr) throw settlementErr;

    return successResponse({
      settlement,
      qualified: draft.qualified,
      qualifiedCount: draft.qualified_booking_count,
      totalAmount: draft.total_amount,
    });
  } catch (err) {
    return errorResponse('SETTLEMENT_FAILED', err instanceof Error ? err.message : '정산 처리 실패', 500);
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await requireAdminRequest(request);
  if (guard) return guard;

  if (!isSupabaseConfigured) {
    return errorResponse('SERVICE_UNAVAILABLE', 'Supabase 미설정', 503);
  }

  try {
    const body = await request.json();
    const id = requiredText(body.id);
    const status = requiredText(body.status);

    if (!id) return errorResponse('MISSING_FIELD', 'id가 필요합니다.', 400);
    if (!isSettlementStatus(status)) {
      return errorResponse('INVALID_STATUS', '유효하지 않은 상태값입니다.', 400);
    }

    const { data: rawCurrent, error: fetchErr } = await supabaseAdmin
      .from('settlements')
      .select('*, affiliates(id, name, booking_count)')
      .eq('id', id)
      .single();

    if (fetchErr || !rawCurrent) {
      return errorResponse('NOT_FOUND', '정산을 찾을 수 없습니다.', 404);
    }
    const current = rawCurrent as SettlementWithAffiliate;

    if (!canTransition(current.status, status)) {
      return errorResponse(
        'INVALID_SETTLEMENT_TRANSITION',
        `${current.status || 'UNKNOWN'} 상태에서 ${status} 상태로 변경할 수 없습니다.`,
        409,
      );
    }

    const payload: Record<string, unknown> = { status };

    if (status === 'COMPLETED') {
      const payoutReference = requiredText(body.payout_reference);
      const paidBy = requiredText(body.paid_by);
      const paidAt = requiredText(body.paid_at);
      const receiptUrl = requiredText(body.receipt_url);
      const withholdingAmount = Number(body.withholding_amount);

      if (
        !payoutReference ||
        !paidBy ||
        !paidAt ||
        !isValidIsoDate(paidAt) ||
        !receiptUrl ||
        !isValidEvidenceUrl(receiptUrl) ||
        !Number.isFinite(withholdingAmount) ||
        withholdingAmount < 0
      ) {
        return errorResponse(
          'PAYOUT_EVIDENCE_REQUIRED',
          'COMPLETED 전환에는 payout_reference, paid_by, 유효한 paid_at, withholding_amount, http(s) receipt_url이 필요합니다.',
          400,
        );
      }

      const finalTotal = Number(current.final_total || 0);
      const finalPayout = Number(current.final_payout || 0);
      if (withholdingAmount > finalTotal) {
        return errorResponse('INVALID_WITHHOLDING_AMOUNT', '원천징수액은 이월 포함 정산액보다 클 수 없습니다.', 400);
      }
      if (amountDelta(finalPayout + withholdingAmount, finalTotal) > 1) {
        return errorResponse(
          'PAYOUT_AMOUNT_MISMATCH',
          '실지급액과 원천징수액의 합이 이월 포함 정산액과 일치해야 합니다.',
          400,
        );
      }

      payload.settled_at = paidAt;
      payload.payout_reference = payoutReference;
      payload.paid_by = paidBy;
      payload.paid_at = paidAt;
      payload.withholding_amount = withholdingAmount;
      payload.receipt_url = receiptUrl;
    }

    if (status === 'HOLD') {
      const holdReason = requiredText(body.hold_reason);
      if (!holdReason) {
        return errorResponse('HOLD_REASON_REQUIRED', 'HOLD 전환에는 hold_reason이 필요합니다.', 400);
      }
      payload.hold_reason = holdReason;
      payload.held_at = new Date().toISOString();
    }

    if (status === 'READY' && current.status === 'HOLD') {
      payload.released_at = new Date().toISOString();
      payload.hold_reason = null;
    }

    if (status === 'VOID') {
      const affBookingCount = Number(current.affiliates?.booking_count ?? 0);

      if (current.affiliate_id && Number(current.qualified_booking_count || 0) > 0) {
        const newCount = Math.max(0, affBookingCount - Number(current.qualified_booking_count || 0));
        await supabaseAdmin
          .from('affiliates')
          .update({ booking_count: newCount })
          .eq('id', current.affiliate_id);
      }

      if (Number(current.carryover_balance || 0) > 0) {
        const range = resolveSettlementPeriodRange(current.settlement_period);
        if (range) {
          const [yearRaw, monthRaw] = current.settlement_period.split('-').map(Number);
          const prevMonth = monthRaw === 1 ? 12 : monthRaw - 1;
          const prevYear = monthRaw === 1 ? yearRaw - 1 : yearRaw;
          const prevPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

          await supabaseAdmin
            .from('settlements')
            .update({ carryover_balance: current.carryover_balance })
            .eq('affiliate_id', current.affiliate_id)
            .eq('settlement_period', prevPeriod);
        }
      }

      payload.final_total = 0;
      payload.tax_deduction = 0;
      payload.final_payout = 0;
      payload.settled_at = null;
      payload.payout_reference = null;
      payload.paid_by = null;
      payload.paid_at = null;
      payload.withholding_amount = 0;
      payload.receipt_url = null;
      payload.carryover_balance = Number(current.carryover_balance || 0) + Number(current.total_amount || 0);
    }

    const { data, error } = await supabaseAdmin
      .from('settlements')
      .update(payload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    const logName = current.affiliates?.name ?? '';
    await supabaseAdmin.from('audit_logs').insert([{
      action: status === 'VOID' ? 'SETTLEMENT_VOID_ROLLBACK' : `SETTLEMENT_${status}`,
      target_type: 'settlement',
      target_id: id,
      description: status === 'VOID'
        ? `${logName} ${current.settlement_period} 정산 롤백`
        : `정산 상태 ${status}`,
      before_value: {
        status: current.status,
        total_amount: current.total_amount,
        final_total: current.final_total,
        final_payout: current.final_payout,
        payout_reference: (current as Record<string, unknown>).payout_reference ?? null,
        paid_by: (current as Record<string, unknown>).paid_by ?? null,
        paid_at: (current as Record<string, unknown>).paid_at ?? null,
        withholding_amount: (current as Record<string, unknown>).withholding_amount ?? null,
        receipt_url: (current as Record<string, unknown>).receipt_url ?? null,
        hold_reason: (current as Record<string, unknown>).hold_reason ?? null,
        held_at: (current as Record<string, unknown>).held_at ?? null,
        released_at: (current as Record<string, unknown>).released_at ?? null,
        booking_count: current.affiliates?.booking_count,
      },
      after_value: {
        status,
        final_payout: data?.final_payout,
        payout_reference: payload.payout_reference ?? null,
        paid_by: payload.paid_by ?? null,
        paid_at: payload.paid_at ?? null,
        withholding_amount: payload.withholding_amount ?? null,
        receipt_url: payload.receipt_url ?? null,
        hold_reason: payload.hold_reason ?? null,
      },
    }]);

    return successResponse({ settlement: data });
  } catch (err) {
    return errorResponse('PATCH_FAILED', err instanceof Error ? err.message : '상태 변경 실패', 500);
  }
}
