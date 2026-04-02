/**
 * 어필리에이트 클릭 추적 API
 * GET /api/influencer/track?ref=CODE&pkg=PACKAGE_ID&sub=YOUTUBE
 *
 * 1. referral_code로 affiliate 조회
 * 2. influencer_links.click_count 증가
 * 3. 쿠키에 ref 코드 저장 (7일 유효)
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true });

  const { searchParams } = request.nextUrl;
  const ref = searchParams.get('ref');
  const pkg = searchParams.get('pkg');
  const sub = searchParams.get('sub') || '';

  if (!ref) return NextResponse.json({ error: 'ref 필요' }, { status: 400 });

  try {
    // 1. affiliate 존재 확인
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code')
      .eq('referral_code', ref)
      .maybeSingle();

    if (!affiliate) return NextResponse.json({ error: '유효하지 않은 추천 코드' }, { status: 404 });

    // 2. influencer_links click_count 증가 (해당 패키지 링크가 있으면)
    if (pkg) {
      const { data: link } = await supabaseAdmin
        .from('influencer_links')
        .select('id, click_count')
        .eq('referral_code', ref)
        .eq('package_id', pkg)
        .maybeSingle();

      if (link) {
        await supabaseAdmin
          .from('influencer_links')
          .update({ click_count: (link.click_count || 0) + 1 })
          .eq('id', link.id);
      }
    }

    // 3. 응답에 쿠키 설정 (7일 유효 — 이 기간 내 예약 시 자동 귀속)
    const response = NextResponse.json({
      ok: true,
      affiliate_id: affiliate.id,
      affiliate_name: affiliate.name,
    });

    response.cookies.set('aff_ref', ref, {
      maxAge: 7 * 24 * 60 * 60, // 7일
      path: '/',
      httpOnly: false, // 프론트에서 읽어야 하므로
      sameSite: 'lax',
    });

    if (sub) {
      response.cookies.set('aff_sub', sub, {
        maxAge: 30 * 24 * 60 * 60,
        path: '/',
        httpOnly: false,
        sameSite: 'lax',
      });
    }

    return response;
  } catch (err) {
    console.error('[Affiliate Track]', err);
    return NextResponse.json({ ok: true }); // 추적 실패해도 사용자 경험 방해 안 함
  }
}
