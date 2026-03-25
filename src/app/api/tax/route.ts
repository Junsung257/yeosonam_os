/**
 * GET /api/tax?month=YYYY-MM
 * 출발일 기준 세무 데이터 조회
 * 반환: { bookings, kpis, todos }
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
  return { from, to };
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ bookings: [], kpis: {}, todos: {} });
  }

  const month = request.nextUrl.searchParams.get('month') ??
    new Date().toISOString().slice(0, 7);

  const { from, to } = monthRange(month);

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id, booking_no, package_title, land_operator,
      total_price, total_cost, paid_amount,
      departure_date, booking_date, payment_date, notes, status,
      transfer_status, transfer_receipt_url, has_tax_invoice, customer_receipt_status,
      customers!lead_customer_id(id, name, phone)
    `)
    .gte('departure_date', from)
    .lte('departure_date', to)
    .or('is_deleted.is.null,is_deleted.eq.false')
    .order('departure_date', { ascending: true });

  if (error) {
    console.error('[세무] 조회 실패:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const bookings = data ?? [];

  // KPI 집계 (정수 연산, 1원 오차 없음)
  const total_price = bookings.reduce((s: number, b: Record<string, unknown>) => s + (((b.total_price as number | null) ?? 0)), 0);
  const total_cost  = bookings.reduce((s: number, b: Record<string, unknown>) => s + (((b.total_cost  as number | null) ?? 0)), 0);
  const net_sales   = total_price - total_cost;
  const vat_estimate = Math.floor(net_sales * 0.1);

  // To-Do 알림
  const pending_transfers = bookings.filter(
    (b: Record<string, unknown>) => b.transfer_status === 'PENDING' && b.status !== 'cancelled'
  );
  const not_issued_receipts = bookings.filter(
    (b: Record<string, unknown>) => b.customer_receipt_status === 'NOT_ISSUED'
  );

  return NextResponse.json({
    bookings,
    kpis: { total_price, total_cost, net_sales, vat_estimate },
    todos: { pending_transfers, not_issued_receipts },
  });
}
