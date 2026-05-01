/**
 * GET /api/admin/ledger/booking/[id]
 *
 * 특정 booking 의 모든 ledger_entries 시간순 + 잔액 누적.
 * BookingDrawer "원장 보기" 모달에서 호출.
 *
 * 응답:
 *   {
 *     booking: { id, booking_no, paid_amount, total_paid_out },
 *     entries: [{
 *       id, created_at, account, entry_type, amount, source, source_ref_id,
 *       memo, created_by,
 *       running_paid_balance, running_payout_balance     // 누적 잔액
 *     }],
 *     totals: { paid_sum, payout_sum, paid_balance, payout_balance, paid_drift, payout_drift }
 *   }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }
  const { id } = params;
  if (!id) return NextResponse.json({ error: 'id 필요' }, { status: 400 });

  // [1] booking 기본 정보
  const { data: booking, error: bErr } = await supabaseAdmin
    .from('bookings')
    .select('id, booking_no, paid_amount, total_paid_out, total_price, total_cost, status, payment_status')
    .eq('id', id)
    .single();
  if (bErr || !booking) {
    return NextResponse.json({ error: bErr?.message ?? 'booking not found' }, { status: 404 });
  }

  // [2] ledger entries 시간순
  const { data: rows, error: lErr } = await supabaseAdmin
    .from('ledger_entries')
    .select('id, created_at, account, entry_type, amount, source, source_ref_id, idempotency_key, memo, created_by')
    .eq('booking_id', id)
    .order('created_at', { ascending: true })
    .limit(500);
  if (lErr) {
    return NextResponse.json({ error: lErr.message }, { status: 500 });
  }

  // [3] 누적 잔액 계산
  let runningPaid = 0;
  let runningPayout = 0;
  const entries = ((rows ?? []) as Array<{
    id: string; created_at: string; account: string; entry_type: string;
    amount: number | string; source: string; source_ref_id: string | null;
    idempotency_key: string | null; memo: string | null; created_by: string | null;
  }>).map(r => {
    const amt = Number(r.amount) || 0;
    if (r.account === 'paid_amount') runningPaid += amt;
    else if (r.account === 'total_paid_out') runningPayout += amt;
    return {
      ...r,
      amount: amt,
      running_paid_balance: runningPaid,
      running_payout_balance: runningPayout,
    };
  });

  const b = booking as {
    id: string; booking_no?: string;
    paid_amount?: number; total_paid_out?: number;
    total_price?: number; total_cost?: number;
    status?: string; payment_status?: string;
  };
  const paidBal = b.paid_amount ?? 0;
  const payoutBal = b.total_paid_out ?? 0;

  return NextResponse.json({
    booking: {
      id: b.id,
      booking_no: b.booking_no,
      paid_amount: paidBal,
      total_paid_out: payoutBal,
      total_price: b.total_price ?? 0,
      total_cost: b.total_cost ?? 0,
      status: b.status,
      payment_status: b.payment_status,
    },
    entries,
    totals: {
      paid_sum: runningPaid,
      payout_sum: runningPayout,
      paid_balance: paidBal,
      payout_balance: payoutBal,
      paid_drift: paidBal - runningPaid,        // 0 이어야 정상
      payout_drift: payoutBal - runningPayout,  // 0 이어야 정상
    },
  });
}
