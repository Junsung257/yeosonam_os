import { NextRequest, NextResponse } from 'next/server';

import { requireAdminRequest } from '@/lib/admin-guard';
import { loadMonthlySettlementPreview } from '@/lib/finance-center-service';
import {
  assertCompletedSettlementMonth,
  type MonthlySettlementClosePreview,
} from '@/lib/monthly-settlement-close';
import { isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readMonth(value: unknown): string {
  if (typeof value !== 'string') throw new Error('마감할 출발 월을 선택해주세요.');
  assertCompletedSettlementMonth(value);
  return value;
}

async function loadPreview(month: string): Promise<MonthlySettlementClosePreview> {
  return loadMonthlySettlementPreview(month);
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: '정산 데이터베이스가 연결되지 않았습니다.' }, { status: 503 });
  }

  try {
    const month = readMonth(request.nextUrl.searchParams.get('month'));
    const preview = await loadPreview(month);
    return NextResponse.json({ preview }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '월 마감 미리보기를 불러오지 못했습니다.';
    const status = /월|YYYY-MM|연도/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminRequest(request);
  if (authError) return authError;
  return NextResponse.json({
    error: '예전 월 확정 방식은 중단되었습니다. 정산센터에서 예약별 확인을 마친 뒤 월 마감을 진행해주세요.',
    financeCenterUrl: '/admin/finance?tab=periods',
  }, { status: 409, headers: { 'Cache-Control': 'private, no-store' } });
}
