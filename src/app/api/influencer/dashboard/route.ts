import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AFFILIATE_CONFIG } from '@/lib/affiliateConfig';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { getSecret } from '@/lib/secret-registry';

const supabaseAdmin = createClient(
  getSecret('NEXT_PUBLIC_SUPABASE_URL')!,
  getSecret('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

const { PIN_MAX_ATTEMPTS, PIN_WINDOW_MINUTES, PIN_LOCKOUT_MINUTES } = AFFILIATE_CONFIG;

// POST /api/influencer/dashboard
// 인증: JWT 쿠키(inf_token) 우선, 없으면 PIN 검증
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const referral_code: string | undefined = body.referral_code;
    if (!referral_code) {
      return NextResponse.json({ error: '코드 필요' }, { status: 400 });
    }

    const { authInfluencer } = await import('@/lib/affiliate/jwt-or-pin-auth');
    const auth = await authInfluencer(req, referral_code, body.pin);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

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
  const bookingCount = Number(affiliate.booking_count) || 0;

  const tierSteps = [0, 10, 30, 50, 100];
  const currentTier = Math.min(Math.max(Number(affiliate.grade) || 1, 1), 5);
  const currentStep = tierSteps[currentTier - 1] || 0;
  const nextStep = tierSteps[Math.min(currentTier, tierSteps.length - 1)] || currentStep;
  const tierProgressPct =
    nextStep > currentStep
      ? Math.min(100, Math.round(((bookingCount - currentStep) / Math.max(1, nextStep - currentStep)) * 100))
      : 100;

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

  const { count: clicks30 } = await supabaseAdmin
    .from('affiliate_touchpoints')
    .select('id', { count: 'exact', head: true })
    .eq('referral_code', affiliate.referral_code)
    .eq('is_bot', false)
    .eq('is_duplicate', false)
    .gte('clicked_at', since30);

  const { count: bookings30 } = await supabaseAdmin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('affiliate_id', affiliate.id)
    .gte('created_at', since30);

  const monthPeriod = new Date().toISOString().slice(0, 7);
  const { data: settlements30 } = await supabaseAdmin
    .from('settlements')
    .select('final_payout, status, settlement_period')
    .eq('affiliate_id', affiliate.id)
    .eq('settlement_period', monthPeriod)
    .in('status', ['READY', 'COMPLETED']);
  const payout30 = (settlements30 || []).reduce((s: number, r: { final_payout?: number }) => s + (Number(r.final_payout) || 0), 0);

  const { data: rewardEvents } = await supabaseAdmin
    .from('affiliate_reward_events')
    .select('id, event_type, points, reward_amount, payload, created_at')
    .eq('affiliate_id', affiliate.id)
    .order('created_at', { ascending: false })
    .limit(20);

  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');

  const { data: subTouchpoints } = await supabaseAdmin
    .from('affiliate_touchpoints')
    .select('sub_id, session_id, package_id, is_bot, is_duplicate, clicked_at')
    .eq('referral_code', affiliate.referral_code)
    .gte('clicked_at', since30)
    .eq('is_bot', false)
    .eq('is_duplicate', false);

  const subAgg = new Map<string, { clicks: number; uniqueSessions: Set<string>; packageHits: Set<string> }>();
  for (const t of (subTouchpoints || []) as Array<{
    sub_id: string | null;
    session_id: string | null;
    package_id: string | null;
  }>) {
    const key = (t.sub_id || 'default').trim() || 'default';
    if (!subAgg.has(key)) {
      subAgg.set(key, { clicks: 0, uniqueSessions: new Set<string>(), packageHits: new Set<string>() });
    }
    const cur = subAgg.get(key)!;
    cur.clicks += 1;
    if (t.session_id) cur.uniqueSessions.add(t.session_id);
    if (t.package_id) cur.packageHits.add(t.package_id);
  }

  const sub_id_stats = [...subAgg.entries()]
    .map(([sub_id, v]) => ({
      sub_id,
      clicks_30d: v.clicks,
      unique_sessions_30d: v.uniqueSessions.size,
      touched_packages_30d: v.packageHits.size,
    }))
    .sort((a, b) => b.clicks_30d - a.clicks_30d);

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
    funnel_30d: {
      clicks: clicks30 ?? 0,
      bookings: bookings30 ?? 0,
      settlements_krw: payout30,
      click_to_booking_rate: (clicks30 || 0) > 0 ? Number((((bookings30 || 0) / Math.max(1, clicks30 || 0)) * 100).toFixed(2)) : 0,
    },
    tier_progress: {
      current_tier: currentTier,
      current_label: gradeInfo.label,
      current_booking_count: bookingCount,
      current_step: currentStep,
      next_step: nextStep,
      progress_pct: Math.max(0, tierProgressPct),
    },
    reward_events: rewardEvents || [],
    settlements,
    recent_bookings,
    contents: contents || [],
    content_revenue: contentRevenue,
    co_brand: {
      path: `/with/${encodeURIComponent(affiliate.referral_code)}`,
      full_url: siteBase ? `${siteBase}/with/${encodeURIComponent(affiliate.referral_code)}` : '',
      landing_views_30d: landingViews30 ?? 0,
    },
    sub_id_stats,
    attribution_notice:
      '정산은 여행 귀국일·예약 상태에 따라 월별로 반영됩니다. 아래 금액은 시스템 기록 기준이며, 미확정 건은 변동될 수 있습니다.',
  });
}
