import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';
import {
  calculateBankAccountReality,
  YEOSONAM_PRIMARY_BANK_ACCOUNT_NUMBER,
  type BankAccountRealityRow,
} from '@/lib/bank-account-reality';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

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
    .select('transaction_type, amount, received_at, settlement_scope, account_number, balance_after, memo, provider_is_unclassified')
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

  return NextResponse.json({
    summary: calculateBankAccountReality((data ?? []) as BankAccountRealityRow[]),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
