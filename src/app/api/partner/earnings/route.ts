import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const affiliateId = String(auth.affiliate.id);
  const { data: runs, error } = await supabaseAdmin
    .from("settlement_runs")
    .select(
      "id, settlement_period, status, hold_reason_code, qualified_booking_count, gross_commission_krw, adjustment_krw, tax_type, tax_rate, withholding_krw, net_payout_krw, calculation_trace_id, ready_at, completed_at, created_at, updated_at, payouts(id, status, amount_krw, payout_reference, receipt_url, requested_at, approved_at, completed_at)",
    )
    .eq("affiliate_id", affiliateId)
    .order("period_start_utc", { ascending: false })
    .limit(36);
  if (error)
    return apiResponse(
      { error: "PARTNER_SETTLEMENTS_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );

  const runIds = (runs || []).map((run) => String(run.id));
  const { data: lines, error: lineError } = runIds.length
    ? await supabaseAdmin
        .from("settlement_lines")
        .select(
          "id, settlement_run_id, booking_id, booking_no, product_name, departure_date, return_date, customer_masked, traveler_count, commission_base_krw, commission_rate, policy_set_version, line_type, line_amount_krw, calculation_trace_id, created_at",
        )
        .in("settlement_run_id", runIds)
        .order("created_at")
    : { data: [], error: null };
  if (lineError)
    return apiResponse(
      { error: "SETTLEMENT_LINES_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );

  const { data: disputes, error: disputeError } = await supabaseAdmin
    .from("affiliate_disputes")
    .select(
      "id, booking_id, settlement_run_id, settlement_line_id, dispute_type, status, reason, opened_at, due_at, resolved_at",
    )
    .eq("affiliate_id", affiliateId)
    .order("opened_at", { ascending: false });
  if (disputeError)
    return apiResponse(
      { error: "DISPUTES_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );

  const linesByRun = new Map<string, unknown[]>();
  for (const line of lines || []) {
    const key = String(line.settlement_run_id);
    linesByRun.set(key, [...(linesByRun.get(key) || []), line]);
  }
  return apiResponse({
    state: "ready",
    settlements: (runs || []).map((run) => ({
      ...run,
      lines: linesByRun.get(String(run.id)) || [],
    })),
    disputes: disputes || [],
    contract_version: "settlement-ledger-v2",
    updated_at: new Date().toISOString(),
  });
}
