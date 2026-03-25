/**
 * GET /api/tax/export?month=YYYY-MM
 * 세무사 제출용 CSV 다운로드 (출발일 기준, UTF-8 BOM)
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

function escapeCSV(value: unknown): string {
  const str = value == null ? '' : String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function receiptLabel(status: string | null): string {
  if (status === 'ISSUED')       return 'O';
  if (status === 'NOT_REQUIRED') return 'N/A';
  return 'X';
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return new NextResponse('Supabase 미설정', { status: 503 });
  }

  const month = request.nextUrl.searchParams.get('month') ??
    new Date().toISOString().slice(0, 7);

  const { from, to } = monthRange(month);

  const { data, error } = await supabase
    .from('bookings')
    .select(`
      booking_no, package_title, land_operator,
      total_price, total_cost,
      departure_date, booking_date, payment_date, notes, status,
      transfer_status, has_tax_invoice, customer_receipt_status,
      customers!lead_customer_id(name)
    `)
    .gte('departure_date', from)
    .lte('departure_date', to)
    .or('is_deleted.is.null,is_deleted.eq.false')
    .order('departure_date', { ascending: true });

  if (error) {
    return new NextResponse(error.message, { status: 500 });
  }

  const bookings = data ?? [];

  // CSV 헤더
  const headers = [
    '출발일자',
    '결제일자',
    '예약자명',
    '예약번호',
    '총 판매가',
    '랜드사명',
    '송금한 원가',
    '순매출',
    '랜드사 송금완료(O/X)',
    '세금계산서 수취(O/X)',
    '고객 현금영수증 발행(O/X)',
    '비고',
  ];

  const rows = bookings.map((b: Record<string, unknown>) => {
    const customer = (b as { customers?: { name?: string } }).customers;
    const totalPrice_ = (b.total_price as number | null) ?? 0;
    const totalCost_  = (b.total_cost  as number | null) ?? 0;
    const net_sales = totalPrice_ - totalCost_;
    const payment_dt = (b.payment_date ?? b.booking_date ?? '') as string;

    return [
      b.departure_date ?? '',
      payment_dt ? payment_dt.slice(0, 10) : '',
      customer?.name ?? '',
      b.booking_no ?? '',
      totalPrice_,
      b.land_operator ?? '',
      totalCost_,
      net_sales,
      b.transfer_status === 'COMPLETED' ? 'O' : 'X',
      b.has_tax_invoice ? 'O' : 'X',
      receiptLabel((b.customer_receipt_status as string | null) ?? null),
      b.notes ?? '',
    ].map(escapeCSV).join(',');
  });

  // 합계 행
  const totalPrice   = bookings.reduce((s: number, b: Record<string, unknown>) => s + (((b.total_price as number | null) ?? 0)), 0);
  const totalCost    = bookings.reduce((s: number, b: Record<string, unknown>) => s + (((b.total_cost  as number | null) ?? 0)), 0);
  const totalNet     = totalPrice - totalCost;
  const summaryRow   = [
    `${month} 합계`,
    '', '', '',
    totalPrice,
    '',
    totalCost,
    totalNet,
    '', '', '', '',
  ].map(escapeCSV).join(',');

  const csvContent = [
    headers.map(escapeCSV).join(','),
    ...rows,
    '',
    summaryRow,
  ].join('\r\n');

  // UTF-8 BOM (한글 Excel 호환)
  const bom = '\uFEFF';
  const filename = encodeURIComponent(`세무기장_${month}.csv`);

  return new NextResponse(bom + csvContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
