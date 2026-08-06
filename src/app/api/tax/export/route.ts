/**
 * GET /api/tax/export?month=YYYY-MM
 * 세무사 제출용 CSV 다운로드 (출발일 기준, UTF-8 BOM)
 */
import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { requireAdminRequest } from '@/lib/admin-guard';
import { loadFinanceBookingReviews } from '@/lib/finance-settlement-v3-service';

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
  const authError = await requireAdminRequest(request);
  if (authError) return authError;

  if (!isSupabaseConfigured) {
    return new NextResponse('Supabase 미설정', { status: 503 });
  }

  const month = request.nextUrl.searchParams.get('month') ??
    new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return new NextResponse('출발 월은 YYYY-MM 형식이어야 합니다.', { status: 400 });
  }

  try {
    const finance = await loadFinanceBookingReviews({ month, includeExcluded: false });
  const financeById = new Map(finance.rows.map(row => [row.id, row]));
  const bookingIds = finance.rows.map(row => row.id);
  const { data, error } = bookingIds.length === 0
    ? { data: [], error: null }
    : await supabaseAdmin
    .from('bookings')
    .select(`
      id, booking_no, package_title, land_operator,
      total_price, total_cost,
      commission_rate, commission_amount,
      departure_date, booking_date, payment_date, notes, status,
      transfer_status, has_tax_invoice, customer_receipt_status,
      customers!lead_customer_id(name)
    `)
    .in('id', bookingIds)
    .eq('finance_excluded', false)
    .or('is_deleted.is.null,is_deleted.eq.false')
    .neq('status', 'cancelled')
    .order('departure_date', { ascending: true });

  if (error) {
    return new NextResponse(sanitizeDbError(error, 'tax export failed'), { status: 500 });
  }

  const bookings = (data ?? []).map(booking => ({
    ...booking,
    finance: financeById.get(booking.id as string),
  }));

  // CSV 헤더
  const headers = [
    '출발일자',
    '결제일자',
    '예약자명',
    '예약번호',
    '상품명',
    '총 판매가',
    '고객 입금액',
    '고객 환불액',
    '고객 미수금',
    '랜드사명',
    '랜드사 예정액',
    '랜드사 송금액',
    '은행 수수료',
    '랜드사 미송금',
    '커미션율(%)',
    '커미션액',
    '장부 예상마진',
    '통장 현금마진',
    '검토 상태',
    '예상 부가세',
    '예상 순수익',
    '랜드사 송금완료(O/X)',
    '세금계산서 수취(O/X)',
    '고객 현금영수증 발행(O/X)',
    '비고',
  ];

  const rows = bookings.map((b: Record<string, unknown>) => {
    const customer = (b as { customers?: { name?: string } }).customers;
    const totalPrice_ = (b.total_price as number | null) ?? 0;
    const totalCost_  = (b.total_cost  as number | null) ?? 0;
    const financeRow = b.finance as ReturnType<typeof financeById.get>;
    const paidAmount_ = financeRow?.deposits ?? 0;
    const refunds_ = financeRow?.customerRefunds ?? 0;
    const paidOut_ = financeRow?.travelWithdrawals ?? 0;
    const bankFees_ = financeRow?.bankFees ?? 0;
    const cashMargin_ = financeRow?.cashMargin ?? 0;
    const receivable = Math.max(0, totalPrice_ - paidAmount_);
    const payable = Math.max(0, totalCost_ - paidOut_);
    const bookMargin = totalPrice_ - totalCost_;
    const taxEstimate = Math.max(0, Math.round(cashMargin_ * 0.1));
    const payment_dt = (b.payment_date ?? b.booking_date ?? '') as string;

    return [
      b.departure_date ?? '',
      payment_dt ? payment_dt.slice(0, 10) : '',
      customer?.name ?? '',
      b.booking_no ?? '',
      b.package_title ?? '',
      totalPrice_,
      paidAmount_,
      refunds_,
      receivable,
      b.land_operator ?? '',
      totalCost_,
      paidOut_,
      bankFees_,
      payable,
      b.commission_rate ?? '',
      b.commission_amount ?? '',
      bookMargin,
      cashMargin_,
      financeRow?.reviewStatus ?? 'pending',
      taxEstimate,
      cashMargin_ - taxEstimate,
      b.transfer_status === 'COMPLETED' ? 'O' : 'X',
      b.has_tax_invoice ? 'O' : 'X',
      receiptLabel((b.customer_receipt_status as string | null) ?? null),
      b.notes ?? '',
    ].map(escapeCSV).join(',');
  });

  // 합계 행
  const summary = bookings.reduce((sum, booking) => {
    const financeRow = booking.finance;
    const totalPrice = Number(booking.total_price) || 0;
    const totalCost = Number(booking.total_cost) || 0;
    const cashMargin = financeRow?.cashMargin ?? 0;
    sum.totalPrice += totalPrice;
    sum.totalCost += totalCost;
    sum.paidAmount += financeRow?.deposits ?? 0;
    sum.refunds += financeRow?.customerRefunds ?? 0;
    sum.paidOut += financeRow?.travelWithdrawals ?? 0;
    sum.bankFees += financeRow?.bankFees ?? 0;
    sum.receivable += Math.max(0, totalPrice - (financeRow?.deposits ?? 0));
    sum.payable += Math.max(0, totalCost - (financeRow?.travelWithdrawals ?? 0));
    sum.bookMargin += totalPrice - totalCost;
    sum.cashMargin += cashMargin;
    return sum;
  }, { totalPrice: 0, totalCost: 0, paidAmount: 0, refunds: 0, paidOut: 0, bankFees: 0, receivable: 0, payable: 0, bookMargin: 0, cashMargin: 0 });
  const summaryTax = Math.max(0, Math.round(summary.cashMargin * 0.1));
  const summaryRow   = [
    `${month} 합계`,
    '', '', '', '',
    summary.totalPrice,
    summary.paidAmount,
    summary.refunds,
    summary.receivable,
    '',
    summary.totalCost,
    summary.paidOut,
    summary.bankFees,
    summary.payable,
    '', '',
    summary.bookMargin,
    summary.cashMargin,
    '',
    summaryTax,
    summary.cashMargin - summaryTax,
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
  } catch (error) {
    return new NextResponse(sanitizeDbError(error, 'tax export failed'), { status: 500 });
  }
}
