/**
 * 어필리에이트 클릭 추적 API
 * GET /api/influencer/track?ref=CODE&pkg=PACKAGE_ID&sub=YOUTUBE
 *
 * P0 개편 (2026-04-15):
 *  - aff_ref 쿠키 수명 7일 → 30일 (여행업 리드타임 고려)
 *  - User-Agent 봇 필터: 봇이면 쿠키 미설정, touchpoint에만 is_bot=true 기록
 *  - aff_sid 세션 쿠키 + is_duplicate_click RPC: 같은 세션+ref+pkg 10분 내 재클릭은 click_count 증가 안 함
 *  - unique_visitor_count: 해당 세션이 ref+pkg 조합에 처음 유입된 경우에만 증가
 *  - affiliate_touchpoints: 모든 요청(봇/중복 포함) 플래그 달아 기록 → 멀티터치 분석 기반
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { isBot } from '@/lib/affiliate/bot-filter';
import {
  getOrCreateAffiliateSid,
  hashIp,
  hashUserAgent,
  getClientIp,
} from '@/lib/affiliate/session';

const COOKIE_MAX_AGE_FULL = 30 * 24 * 60 * 60;  // 동의 후 30일
const COOKIE_MAX_AGE_SESSION = 60 * 30;         // 동의 전 30분 (브라우저 세션)

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured) return NextResponse.json({ ok: true });

  const { searchParams } = request.nextUrl;
  const ref = searchParams.get('ref');
  const pkg = searchParams.get('pkg');
  const sub = searchParams.get('sub') || '';

  if (!ref) return NextResponse.json({ error: 'ref 필요' }, { status: 400 });

  const response = NextResponse.json({ ok: true });
  const { sid } = getOrCreateAffiliateSid(request, response);
  const userAgent = request.headers.get('user-agent');
  const botDetected = isBot(userAgent);

  try {
    const { data: affiliate } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code')
      .eq('referral_code', ref)
      .maybeSingle();

    if (!affiliate) {
      return NextResponse.json({ error: '유효하지 않은 추천 코드' }, { status: 404 });
    }

    const ipHash = hashIp(getClientIp(request));
    const uaHash = hashUserAgent(userAgent);

    let isDuplicate = false;
    if (!botDetected) {
      const { data: dupCheck } = await supabaseAdmin.rpc('is_duplicate_click', {
        p_session: sid,
        p_ref: ref,
        p_pkg: pkg,
      });
      isDuplicate = !!dupCheck;
    }

    await supabaseAdmin.from('affiliate_touchpoints').insert({
      session_id: sid,
      referral_code: ref,
      package_id: pkg,
      sub_id: sub || null,
      ip_hash: ipHash,
      user_agent_hash: uaHash,
      is_bot: botDetected,
      is_duplicate: isDuplicate,
    });

    if (botDetected) {
      return NextResponse.json({ ok: true, affiliate_id: affiliate.id, filtered: 'bot' });
    }

    if (pkg && !isDuplicate) {
      const { data: link } = await supabaseAdmin
        .from('influencer_links')
        .select('id, click_count, unique_visitor_count')
        .eq('referral_code', ref)
        .eq('package_id', pkg)
        .maybeSingle();

      if (link) {
        const { data: priorSessionHit } = await supabaseAdmin
          .from('affiliate_touchpoints')
          .select('id')
          .eq('session_id', sid)
          .eq('referral_code', ref)
          .eq('package_id', pkg)
          .eq('is_duplicate', false)
          .eq('is_bot', false)
          .lt('clicked_at', new Date().toISOString())
          .limit(2);

        const isFirstVisit = !priorSessionHit || priorSessionHit.length <= 1;

        await supabaseAdmin
          .from('influencer_links')
          .update({
            click_count: (link.click_count || 0) + 1,
            unique_visitor_count: (link.unique_visitor_count || 0) + (isFirstVisit ? 1 : 0),
          })
          .eq('id', link.id);
      }
    }

    // PIPA 2026-09 대응: 마케팅 쿠키 동의 없으면 30분 세션 쿠키, 동의 시 30일.
    const hasConsent = request.cookies.get('ys_marketing_consent')?.value === 'true';
    const cookieAge = hasConsent ? COOKIE_MAX_AGE_FULL : COOKIE_MAX_AGE_SESSION;

    response.cookies.set('aff_ref', ref, {
      maxAge: cookieAge,
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
    });

    if (sub) {
      response.cookies.set('aff_sub', sub, {
        maxAge: cookieAge,
        path: '/',
        httpOnly: false,
        sameSite: 'lax',
      });
    }

    return NextResponse.json(
      { ok: true, affiliate_id: affiliate.id, affiliate_name: affiliate.name, duplicate: isDuplicate },
      { headers: response.headers },
    );
  } catch (err) {
    console.error('[Affiliate Track]', err);
    return NextResponse.json({ ok: true });
  }
}
