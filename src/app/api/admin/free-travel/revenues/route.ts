/**
 * GET /api/admin/free-travel/revenues
 *
 * MRT REVENUES:READ API로 수익 현황을 자동 조회하여 반환.
 * utm_content(세션 ID) 기반으로 free_travel_sessions와 매칭.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getMrtRevenues } from '@/lib/mrt-partner-api';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const startDate      = searchParams.get('from') ?? new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  const endDate        = searchParams.get('to')   ?? new Date().toISOString().slice(0, 10);
  const page           = Number(searchParams.get('page') ?? 1);
  const dateSearchType = (searchParams.get('dateSearchType') ?? 'SETTLEMENT') as 'SETTLEMENT' | 'PAYMENT';

  try {
    const [revenues, sessions] = await Promise.all([
      getMrtRevenues({ startDate, endDate, dateSearchType, page, pageSize: 50 }),
      isSupabaseConfigured && supabaseAdmin
        ? supabaseAdmin.from('free_travel_sessions').select('id, destination, customer_phone, customer_name').then((r: { data: unknown[] | null }) => r.data ?? [])
        : Promise.resolve([]),
    ]);

    if (!revenues) {
      return NextResponse.json({ error: 'MRT API 조회 실패. API Key를 확인하세요.' }, { status: 502 });
    }

    // utmContent(세션 ID)로 세션 매칭
    const sessionMap = new Map((sessions as { id: string; destination: string; customer_phone: string | null; customer_name: string | null }[]).map(s => [s.id, s]));
    const enriched = revenues.items.map(item => ({
      ...item,
      session: item.utmContent ? (sessionMap.get(item.utmContent) ?? null) : null,
    }));

    return NextResponse.json({
      items:      enriched,
      totalCount: revenues.totalCount,
      page:       revenues.page,
      from:       startDate,
      to:         endDate,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '처리 실패' }, { status: 500 });
  }
}
