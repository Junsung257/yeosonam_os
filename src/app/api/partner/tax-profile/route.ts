import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { recordAffiliateFunnelEvent } from "@/lib/affiliate/funnel-events";
import {
  idempotencyKey,
  sameOriginWrite,
  submitTaxProfile,
} from "@/lib/affiliate/profile-submission";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok) return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });
  const { data, error } = await supabaseAdmin
    .from("affiliate_tax_profiles")
    .select("id, masked_identifier, tax_type, status, submitted_at, review_reason")
    .eq("affiliate_id", String(auth.affiliate.id))
    .maybeSingle();
  if (error) return apiResponse({ state: "data_unavailable", error: "TAX_PROFILE_UNAVAILABLE" }, { status: 503 });
  return apiResponse({ state: "ready", profile: data, status: auth.affiliate.tax_profile_status || "NOT_SUBMITTED" });
}

export async function POST(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok) return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });
  if (!sameOriginWrite(request)) return apiResponse({ error: "ORIGIN_REJECTED" }, { status: 403 });
  const key = idempotencyKey(request);
  if (!key) return apiResponse({ error: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const taxType = String(body.tax_type || "").toUpperCase();
  const identifier = String(body.identifier || "").replace(/\s+/g, "");
  const legalName = String(body.legal_name || "").trim();
  if (!(taxType === "PERSONAL" || taxType === "BUSINESS") || !/^[0-9-]{6,20}$/.test(identifier) || !/^[가-힣A-Za-z0-9 .'-]{2,120}$/.test(legalName)) {
    return apiResponse({ error: "INVALID_TAX_PROFILE" }, { status: 400 });
  }
  try {
    const profile = await submitTaxProfile({
      affiliateId: String(auth.affiliate.id),
      idempotencyKey: key,
      taxType: taxType as "PERSONAL" | "BUSINESS",
      identifier,
      legalName,
    });
    await recordAffiliateFunnelEvent({
      eventName: "affiliate_onboarding_step_completed",
      affiliateId: String(auth.affiliate.id),
      actorType: "affiliate",
      idempotencyKey: `tax-profile:${auth.affiliate.id}:${key}`,
      payload: { step: "tax_profile", status: "PENDING_REVIEW" },
    });
    return apiResponse({ state: "ready", profile, status: "PENDING_REVIEW" });
  } catch {
    return apiResponse({ state: "data_unavailable", error: "TAX_PROFILE_SUBMISSION_FAILED" }, { status: 503 });
  }
}
