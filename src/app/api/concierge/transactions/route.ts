import { NextResponse } from 'next/server';
import { listTransactions, isSupabaseConfigured } from '@/lib/supabase';

// GET /api/concierge/transactions
export async function GET() {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ transactions: [] });
  }
  const transactions = await listTransactions(100);
  return NextResponse.json({ transactions });
}
