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
  const travelTransactionIds = transactions
    .filter(row => row.id && row.settlement_scope === 'travel')
    .map(row => row.id as string);
  const allocations: BookingCashAllocationRow[] = [];
  let bookings: BookingCashBookingRow[] = [];

  if (travelTransactionIds.length > 0) {
    const allocationResults = await Promise.all(chunkIds(travelTransactionIds).map(ids => supabaseAdmin
      .from('bank_transaction_allocations')
      .select('bank_transaction_id, booking_id, allocated_amount')
      .in('bank_transaction_id', ids)
      .eq('status', 'active')
      .is('reversed_at', null)));
    for (const result of allocationResults) {
      if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
      }
      allocations.push(...((result.data ?? []) as BookingCashAllocationRow[]));
    }

    const bookingIds = [...new Set(allocations.map(allocation => allocation.booking_id))];
    if (bookingIds.length > 0) {
      const { data: bookingData, error: bookingError } = await supabaseAdmin
        .from('bookings')
        .select('id, departure_date, settlement_confirmed_at, total_price, total_cost')
        .in('id', bookingIds);
      if (bookingError) {
        return NextResponse.json({ error: bookingError.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
      }
      bookings = (bookingData ?? []) as BookingCashBookingRow[];
    }
  }

  const bankSummary = calculateBankAccountReality(transactions);
  const bookingCash = calculateBookingCashPositions({ transactions, allocations, bookings });
  const profitErp = calculateBankProfitErp({
    bankSummary,
    bookingCash,
    transactions,
    allocations,
    bookings,
    referenceDate: bankSummary.asOf ?? new Date(),
  });

  return NextResponse.json({
    summary: { ...bankSummary, bookingCash, profitErp },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
