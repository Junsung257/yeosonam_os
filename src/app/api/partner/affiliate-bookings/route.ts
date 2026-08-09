import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { supabaseAdmin } from "@/lib/supabase";

function money(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function signedMoney(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const affiliateId = String(auth.affiliate.id);
  const { data: bookings, error } = await supabaseAdmin
    .from("bookings")
    .select(
      "id, booking_no, package_id, package_title, departure_date, return_date, status, payment_status, total_price, commission_status, commission_policy_version, commission_calculation_trace_id, attribution_decision_id, created_at, updated_at",
    )
    .eq("affiliate_id", affiliateId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error)
    return apiResponse(
      { error: "AFFILIATE_BOOKINGS_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );

  const bookingIds = (bookings || []).map((booking) => booking.id).filter(Boolean);
  const { data: ledgerEntries, error: ledgerError } = bookingIds.length
    ? await supabaseAdmin
        .from("commission_ledger_entries")
        .select("booking_id, amount_krw, hold_reason, policy_set_version, calculation_trace_id")
        .eq("affiliate_id", affiliateId)
        .in("booking_id", bookingIds)
    : { data: [], error: null };
  if (ledgerError)
    return apiResponse(
      { error: "COMMISSION_LEDGER_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );
  const ledgerByBooking = new Map<string, { amount: number; hold: boolean; policy: string | null; trace: string | null }>();
  (ledgerEntries || []).forEach((entry) => {
    const bookingId = String(entry.booking_id || "");
    if (!bookingId) return;
    const current = ledgerByBooking.get(bookingId) || { amount: 0, hold: false, policy: null, trace: null };
    current.amount += Number(entry.amount_krw) || 0;
    current.hold = current.hold || Boolean(entry.hold_reason);
    current.policy = current.policy || entry.policy_set_version || null;
    current.trace = current.trace || entry.calculation_trace_id || null;
    ledgerByBooking.set(bookingId, current);
  });

  const decisionIds = (bookings || [])
    .map((row) => row.attribution_decision_id)
    .filter(Boolean) as string[];
  const { data: decisions, error: decisionError } = decisionIds.length
    ? await supabaseAdmin
        .from("attribution_decisions")
        .select(
          "id, publication_id, attribution_model, reason_code, policy_version, trace_id, decided_at",
        )
        .in("id", decisionIds)
    : { data: [], error: null };
  if (decisionError)
    return apiResponse(
      { error: "ATTRIBUTION_EVIDENCE_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );

  const publicationIds = (decisions || [])
    .map((row) => row.publication_id)
    .filter(Boolean) as string[];
  const { data: publications, error: publicationError } = publicationIds.length
    ? await supabaseAdmin
        .from("affiliate_publications")
        .select("id, channel_type, placement_name, published_url")
        .eq("affiliate_id", affiliateId)
        .in("id", publicationIds)
    : { data: [], error: null };
  if (publicationError)
    return apiResponse(
      { error: "PUBLICATION_EVIDENCE_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );

  const decisionById = new Map(
    (decisions || []).map((row) => [String(row.id), row]),
  );
  const publicationById = new Map(
    (publications || []).map((row) => [String(row.id), row]),
  );
  return apiResponse({
    state: "ready",
    bookings: (bookings || []).map((booking) => {
      const decision = decisionById.get(
        String(booking.attribution_decision_id || ""),
      );
      const publication = decision
        ? publicationById.get(String(decision.publication_id || ""))
        : undefined;
      return {
        id: booking.id,
        booking_no: booking.booking_no,
        product_id: booking.package_id,
        product_name: booking.package_title || "상품명 확인 필요",
        departure_date: booking.departure_date,
        return_date: booking.return_date,
        booking_status: booking.status,
        payment_status: booking.payment_status,
        booking_amount_krw: money(booking.total_price),
        commission_amount_krw: ledgerByBooking.has(booking.id)
          ? signedMoney(ledgerByBooking.get(booking.id)?.amount)
          : null,
        commission_status: ledgerByBooking.get(booking.id)?.hold
          ? "CALCULATION_HOLD"
          : booking.commission_status || "CALCULATION_HOLD",
        commission_policy_version:
          ledgerByBooking.get(booking.id)?.policy || booking.commission_policy_version,
        commission_trace_id:
          ledgerByBooking.get(booking.id)?.trace || booking.commission_calculation_trace_id,
        attribution: decision
          ? {
              decision_id: decision.id,
              model: decision.attribution_model,
              reason_code: decision.reason_code,
              policy_version: decision.policy_version,
              trace_id: decision.trace_id,
              decided_at: decision.decided_at,
              publication: publication || null,
            }
          : null,
        created_at: booking.created_at,
        updated_at: booking.updated_at,
      };
    }),
    definitions: {
      booking_amount_krw: "예약에 저장된 고객 총 결제 예정 금액",
      commission_amount_krw: "commission_ledger_entries에 기록된 예약별 원장 순액",
      attribution: "예약 귀속 결정과 실제 게시 위치를 연결한 감사 근거",
    },
    updated_at: new Date().toISOString(),
  });
}
