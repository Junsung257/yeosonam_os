import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * GET /api/bookings/unsettled?landOperatorId=UUID
 *
 * 특정 랜드사로 정산 대기중인 booking 후보 리스트.
 * 정의: total_cost > total_paid_out 이고 status != 'cancelled', is_deleted=false.
 *
 * SettlementBundleModal 의 booking 후보 제공.
 */
export async function GET(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ bookings: [] });
  }

  const landOperatorId = req.nextUrl.searchParams.get('landOperatorId');
  if (!landOperatorId) {
    return NextResponse.json({ error: 'landOperatorId 필수' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select(
        'id, booking_no, departure_date, total_cost, total_paid_out, status, payment_status, customers!lead_customer_id(name)',
      )
      .eq('land_operator_id', landOperatorId)
      .eq('is_deleted', false)
      .neq('status', 'cancelled')
      .order('departure_date', { ascending: true, nullsFirst: false })
      .limit(50);

    if (error) throw error;

    type Row = {
      id: string;
      booking_no: string;
      departure_date: string | null;
      total_cost: number | null;
      total_paid_out: number | null;
      status: string | null;
      payment_status: string | null;
      customers: { name?: string | null } | { name?: string | null }[] | null;
    };

    const pickName = (v: Row['customers']): string | null => {
      if (!v) return null;
      if (Array.isArray(v)) return v[0]?.name ?? null;
      return v.name ?? null;
    };

    const bookings = ((data ?? []) as Row[])
      .map(b => {
        const totalCost = b.total_cost ?? 0;
        const paidOut = b.total_paid_out ?? 0;
        const unsettledAmount = Math.max(0, totalCost - paidOut);
        return {
          id: b.id,
          booking_no: b.booking_no,
          customer_name: pickName(b.customers),
          departure_date: b.departure_date,
          total_cost: totalCost,
          total_paid_out: paidOut,
          unsettled_amount: unsettledAmount,
          status: b.status,
          payment_status: b.payment_status,
        };
      })
      .filter(b => b.unsettled_amount > 0);

    return NextResponse.json({ bookings });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '조회 실패' },
      { status: 500 },
    );
  }
}
