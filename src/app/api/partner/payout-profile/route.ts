import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { recordAffiliateFunnelEvent } from "@/lib/affiliate/funnel-events";
import {
  idempotencyKey,
  sameOriginWrite,
  submitPayoutProfile,
} from "@/lib/affiliate/profile-submission";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok) return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });
  const { data, error } = await supabaseAdmin
    .from("affiliate_payout_profiles")
    .select("id, masked_account, payout_type, status, submitted_at, review_reason")
    .eq("affiliate_id", String(auth.affiliate.id))
    .maybeSingle();
  if (error) return apiResponse({ state: "data_unavailable", error: "PAYOUT_PROFILE_UNAVAILABLE" }, { status: 503 });
  return apiResponse({ state: "ready", profile: data, status: auth.affiliate.payout_profile_status || "NOT_SUBMITTED" });
}

export async function POST(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok) return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!sameOriginWrite(request)) return apiResponse({ error: "ORIGIN_REJECTED" }, { status: 403 });
  const key = idempotencyKey(request);
  if (!key) return apiResponse({ error: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const payoutType = String(body.payout_type || "").toUpperCase();
  const accountHolder = String(body.account_holder || "").trim();
  const bankName = String(body.bank_name || "").trim();
  const accountNumber = String(body.account_number || "").replace(/\s+/g, "");
  if (!(payoutType === "PERSONAL" || payoutType === "BUSINESS") || !/^[가-힣A-Za-z0-9 .'-]{2,80}$/.test(accountHolder) || !/^[가-힣A-Za-z0-9 .'-]{2,80}$/.test(bankName) || !/^[0-9-]{8,30}$/.test(accountNumber)) {
    return apiResponse({ error: "INVALID_PAYOUT_PROFILE" }, { status: 400 });
  }
  try {
    const profile = await submitPayoutProfile({
      affiliateId: String(auth.affiliate.id),
      idempotencyKey: key,
      payoutType: payoutType as "PERSONAL" | "BUSINESS",
      accountHolder,
      bankName,
      accountNumber,
    });
    await recordAffiliateFunnelEvent({
      eventName: "affiliate_onboarding_step_completed",
      affiliateId: String(auth.affiliate.id),
      actorType: "affiliate",
      idempotencyKey: `payout-profile:${auth.affiliate.id}:${key}`,
      payload: { step: "payout_profile", status: "PENDING_REVIEW" },
    });
    return apiResponse({ state: "ready", profile, status: "PENDING_REVIEW" });
  } catch {
    return apiResponse({ state: "data_unavailable", error: "PAYOUT_PROFILE_SUBMISSION_FAILED" }, { status: 503 });
  }
}
