import { supabaseAdmin } from '@/lib/supabase';

const WINDOW_MONTHS = 6;
const RELIABILITY_FLOOR = 0.3;
const RELIABILITY_CEIL = 1.0;
const DEFAULT_RELIABILITY = 0.7;
const MIN_BOOKINGS_FOR_FIT = 5; // 부킹 적으면 default 유지

export interface ReliabilityFitResult {
  operators_total: number;
  operators_updated: number;
  operators_default_kept: number;
  computed_at: string;
}

/**
 * 랜드사별 신뢰도 산출:
 *   reliability = 1 - (cancel_rate * 0.4 + refund_rate * 0.4 + dispute_rate * 0.2)
 *   clamp [0.3, 1.0]
 *
 * 부킹 < 5건이면 default 0.7 유지 (콜드스타트 안전).
 * 6개월 윈도우.
 */
export async function fitLandOperatorReliability(): Promise<ReliabilityFitResult> {
  const since = new Date();
  since.setMonth(since.getMonth() - WINDOW_MONTHS);
  const sinceIso = since.toISOString();

  const { data: ops, error: opsErr } = await supabaseAdmin
    .from('land_operators')
    .select('id')
    .eq('is_active', true);
  if (opsErr) throw new Error(`land_operators 로드 실패: ${opsErr.message}`);
  const operators = (ops ?? []) as Array<{ id: string }>;

  const { data: bks, error: bkErr } = await supabaseAdmin
    .from('bookings')
    .select('land_operator_id, status, cancelled_at, refund_amount, dispute_flag, total_price')
    .gte('created_at', sinceIso)
    .eq('is_deleted', false)
    .not('land_operator_id', 'is', null);
  if (bkErr) throw new Error(`bookings 로드 실패: ${bkErr.message}`);
  type BookingRow = {
    land_operator_id: string;
    status: string | null;
    cancelled_at: string | null;
    refund_amount: number | null;
    dispute_flag: boolean | null;
    total_price: number | null;
  };
  const bookings = (bks ?? []) as BookingRow[];

  const stats = new Map<string, {
    total: number; cancelled: number;
    refundAmount: number; revenue: number;
    disputes: number;
  }>();
  for (const b of bookings) {
    if (!b.land_operator_id) continue;
    if (!stats.has(b.land_operator_id)) {
      stats.set(b.land_operator_id, {
        total: 0, cancelled: 0, refundAmount: 0, revenue: 0, disputes: 0,
      });
    }
    const s = stats.get(b.land_operator_id)!;
    s.total++;
    if (b.cancelled_at || (b.status ?? '').toLowerCase().includes('cancel')) s.cancelled++;
    s.refundAmount += b.refund_amount ?? 0;
    s.revenue += b.total_price ?? 0;
    if (b.dispute_flag) s.disputes++;
  }

  const computedAt = new Date().toISOString();
  let updated = 0;
  let kept = 0;

  for (const op of operators) {
    const s = stats.get(op.id);
    let reliability = DEFAULT_RELIABILITY;
    let total = 0;
    let cancelled = 0;
    let refundTotal = 0;
    let disputes = 0;

    if (s && s.total >= MIN_BOOKINGS_FOR_FIT) {
      total = s.total;
      cancelled = s.cancelled;
      refundTotal = Math.round(s.refundAmount);
      disputes = s.disputes;

      const cancelRate = cancelled / total;
      const refundRate = s.revenue > 0 ? Math.min(1, s.refundAmount / s.revenue) : 0;
      const disputeRate = disputes / total;

      reliability = 1 - (cancelRate * 0.4 + refundRate * 0.4 + disputeRate * 0.2);
      reliability = Math.max(RELIABILITY_FLOOR, Math.min(RELIABILITY_CEIL, reliability));
    } else {
      kept++;
    }

    const { error: upErr } = await supabaseAdmin
      .from('land_operators')
      .update({
        reliability_score: Number(reliability.toFixed(4)),
        total_bookings: total,
        cancelled_count: cancelled,
        refund_total: refundTotal,
        dispute_count: disputes,
        reliability_computed_at: computedAt,
      })
      .eq('id', op.id);
    if (upErr) {
      console.error(`[reliability-fit] ${op.id} update 실패:`, upErr.message);
      continue;
    }
    if (s && s.total >= MIN_BOOKINGS_FOR_FIT) updated++;
  }

  return {
    operators_total: operators.length,
    operators_updated: updated,
    operators_default_kept: kept,
    computed_at: computedAt,
  };
}
