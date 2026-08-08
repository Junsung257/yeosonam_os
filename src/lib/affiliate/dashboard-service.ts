import { NextRequest } from "next/server";
import { authInfluencer } from "@/lib/affiliate/jwt-or-pin-auth";
import { buildPublicUrl } from "@/lib/public-app-origin";
import { supabaseAdmin } from "@/lib/supabase";

type AffiliateRow = Record<string, unknown>;
type SettlementRow = {
  id: string;
  status?: string | null;
  settlement_period?: string | null;
  gross_commission_krw?: number | null;
  adjustment_krw?: number | null;
  withholding_krw?: number | null;
  net_payout_krw?: number | null;
  qualified_booking_count?: number | null;
  completed_at?: string | null;
  created_at?: string | null;
  total_amount?: number | null;
  final_payout?: number | null;
};
type BookingRow = {
  id: string;
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
  commission_status?: string | null;
  commission_policy_version?: string | null;
  attribution_decision_id?: string | null;
  created_at?: string | null;
};
type QueryResult<T> = {
  data: T[] | null;
  error: { message?: string } | null;
  count?: number | null;
};

const GRADE_MAP: Record<number, { label: string; next: string }> = {
  1: { label: "Bronze", next: "예약 10건 달성 시 Silver" },
  2: { label: "Silver", next: "예약 30건 달성 시 Gold" },
  3: { label: "Gold", next: "예약 50건 달성 시 Platinum" },
  4: { label: "Platinum", next: "예약 100건 달성 시 Diamond" },
  5: { label: "Diamond", next: "최고 등급" },
};

const METRIC_DEFINITIONS = {
  funnel_30d_clicks:
    "최근 30일 동안 봇·중복으로 분류되지 않은 affiliate_touchpoints.",
  funnel_30d_bookings: "최근 30일 동안 affiliate_id로 귀속된 실제 bookings.",
  settlement_ready_krw: "현재 KST 정산월의 READY 또는 PAYOUT_PENDING 실지급액.",
  publication_clicks: "파트너 소유 affiliate_publications의 누적 클릭 수.",
  content_clicks: "파트너가 만든 카드뉴스의 누적 클릭 수. 예약과는 별도 지표.",
  content_views: "파트너가 만든 카드뉴스의 누적 조회 수. 예약과는 별도 지표.",
  payout_completed_krw:
    "지급 증빙까지 완료된 settlement_runs.net_payout_krw 합계.",
  unsettled_commission_krw:
    "아직 settlement_lines에 포함되지 않은 커미션 원장 순액.",
} as const;

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function queryFailure(source: string, error: { message?: string } | null) {
  console.error(`[affiliate-dashboard:${source}]`, {
    code: "DATA_UNAVAILABLE",
    detail: error?.message || "query failed",
  });
  return new Error(`AFFILIATE_DASHBOARD_DATA_UNAVAILABLE:${source}`);
}
function rows<T>(source: string, result: QueryResult<T>): T[] {
  if (result.error) throw queryFailure(source, result.error);
  return result.data || [];
}
function count(source: string, result: QueryResult<unknown>): number {
  if (result.error) throw queryFailure(source, result.error);
  return result.count || 0;
}
function currentKstPeriod() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

export function buildSubIdTrackingUrl(
  siteBase: string,
  referralCode: string,
  subId: string,
): string {
  return `${siteBase || ""}/with/${encodeURIComponent(referralCode)}?sub_id=${encodeURIComponent(subId)}`;
}
export function calculateClickToBookingRate(
  clicks: number,
  bookings: number,
): number {
  return clicks > 0
    ? Number(((bookings / Math.max(1, clicks)) * 100).toFixed(2))
    : 0;
}

function normalizeAffiliate(affiliate: AffiliateRow) {
  const grade = Math.min(Math.max(numberValue(affiliate.grade) || 1, 1), 5);
  const info = GRADE_MAP[grade] || GRADE_MAP[1];
  return {
    id: stringValue(affiliate.id),
    name: stringValue(affiliate.name),
    referral_code: stringValue(affiliate.referral_code),
    grade,
    grade_label: stringValue(affiliate.grade_label) || info.label,
    grade_rate: numberValue(affiliate.grade_rate),
    next_grade: info.next,
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
  const snapshotMethod =
    typeof snapshot.method === "string" ? snapshot.method : "";
  const snapshotSource =
    typeof snapshot.source === "string" ? snapshot.source : "";
  const splitModel =
    typeof booking.attribution_split?.model === "string"
      ? booking.attribution_split.model
      : "";
  if (booking.promo_code && booking.promo_affiliate_id)
    return {
      method: "promo_code",
      label: "Promo code",
      detail: booking.promo_code,
      model:
        booking.attribution_model ||
        splitModel ||
        snapshotMethod ||
        "last_touch",
    };
  if (snapshotSource)
    return {
      method: snapshotSource,
      label: snapshotSource === "cookie" ? "Cookie" : "Snapshot",
      detail: snapshotMethod || snapshotSource,
      model:
        booking.attribution_model ||
        splitModel ||
        snapshotMethod ||
        "last_touch",
    };
  if (booking.referral_code)
    return {
      method: "referral_link",
      label: "Referral link",
      detail: booking.referral_code,
      model: booking.attribution_model || splitModel || "last_touch",
    };
  return {
    method: "manual",
    label: "Manual attribution",
    detail: "",
    model: booking.attribution_model || splitModel || "last_touch",
  };
}

export function summarizeCommissions(settlements: SettlementRow[]) {
  const empty = { count: 0, total_amount: 0, final_payout: 0 };
  const byStatus = settlements.reduce<Record<string, typeof empty>>(
    (acc, row) => {
      const status = row.status || "UNKNOWN";
      const current = acc[status] || { ...empty };
      current.count += 1;
      current.total_amount += numberValue(
        row.gross_commission_krw ?? row.total_amount,
      );
      current.final_payout += numberValue(
        row.net_payout_krw ?? row.final_payout,
      );
      acc[status] = current;
      return acc;
    },
    {},
  );
  return {
    total_gross: settlements.reduce(
      (sum, row) =>
        sum + numberValue(row.gross_commission_krw ?? row.total_amount),
      0,
    ),
    total_payout: settlements.reduce(
      (sum, row) => sum + numberValue(row.net_payout_krw ?? row.final_payout),
      0,
    ),
    pending_amount:
      (byStatus.PENDING?.total_amount || 0) +
      (byStatus.HOLD?.total_amount || 0),
    ready_payout:
      (byStatus.READY?.final_payout || 0) +
      (byStatus.PAYOUT_PENDING?.final_payout || 0),
    completed_payout: byStatus.COMPLETED?.final_payout || 0,
    by_status: byStatus,
  };
}

async function loadAffiliateById(affiliateId: string) {
  const { data, error } = await supabaseAdmin
    .from("affiliates")
    .select(
      "id, name, referral_code, grade, grade_label, grade_rate, bonus_rate, booking_count, total_commission, payout_type, logo_url, created_at, branding_level, content_quota, content_used, last_conversion_at",
    )
    .eq("id", affiliateId)
    .maybeSingle();
  if (error) throw queryFailure("affiliate", error);
  return data as AffiliateRow | null;
}

async function buildDashboard(
  affiliateRow: AffiliateRow,
  authenticated = true,
) {
  const affiliate = normalizeAffiliate(affiliateRow);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const since7 = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const kstPeriod = currentKstPeriod();
  const [
    settlementsRes,
    recentBookingsRes,
    trendBookingsRes,
    publicationsRes,
    clicksRes,
    bookingsCountRes,
    ledgerRes,
    settledLinesRes,
    contentsRes,
    cardNewsRes,
    insightsRes,
    rewardsRes,
    creatorCodesRes,
    subTouchpointsRes,
  ] = await Promise.all([
    supabaseAdmin
      .from("settlement_runs")
      .select(
        "id, settlement_period, status, qualified_booking_count, gross_commission_krw, adjustment_krw, withholding_krw, net_payout_krw, completed_at, created_at",
      )
      .eq("affiliate_id", affiliate.id)
      .order("period_start_utc", { ascending: false })
      .limit(12),
    supabaseAdmin
      .from("bookings")
      .select(
        "id, package_title, booking_date, status, total_price, influencer_commission, referral_code, commission_status, commission_policy_version, attribution_decision_id, created_at",
      )
      .eq("affiliate_id", affiliate.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("bookings")
      .select("id, total_price, influencer_commission, created_at")
      .eq("affiliate_id", affiliate.id)
      .gte("created_at", since7)
      .order("created_at"),
    supabaseAdmin
      .from("affiliate_publications")
      .select(
        "id, placement_name, sub_id, channel_type, status, click_count, unique_visitor_count, conversion_count, health_status, created_at",
      )
      .eq("affiliate_id", affiliate.id),
    supabaseAdmin
      .from("affiliate_touchpoints")
      .select("id", { count: "exact", head: true })
      .eq("affiliate_id", affiliate.id)
      .eq("is_bot", false)
      .eq("is_duplicate", false)
      .gte("clicked_at", since30),
    supabaseAdmin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("affiliate_id", affiliate.id)
      .gte("created_at", since30),
    supabaseAdmin
      .from("commission_ledger_entries")
      .select("id, amount_krw, hold_reason")
      .eq("affiliate_id", affiliate.id)
      .limit(5000),
    supabaseAdmin
      .from("settlement_lines")
      .select("ledger_entry_id, settlement_runs!inner(affiliate_id)")
      .eq("settlement_runs.affiliate_id", affiliate.id)
      .limit(5000),
    supabaseAdmin
      .from("content_distributions")
      .select(
        "id, product_id, platform, status, generation_agent, created_at, published_at",
      )
      .eq("affiliate_id", affiliate.id)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("card_news")
      .select("id, title_slides, created_at, views, clicks, status")
      .eq("created_by_affiliate_id", affiliate.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabaseAdmin
      .from("affiliate_content_insights")
      .select("id, insight_type, title, content, is_read, created_at")
      .eq("affiliate_id", affiliate.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabaseAdmin
      .from("affiliate_reward_events")
      .select("id, event_type, points, reward_amount, payload, created_at")
      .eq("affiliate_id", affiliate.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("creator_codes")
      .select("id, code, status, source, created_at")
      .eq("affiliate_id", affiliate.id)
      .order("created_at", { ascending: false }),
    supabaseAdmin
      .from("affiliate_touchpoints")
      .select("sub_id, session_id, package_id, publication_id, clicked_at")
      .eq("affiliate_id", affiliate.id)
      .eq("is_bot", false)
      .eq("is_duplicate", false)
      .gte("clicked_at", since30),
  ]);

  const settlements = rows(
    "settlement-runs",
    settlementsRes as QueryResult<SettlementRow>,
  );
  const recentBookings = rows(
    "recent-bookings",
    recentBookingsRes as QueryResult<BookingRow>,
  );
  const trendBookings = rows(
    "booking-trend",
    trendBookingsRes as QueryResult<Record<string, unknown>>,
  );
  const publications = rows(
    "publications",
    publicationsRes as QueryResult<Record<string, unknown>>,
  );
  const clicks30 = count("clicks-30d", clicksRes as QueryResult<unknown>);
  const bookings30 = count(
    "bookings-30d",
    bookingsCountRes as QueryResult<unknown>,
  );
  const ledger = rows(
    "commission-ledger",
    ledgerRes as QueryResult<Record<string, unknown>>,
  );
  const settledLines = rows(
    "settlement-lines",
    settledLinesRes as QueryResult<Record<string, unknown>>,
  );
  const contents = rows(
    "content-distributions",
    contentsRes as QueryResult<Record<string, unknown>>,
  );
  const cardNews = rows(
    "card-news",
    cardNewsRes as QueryResult<Record<string, unknown>>,
  );
  const insights = rows(
    "content-insights",
    insightsRes as QueryResult<Record<string, unknown>>,
  );
  const rewards = rows(
    "reward-events",
    rewardsRes as QueryResult<Record<string, unknown>>,
  );
  const creatorCodes = rows(
    "creator-codes",
    creatorCodesRes as QueryResult<Record<string, unknown>>,
  );
  const subTouchpoints = rows(
    "sub-touchpoints",
    subTouchpointsRes as QueryResult<Record<string, unknown>>,
  );

  const settledIds = new Set(
    settledLines.map((line) => stringValue(line.ledger_entry_id)),
  );
  const unsettled = ledger.filter(
    (entry) => !settledIds.has(stringValue(entry.id)),
  );
  const unsettledCommission = unsettled.reduce(
    (sum, entry) => sum + numberValue(entry.amount_krw),
    0,
  );
  const commissionHold = unsettled
    .filter((entry) => Boolean(entry.hold_reason))
    .reduce((sum, entry) => sum + numberValue(entry.amount_krw), 0);
  const commissionSummary = summarizeCommissions(settlements);
  const monthReady = settlements
    .filter(
      (run) =>
        run.settlement_period === kstPeriod &&
        ["READY", "PAYOUT_PENDING"].includes(String(run.status)),
    )
    .reduce((sum, run) => sum + numberValue(run.net_payout_krw), 0);

  const daily = new Map<
    string,
    { bookings: number; booking_amount_krw: number; commission_krw: number }
  >();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * 86_400_000)
      .toISOString()
      .slice(0, 10);
    daily.set(date, { bookings: 0, booking_amount_krw: 0, commission_krw: 0 });
  }
  for (const booking of trendBookings) {
    const bucket = daily.get(stringValue(booking.created_at).slice(0, 10));
    if (!bucket) continue;
    bucket.bookings += 1;
    bucket.booking_amount_krw += numberValue(booking.total_price);
    bucket.commission_krw += numberValue(booking.influencer_commission);
  }

  const publicationClicks = publications.reduce(
    (sum, row) => sum + numberValue(row.click_count),
    0,
  );
  const publicationConversions = publications.reduce(
    (sum, row) => sum + numberValue(row.conversion_count),
    0,
  );
  const contentViews = cardNews.reduce(
    (sum, row) => sum + numberValue(row.views),
    0,
  );
  const contentClicks = cardNews.reduce(
    (sum, row) => sum + numberValue(row.clicks),
    0,
  );
  const subAggregation = new Map<
    string,
    { clicks: number; sessions: Set<string>; products: Set<string> }
  >();
  for (const touchpoint of subTouchpoints) {
    const subId = stringValue(touchpoint.sub_id) || "default";
    const current = subAggregation.get(subId) || {
      clicks: 0,
      sessions: new Set<string>(),
      products: new Set<string>(),
    };
    current.clicks += 1;
    if (touchpoint.session_id)
      current.sessions.add(stringValue(touchpoint.session_id));
    if (touchpoint.package_id)
      current.products.add(stringValue(touchpoint.package_id));
    subAggregation.set(subId, current);
  }

  return {
    authenticated,
    state: "ready",
    affiliate,
    stats: {
      total_publications: publications.length,
      publication_clicks: publicationClicks,
      publication_conversions: publicationConversions,
      conversion_rate: `${calculateClickToBookingRate(publicationClicks, publicationConversions).toFixed(2)}%`,
      content_clicks: contentClicks,
      content_views: contentViews,
    },
    funnel_30d: {
      clicks: clicks30,
      bookings: bookings30,
      settlement_ready_krw: monthReady,
      click_to_booking_rate: calculateClickToBookingRate(clicks30, bookings30),
    },
    commission_summary: commissionSummary,
    payout_completed_krw: commissionSummary.completed_payout,
    unsettled_commission_krw: unsettledCommission,
    commission_hold_krw: commissionHold,
    settlements,
    recent_bookings: recentBookings.map((booking) => ({
      ...booking,
      attribution: resolveAttributionMethod(booking),
    })),
    publications,
    creator_codes: creatorCodes,
    contents,
    recent_card_news: cardNews.slice(0, 10),
    insights,
    reward_events: rewards,
    booking_trend: [...daily.entries()].map(([date, value]) => ({
      date,
      ...value,
    })),
    co_brand: {
      path: `/with/${encodeURIComponent(affiliate.referral_code)}`,
      full_url: buildPublicUrl(
        `/with/${encodeURIComponent(affiliate.referral_code)}`,
      ),
    },
    sub_id_stats: [...subAggregation.entries()]
      .map(([sub_id, value]) => ({
        sub_id,
        clicks_30d: value.clicks,
        unique_sessions_30d: value.sessions.size,
        touched_packages_30d: value.products.size,
        tracking_url: buildSubIdTrackingUrl(
          "",
          affiliate.referral_code,
          sub_id,
        ),
      }))
      .sort((a, b) => b.clicks_30d - a.clicks_30d),
    metric_definitions: METRIC_DEFINITIONS,
    metric_periods: {
      funnel: "rolling_30_days",
      booking_trend: "rolling_7_days",
      settlement: `KST_${kstPeriod}`,
    },
    data_availability: "available",
    updated_at: new Date().toISOString(),
    deprecated_metrics: {
      total_revenue: "removed_use_payout_completed_krw",
      booking_trend_card_news: "removed_use_actual_bookings",
    },
  };
}

export async function buildAffiliateDashboardById(affiliateId: string) {
  const affiliate = await loadAffiliateById(affiliateId);
  return affiliate ? buildDashboard(affiliate, true) : null;
}

export async function buildAffiliateDashboardByCode(
  referralCode: string,
  request: NextRequest,
  pin?: string | null,
) {
  const auth = await authInfluencer(request, referralCode, pin);
  if (!auth.ok)
    return { authError: { error: auth.error, status: auth.status } };
  return buildDashboard(auth.affiliate, true);
}
