import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import {
  fingerprintAffiliateRequest,
  hashOpaqueValue,
} from "@/lib/affiliate/auth-crypto";
import { recordAffiliateFunnelEvent } from "@/lib/affiliate/funnel-events";
import {
  AFFILIATE_REQUIRED_DOCUMENTS,
  affiliateDocumentHash,
  affiliateDocumentVersion,
  type AffiliateRequiredDocument,
} from "@/lib/affiliate/policy-documents";
import { supabaseAdmin } from "@/lib/supabase";

function sameOriginWrite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

function idempotencyKey(request: NextRequest): string | null {
  const value = request.headers.get("idempotency-key")?.trim() || "";
  return /^[A-Za-z0-9:_-]{8,100}$/.test(value) ? value : null;
}

function requirements(accepted: Array<{ document_type: string; document_version: string }>) {
  return AFFILIATE_REQUIRED_DOCUMENTS.map((documentType) => ({
    document_type: documentType,
    document_version: affiliateDocumentVersion(documentType),
    document_hash: affiliateDocumentHash(documentType),
    accepted: accepted.some(
      (row) =>
        row.document_type === documentType &&
        row.document_version === affiliateDocumentVersion(documentType),
    ),
  }));
}

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok) {
    return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });
  }
  const { data, error } = await supabaseAdmin
    .from("affiliate_terms_acceptances")
    .select("document_type, document_version, accepted_at")
    .eq("affiliate_id", String(auth.affiliate.id))
    .order("accepted_at", { ascending: false });
  if (error) {
    return apiResponse(
      { state: "data_unavailable", error: "PARTNER_TERMS_UNAVAILABLE" },
      { status: 503 },
    );
  }
  return apiResponse({
    state: "ready",
    required: requirements(data || []),
    accepted: data || [],
    all_required_accepted: requirements(data || []).every((row) => row.accepted),
    updated_at: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok) {
    return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });
  }
  if (!sameOriginWrite(request)) {
    return apiResponse({ error: "ORIGIN_REJECTED" }, { status: 403 });
  }
  const key = idempotencyKey(request);
  if (!key) {
    return apiResponse({ error: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.accept !== true) {
    return apiResponse({ error: "TERMS_ACCEPTANCE_REQUIRED" }, { status: 400 });
  }
  const requested = Array.isArray(body.document_types)
    ? body.document_types.map((value) => String(value).trim())
    : [...AFFILIATE_REQUIRED_DOCUMENTS];
  const expected = [...AFFILIATE_REQUIRED_DOCUMENTS];
  if (
    requested.length !== expected.length ||
    expected.some((documentType) => !requested.includes(documentType))
  ) {
    return apiResponse({ error: "ALL_REQUIRED_DOCUMENTS_MUST_BE_ACCEPTED" }, { status: 400 });
  }

  const affiliateId = String(auth.affiliate.id);
  const ipHash = fingerprintAffiliateRequest(
    request.headers.get("x-forwarded-for")?.split(",")[0] || request.headers.get("x-real-ip"),
  );
  const userAgentHash = fingerprintAffiliateRequest(request.headers.get("user-agent"));
  const rows = AFFILIATE_REQUIRED_DOCUMENTS.map((documentType: AffiliateRequiredDocument) => ({
    affiliate_id: affiliateId,
    document_type: documentType,
    document_version: affiliateDocumentVersion(documentType),
    document_hash: affiliateDocumentHash(documentType),
    accepted_by: `affiliate:${affiliateId}`,
    ip_hash: ipHash,
    user_agent_hash: userAgentHash,
    evidence: {
      source: "partner-settings",
      terms_bundle_version: affiliateDocumentVersion(documentType),
      idempotency_key_hash: hashOpaqueValue(key),
    },
  }));
  const { error } = await supabaseAdmin
    .from("affiliate_terms_acceptances")
    .upsert(rows, {
      onConflict: "affiliate_id,document_type,document_version",
      ignoreDuplicates: true,
    });
  if (error) {
    return apiResponse(
      { state: "data_unavailable", error: "PARTNER_TERMS_ACCEPTANCE_FAILED" },
      { status: 503 },
    );
  }

  await recordAffiliateFunnelEvent({
    eventName: "affiliate_onboarding_step_completed",
    affiliateId,
    actorType: "affiliate",
    idempotencyKey: `terms-accepted:${affiliateId}:${key}`,
    payload: { step: "terms", document_count: rows.length },
  });
  return apiResponse({
    state: "ready",
    accepted: true,
    required: requirements(rows),
    all_required_accepted: true,
  });
}
