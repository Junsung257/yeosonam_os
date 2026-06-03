import { NextRequest } from 'next/server';
import { authInfluencer } from '@/lib/affiliate/jwt-or-pin-auth';
import { supabaseAdmin } from '@/lib/supabase';

type AffiliateRow = Record<string, unknown>;

type SettlementRow = {
  id: string;
  settlement_period?: string | null;
  qualified_booking_count?: number | null;
  total_amount?: number | null;
  carryover_balance?: number | null;
  final_total?: number | null;
  tax_deduction?: number | null;
  final_payout?: number | null;
  status?: string | null;
  settled_at?: string | null;
  created_at?: string | null;
};

type BookingRow = {
  id: string;
  product_name?: string | null;
  package_title?: string | null;
  booking_date?: string | null;
  status?: string | null;
  total_price?: number | null;
  influencer_commission?: number | null;
  referral_code?: string | null;
  promo_code?: string | null;
  promo_affiliate_id?: string | null;
  attribution_model?: string | null;
  attribution_split?: Record<string, unknown> | null;
  attribution_snapshot?: Record<string, unknown> | null;
  created_at?: string | null;
};

type DashboardQueryResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
  count?: number | null;
};

const GRADE_MAP: Record<number, { label: string; rate: string; next: string }> = {
  1: { label: 'Bronze', rate: '0%', next: '10 bookings to Silver' },
  2: { label: 'Silver', rate: '0.1%', next: '30 bookings to Gold' },
  3: { label: 'Gold', rate: '0.2%', next: '50 bookings to Platinum' },
  4: { label: 'Platinum', rate: '0.3%', next: '100 bookings to Diamond' },
  5: { label: 'Diamond', rate: '0.5%', next: 'Top tier' },
};

const METRIC_DEFINITIONS = {
  funnel_30d_clicks: 'Recent 30-day non-bot, non-duplicate affiliate_touchpoints for the partner referral code.',
  funnel_30d_bookings: 'Bookings created in the recent 30-day window and attributed to the partner affiliate_id.',
  funnel_30d_settlements_krw: 'Current settlement-period READY or COMPLETED final_payout total, not a rolling 30-day payout.',
  link_clicks: 'Historical influencer_links click_count total for partner-owned links.',
  content_clicks: 'Historical card_news clicks total for partner-created content.',
  content_views: 'Historical card_news views total for partner-created content.',
  commission_summary: 'Settlement totals grouped by settlement status using total_amount and final_payout.',
} as const;

function numberValue(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function buildSubIdTrackingUrl(siteBase: string, referralCode: string, subId: string): string {
  return `${siteBase || ''}/with/${encodeURIComponent(referralCode)}?sub_id=${encodeURIComponent(subId)}`;
}

export function calculateClickToBookingRate(clicks: number, bookings: number): number {
  return clicks > 0 ? Number(((bookings / Math.max(1, clicks)) * 100).toFixed(2)) : 0;
}

function queryErrorMessage(source: string, error: { message?: string } | null) {
  return `[affiliate-dashboard:${source}] ${error?.message || 'query failed'}`;
}

function requireRows<T>(source: string, result: DashboardQueryResult<T>): T[] {
  if (result.error) throw new Error(queryErrorMessage(source, result.error));
  return result.data || [];
}

function requireCount(source: string, result: DashboardQueryResult<unknown>): number {
  if (result.error) throw new Error(queryErrorMessage(source, result.error));
  return result.count || 0;
}

function optionalRows<T>(source: string, result: DashboardQueryResult<T>): T[] {
  if (result.error) {
    console.warn(queryErrorMessage(source, result.error));
    return [];
  }
  return result.data || [];
}

function optionalCount(source: string, result: DashboardQueryResult<unknown>): number {
  if (result.error) {
    console.warn(queryErrorMessage(source, result.error));
    return 0;
  }
  return result.count || 0;
}

function normalizeAffiliate(affiliate: AffiliateRow) {
  const grade = Math.min(Math.max(numberValue(affiliate.grade) || 1, 1), 5);
  const gradeInfo = GRADE_MAP[grade] || GRADE_MAP[1];

  return {
    id: stringValue(affiliate.id),
    name: stringValue(affiliate.name),
    referral_code: stringValue(affiliate.referral_code),
    grade,
    grade_label: stringValue(affiliate.grade_label) || gradeInfo.label,
    grade_rate: gradeInfo.rate,
    next_grade: gradeInfo.next,
    bonus_rate: numberValue(affiliate.bonus_rate),
    booking_count: numberValue(affiliate.booking_count),
    total_commission: numberValue(affiliate.total_commission),
    payout_type: stringValue(affiliate.payout_type),
    logo_url: stringValue(affiliate.logo_url),
    created_at: stringValue(affiliate.created_at),
    branding_level: stringValue(affiliate.branding_level),
    content_quota: numberValue(affiliate.content_quota),
    content_used: numberValue(affiliate.content_used),
    last_conversion_at: stringValue(affiliate.last_conversion_at) || null,
  };
}

export function resolveAttributionMethod(booking: BookingRow) {
  const snapshot = booking.attribution_snapshot || {};
  const snapshotMethod = typeof snapshot.method === 'string' ? snapshot.method : '';
  const snapshotSource = typeof snapshot.source === 'string' ? snapshot.source : '';
  const splitModel = typeof booking.attribution_split?.model === 'string' ? booking.attribution_split.model : '';

  if (booking.promo_code && booking.promo_affiliate_id) {
    return {
      method: 'promo_code',
      label: 'Promo code',
      detail: booking.promo_code,
      model: booking.attribution_model || splitModel || snapshotMethod || 'last_touch',
    };
  }

  if (snapshotSource) {
    return {
      method: snapshotSource,
      label: snapshotSource === 'cookie' ? 'Cookie' : 'Snapshot',
      detail: snapshotMethod || snapshotSource,
      model: booking.attribution_model || splitModel || snapshotMethod || 'last_touch',
    };
  }

  if (booking.referral_code) {
    return {
      method: 'referral_link',
      label: 'Referral link',
      detail: booking.referral_code,
      model: booking.attribution_model || splitModel || 'last_touch',
    };
  }

  return {
    method: 'manual',
    label: 'Manual attribution',
    detail: '',
    model: booking.attribution_model || splitModel || 'last_touch',
  };
}

export function summarizeCommissions(settlements: SettlementRow[]) {
  const empty = { count: 0, total_amount: 0, final_payout: 0 };
  const byStatus = settlements.reduce<Record<string, typeof empty>>((acc, row) => {
    const status = row.status || 'UNKNOWN';
    const cur = acc[status] || { ...empty };
    cur.count += 1;
    cur.total_amount += numberValue(row.total_amount);
    cur.final_payout += numberValue(row.final_payout);
    acc[status] = cur;
    return acc;
  }, {});

  return {
    total_gross: settlements.reduce((sum, row) => sum + numberValue(row.total_amount), 0),
    total_payout: settlements.reduce((sum, row) => sum + numberValue(row.final_payout), 0),
    pending_amount: (byStatus.PENDING?.total_amount || 0) + (byStatus.HOLD?.total_amount || 0),
    ready_payout: byStatus.READY?.final_payout || 0,
    completed_payout: byStatus.COMPLETED?.final_payout || 0,
    by_status: byStatus,
  };
}

async function loadAffiliateById(affiliateId: string) {
  const { data, error } = await supabaseAdmin
    .from('affiliates')
    .select('id, name, referral_code, grade, grade_label, bonus_rate, booking_count, total_commission, payout_type, logo_url, created_at, branding_level, content_quota, content_used, last_conversion_at')
    .eq('id', affiliateId)
    .maybeSingle();

  if (error) throw error;
  return data as AffiliateRow | null;
}

async function buildDashboard(affiliateRow: AffiliateRow, authenticated = true) {
  const affiliate = normalizeAffiliate(affiliateRow);
  const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
  const siteBase = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_BASE_URL || '').replace(/\/$/, '');

  const [
    settlementsRes,
    recentBookingsRes,
    linkStatsRes,
    contentsRes,
    landingViewsRes,
    clicksRes,
    bookingsRes,
    monthSettlementsRes,
    rewardEventsRes,
    subTouchpointsRes,
    promoCodesRes,
    cardNewsRes,
    cardPerfRes,
    insightsRes,
    recentNewsRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('settlements')
      .select('id, settlement_period, qualified_booking_count, total_amount, carryover_balance, final_total, tax_deduction, final_payout, status, settled_at, created_at')
      .eq('affiliate_id', affiliate.id)
      .order('settlement_period', { ascending: false })
      .limit(12),
    supabaseAdmin
      .from('bookings')
      .select('id, product_name, package_title, booking_date, status, total_price, influencer_commission, referral_code, promo_code, promo_affiliate_id, attribution_model, attribution_split, attribution_snapshot, created_at')
      .eq('affiliate_id', affiliate.id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseAdmin
      .from('influencer_links')
      .select('id, click_count, conversion_count')
      .eq('affiliate_id', affiliate.id),
    supabaseAdmin
      .from('content_distributions')
      .select('id, product_id, platform, status, generation_agent, created_at, published_at')
      .eq('affiliate_id', affiliate.id)
      .order('updated_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('affiliate_touchpoints')
      .select('id', { count: 'exact', head: true })
      .eq('referral_code', affiliate.referral_code)
      .eq('sub_id', 'co_brand_landing')
      .gte('clicked_at', since30),
    supabaseAdmin
      .from('affiliate_touchpoints')
      .select('id', { count: 'exact', head: true })
      .eq('referral_code', affiliate.referral_code)
      .eq('is_bot', false)
      .eq('is_duplicate', false)
      .gte('clicked_at', since30),
    supabaseAdmin
      .from('bookings')
      .select('id', { count: 'exact', head: true })
      .eq('affiliate_id', affiliate.id)
      .gte('created_at', since30),
    supabaseAdmin
      .from('settlements')
      .select('final_payout, status, settlement_period')
      .eq('affiliate_id', affiliate.id)
      .eq('settlement_period', new Date().toISOString().slice(0, 7))
      .in('status', ['READY', 'COMPLETED']),
    supabaseAdmin
      .from('affiliate_reward_events')
      .select('id, event_type, points, reward_amount, payload, created_at')
      .eq('affiliate_id', affiliate.id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabaseAdmin
      .from('affiliate_touchpoints')
      .select('sub_id, session_id, package_id, is_bot, is_duplicate, clicked_at')
      .eq('referral_code', affiliate.referral_code)
      .gte('clicked_at', since30)
      .eq('is_bot', false)
      .eq('is_duplicate', false),
    supabaseAdmin
      .from('affiliate_promo_codes')
      .select('id, code, discount_type, discount_value, is_active, starts_at, ends_at, max_uses, uses_count, created_at')
      .eq('affiliate_id', affiliate.id)
      .order('created_at', { ascending: false })
      .limit(100),
    supabaseAdmin
      .from('card_news')
      .select('id, title_slides, created_at, views, clicks, status')
      .eq('created_by_affiliate_id', affiliate.id)
      .order('created_at', { ascending: false })
      .limit(10),
    supabaseAdmin
      .from('card_news')
      .select('views, clicks')
      .eq('created_by_affiliate_id', affiliate.id),
    supabaseAdmin
      .from('affiliate_content_insights')
      .select('id, insight_type, title, content, is_read, created_at')
      .eq('affiliate_id', affiliate.id)
      .order('created_at', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('card_news')
      .select('id, created_at')
      .eq('created_by_affiliate_id', affiliate.id)
      .gte('created_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .order('created_at', { ascending: true }),
  ]);

  const settlementsRows = requireRows('settlements', settlementsRes as DashboardQueryResult<SettlementRow>);
  const recentBookingRows = requireRows('recent-bookings', recentBookingsRes as DashboardQueryResult<BookingRow>);
  const linkStatsRows = requireRows(
    'influencer-links',
    linkStatsRes as DashboardQueryResult<{ id: string; click_count?: number | null; conversion_count?: number | null }>,
  );
  const landingViews30 = optionalCount('landing-views-30d', landingViewsRes as DashboardQueryResult<unknown>);
  const clicks30 = requireCount('clicks-30d', clicksRes as DashboardQueryResult<unknown>);
  const bookings30 = requireCount('bookings-30d', bookingsRes as DashboardQueryResult<unknown>);
  const monthSettlementRows = requireRows(
    'current-month-settlements',
    monthSettlementsRes as DashboardQueryResult<{ final_payout?: number | null }>,
  );
  const contentRows = optionalRows('content-distributions', contentsRes as DashboardQueryResult<{ id: string }>);
  const rewardRows = optionalRows('reward-events', rewardEventsRes as DashboardQueryResult<Record<string, unknown>>);
  const subTouchpointRows = optionalRows(
    'sub-touchpoints',
    subTouchpointsRes as DashboardQueryResult<{ sub_id?: string | null; session_id?: string | null; package_id?: string | null }>,
  );
  const promoCodeRows = optionalRows('promo-codes', promoCodesRes as DashboardQueryResult<Record<string, unknown>>);
  const cardNewsRows = optionalRows(
    'card-news',
    cardNewsRes as DashboardQueryResult<{ id: string; title_slides?: unknown; created_at?: string | null; views?: number | null; clicks?: number | null; status?: string | null }>,
  );
  const cardPerfRows = optionalRows('card-news-performance', cardPerfRes as DashboardQueryResult<{ views?: number | null; clicks?: number | null }>);
  const insightRows = optionalRows('content-insights', insightsRes as DashboardQueryResult<Record<string, unknown>>);
  const recentNewsRows = optionalRows('recent-card-news-trend', recentNewsRes as DashboardQueryResult<{ created_at?: string | null }>);

  const settlements = settlementsRows.map((s) => ({
    id: s.id,
    settlement_period: s.settlement_period || '',
    period: s.settlement_period || '',
    gross_amount: numberValue(s.total_amount),
    total_amount: numberValue(s.total_amount),
    tax_amount: numberValue(s.tax_deduction),
    tax_deduction: numberValue(s.tax_deduction),
    net_payout: numberValue(s.final_payout),
    final_payout: numberValue(s.final_payout),
    status: s.status || 'UNKNOWN',
    settled_at: s.settled_at || null,
    qualified_booking_count: numberValue(s.qualified_booking_count),
    carryover_balance: numberValue(s.carryover_balance),
    final_total: numberValue(s.final_total),
    created_at: s.created_at || null,
  }));

  const recent_bookings = recentBookingRows.map((b) => ({
    id: b.id,
    product_name: b.product_name || b.package_title || 'Untitled booking',
    booking_date: b.booking_date || null,
    status: b.status || '',
    total_price: numberValue(b.total_price),
    influencer_commission: numberValue(b.influencer_commission),
    created_at: b.created_at || '',
    attribution: resolveAttributionMethod(b),
    promo_code: b.promo_code || null,
  }));

  const totalLinkClicks = linkStatsRows.reduce((sum, l) => sum + numberValue(l.click_count), 0);
  const totalConversions = linkStatsRows.reduce((sum, l) => sum + numberValue(l.conversion_count), 0);

  const currentTier = affiliate.grade;
  const tierSteps = [0, 10, 30, 50, 100];
  const currentStep = tierSteps[currentTier - 1] || 0;
  const nextStep = tierSteps[Math.min(currentTier, tierSteps.length - 1)] || currentStep;
  const tierProgressPct = nextStep > currentStep
    ? Math.min(100, Math.round(((affiliate.booking_count - currentStep) / Math.max(1, nextStep - currentStep)) * 100))
    : 100;

  const monthPayout = monthSettlementRows.reduce((sum, row) => sum + numberValue(row.final_payout), 0);

  const subAgg = new Map<string, { clicks: number; uniqueSessions: Set<string>; packageHits: Set<string> }>();
  for (const t of subTouchpointRows) {
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
      tracking_url: buildSubIdTrackingUrl(siteBase, affiliate.referral_code, sub_id),
    }))
    .sort((a, b) => b.clicks_30d - a.clicks_30d);

  const contentIds = contentRows.map((c) => c.id);
  let contentRevenue: Array<{ content_id: string; bookings: number; revenue: number; commission: number }> = [];
  if (contentIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('bookings')
      .select('id, content_creative_id, total_price, influencer_commission, status')
      .eq('affiliate_id', affiliate.id)
      .in('content_creative_id', contentIds);
    if (error) throw error;

    const byContent = new Map<string, { bookings: number; revenue: number; commission: number }>();
    for (const b of (data || []) as Array<{ content_creative_id?: string | null; total_price?: number | null; influencer_commission?: number | null }>) {
      if (!b.content_creative_id) continue;
      const cur = byContent.get(b.content_creative_id) || { bookings: 0, revenue: 0, commission: 0 };
      cur.bookings += 1;
      cur.revenue += numberValue(b.total_price);
      cur.commission += numberValue(b.influencer_commission);
      byContent.set(b.content_creative_id, cur);
    }

    contentRevenue = contentIds.map((id) => ({
      content_id: id,
      ...(byContent.get(id) || { bookings: 0, revenue: 0, commission: 0 }),
    }));
  }

  const dailyMap = new Map<string, { bookings: number; revenue: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    dailyMap.set(d.toISOString().slice(0, 10), { bookings: 0, revenue: 0 });
  }
  for (const cn of recentNewsRows) {
    const key = (cn.created_at || '').slice(0, 10);
    if (dailyMap.has(key)) dailyMap.get(key)!.bookings += 1;
  }

  const totalViews = cardPerfRows.reduce((sum, c) => sum + numberValue(c.views), 0);
  const contentClicks = cardPerfRows.reduce((sum, c) => sum + numberValue(c.clicks), 0);
  const commissionSummary = summarizeCommissions(settlements);

  return {
    authenticated,
    affiliate,
    stats: {
      total_links: linkStatsRows.length,
      total_clicks: totalLinkClicks,
      total_conversions: totalConversions,
      conversion_rate: totalLinkClicks > 0 ? `${((totalConversions / totalLinkClicks) * 100).toFixed(1)}%` : '0%',
      link_clicks: totalLinkClicks,
      content_clicks: contentClicks,
      content_views: totalViews,
    },
    funnel_30d: {
      clicks: clicks30,
      bookings: bookings30,
      settlements_krw: monthPayout,
      click_to_booking_rate: calculateClickToBookingRate(clicks30, bookings30),
    },
    commission_summary: commissionSummary,
    tier_progress: {
      current_tier: currentTier,
      current_label: affiliate.grade_label,
      current_booking_count: affiliate.booking_count,
      current_step: currentStep,
      next_step: nextStep,
      progress_pct: Math.max(0, tierProgressPct),
    },
    reward_events: rewardRows,
    settlements,
    recent_bookings,
    promo_codes: promoCodeRows,
    contents: contentRows,
    content_revenue: contentRevenue,
    recent_card_news: cardNewsRows,
    insights: insightRows,
    booking_trend: Array.from(dailyMap.entries()).map(([date, data]) => ({ date, ...data })),
    total_views: totalViews,
    total_clicks: totalLinkClicks,
    content_clicks: contentClicks,
    total_revenue: commissionSummary.completed_payout,
    pending_revenue: commissionSummary.pending_amount + commissionSummary.ready_payout,
    co_brand: {
      path: `/with/${encodeURIComponent(affiliate.referral_code)}`,
      full_url: siteBase ? `${siteBase}/with/${encodeURIComponent(affiliate.referral_code)}` : '',
      landing_views_30d: landingViews30,
    },
    sub_id_stats,
    attribution_notice:
      '정산은 여행 귀속일, 예약 상태, 지급 증빙에 따라 월별로 반영됩니다. 표시 금액은 시스템 기록 기준이며 검수 결과에 따라 변동될 수 있습니다.',
    metric_definitions: METRIC_DEFINITIONS,
  };
}

export async function buildAffiliateDashboardById(affiliateId: string) {
  const affiliate = await loadAffiliateById(affiliateId);
  if (!affiliate) return null;
  return buildDashboard(affiliate, true);
}

export async function buildAffiliateDashboardByCode(referralCode: string, request: NextRequest, pin?: string | null) {
  const auth = await authInfluencer(request, referralCode, pin);
  if (!auth.ok) {
    return { authError: { error: auth.error, status: auth.status } };
  }
  return buildDashboard(auth.affiliate, true);
}
