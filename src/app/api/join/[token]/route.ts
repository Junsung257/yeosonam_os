import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

/**
 * GET /api/join/[token]
 * 토큰으로 동행자 레코드와 연결된 예약 정보를 조회한다.
 * (상품명, 출발일만 노출 — 개인정보 최소화)
 *
 * POST /api/join/[token]
 * 동행자 여권 정보를 저장한다.
 * Body: { name, passport_name, passport_no, birth_date, phone, email? }
 */

export async function GET(_request: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const { token } = params;

    const { data: companion, error } = await supabaseAdmin
      .from('booking_companions')
      .select(
        'id, submitted_at, bookings!booking_id(id, departure_date, travel_packages!package_id(title))',
      )
      .eq('invite_token', token)
      .limit(1);

    if (error) throw error;
    if (!companion || companion.length === 0) {
      return NextResponse.json({ error: '유효하지 않은 초대 링크입니다.' }, { status: 404 });
    }

    const row = companion[0];
    const rawBooking = Array.isArray(row.bookings) ? row.bookings[0] : row.bookings;
    const booking = rawBooking as unknown as { departure_date: string; travel_packages: { title: string }[] } | null;
    const pkg = booking?.travel_packages?.[0] ?? null;

    return NextResponse.json({
      alreadySubmitted: !!row.submitted_at,
      booking: booking
        ? {
            departure_date: booking.departure_date,
            product_title: pkg?.title ?? null,
          }
        : null,
    });
  } catch (err) {
    const requestId = randomUUID();
    console.error('[companion-join:get]', { requestId, error: err });
    return apiResponse(
      {
        ok: false,
        error: {
          code: 'COMPANION_LOOKUP_FAILED',
          message: '초대 정보를 확인할 수 없습니다. 예약 담당자에게 문의해 주세요.',
          requestId,
        },
      },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

export async function POST(
  _request: NextRequest,
  _props: { params: Promise<{ token: string }> },
) {
  const requestId = randomUUID();
  return apiResponse(
    {
      ok: false,
      error: {
        code: 'COMPANION_PII_COLLECTION_UNAVAILABLE',
        message:
          '온라인 동행자 여권정보 제출을 잠시 중단했습니다. 예약 담당자에게 안전한 제출 방법을 문의해 주세요.',
        requestId,
      },
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
