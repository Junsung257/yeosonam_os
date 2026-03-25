import { NextRequest, NextResponse } from 'next/server';
import { getMasterLedger, isSupabaseConfigured } from '@/lib/supabase';

// GET /api/master/ledger?month=YYYY-MM&category=DYNAMIC|FIXED
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ entries: [], kpis: {} });
  const month    = request.nextUrl.searchParams.get('month') ?? new Date().toISOString().slice(0, 7);
  const category = request.nextUrl.searchParams.get('category') as 'DYNAMIC' | 'FIXED' | null;
  const { entries, kpis } = await getMasterLedger(month, category ?? undefined);
  return NextResponse.json({ entries, kpis, month });
}
