import { supabaseAdmin } from '@/lib/supabase';
import { AFFILIATE_CONFIG } from '@/lib/affiliateConfig';

const { SETTLEMENT_MIN_AMOUNT, SETTLEMENT_MIN_BOOKINGS, PERSONAL_TAX_RATE } = AFFILIATE_CONFIG;

export interface SettlementDraft {
  affiliate_id: string;
  affiliate_name: string;
  period: string;
  qualified_booking_count: number;
  total_amount: number;
  carryover_balance: number;
  final_total: number;
  tax_deduction: number;
  final_payout: number;
  booking_ids: string[];
  payout_type: string;
  qualified: boolean;
  /** 이번 정산에 적용된 조정액 (clawback 음수 + bonus 양수) */
  adjustment_amount: number;
  /** 적용된 commission_adjustments.id 배열 (정산 승인 시 status='applied'로 일괄 업데이트) */
  adjustment_ids: string[];
}

export function resolvePreviousPeriod(today = new Date()): {
  period: string;
  periodStart: string;
  periodEnd: string;
  todayIso: string;
} {
  const prevMonth = today.getMonth() === 0 ? 12 : today.getMonth();
  const prevYear = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
  const period = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  const periodStart = `${period}-01`;
  const periodEnd = new Date(prevYear, prevMonth, 0).toISOString().split('T')[0];
  const todayIso = today.toISOString().split('T')[0];
  return { period, periodStart, periodEnd, todayIso };
}

export async function calculateDraftForAffiliate(
  affiliate: { id: string; name: string; payout_type: string },
  period: string,
  periodStart: string,
  periodEnd: string,
  todayIso: string,
): Promise<SettlementDraft | null> {
  const { data: existing } = await supabaseAdmin
    .from('settlements')
    .select('id, status')
    .eq('affiliate_id', affiliate.id)
    .eq('settlement_period', period)
    .maybeSingle();
  if (existing && ['READY', 'COMPLETED'].includes(existing.status)) return null;

  const prevMonthDate = new Date(`${period}-01`);
  prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
  const prevPeriod = prevMonthDate.toISOString().slice(0, 7);

  const [bookingsRes, prevSettlementRes, pendingAdjustmentsRes] = await Promise.all([
    supabaseAdmin
      .from('bookings')
      .select('id, influencer_commission, return_date, status, self_referral_flag')
      .eq('affiliate_id', affiliate.id)
      .in('status', ['confirmed', 'completed', 'fully_paid'])
      .gte('departure_date', periodStart)
      .lte('departure_date', periodEnd)
      .lte('return_date', todayIso)
      .or('is_deleted.is.null,is_deleted.eq.false'),
    supabaseAdmin
      .from('settlements')
      .select('carryover_balance')
      .eq('affiliate_id', affiliate.id)
      .eq('settlement_period', prevPeriod)
      .maybeSingle(),
    supabaseAdmin
      .from('commission_adjustments')
      .select('id, amount')
      .eq('affiliate_id', affiliate.id)
      .eq('status', 'pending'),
  ]);

  const bookings = bookingsRes.data;
  const prevSettlement = prevSettlementRes.data;
  const pendingAdjustments = pendingAdjustmentsRes.data;

  const qualifiedBookings = (bookings || []).filter((b: any) =>
    b.return_date && b.return_date <= todayIso && !b.self_referral_flag,
  );
  const count = qualifiedBookings.length;
  const totalAmount = qualifiedBookings.reduce(
    (s: number, b: any) => s + (b.influencer_commission || 0),
    0,
  );

  const prevCarryover = (prevSettlement as any)?.carryover_balance ?? 0;
  const adjustmentSum = (pendingAdjustments || []).reduce(
    (s: number, a: any) => s + (Number(a.amount) || 0),
    0,
  );
  const adjustmentIds = (pendingAdjustments || []).map((a: any) => a.id);

  const isQualified = count >= SETTLEMENT_MIN_BOOKINGS && totalAmount >= SETTLEMENT_MIN_AMOUNT;
  // 조정액(음수=clawback)을 finalTotal에 반영. carryover는 이미 prev 잔액 + 이번달 미달분 처리.
  const finalTotal = totalAmount + prevCarryover + adjustmentSum;
  const taxDeduction =
    isQualified && affiliate.payout_type === 'PERSONAL'
      ? Math.round(finalTotal * PERSONAL_TAX_RATE)
      : 0;
  const finalPayout = isQualified ? finalTotal - taxDeduction : 0;

  return {
    affiliate_id: affiliate.id,
    affiliate_name: affiliate.name,
    period,
    qualified_booking_count: count,
    total_amount: totalAmount,
    carryover_balance: isQualified
      ? prevCarryover + adjustmentSum
      : prevCarryover + totalAmount + adjustmentSum,
    final_total: isQualified ? finalTotal : 0,
    tax_deduction: taxDeduction,
    final_payout: finalPayout,
    booking_ids: qualifiedBookings.map((b: any) => b.id),
    payout_type: affiliate.payout_type,
    qualified: isQualified,
    adjustment_amount: adjustmentSum,
    adjustment_ids: adjustmentIds,
  };
}

export async function applySettlementApproval(draft: SettlementDraft): Promise<void> {
  if (draft.qualified) {
    await supabaseAdmin.from('settlements').upsert(
      {
        affiliate_id: draft.affiliate_id,
        settlement_period: draft.period,
        qualified_booking_count: draft.qualified_booking_count,
        total_amount: draft.total_amount,
        carryover_balance: draft.carryover_balance,
        final_total: draft.final_total,
        tax_deduction: draft.tax_deduction,
        final_payout: draft.final_payout,
        status: 'READY',
      },
      { onConflict: 'affiliate_id,settlement_period' },
    );

    const { data: aff } = await supabaseAdmin
      .from('affiliates')
      .select('booking_count')
      .eq('id', draft.affiliate_id)
      .maybeSingle();

    await supabaseAdmin
      .from('affiliates')
      .update({ booking_count: (aff?.booking_count || 0) + draft.qualified_booking_count })
      .eq('id', draft.affiliate_id);
  } else {
    await supabaseAdmin.from('settlements').upsert(
      {
        affiliate_id: draft.affiliate_id,
        settlement_period: draft.period,
        qualified_booking_count: draft.qualified_booking_count,
        total_amount: draft.total_amount,
        carryover_balance: draft.carryover_balance,
        final_total: 0,
        tax_deduction: 0,
        final_payout: 0,
        status: 'PENDING',
      },
      { onConflict: 'affiliate_id,settlement_period' },
    );
  }

  // pending adjustments 를 'applied'로 일괄 전환 (이중 적용 방지)
  if (draft.adjustment_ids.length > 0) {
    await supabaseAdmin
      .from('commission_adjustments')
      .update({
        status: 'applied',
        applied_to_period: draft.period,
        applied_at: new Date().toISOString(),
      })
      .in('id', draft.adjustment_ids);
  }

  await supabaseAdmin.from('audit_logs').insert({
    action: 'SETTLEMENT_APPROVED',
    target_type: 'settlement',
    target_id: draft.affiliate_id,
    description: `${draft.period} ${draft.affiliate_name} 정산 ${draft.qualified ? '확정' : '이월'} (${draft.final_payout.toLocaleString()}원)`,
    after_value: draft as any,
  }).then(() => {}).catch(() => {});
}
