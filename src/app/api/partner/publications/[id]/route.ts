import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { recordAffiliateFunnelEvent } from "@/lib/affiliate/funnel-events";
import { isAllowedPartnerWriteOrigin } from "@/lib/affiliate/write-origin";
import { buildPublicUrl } from "@/lib/public-app-origin";
import { supabaseAdmin } from "@/lib/supabase";
import { isValidUuid } from "@/lib/supabase-filter-safe";

const PARTNER_STATUSES = new Set([
  "DRAFT",
  "TESTED",
  "PUBLISHED",
  "PAUSED",
  "RETIRED",
]);

function commandKey(request: NextRequest): string | null {
  const key = request.headers.get("idempotency-key")?.trim() || "";
  return /^[A-Za-z0-9:_-]{8,100}$/.test(key) ? key : null;
}

function safePublishedUrl(value: unknown): string | null | "INVALID" {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 2_000) return "INVALID";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password)
      return "INVALID";
    return url.toString();
  } catch {
    return "INVALID";
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isAllowedPartnerWriteOrigin(request)) {
    return apiResponse({ error: "ORIGIN_REJECTED" }, { status: 403 });
  }
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const { id } = await context.params;
  if (!isValidUuid(id))
    return apiResponse({ error: "INVALID_PUBLICATION_ID" }, { status: 400 });

  const idempotencyKey = commandKey(request);
  if (!idempotencyKey)
    return apiResponse({ error: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const status =
    typeof body.status === "string" ? body.status.toUpperCase() : "";
  const publishedUrl = safePublishedUrl(body.published_url);
  if (!PARTNER_STATUSES.has(status) || publishedUrl === "INVALID") {
    return apiResponse(
      { error: "INVALID_PUBLICATION_UPDATE" },
      { status: 400 },
    );
  }

  const affiliateId = String(auth.affiliate.id);
  const { data: current, error: currentError } = await supabaseAdmin
    .from("affiliate_publications")
    .select("id, channel_type, channel_id, published_url, created_at")
    .eq("id", id)
    .eq("affiliate_id", affiliateId)
    .maybeSingle();
  if (currentError)
    return apiResponse(
      { error: "PUBLICATION_STATE_UNAVAILABLE" },
      { status: 503 },
    );
  if (!current)
    return apiResponse({ error: "PUBLICATION_NOT_FOUND" }, { status: 404 });

  if (status === "TESTED") {
    const { data: observed, error: touchpointError } = await supabaseAdmin
      .from("affiliate_touchpoints")
      .select("id, outcome")
      .eq("affiliate_id", affiliateId)
      .eq("publication_id", id)
      .eq("outcome", "accepted")
      .gte("clicked_at", current.created_at)
      .limit(1)
      .maybeSingle();
    if (touchpointError)
      return apiResponse(
        { error: "TEST_CLICK_CHECK_UNAVAILABLE" },
        { status: 503 },
      );
    if (!observed)
      return apiResponse({ error: "TEST_CLICK_NOT_OBSERVED" }, { status: 409 });
  }

  let verifiedDomainId: string | null = null;
  if (status === "PUBLISHED" && ["BLOG", "WEBSITE"].includes(current.channel_type)) {
    const effectivePublishedUrl = publishedUrl || current.published_url;
    if (!effectivePublishedUrl) {
      return apiResponse({ error: "PUBLISHED_URL_REQUIRED" }, { status: 409 });
    }
    const host = new URL(effectivePublishedUrl).hostname.toLowerCase();
    if (["BLOG", "WEBSITE"].includes(current.channel_type)) {
      const { data: verifiedDomain, error: domainError } = await supabaseAdmin
        .from("affiliate_domains")
        .select("id")
        .eq("affiliate_id", affiliateId)
        .eq("hostname", host)
        .eq("verification_status", "VERIFIED")
        .maybeSingle();
      if (domainError)
        return apiResponse(
          { error: "DOMAIN_VERIFICATION_UNAVAILABLE" },
          { status: 503 },
        );
      if (!verifiedDomain)
        return apiResponse(
          { error: "VERIFIED_DOMAIN_REQUIRED" },
          { status: 409 },
        );
      verifiedDomainId = String(verifiedDomain.id);
    }
  }

  if (status === "PUBLISHED" && verifiedDomainId) {
    const { error: bindError } = await supabaseAdmin.rpc(
      "bind_affiliate_publication_verified_domain_v2",
      {
        p_affiliate_id: affiliateId,
        p_publication_id: id,
        p_domain_id: verifiedDomainId,
      },
    );
    if (bindError)
      return apiResponse({ error: "DOMAIN_EVIDENCE_BIND_FAILED" }, { status: 503 });
  }

  const requestHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ id, status, published_url: publishedUrl }))
    .digest("hex");
  const { data, error } = await supabaseAdmin.rpc(
    "update_affiliate_publication_v2",
    {
      p_affiliate_id: affiliateId,
      p_publication_id: id,
      p_idempotency_key: idempotencyKey,
      p_request_hash: requestHash,
      p_status: status,
      p_published_url: publishedUrl,
    },
  );
  if (error) {
    const message = String((error as { message?: string }).message || "");
    const notFound = message.includes("PUBLICATION_NOT_FOUND");
    const conflict =
      /IDEMPOTENCY_KEY_REUSED|INVALID_PUBLICATION_TRANSITION|PUBLISHED_URL_REQUIRED/.test(
        message,
      );
    return apiResponse(
      {
        error: notFound
          ? "PUBLICATION_NOT_FOUND"
          : conflict
            ? "PUBLICATION_UPDATE_CONFLICT"
            : "PUBLICATION_UPDATE_FAILED",
      },
      { status: notFound ? 404 : conflict ? 409 : 500 },
    );
  }

  const publication = Array.isArray(data) ? data[0] : data;
  if (status === "TESTED" || status === "PUBLISHED") {
    await recordAffiliateFunnelEvent({
      eventName:
        status === "TESTED"
          ? "affiliate_publication_test_passed"
          : "affiliate_publication_published",
      affiliateId,
      publicationId: id,
      actorType: "affiliate",
      traceId: idempotencyKey,
      idempotencyKey: `publication-${status.toLowerCase()}:${id}:${idempotencyKey}`,
      payload: {
        status,
        has_published_url: Boolean(publishedUrl),
      },
    });
  }
  return apiResponse({
    publication,
    short_url: buildPublicUrl(`/go/${id}`),
  });
}
