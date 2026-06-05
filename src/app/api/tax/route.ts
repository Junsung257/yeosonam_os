import { type NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { requireAdminRequest } from '@/lib/admin-guard';

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;
  return { from, to };
}

const NO_STORE_HEADERS = { 'Cache-Control': 'no-store' };

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) {
    return apiResponse(
      { bookings: [], kpis: {}, todos: {} },
      { headers: NO_STORE_HEADERS },
    );
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
    console.error('[tax] fetch failed:', sanitizeDbError(error));
    return apiResponse(
      { error: sanitizeDbError(error, '조회 실패') },
      { headers: NO_STORE_HEADERS, status: 500 },
    );
  }

  const bookings = data ?? [];

  const total_price = bookings.reduce((s: number, b: Record<string, unknown>) => s + (((b.total_price as number | null) ?? 0)), 0);
  const total_cost = bookings.reduce((s: number, b: Record<string, unknown>) => s + (((b.total_cost as number | null) ?? 0)), 0);
  const net_sales = total_price - total_cost;
  const vat_estimate = Math.floor(net_sales * 0.1);

  const pending_transfers = bookings.filter(
    (b: Record<string, unknown>) => b.transfer_status === 'PENDING' && b.status !== 'cancelled',
  );
  const not_issued_receipts = bookings.filter(
    (b: Record<string, unknown>) => b.customer_receipt_status === 'NOT_ISSUED',
  );

  return apiResponse({
    bookings,
    kpis: { total_price, total_cost, net_sales, vat_estimate },
    todos: { pending_transfers, not_issued_receipts },
  }, { headers: NO_STORE_HEADERS });
}
