import { NextRequest } from "next/server";
import { requireAdminRequest, resolveAdminActorLabel } from "@/lib/admin-guard";
import { successResponse, errorResponse } from "@/lib/api-response";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase";
import { isValidUuid } from "@/lib/supabase-filter-safe";

type ProfileType = "payout" | "tax";
type ReviewStatus = "VERIFIED" | "CHANGES_REQUIRED" | "LOCKED" | "PENDING_REVIEW";

function tableFor(type: ProfileType) {
  return type === "payout" ? "affiliate_payout_profiles" : "affiliate_tax_profiles";
}

function sameOriginWrite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

function key(request: NextRequest): string | null {
  const value = request.headers.get("idempotency-key")?.trim() || "";
  return /^[A-Za-z0-9:_-]{8,100}$/.test(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const guard = await requireAdminRequest(request);
  if (guard) return guard;
  if (!isSupabaseAdminConfigured) return errorResponse("SERVICE_UNAVAILABLE", "DB unavailable", 503);
  const type = (request.nextUrl.searchParams.get("type") || "payout") as ProfileType;
  if (!(type === "payout" || type === "tax")) return errorResponse("INVALID_PROFILE_TYPE", "Invalid profile type", 400);
  const table = tableFor(type);
  const select = type === "payout"
    ? "id, affiliate_id, masked_account, payout_type, status, submitted_at, reviewed_at, reviewed_by, review_reason, affiliates(id, name, referral_code)"
    : "id, affiliate_id, masked_identifier, tax_type, status, submitted_at, reviewed_at, reviewed_by, review_reason, affiliates(id, name, referral_code)";
  const { data, error } = await supabaseAdmin
    .from(table)
    .select(select)
    .order("submitted_at", { ascending: false });
  if (error) return errorResponse("PROFILES_UNAVAILABLE", "Profile queue unavailable", 503);
  return successResponse({ profile_type: type, profiles: data || [], contract_version: "affiliate-profile-review-v1" });
}

export async function PATCH(request: NextRequest) {
  const guard = await requireAdminRequest(request);
  if (guard) return guard;
  if (!sameOriginWrite(request)) return errorResponse("ORIGIN_REJECTED", "Origin rejected", 403);
  const commandKey = key(request);
  if (!commandKey) return errorResponse("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key required", 400);
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const type = String(body.profile_type || body.type || "") as ProfileType;
  const id = String(body.id || "");
  const status = String(body.status || "").toUpperCase() as ReviewStatus;
  const reason = String(body.reason || "").trim();
  if (!(type === "payout" || type === "tax") || !isValidUuid(id)) return errorResponse("INVALID_PROFILE", "Invalid profile", 400);
  if (!(status === "VERIFIED" || status === "CHANGES_REQUIRED" || status === "LOCKED" || status === "PENDING_REVIEW")) return errorResponse("INVALID_REVIEW_STATUS", "Invalid review status", 400);
  if (status === "CHANGES_REQUIRED" && reason.length < 3) return errorResponse("REVIEW_REASON_REQUIRED", "Reason required", 400);
  const actor = await resolveAdminActorLabel(request);
  const table = tableFor(type);
  const { data: profile, error: profileError } = await supabaseAdmin
    .from(table)
    .update({
      status,
      reviewed_at: status === "PENDING_REVIEW" ? null : new Date().toISOString(),
      reviewed_by: status === "PENDING_REVIEW" ? null : actor,
      review_reason: reason || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id, affiliate_id, status, reviewed_at, reviewed_by, review_reason")
    .single();
  if (profileError || !profile) return errorResponse("PROFILE_REVIEW_FAILED", "Profile review failed", 409);
  const affiliateStatusColumn = type === "payout" ? "payout_profile_status" : "tax_profile_status";
  const { error: affiliateError } = await supabaseAdmin
    .from("affiliates")
    .update({ [affiliateStatusColumn]: status })
    .eq("id", profile.affiliate_id);
  if (affiliateError) return errorResponse("PROFILE_STATUS_SYNC_FAILED", "Profile status sync failed", 503);
  return successResponse({ profile, idempotent: true, idempotency_key: commandKey });
}
