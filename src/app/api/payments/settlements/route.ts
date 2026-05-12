import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * GET /api/payments/settlements
 *
 * 출금 정산 묶음 리스트.
 * Query: status (all|pending|confirmed|reversed), limit (default 50), operator_id
 */
export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ settlements: [] });
  }

  const status = req.nextUrl.searchParams.get('status') ?? 'all';
  const limit = Math.min(200, Number(req.nextUrl.searchParams.get('limit')) || 50);
  const operatorId = req.nextUrl.searchParams.get('operator_id');

  try {
    let query = supabaseAdmin
      .from('land_settlements')
      .select(
        'id, land_operator_id, bank_transaction_id, total_amount, bundled_total, fee_amount, is_refund, status, notes, created_at, created_by, confirmed_at, confirmed_by, reversed_at, reversed_by, reversal_reason, ' +
          'land_operators!land_operator_id(name), ' +
          'bank_transactions!bank_transaction_id(received_at, counterparty_name, memo), ' +
          'land_settlement_bookings(amount, bookings!booking_id(id, booking_no, departure_date, customers!lead_customer_id(name)))',
      )
      .order('created_at', { ascending: false })
      .limit(limit);

    if (status !== 'all') query = query.eq('status', status);
    if (operatorId) query = query.eq('land_operator_id', operatorId);

    const { data, error } = await query;
    if (error) throw error;

    type Embed1 = { name?: string | null } | { name?: string | null }[] | null;
    type TxEmbed =
      | { received_at?: string | null; counterparty_name?: string | null; memo?: string | null }
      | { received_at?: string | null; counterparty_name?: string | null; memo?: string | null }[]
      | null;
    const pickName = (v: Embed1): string | null => {
      if (!v) return null;
      if (Array.isArray(v)) return v[0]?.name ?? null;
      return v.name ?? null;
    };
    const pickTx = (v: TxEmbed) => {
      if (!v) return null;
      if (Array.isArray(v)) return v[0] ?? null;
      return v;
    };

    const settlements = ((data ?? []) as any[]).map(row => {
      const lsb = (row.land_settlement_bookings ?? []) as Array<{
        amount: number;
        bookings: { id: string; booking_no: string; departure_date: string | null; customers: Embed1 } | null;
      }>;
      const tx = pickTx(row.bank_transactions);
      return {
        id: row.id,
        land_operator_id: row.land_operator_id,
        land_operator_name: pickName(row.land_operators),
        bank_transaction_id: row.bank_transaction_id,
        transaction_received_at: tx?.received_at ?? null,
        transaction_counterparty: tx?.counterparty_name ?? null,
        total_amount: row.total_amount,
        bundled_total: row.bundled_total,
        fee_amount: row.fee_amount,
        is_refund: row.is_refund,
        status: row.status,
        notes: row.notes,
        created_at: row.created_at,
        created_by: row.created_by,
        confirmed_at: row.confirmed_at,
        confirmed_by: row.confirmed_by,
        reversed_at: row.reversed_at,
        reversed_by: row.reversed_by,
        reversal_reason: row.reversal_reason,
        bookings: lsb.map(b => ({
          id: b.bookings?.id ?? null,
          booking_no: b.bookings?.booking_no ?? null,
          customer_name: b.bookings ? pickName(b.bookings.customers) : null,
          departure_date: b.bookings?.departure_date ?? null,
          amount: b.amount,
        })),
      };
    });

    return NextResponse.json({ settlements });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
