import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// PIN 인증 + 대시보드 데이터
export async function POST(req: NextRequest) {
  try {
    const { referral_code, pin } = await req.json();
    if (!referral_code) return NextResponse.json({ error: '코드 필요' }, { status: 400 });

    // 어필리에이트 조회
    const { data: affiliate, error } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, referral_code, grade, grade_label, bonus_rate, booking_count, total_commission, payout_type, logo_url, pin, phone, created_at')
      .eq('referral_code', referral_code)
      .single();

    if (error || !affiliate) {
      return NextResponse.json({ error: '존재하지 않는 코드입니다' }, { status: 404 });
    }

    // PIN 인증 (pin 미설정 시 phone 뒷자리 4자리로 폴백)
    if (pin) {
      const storedPin = affiliate.pin || (affiliate.phone ? affiliate.phone.replace(/[^0-9]/g, '').slice(-4) : null);
      if (!storedPin || pin !== storedPin) {
        return NextResponse.json({ error: 'PIN이 일치하지 않습니다' }, { status: 401 });
      }
    }

    // 등급 정보
    const GRADE_MAP: Record<number, { label: string; rate: string; next: string }> = {
      1: { label: '브론즈', rate: '0%', next: '10건 달성 시 실버' },
      2: { label: '실버', rate: '0.1%', next: '30건 달성 시 골드' },
      3: { label: '골드', rate: '0.2%', next: '50건 달성 시 플래티넘' },
      4: { label: '플래티넘', rate: '0.3%', next: '100건 달성 시 다이아' },
      5: { label: '다이아몬드', rate: '0.5%', next: '최고 등급' },
    };
    const gradeInfo = GRADE_MAP[affiliate.grade] || GRADE_MAP[1];

    // 최근 정산 내역
    const { data: settlements } = await supabaseAdmin
      .from('settlements')
      .select('id, period, gross_amount, tax_amount, net_payout, status, settled_at')
      .eq('affiliate_id', affiliate.id)
      .order('period', { ascending: false })
      .limit(6);

    // 최근 예약 (커미션 발생 건)
    const { data: recentBookings } = await supabaseAdmin
      .from('bookings')
      .select('id, product_name, booking_date, status, influencer_commission, created_at')
      .eq('affiliate_id', affiliate.id)
      .order('created_at', { ascending: false })
      .limit(10);

    // 생성한 링크 수 & 클릭 수
    const { data: linkStats } = await supabaseAdmin
      .from('influencer_links')
      .select('id, click_count, conversion_count')
      .eq('affiliate_id', affiliate.id);

    const totalClicks = linkStats?.reduce((sum, l) => sum + (l.click_count || 0), 0) || 0;
    const totalConversions = linkStats?.reduce((sum, l) => sum + (l.conversion_count || 0), 0) || 0;

    return NextResponse.json({
      authenticated: !!pin,
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
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}
