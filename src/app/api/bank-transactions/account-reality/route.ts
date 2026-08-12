import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';
import {
  calculateBankAccountReality,
  calculateBankProfitErp,
  calculateBookingCashPositions,
  YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER,
  type BookingCashAllocationRow,
  type BookingCashBookingRow,
  type BankAccountRealityRow,
  type SettlementProfitSnapshot,
} from '@/lib/bank-account-reality';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function chunkIds(ids: string[], size = 100): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += size) chunks.push(ids.slice(index, index + size));
  return chunks;
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  const accountNumber = request.nextUrl.searchParams.get('account_number')?.replace(/\D/g, '')
    || YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER;
  let query = supabaseAdmin
    .from('bank_transactions')
    .select('id, transaction_type, amount, received_at, settlement_scope, account_number, balance_after, memo, counterparty_name, provider_category, provider_is_unclassified')
    .eq('external_provider', 'clobe')
    .eq('source', 'clobe_mcp')
    .eq('status', 'active')
    .order('received_at', { ascending: true })
    .limit(5000);
  query = query.eq('account_number', accountNumber) as typeof query;

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }

  const transactions = (data ?? []) as BankAccountRealityRow[];
  const transactionIds = transactions
    .filter(row => row.id)
    .map(row => row.id as string);
  const allocations: BookingCashAllocationRow[] = [];
  let bookings: BookingCashBookingRow[] = [];

  if (transactionIds.length > 0) {
    const allocationResults = await Promise.all(chunkIds(transactionIds).map(ids => supabaseAdmin
      .from('bank_transaction_allocations')
      .select('bank_transaction_id, booking_id, allocated_amount, target_type')
      .in('bank_transaction_id', ids)
      .eq('status', 'active')
      .is('reversed_at', null)));
    for (const result of allocationResults) {
      if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
      }
      allocations.push(...((result.data ?? []) as BookingCashAllocationRow[]));
    }

  }

  // Unmatched and zero-transaction bookings can still hold customer money or
  // unpaid supplier cost, so every active finance booking must share the same
  // reserve calculation used by the finance center summary.
  const { data: bookingData, error: bookingError } = await supabaseAdmin
    .from('bookings')
    .select('id, departure_date, settlement_confirmed_at, total_price, total_cost, status, is_deleted, finance_excluded')
    .limit(5000);
  if (bookingError) {
    return NextResponse.json({ error: bookingError.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  bookings = (bookingData ?? []) as BookingCashBookingRow[];

  const { data: currentPeriods, error: periodError } = await supabaseAdmin
    .from('settlement_periods')
    .select('id')
    .eq('is_current', true)
    .in('status', ['closed', 'conditional'])
    .limit(500);
  if (periodError) {
    return NextResponse.json({ error: periodError.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
  const confirmedSettlementItems: SettlementProfitSnapshot[] = [];
  for (const periodIds of chunkIds((currentPeriods ?? []).map(row => row.id as string))) {
    const { data: itemData, error: itemError } = await supabaseAdmin
      .from('settlement_period_items')
      .select('booking_id, departure_date, cash_margin')
      .in('settlement_period_id', periodIds)
      .limit(5000);
    if (itemError) {
      return NextResponse.json({ error: itemError.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
    }
    confirmedSettlementItems.push(...((itemData ?? []) as SettlementProfitSnapshot[]));
  }
  const confirmedBookingIds = new Set(confirmedSettlementItems.map(item => item.booking_id));

  const bankSummary = calculateBankAccountReality(transactions, allocations);
  const bookingCash = calculateBookingCashPositions({ transactions, allocations, bookings, confirmedBookingIds });
  const profitErp = calculateBankProfitErp({
    bankSummary,
    bookingCash,
    transactions,
    allocations,
    bookings,
    confirmedSettlementItems,
    referenceDate: bankSummary.asOf ?? new Date(),
  });

  return NextResponse.json({
    summary: { ...bankSummary, bookingCash, profitErp },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
