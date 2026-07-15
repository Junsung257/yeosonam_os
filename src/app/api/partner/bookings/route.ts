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
import { getPublishedPartnerPackages } from '@/lib/public-packages';

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

    const { data: operatorPackages, error: operatorPackagesError } = await supabaseAdmin
      .from('travel_packages')
      .select('id')
      .eq('land_operator_id', operator.id);
    if (operatorPackagesError) throw operatorPackagesError;
    const operatorPackageIds = new Set((operatorPackages ?? []).map(row => String(row.id)));

    // lead_customer_id와 원본 상품 문구는 반환하지 않는다.
    const { data: bookings, error: bookingError } = await supabaseAdmin
      .from('bookings')
      .select(`
        booking_no,
        package_id,
        departure_date,
        adult_count,
        status,
        created_at
      `)
      .in('status', CONFIRMED_STATUSES)
      .order('departure_date', { ascending: true });

    if (bookingError) throw bookingError;

    type BookingRow = {
      booking_no: string | null;
      departure_date: string | null;
      adult_count: number | null;
      status: string;
      created_at: string | null;
      package_id: string | null;
    };

    const operatorBookings = (bookings as BookingRow[] ?? [])
      .filter(booking => booking.package_id && operatorPackageIds.has(booking.package_id));
    const publicPackages = await getPublishedPartnerPackages(
      supabaseAdmin,
      operatorBookings.map(booking => String(booking.package_id)),
    );
    const titleByPackageId = new Map(publicPackages.map(pkg => [String(pkg.package_id ?? pkg.id), String(pkg.title ?? '')]));
    const filtered = operatorBookings
      .map((b) => {
        return {
          booking_no: b.booking_no,
          package_title: titleByPackageId.get(String(b.package_id)) ?? '',
          departure_date: b.departure_date,
          adult_count: b.adult_count,
          status: b.status,
          created_at: b.created_at,
        };
      });

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
