import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import {
  matchPaymentToBookings,
  applyDuplicateNameGuard,
  type BookingCandidate,
} from '@/lib/payment-matcher';
import { operatorScore } from '@/lib/payment-command-resolver';
import { findSubsetSum } from '@/lib/subset-sum';

/**
 * GET /api/payments/auto-suggest?transactionId=UUID
 *
 * 거래 1건에 대해 시스템이 사전 분석한 매칭 후보를 반환.
 *  - 입금/환불: matchPaymentToBookings 활용해 booking 1:1 후보 (top 3)
 *  - 출금: counterparty_name → land_operator fuzzy →
 *           해당 operator 의 미정산 booking 들 중 합계 ±5천원 부분집합 (subset-sum)
 *
 * 거래 카드 UI 가 호출 → 칩으로 노출 → 사장님 1-click → match-confirm 또는 settlement-bundle 로 확정.
 *
 * 정책: 자동 매칭 절대 안 함 — 후보 제시까지만. 확정은 항상 사장님 액션.
 */

const TOLERANCE = 5_000;

export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ candidates: [] });
  }

  const txId = req.nextUrl.searchParams.get('transactionId');
  if (!txId) {
    return NextResponse.json({ error: 'transactionId 필수' }, { status: 400 });
  }

  try {
    const { data: txData, error: txErr } = await supabaseAdmin
      .from('bank_transactions')
      .select('id, transaction_type, amount, counterparty_name, received_at, is_refund, match_status')
      .eq('id', txId)
      .limit(1);
    if (txErr) throw txErr;
    const tx = (txData as any[] | null)?.[0];
    if (!tx) {
      return NextResponse.json({ error: '거래를 찾을 수 없습니다' }, { status: 404 });
    }
    if (tx.match_status !== 'unmatched' && tx.match_status !== 'review' && tx.match_status !== 'error') {
      return NextResponse.json({ candidates: [], note: '이미 매칭된 거래' });
    }

    const amountAbs = Math.abs(tx.amount);
    const isOutflow = tx.transaction_type === '출금' && !tx.is_refund;

    // ── 입금/환불: booking 1:1 매칭 후보 ─────────────────────
    if (!isOutflow) {
      const { data: bookingRows, error: bErr } = await supabaseAdmin
        .from('bookings')
        .select(
          'id, booking_no, total_price, total_cost, paid_amount, total_paid_out, status, payment_status, actual_payer_name, lead_customer_id, departure_date, customers!lead_customer_id(name)',
        )
        .eq('is_deleted', false)
        .neq('status', 'cancelled')
        .gt('total_price', 0)
        .limit(300);
      if (bErr) throw bErr;

      type Embed = { name?: string | null } | { name?: string | null }[] | null;
      const pickName = (v: Embed): string | null => {
        if (!v) return null;
        if (Array.isArray(v)) return v[0]?.name ?? null;
        return v.name ?? null;
      };

      const candidates: BookingCandidate[] = ((bookingRows ?? []) as any[]).map(b => ({
        id: b.id,
        booking_no: b.booking_no,
        package_title: undefined,
        total_price: b.total_price ?? 0,
        total_cost: b.total_cost ?? 0,
        paid_amount: b.paid_amount ?? 0,
        total_paid_out: b.total_paid_out ?? 0,
        status: b.status ?? '',
        payment_status: b.payment_status ?? undefined,
        customer_name: pickName(b.customers) ?? undefined,
        actual_payer_name: b.actual_payer_name ?? null,
        passenger_names: [],
      }));

      const raw = matchPaymentToBookings({
        amount: amountAbs,
        senderName: tx.counterparty_name ?? null,
        bookings: candidates,
      });
      const guarded = applyDuplicateNameGuard(raw);

      const top = guarded
        .filter(m => m.confidence >= 0.6)
        .slice(0, 3)
        .map(m => ({
          kind: 'booking_match' as const,
          score: m.confidence,
          booking: {
            id: m.booking.id,
            booking_no: m.booking.booking_no ?? '',
            customer_name: m.booking.customer_name ?? null,
            total_price: m.booking.total_price ?? 0,
            paid_amount: m.booking.paid_amount ?? 0,
          },
          reasons: m.reasons,
          matchType: m.matchType,
        }));

      return NextResponse.json({
        type: tx.is_refund ? 'refund' : 'inflow',
        transaction: {
          id: tx.id,
          amount: tx.amount,
          counterparty_name: tx.counterparty_name,
          received_at: tx.received_at,
          is_refund: tx.is_refund,
        },
        candidates: top,
      });
    }

    // ── 출금: operator fuzzy → subset-sum ─────────────────────
    const { data: opRows, error: opErr } = await supabaseAdmin
      .from('land_operators')
      .select('id, name, aliases')
      .eq('is_active', true);
    if (opErr) throw opErr;

    type OpRow = { id: string; name: string; aliases: string[] | null };
    const ops = (opRows ?? []) as OpRow[];

    const opCandidates = ops
      .map(o => ({ op: o, score: operatorScore(tx.counterparty_name ?? '', o.aliases ?? []) }))
      .filter(x => x.score >= 0.5)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const candidates: any[] = [];
    for (const { op, score: opMatchScore } of opCandidates) {
      const { data: unsettledRows, error: uErr } = await supabaseAdmin
        .from('bookings')
        .select(
          'id, booking_no, total_cost, total_paid_out, departure_date, customers!lead_customer_id(name)',
        )
        .eq('land_operator_id', op.id)
        .eq('is_deleted', false)
        .neq('status', 'cancelled')
        .order('departure_date', { ascending: true });
      if (uErr) continue;

      type UR = {
        id: string;
        booking_no: string;
        total_cost: number | null;
        total_paid_out: number | null;
        departure_date: string | null;
        customers: { name?: string | null } | { name?: string | null }[] | null;
      };
      const unsettled = ((unsettledRows ?? []) as UR[])
        .map(b => {
          const cust = b.customers;
          const customerName = !cust
            ? null
            : Array.isArray(cust)
              ? cust[0]?.name ?? null
              : cust.name ?? null;
          const remaining = Math.max(0, (b.total_cost ?? 0) - (b.total_paid_out ?? 0));
          return {
            id: b.id,
            booking_no: b.booking_no,
            customer_name: customerName,
            departure_date: b.departure_date,
            unsettled_amount: remaining,
          };
        })
        .filter(b => b.unsettled_amount > 0)
        .slice(0, 25); // subset-sum 입력 N 제한

      if (unsettled.length === 0) continue;

      const match = findSubsetSum(
        unsettled.map(b => ({ id: b.id, amount: b.unsettled_amount })),
        amountAbs,
        { tolerance: TOLERANCE, deadlineMs: 250, maxItems: 10 },
      );
      if (!match) continue;

      const bookingMap = new Map(unsettled.map(b => [b.id, b]));
      const matched = match.items.map(i => {
        const b = bookingMap.get(i.id)!;
        return {
          id: b.id,
          booking_no: b.booking_no,
          customer_name: b.customer_name,
          departure_date: b.departure_date,
          amount: i.amount,
        };
      });

      candidates.push({
        kind: 'settlement_bundle',
        score: opMatchScore,
        operator: { id: op.id, name: op.name },
        bookings: matched,
        bundled_total: match.total,
        fee_amount: amountAbs - match.total,
      });

      if (candidates.length >= 1) break; // 첫 번째 매치 1개만 (사장님 1-click)
    }

    return NextResponse.json({
      type: 'outflow',
      transaction: {
        id: tx.id,
        amount: tx.amount,
        counterparty_name: tx.counterparty_name,
        received_at: tx.received_at,
      },
      candidates,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '제안 실패' },
      { status: 500 },
    );
  }
}
