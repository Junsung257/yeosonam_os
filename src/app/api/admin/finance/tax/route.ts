import { NextResponse, type NextRequest } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';
import { needsCustomerCashReceipt } from '@/lib/finance-settlement-v3';
import { loadFinanceBookingReviews } from '@/lib/finance-settlement-v3-service';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function money(value: unknown): number {
  return Math.round(Number(value) || 0);
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '정산 데이터베이스가 연결되지 않았습니다.' }, { status: 503 });
  }

  const month = request.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return NextResponse.json({ error: '출발 월은 YYYY-MM 형식이어야 합니다.' }, { status: 400 });
  }

  try {
    const finance = await loadFinanceBookingReviews({ month, includeExcluded: false });
    const ids = finance.rows.map(row => row.id);
    const { data, error } = ids.length === 0
      ? { data: [], error: null }
      : await supabaseAdmin
        .from('bookings')
        .select('id, booking_no, package_title, land_operator, total_price, total_cost, departure_date, booking_date, payment_date, notes, status, transfer_status, transfer_receipt_url, has_tax_invoice, customer_receipt_status, customers!lead_customer_id(id, name, phone)')
        .in('id', ids)
        .eq('finance_excluded', false)
        .or('is_deleted.is.null,is_deleted.eq.false')
        .neq('status', 'cancelled')
        .order('departure_date', { ascending: true });
    if (error) throw error;

    const financeById = new Map(finance.rows.map(row => [row.id, row]));
    const bookings = (data ?? []).map(booking => {
      const cash = financeById.get(booking.id as string)!;
      return {
        ...booking,
        paid_amount: cash.deposits,
        total_paid_out: cash.travelWithdrawals,
        customer_refunds: cash.customerRefunds,
        bank_fees: cash.bankFees,
        cash_margin: cash.cashMargin,
        review_status: cash.reviewStatus,
        travel_key: cash.travelKey,
        price_unconfirmed: money(booking.total_price) === 0,
      };
    });

    const totalPrice = bookings.reduce((sum, row) => sum + money(row.total_price), 0);
    const totalCost = bookings.reduce((sum, row) => sum + money(row.total_cost), 0);
    const totalPaid = bookings.reduce((sum, row) => sum + money(row.paid_amount), 0);
    const travelPaidOut = bookings.reduce((sum, row) => sum + money(row.total_paid_out), 0);
    const totalRefunds = bookings.reduce((sum, row) => sum + money(row.customer_refunds), 0);
    const cashMargin = bookings.reduce((sum, row) => sum + money(row.cash_margin), 0);
    const bookMargin = totalPrice - totalCost;
    const estimatedTax = Math.max(0, Math.round(cashMargin * 0.1));
    const pendingTransfers = bookings.filter(row => money(row.total_cost) > 0
      && money(row.total_paid_out) < money(row.total_cost)
      && row.transfer_status === 'PENDING');
    const notIssuedReceipts = bookings.filter(row => needsCustomerCashReceipt({
      paidAmount: row.paid_amount,
      receiptTargetAmount: row.total_price,
      receiptStatus: row.customer_receipt_status,
    }));
    const priceUnconfirmed = bookings.filter(row => money(row.total_price) === 0);
    const costUnconfirmed = bookings.filter(row => money(row.total_cost) === 0);
    const reviewPending = bookings.filter(row => row.review_status === 'pending' || row.review_status === 'deferred');

    return NextResponse.json({
      basis: {
        bank: 'Clobe 신한 4128 활성 배분',
        book: '예약 판매가·예정원가',
        warning: '예상 세금은 신고 금액이 아닙니다.',
      },
      bookings,
      kpis: {
        total_price: totalPrice,
        total_cost: totalCost,
        total_paid: totalPaid,
        total_paid_out: travelPaidOut,
        customer_refunds: totalRefunds,
        cash_margin: cashMargin,
        receivable: Math.max(0, totalPrice - totalPaid),
        payable: Math.max(0, totalCost - travelPaidOut),
        net_sales: bookMargin,
        vat_estimate: estimatedTax,
        net_profit_estimate: cashMargin - estimatedTax,
      },
      todos: {
        pending_transfers: pendingTransfers,
        not_issued_receipts: notIssuedReceipts,
        price_unconfirmed: priceUnconfirmed,
        cost_unconfirmed: costUnconfirmed,
        review_pending: reviewPending,
      },
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '세금·증빙 데이터를 불러오지 못했습니다.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
