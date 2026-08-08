import { resolveTxt } from "node:dns/promises";
import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { hashOpaqueValue } from "@/lib/affiliate/auth-crypto";
import { isAllowedPartnerWriteOrigin } from "@/lib/affiliate/write-origin";
import { supabaseAdmin } from "@/lib/supabase";
import { isValidUuid } from "@/lib/supabase-filter-safe";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAllowedPartnerWriteOrigin(request))
    return apiResponse({ error: "ORIGIN_REJECTED" }, { status: 403 });
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const { id } = await context.params;
  if (!isValidUuid(id))
    return apiResponse({ error: "INVALID_DOMAIN_ID" }, { status: 400 });
  const affiliateId = String(auth.affiliate.id);
  const { data: domain, error } = await supabaseAdmin
    .from("affiliate_domains")
    .select(
      "id, hostname, verification_method, verification_token_hash, verification_status",
    )
    .eq("id", id)
    .eq("affiliate_id", affiliateId)
    .maybeSingle();
  if (error)
    return apiResponse({ error: "DOMAIN_CHECK_UNAVAILABLE" }, { status: 503 });
  if (!domain)
    return apiResponse({ error: "DOMAIN_NOT_FOUND" }, { status: 404 });
  if (domain.verification_method !== "DNS_TXT")
    return apiResponse(
      { error: "DOMAIN_METHOD_NOT_SUPPORTED" },
      { status: 409 },
    );

  let verified = false;
  try {
    const records = await resolveTxt(`_yeosonam-affiliate.${domain.hostname}`);
    verified = records
      .map((parts) => parts.join(""))
      .some(
        (value) => hashOpaqueValue(value) === domain.verification_token_hash,
      );
  } catch {
    verified = false;
  }
  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("affiliate_domains")
    .update({
      verification_status: verified ? "VERIFIED" : "FAILED",
      verified_at: verified ? now : null,
      last_checked_at: now,
      updated_at: now,
    } as never)
    .eq("id", id)
    .eq("affiliate_id", affiliateId)
    .select(
      "id, hostname, verification_method, verification_status, verified_at, last_checked_at",
    )
    .single();
  if (updateError)
    return apiResponse({ error: "DOMAIN_CHECK_SAVE_FAILED" }, { status: 503 });
  return apiResponse(
    { domain: updated, verified },
    { status: verified ? 200 : 409 },
  );
}
