import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { recordAffiliateFunnelEvent } from "@/lib/affiliate/funnel-events";
import { isAllowedPartnerWriteOrigin } from "@/lib/affiliate/write-origin";
import { sanitizeDbError } from "@/lib/error-sanitizer";
import { isCustomerPubliclyOpenable } from "@/lib/package-public-eligibility";
import { buildPublicUrl } from "@/lib/public-app-origin";
import { supabaseAdmin } from "@/lib/supabase";
import { isValidUuid } from "@/lib/supabase-filter-safe";
import { CUSTOMER_VISIBLE_STATUSES } from "@/lib/visibility-status";

const CHANNEL_TYPES = new Set([
  "BLOG",
  "WEBSITE",
  "INSTAGRAM",
  "YOUTUBE",
  "FACEBOOK",
  "THREADS",
  "KAKAO",
  "QR",
  "OFFLINE",
  "OTHER",
]);

function cleanPlacementName(value: unknown): string {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, 80)
    : "";
}

function cleanSubId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
  return cleaned || null;
}

function hasDepartureDate(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.some((item) => {
      const candidate =
        typeof item === "string"
          ? item
          : item && typeof item === "object"
            ? String(
                (item as Record<string, unknown>).departure_date ||
                  (item as Record<string, unknown>).date ||
                  "",
              )
            : "";
      return /^\d{4}-\d{2}-\d{2}/.test(candidate);
    })
  );
}

function validIdempotencyKey(request: NextRequest): string | null {
  const key = request.headers.get("idempotency-key")?.trim() || "";
  return /^[A-Za-z0-9:_-]{8,100}$/.test(key) ? key : null;
}

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );

  const { data, error } = await supabaseAdmin
    .from("affiliate_publications")
    .select(
      "id, product_id, collection_id, channel_id, verified_domain_id, channel_type, placement_name, sub_id, status, published_url, click_count, unique_visitor_count, conversion_count, health_status, first_published_at, last_checked_at, created_at, updated_at",
    )
    .eq("affiliate_id", String(auth.affiliate.id))
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    return apiResponse(
      { error: sanitizeDbError(error), code: "PUBLICATIONS_UNAVAILABLE" },
      { status: 503 },
    );
  }

  const publications = (data || []).map((row) => ({
    ...row,
    short_url: buildPublicUrl(`/go/${row.id}`),
  }));
  return apiResponse({ publications, updated_at: new Date().toISOString() });
}

export async function POST(request: NextRequest) {
  if (!isAllowedPartnerWriteOrigin(request)) {
    return apiResponse({ error: "ORIGIN_REJECTED" }, { status: 403 });
  }
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );

  const idempotencyKey = validIdempotencyKey(request);
  if (!idempotencyKey) {
    return apiResponse({ error: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const productId = typeof body.product_id === "string" ? body.product_id : "";
  const channelId = typeof body.channel_id === "string" ? body.channel_id : "";
  const channelType =
    typeof body.channel_type === "string"
      ? body.channel_type.toUpperCase()
      : "";
  const placementName = cleanPlacementName(body.placement_name);
  const subId = cleanSubId(body.sub_id);
  if (
    !isValidUuid(productId) ||
    (channelId && !isValidUuid(channelId)) ||
    !CHANNEL_TYPES.has(channelType) ||
    !placementName
  ) {
    return apiResponse({ error: "INVALID_PUBLICATION_INPUT" }, { status: 400 });
  }

  if (channelId) {
    const { data: channel, error: channelError } = await supabaseAdmin
      .from("affiliate_channels")
      .select("id, channel_type, verification_status")
      .eq("id", channelId)
      .eq("affiliate_id", String(auth.affiliate.id))
      .maybeSingle();
    if (channelError)
      return apiResponse(
        { error: "CHANNEL_ELIGIBILITY_UNAVAILABLE" },
        { status: 503 },
      );
    if (
      !channel ||
      channel.channel_type !== channelType ||
      channel.verification_status === "REVOKED"
    ) {
      return apiResponse({ error: "CHANNEL_NOT_ELIGIBLE" }, { status: 409 });
    }
  }

  const { data: product, error: productError } = await supabaseAdmin
    .from("travel_packages")
    .select(
      "id, title, status, publication_state, price, confirmed_dates, price_dates, seats_confirmed, package_revision, audit_status, audit_report, updated_at, optional_tours, itinerary_data",
    )
    .eq("id", productId)
    .in("status", [...CUSTOMER_VISIBLE_STATUSES])
    .in("publication_state", ["approved", "published"])
    .maybeSingle();
  if (productError) {
    return apiResponse(
      { error: "PRODUCT_ELIGIBILITY_UNAVAILABLE" },
      { status: 503 },
    );
  }
  const productPrice = Number(product?.price);
  const seats = Number(product?.seats_confirmed);
  const hasDeparture =
    hasDepartureDate(product?.confirmed_dates) ||
    hasDepartureDate(product?.price_dates);
  if (
    !product ||
    !isCustomerPubliclyOpenable(product as Record<string, unknown>) ||
    !Number.isFinite(productPrice) ||
    productPrice <= 0 ||
    !hasDeparture ||
    (Number.isFinite(seats) && seats === 0)
  ) {
    return apiResponse({ error: "PRODUCT_NOT_PUBLISHABLE" }, { status: 409 });
  }

  const row = {
    affiliate_id: String(auth.affiliate.id),
    product_id: productId,
    collection_id: null,
    channel_id: channelId || null,
    channel_type: channelType,
    placement_name: placementName,
    sub_id: subId,
    destination_url: buildPublicUrl(`/packages/${productId}`),
    disclosure_version: "affiliate-disclosure-v1",
    status: "DRAFT",
    idempotency_key: idempotencyKey,
  };
  const { data, error } = await supabaseAdmin
    .from("affiliate_publications")
    .insert(row as never)
    .select(
      "id, product_id, channel_type, placement_name, sub_id, status, created_at",
    )
    .single();

  if (error) {
    const { data: existing } = await supabaseAdmin
      .from("affiliate_publications")
      .select(
        "id, product_id, channel_type, placement_name, sub_id, status, created_at",
      )
      .eq("affiliate_id", String(auth.affiliate.id))
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (existing) {
      return apiResponse({
        publication: existing,
        short_url: buildPublicUrl(`/go/${existing.id}`),
        idempotent_replay: true,
      });
    }
    console.error("[Partner publication create]", {
      trace_id: crypto.randomUUID(),
    });
    return apiResponse(
      { error: sanitizeDbError(error), code: "PUBLICATION_CREATE_FAILED" },
      { status: 500 },
    );
  }

  await recordAffiliateFunnelEvent({
    eventName: "affiliate_publication_created",
    affiliateId: String(auth.affiliate.id),
    publicationId: data.id,
    productId,
    actorType: "affiliate",
    traceId: idempotencyKey,
    idempotencyKey: `publication-created:${data.id}`,
    payload: {
      channel_type: channelType,
      has_channel_id: Boolean(channelId),
      has_sub_id: Boolean(subId),
    },
  });

  return apiResponse(
    {
      publication: data,
      short_url: buildPublicUrl(`/go/${data.id}`),
      idempotent_replay: false,
    },
    { status: 201 },
  );
}
