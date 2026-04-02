import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AFFILIATE_CONFIG } from '@/lib/affiliateConfig';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const { PIN_MAX_ATTEMPTS, PIN_WINDOW_MINUTES, PIN_LOCKOUT_MINUTES } = AFFILIATE_CONFIG;

// PIN 인증 + 대시보드 데이터
export async function POST(req: NextRequest) {
  try {
    const { referral_code, pin } = await req.json();
    if (!referral_code) return NextResponse.json({ error: '코드 필요' }, { status: 400 });

    // ── PIN 시도 횟수 체크 (브루트포스 방어) ──
    if (pin) {
      const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const identifier = `${referral_code}_${ip}`;
      const windowStart = new Date(Date.now() - PIN_WINDOW_MINUTES * 60 * 1000).toISOString();

      const { count: attemptCount } = await supabaseAdmin
        .from('pin_attempts')
        .select('*', { count: 'exact', head: true })
        .eq('identifier', identifier)
        .gte('attempted_at', windowStart);

      if (attemptCount && attemptCount >= PIN_MAX_ATTEMPTS) {
        return NextResponse.json(
          { error: `PIN 시도 횟수를 초과했습니다. ${PIN_LOCKOUT_MINUTES}분 후 다시 시도해주세요.` },
          { status: 429 }
        );
      }

      // 시도 기록 저장 (성공/실패 무관)
      await supabaseAdmin.from('pin_attempts').insert({ identifier });

      // 어필리에이트 조회
      const { data: affiliate, error } = await supabaseAdmin
        .from('affiliates')
        .select('id, name, referral_code, grade, grade_label, bonus_rate, booking_count, total_commission, payout_type, logo_url, pin, phone, created_at')
        .eq('referral_code', referral_code)
        .single();

      if (error || !affiliate) {
        return NextResponse.json({ error: '존재하지 않는 코드입니다' }, { status: 404 });
      }

      // PIN 검증
      const storedPin = affiliate.pin || (affiliate.phone ? affiliate.phone.replace(/[^0-9]/g, '').slice(-4) : null);
      if (!storedPin || pin !== storedPin) {
        const remaining = PIN_MAX_ATTEMPTS - (attemptCount || 0) - 1;
        return NextResponse.json(
          { error: `PIN이 일치하지 않습니다. 남은 시도: ${remaining}회` },
          { status: 401 }
        );
      }

      // 성공 시 시도 기록 삭제
      await supabaseAdmin.from('pin_attempts').delete().eq('identifier', identifier);

      // 이하 대시보드 데이터 로드 (affiliate 변수 사용)
      return await buildDashboardResponse(affiliate, true);
    }

    // PIN 없이 호출 (이미 인증된 세션) — 기존 로직 유지
    const { data: affiliate, error } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code, grade, grade_label, bonus_rate, booking_count, total_commission, payout_type, logo_url, pin, phone, created_at')
      .eq('referral_code', referral_code)
      .single();

    if (error || !affiliate) {
      return NextResponse.json({ error: '존재하지 않는 코드입니다' }, { status: 404 });
    }

    return await buildDashboardResponse(affiliate, false);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}

// ── 대시보드 데이터 조회 공통 함수 ──
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function buildDashboardResponse(affiliate: any, authenticated: boolean) {
  const GRADE_MAP: Record<number, { label: string; rate: string; next: string }> = {
    1: { label: '브론즈', rate: '0%', next: '10건 달성 시 실버' },
    2: { label: '실버', rate: '0.1%', next: '30건 달성 시 골드' },
    3: { label: '골드', rate: '0.2%', next: '50건 달성 시 플래티넘' },
    4: { label: '플래티넘', rate: '0.3%', next: '100건 달성 시 다이아' },
    5: { label: '다이아몬드', rate: '0.5%', next: '최고 등급' },
  };
  const gradeInfo = GRADE_MAP[affiliate.grade] || GRADE_MAP[1];

  const { data: settlements } = await supabaseAdmin
    .from('settlements')
    .select('id, period, gross_amount, tax_amount, net_payout, status, settled_at')
    .eq('affiliate_id', affiliate.id)
    .order('period', { ascending: false })
    .limit(6);

  const { data: recentBookings } = await supabaseAdmin
    .from('bookings')
    .select('id, product_name, booking_date, status, influencer_commission, created_at')
    .eq('affiliate_id', affiliate.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: linkStats } = await supabaseAdmin
    .from('influencer_links')
    .select('id, click_count, conversion_count')
    .eq('affiliate_id', affiliate.id);

  const totalClicks = linkStats?.reduce((sum, l) => sum + (l.click_count || 0), 0) || 0;
  const totalConversions = linkStats?.reduce((sum, l) => sum + (l.conversion_count || 0), 0) || 0;

  return NextResponse.json({
    authenticated,
    affiliate: {
      id: affiliate.id,
      name: affiliate.name,
      referral_code: affiliate.referral_code,
      grade: affiliate.grade,
      grade_label: gradeInfo.label,
      grade_rate: gradeInfo.rate,
      next_grade: gradeInfo.next,
      bonus_rate: affiliate.bonus_rate,
      booking_count: affiliate.booking_count,
      total_commission: affiliate.total_commission,
      payout_type: affiliate.payout_type,
      logo_url: affiliate.logo_url,
      created_at: affiliate.created_at,
    },
    stats: {
      total_links: linkStats?.length || 0,
      total_clicks: totalClicks,
      total_conversions: totalConversions,
      conversion_rate: totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(1) + '%' : '0%',
    },
    settlements: settlements || [],
    recent_bookings: recentBookings || [],
  });
}
