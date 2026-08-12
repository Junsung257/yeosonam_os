import type { NextRequest } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';
import { apiResponse } from '@/lib/api-response';
import { loadFinanceWorkday } from '@/lib/finance-workday-service';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return apiResponse({ error: '정산 데이터베이스가 연결되지 않았습니다.' }, { status: 503 });
  }

  try {
    const rawRate = Number(request.nextUrl.searchParams.get('taxRate') ?? 0.1);
    const taxRate = Number.isFinite(rawRate) ? Math.max(0, Math.min(1, rawRate)) : 0.1;
    const closeMonth = request.nextUrl.searchParams.get('closeMonth');
    if (closeMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(closeMonth)) {
      return apiResponse({ error: '마감 월은 YYYY-MM 형식이어야 합니다.' }, { status: 400 });
    }
    const workday = await loadFinanceWorkday(taxRate, closeMonth);
    return apiResponse({ workday }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return apiResponse(
      { error: error instanceof Error ? error.message : '오늘 정산 작업을 불러오지 못했습니다.' },
      { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
}
