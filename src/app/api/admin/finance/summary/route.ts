import { NextResponse, type NextRequest } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';
import { loadFinanceCenterSummary } from '@/lib/finance-center-service';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '정산 데이터베이스가 연결되지 않았습니다.' }, { status: 503 });
  }

  try {
    const rawRate = Number(request.nextUrl.searchParams.get('taxRate') ?? 0.1);
    const taxRate = Number.isFinite(rawRate) ? Math.max(0, Math.min(1, rawRate)) : 0.1;
    const summary = await loadFinanceCenterSummary(taxRate);
    return NextResponse.json({ summary }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '정산 요약을 불러오지 못했습니다.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
