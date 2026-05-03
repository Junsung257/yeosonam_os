import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AFFILIATE_CONFIG } from '@/lib/affiliateConfig';
import { verifyAffiliateReferralAndPin } from '@/lib/influencer-pin-auth';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const { PIN_MAX_ATTEMPTS, PIN_WINDOW_MINUTES, PIN_LOCKOUT_MINUTES } = AFFILIATE_CONFIG;

// PIN 인증 + 대시보드 데이터 (PIN 없이 민감 정보 반환 금지)
export async function POST(req: NextRequest) {
  try {
    const { referral_code, pin } = await req.json();
    if (!referral_code) {
      return NextResponse.json({ error: '코드 필요' }, { status: 400 });
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const codeKey = normalizeAffiliateReferralCode(referral_code);
    if (!codeKey) {
      return NextResponse.json({ error: '코드 필요' }, { status: 400 });
    }

    const identifier = `${codeKey}_${ip}`;
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

    await supabaseAdmin.from('pin_attempts').insert({ identifier });

    const auth = await verifyAffiliateReferralAndPin(supabaseAdmin, referral_code, pin);
    if (!auth.ok) {
      const remaining = PIN_MAX_ATTEMPTS - (attemptCount || 0) - 1;
      const msg =
        auth.status === 401
          ? `PIN이 일치하지 않습니다. 남은 시도: ${remaining}회`
          : auth.message;
      return NextResponse.json({ error: msg }, { status: auth.status });
    }

    await supabaseAdmin.from('pin_attempts').delete().eq('identifier', identifier);

    return await buildDashboardResponse(auth.affiliate, true);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Server error' }, { status: 500 });
  }
}

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

  const { data: settlementsRaw } = await supabaseAdmin
    .from('settlements')
    .select(
      'id, settlement_period, qualified_booking_count, total_amount, carryover_balance, final_total, tax_deduction, final_payout, status, settled_at, created_at',
    )
    .eq('affiliate_id', affiliate.id)
    .order('settlement_period', { ascending: false })
    .limit(12);

  const settlements = (settlementsRaw || []).map((s: Record<string, unknown>) => ({
    id: s.id as string,
    period: s.settlement_period as string,
    gross_amount: Number(s.total_amount) || 0,
    tax_amount: Number(s.tax_deduction) || 0,
    net_payout: Number(s.final_payout) || 0,
    status: s.status as string,
    settled_at: s.settled_at as string | undefined,
    qualified_booking_count: Number(s.qualified_booking_count) || 0,
    carryover_balance: Number(s.carryover_balance) || 0,
    final_total: Number(s.final_total) || 0,
  }));

  const { data: recentBookingsRaw } = await supabaseAdmin
    .from('bookings')
    .select('id, product_name, package_title, booking_date, status, influencer_commission, created_at')
    .eq('affiliate_id', affiliate.id)
    .order('created_at', { ascending: false })
    .limit(10);

  const recent_bookings = (recentBookingsRaw || []).map((b: Record<string, unknown>) => ({
    id: b.id as string,
    product_name: (b.product_name as string) || (b.package_title as string) || undefined,
    booking_date: b.booking_date as string | undefined,
    status: b.status as string | undefined,
    influencer_commission: Number(b.influencer_commission) || 0,
    created_at: b.created_at as string,
  }));

  const { data: linkStats } = await supabaseAdmin
    .from('influencer_links')
    .select('id, click_count, conversion_count')
    .eq('affiliate_id', affiliate.id);

  const totalClicks = linkStats?.reduce((sum, l) => sum + (l.click_count || 0), 0) || 0;
  const totalConversions = linkStats?.reduce((sum, l) => sum + (l.conversion_count || 0), 0) || 0;

  const { data: contents } = await supabaseAdmin
    .from('content_distributions')
    .select('id, product_id, platform, status, generation_agent, created_at, published_at')
    .eq('affiliate_id', affiliate.id)
    .order('updated_at', { ascending: false })
    .limit(20);

  const contentIds = (contents || []).map((c: { id: string }) => c.id);

  let contentRevenue: Array<{
    content_id: string;
    bookings: number;
    revenue: number;
    commission: number;
  }> = [];

  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const { count: landingViews30 } = await supabaseAdmin
    .from('affiliate_touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('referral_code', affiliate.referral_code)
    .eq('sub_id', 'co_brand_landing')
    .gte('clicked_at', since30);

  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');

  if (contentIds.length > 0) {
    const { data: attributedBookings } = await supabaseAdmin
      .from('bookings')
      .select('id, content_creative_id, total_price, influencer_commission, status')
      .eq('affiliate_id', affiliate.id)
      .in('content_creative_id', contentIds);

    const byContent = new Map<string, { bookings: number; revenue: number; commission: number }>();
    for (const b of (attributedBookings || []) as Array<{
      content_creative_id: string;
      total_price: number;
      influencer_commission: number;
    }>) {
      const cur = byContent.get(b.content_creative_id) || { bookings: 0, revenue: 0, commission: 0 };
      cur.bookings += 1;
      cur.revenue += Number(b.total_price) || 0;
      cur.commission += Number(b.influencer_commission) || 0;
      byContent.set(b.content_creative_id, cur);
    }
    contentRevenue = contentIds.map((id: string) => ({
      content_id: id,
      ...(byContent.get(id) || { bookings: 0, revenue: 0, commission: 0 }),
    }));
  }

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
    settlements,
    recent_bookings,
    contents: contents || [],
    content_revenue: contentRevenue,
    co_brand: {
      path: `/with/${encodeURIComponent(affiliate.referral_code)}`,
      full_url: siteBase ? `${siteBase}/with/${encodeURIComponent(affiliate.referral_code)}` : '',
      landing_views_30d: landingViews30 ?? 0,
    },
    attribution_notice:
      '정산은 여행 귀국일·예약 상태에 따라 월별로 반영됩니다. 아래 금액은 시스템 기록 기준이며, 미확정 건은 변동될 수 있습니다.',
  });
}
