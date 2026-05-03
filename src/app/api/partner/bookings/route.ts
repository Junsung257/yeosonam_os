/**
 * GET /api/partner/bookings
 *
 * 랜드사 파트너 포털 — 확정 예약 목록 조회
 * Authorization: Bearer {portal_access_token}
 *
 * status IN ('deposit_paid', 'waiting_balance', 'fully_paid') 만 반환
 * lead_customer_id 는 개인정보 보호를 위해 제외
 *
 * 응답:
 *   { operator: { id, name }, bookings: [{ booking_no, package_title, departure_date, adult_count, status, created_at }] }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CONFIRMED_STATUSES = ['deposit_paid', 'waiting_balance', 'fully_paid'] as const;

function extractBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'Supabase 미설정' }, { status: 500 });
  }

  const token = extractBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: '인증 토큰이 없습니다. Authorization: Bearer {token} 헤더를 포함해주세요.' },
      { status: 401 },
    );
  }

  try {
    // 토큰으로 랜드사 인증
    const { data: operators, error: opError } = await supabaseAdmin
      .from('land_operators')
      .select('id, name')
      .eq('portal_access_token', token)
      .eq('portal_enabled', true)
      .limit(1);

    if (opError) throw opError;

    const operator = operators?.[0] ?? null;
    if (!operator) {
      return NextResponse.json(
        { error: '유효하지 않은 토큰이거나 포털 접근이 비활성화되어 있습니다.' },
        { status: 401 },
      );
    }

    // 해당 랜드사의 확정 예약 목록 조회
    // lead_customer_id 제외, travel_packages join으로 패키지 제목 포함
    const { data: bookings, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select(`
        booking_no,
        departure_date,
        adult_count,
        status,
        created_at,
        travel_packages!package_id (
          title,
          land_operator_id
        )
      `)
      .in('status', CONFIRMED_STATUSES)
      .order('departure_date', { ascending: true });

    if (bookingError) throw bookingError;

    // 해당 랜드사 소속 예약만 필터링 (join으로 필터가 어려운 경우 앱 레벨에서)
    const filtered = (bookings ?? [])
      .filter((b: any) => b.travel_packages?.land_operator_id === operator.id)
      .map((b: any) => ({
        booking_no: b.booking_no,
        package_title: b.travel_packages?.title ?? '',
        departure_date: b.departure_date,
        adult_count: b.adult_count,
        status: b.status,
        created_at: b.created_at,
      }));

    return NextResponse.json({
      operator: { id: operator.id, name: operator.name },
      bookings: filtered,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
