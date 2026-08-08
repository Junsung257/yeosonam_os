import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { supabaseAdmin } from "@/lib/supabase";

function amount(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const affiliateId = String(auth.affiliate.id);
  const referralCode = String(auth.affiliate.referral_code);
  const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();

  const [
    clicks,
    bookings,
    publications,
    ledger,
    settledLines,
    runs,
    channels,
    domains,
    saved,
    terms,
  ] = await Promise.all([
    supabaseAdmin
      .from("affiliate_touchpoints")
      .select("id, clicked_at")
      .eq("referral_code", referralCode)
      .eq("is_bot", false)
      .eq("is_duplicate", false)
      .gte("clicked_at", since30),
    supabaseAdmin
      .from("bookings")
      .select(
        "id, created_at, total_price, influencer_commission, commission_status, status",
      )
      .eq("affiliate_id", affiliateId)
      .gte("created_at", since30),
    supabaseAdmin
      .from("affiliate_publications")
      .select(
        "id, status, health_status, click_count, conversion_count, created_at",
      )
      .eq("affiliate_id", affiliateId),
    supabaseAdmin
      .from("commission_ledger_entries")
      .select("id, amount_krw, hold_reason, eligible_at")
      .eq("affiliate_id", affiliateId),
    supabaseAdmin
      .from("settlement_lines")
      .select("ledger_entry_id, settlement_runs!inner(affiliate_id)")
      .eq("settlement_runs.affiliate_id", affiliateId),
    supabaseAdmin
      .from("settlement_runs")
      .select("id, status, net_payout_krw, settlement_period, updated_at")
      .eq("affiliate_id", affiliateId)
      .order("period_start_utc", { ascending: false })
      .limit(12),
    supabaseAdmin
      .from("affiliate_channels")
      .select("id, verification_status")
      .eq("affiliate_id", affiliateId),
    supabaseAdmin
      .from("affiliate_domains")
      .select("id, verification_status")
      .eq("affiliate_id", affiliateId),
    supabaseAdmin
      .from("affiliate_saved_products")
      .select("id")
      .eq("affiliate_id", affiliateId),
    supabaseAdmin
      .from("affiliate_terms_acceptances")
      .select("document_type")
      .eq("affiliate_id", affiliateId),
  ]);
  const required = [
    clicks,
    bookings,
    publications,
    ledger,
    settledLines,
    runs,
    channels,
    domains,
    saved,
    terms,
  ];
  if (required.some((result) => result.error)) {
    return apiResponse(
      {
        state: "data_unavailable",
        error: "PARTNER_OVERVIEW_UNAVAILABLE",
        updated_at: new Date().toISOString(),
      },
      { status: 503 },
    );
  }

  const settledIds = new Set(
    (settledLines.data || []).map((line) => String(line.ledger_entry_id)),
  );
  const unsettledEntries = (ledger.data || []).filter(
    (entry) => !settledIds.has(String(entry.id)),
  );
  const pendingCommission = unsettledEntries.reduce(
    (sum, entry) => sum + amount(entry.amount_krw),
    0,
  );
  const heldCommission = unsettledEntries
    .filter((entry) => Boolean(entry.hold_reason))
    .reduce((sum, entry) => sum + amount(entry.amount_krw), 0);
  const readyPayout = (runs.data || [])
    .filter((run) => ["READY", "PAYOUT_PENDING"].includes(String(run.status)))
    .reduce((sum, run) => sum + amount(run.net_payout_krw), 0);
  const completedPayout = (runs.data || [])
    .filter((run) => run.status === "COMPLETED")
    .reduce((sum, run) => sum + amount(run.net_payout_krw), 0);

  const trend = new Map<
    string,
    { bookings: number; booking_amount_krw: number; commission_krw: number }
  >();
  for (let offset = 6; offset >= 0; offset--) {
    const day = new Date(Date.now() - offset * 86_400_000)
      .toISOString()
      .slice(0, 10);
    trend.set(day, { bookings: 0, booking_amount_krw: 0, commission_krw: 0 });
  }
  for (const booking of bookings.data || []) {
    const day = String(booking.created_at || "").slice(0, 10);
    const bucket = trend.get(day);
    if (!bucket) continue;
    bucket.bookings += 1;
    bucket.booking_amount_krw += amount(booking.total_price);
    bucket.commission_krw += amount(booking.influencer_commission);
  }

  const acceptedTerms = new Set(
    (terms.data || []).map((row) => String(row.document_type)),
  );
  const onboarding = [
    {
      key: "terms",
      label: "계약·필수 동의",
      complete: [
        "AFFILIATE_AGREEMENT",
        "PRIVACY",
        "AD_DISCLOSURE",
        "PAYOUT_POLICY",
      ].every((key) => acceptedTerms.has(key)),
    },
    {
      key: "channel",
      label: "채널 등록",
      complete: (channels.data || []).length > 0,
    },
    {
      key: "domain",
      label: "게시 도메인 등록",
      complete: (domains.data || []).some(
        (row) => row.verification_status === "VERIFIED",
      ),
    },
    {
      key: "payout",
      label: "계좌 확인",
      complete: auth.affiliate.payout_profile_status === "VERIFIED",
    },
    {
      key: "tax",
      label: "세금 정보 확인",
      complete: auth.affiliate.tax_profile_status === "VERIFIED",
    },
    {
      key: "product",
      label: "첫 상품 저장",
      complete: (saved.data || []).length > 0,
    },
    {
      key: "publication",
      label: "첫 게시 만들기",
      complete: (publications.data || []).length > 0,
    },
    {
      key: "published",
      label: "실제 게시 URL 등록",
      complete: (publications.data || []).some(
        (row) => row.status === "PUBLISHED",
      ),
    },
  ];
  const completedSteps = onboarding.filter((step) => step.complete).length;

  return apiResponse({
    state: "ready",
    affiliate: {
      id: affiliateId,
      name: auth.affiliate.name,
      referral_code: referralCode,
      payout_profile_status:
        auth.affiliate.payout_profile_status || "NOT_SUBMITTED",
      tax_profile_status: auth.affiliate.tax_profile_status || "NOT_SUBMITTED",
    },
    onboarding: {
      completed: completedSteps,
      total: onboarding.length,
      steps: onboarding,
    },
    metrics: {
      valid_clicks_30d: (clicks.data || []).length,
      attributed_bookings_30d: (bookings.data || []).length,
      pending_commission_krw: pendingCommission,
      commission_hold_krw: heldCommission,
      settlement_ready_krw: readyPayout,
      payout_completed_krw: completedPayout,
      active_publications: (publications.data || []).filter((row) =>
        ["TESTED", "PUBLISHED"].includes(String(row.status)),
      ).length,
    },
    booking_trend_7d: [...trend.entries()].map(([date, values]) => ({
      date,
      ...values,
    })),
    definitions: {
      valid_clicks_30d: "최근 30일 동안 봇·중복으로 분류되지 않은 클릭",
      attributed_bookings_30d: "최근 30일 동안 이 파트너 ID로 귀속된 예약",
      pending_commission_krw: "아직 정산 라인에 포함되지 않은 커미션 원장 순액",
      settlement_ready_krw: "READY 또는 지급 처리 중인 정산 실지급액",
      payout_completed_krw: "지급 증빙까지 완료된 정산 실지급액",
    },
    period: { clicks_and_bookings: "rolling_30_days", trend: "rolling_7_days" },
    updated_at: new Date().toISOString(),
  });
}
