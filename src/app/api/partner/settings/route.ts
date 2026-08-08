import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import {
  AFFILIATE_REQUIRED_DOCUMENTS,
  affiliateDocumentHash,
  affiliateDocumentVersion,
} from "@/lib/affiliate/policy-documents";
import { supabaseAdmin } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const affiliateId = String(auth.affiliate.id);
  const [channels, domains, terms, sessions] = await Promise.all([
    supabaseAdmin
      .from("affiliate_channels")
      .select(
        "id, channel_type, channel_url, display_name, verification_status, verified_at",
      )
      .eq("affiliate_id", affiliateId)
      .order("created_at"),
    supabaseAdmin
      .from("affiliate_domains")
      .select(
        "id, hostname, verification_method, verification_status, verified_at, last_checked_at",
      )
      .eq("affiliate_id", affiliateId)
      .order("created_at"),
    supabaseAdmin
      .from("affiliate_terms_acceptances")
      .select("document_type, document_version, accepted_at")
      .eq("affiliate_id", affiliateId)
      .order("accepted_at", { ascending: false }),
    supabaseAdmin
      .from("affiliate_sessions")
      .select("id, issued_at, expires_at, last_used_at, revoked_at")
      .eq("affiliate_id", affiliateId)
      .is("revoked_at", null)
      .order("issued_at", { ascending: false }),
  ]);
  if ([channels, domains, terms, sessions].some((result) => result.error)) {
    return apiResponse(
      { error: "PARTNER_SETTINGS_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );
  }
  return apiResponse({
    state: "ready",
    profile: {
      name: auth.affiliate.name,
      referral_code: auth.affiliate.referral_code,
      partner_status: auth.affiliate.partner_status,
      payout_profile_status:
        auth.affiliate.payout_profile_status || "NOT_SUBMITTED",
      tax_profile_status: auth.affiliate.tax_profile_status || "NOT_SUBMITTED",
    },
    channels: channels.data || [],
    domains: domains.data || [],
    terms: terms.data || [],
    terms_requirements: AFFILIATE_REQUIRED_DOCUMENTS.map((document_type) => ({
      document_type,
      document_version: affiliateDocumentVersion(document_type),
      document_hash: affiliateDocumentHash(document_type),
      accepted: (terms.data || []).some(
        (row) =>
          row.document_type === document_type &&
          row.document_version === affiliateDocumentVersion(document_type),
      ),
    })),
    active_sessions: sessions.data || [],
    policy_blockers: {
      terms_document_publication_required: (terms.data || []).length === 0,
      payout_submission_requires_secure_operations_review:
        auth.affiliate.payout_profile_status === "NOT_SUBMITTED",
      tax_submission_requires_secure_operations_review:
        auth.affiliate.tax_profile_status === "NOT_SUBMITTED",
    },
    updated_at: new Date().toISOString(),
  });
}
