import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { verifyInfluencerPinForReferral } from '@/lib/affiliate-influencer-auth';
import { issueAffiliateToken } from '@/lib/affiliate/jwt-auth';

// POST /api/influencer/auth — PIN 인증 → JWT 발급
export async function POST(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const { code, pin } = body;

    if (!code || !pin) {
      return NextResponse.json({ error: '추천코드와 PIN이 필요합니다.' }, { status: 400 });
    }

    const v = await verifyInfluencerPinForReferral(code, String(pin));
    if (!v.ok) {
      return NextResponse.json({ error: 'PIN이 일치하지 않습니다.' }, { status: 401 });
    }

    // 어필리에이트 정보 조회
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code, grade, grade_label, grade_rate, logo_url')
      .eq('id', v.affiliateId)
      .single();

    if (!affiliate) {
      return NextResponse.json({ error: '파트너 정보를 찾을 수 없습니다.' }, { status: 404 });
    }

    // JWT 발급 (httpOnly 쿠키 + 응답 바디)
    const token = await issueAffiliateToken({
      id: affiliate.id,
      referral_code: affiliate.referral_code,
      name: affiliate.name,
    });

    const response = NextResponse.json({
      affiliate: {
        id: affiliate.id,
        name: affiliate.name,
        referral_code: affiliate.referral_code,
        grade: affiliate.grade,
        grade_label: affiliate.grade_label,
        grade_rate: affiliate.grade_rate,
        logo_url: affiliate.logo_url,
      },
      token,
    });

    // httpOnly 쿠키 설정 (7일 만료)
    response.cookies.set('inf_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7일
    });

    return response;
  } catch (error) {
    console.error('[Influencer Auth]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '인증 실패' },
      { status: 500 },
    );
  }
}

// GET /api/influencer/auth — 현재 인증 상태 확인 (쿠키 기반)
export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json({ error: 'DB 미설정' }, { status: 503 });
  }

  const token = request.cookies.get('inf_token')?.value;
  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 200 });
  }

  const { verifyAffiliateToken } = await import('@/lib/affiliate/jwt-auth');
  const v = await verifyAffiliateToken(token);
  if (!v.ok) {
    // 토큰 만료/무효 → 쿠키 삭제
    const response = NextResponse.json({ authenticated: false }, { status: 200 });
    response.cookies.set('inf_token', '', { httpOnly: true, path: '/', maxAge: 0 });
    return response;
  }

  // 어필리에이트 정보 재조회 (grade 등 업데이트 반영)
  const { data: affiliate } = await supabaseAdmin
    .from('affiliates')
    .select('id, name, referral_code, grade, grade_label, grade_rate, logo_url')
    .eq('id', v.affiliateId)
    .single();

  if (!affiliate) {
    const response = NextResponse.json({ authenticated: false }, { status: 200 });
    response.cookies.set('inf_token', '', { httpOnly: true, path: '/', maxAge: 0 });
    return response;
  }

  return NextResponse.json({
    authenticated: true,
    affiliate: {
      id: affiliate.id,
      name: affiliate.name,
      referral_code: affiliate.referral_code,
      grade: affiliate.grade,
      grade_label: affiliate.grade_label,
      grade_rate: affiliate.grade_rate,
      logo_url: affiliate.logo_url,
    },
  });
}

// DELETE /api/influencer/auth — 로그아웃 (쿠키 삭제)
export async function DELETE(_request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set('inf_token', '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
