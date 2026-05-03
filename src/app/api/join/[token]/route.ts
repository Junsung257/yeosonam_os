import { NextRequest, NextResponse } from 'next/server';
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

export async function GET(
  _request: NextRequest,
  { params }: { params: { token: string } },
) {
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
    const booking = Array.isArray(row.bookings) ? row.bookings[0] : row.bookings;
    const pkg = booking
      ? Array.isArray((booking as { travel_packages: unknown }).travel_packages)
        ? ((booking as { travel_packages: unknown[] }).travel_packages[0] as { title: string } | undefined)
        : (booking as { travel_packages: { title: string } }).travel_packages
      : null;

    return NextResponse.json({
      alreadySubmitted: !!row.submitted_at,
      booking: booking
        ? {
            departure_date: (booking as { departure_date: string }).departure_date,
            product_title: (pkg as { title: string } | null)?.title ?? null,
          }
        : null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { token: string } },
) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const { token } = params;
    const body = await request.json().catch(() => ({}));

    const { name, passport_name, passport_no, birth_date, phone, email } = body;

    // ── 필수값 검증 ───────────────────────────────────────────
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: '이름은 필수입니다.' }, { status: 400 });
    }
    if (!passport_name || typeof passport_name !== 'string') {
      return NextResponse.json({ error: '여권 영문 이름은 필수입니다.' }, { status: 400 });
    }
    if (!passport_no || typeof passport_no !== 'string') {
      return NextResponse.json({ error: '여권 번호는 필수입니다.' }, { status: 400 });
    }
    if (!birth_date || typeof birth_date !== 'string') {
      return NextResponse.json({ error: '생년월일은 필수입니다.' }, { status: 400 });
    }
    if (!phone || typeof phone !== 'string') {
      return NextResponse.json({ error: '전화번호는 필수입니다.' }, { status: 400 });
    }

    // ── 토큰 유효성 + 중복 제출 방지 ────────────────────────
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('booking_companions')
      .select('id, submitted_at')
      .eq('invite_token', token)
      .limit(1);

    if (fetchError) throw fetchError;
    if (!existing || existing.length === 0) {
      return NextResponse.json({ error: '유효하지 않은 초대 링크입니다.' }, { status: 404 });
    }

    const row = existing[0];
    if (row.submitted_at) {
      return NextResponse.json({ error: '이미 제출된 정보입니다.' }, { status: 409 });
    }

    // ── 여권 정보 저장 ────────────────────────────────────────
    const { error: updateError } = await supabaseAdmin
      .from('booking_companions')
      .update({
        name: name.trim(),
        passport_name: passport_name.trim().toUpperCase(),
        passport_no: passport_no.trim().toUpperCase(),
        birth_date,
        phone: phone.trim(),
        ...(email ? { email: (email as string).trim() } : {}),
        submitted_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '처리 실패' },
      { status: 500 },
    );
  }
}
