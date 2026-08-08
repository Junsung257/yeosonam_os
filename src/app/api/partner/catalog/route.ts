import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { calculateCommissionQuote } from "@/lib/affiliate/commission-policy-service";
import { isCustomerPubliclyOpenable } from "@/lib/package-public-eligibility";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase";
import { CUSTOMER_VISIBLE_STATUSES } from "@/lib/visibility-status";
import { isValidUuid } from "@/lib/supabase-filter-safe";

type CatalogRow = Record<string, unknown> & { id: string; title: string };

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dateCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result = new Set<string>();
  for (const item of value) {
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
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(candidate);
    if (match) result.add(match[1]);
  }
  return [...result].sort();
}

function cancellationRisk(
  value: unknown,
): "HIGH" | "NORMAL" | "REVIEW_REQUIRED" {
  if (value == null) return "REVIEW_REQUIRED";
  const text = JSON.stringify(value).toLowerCase();
  if (!text || text === "{}" || text === "[]") return "REVIEW_REQUIRED";
  if (/환불\s*불가|취소\s*불가|non.?refundable|100%/.test(text)) return "HIGH";
  return "NORMAL";
}

function availability(row: CatalogRow, departures: string[]) {
  const price = Number(row.price);
  const seats = Number(row.seats_confirmed);
  if (!Number.isFinite(price) || price <= 0)
    return { code: "PRICE_REVIEW_REQUIRED", sellable: false };
  if (departures.length === 0)
    return { code: "DEPARTURE_DATE_MISSING", sellable: false };
  if (Number.isFinite(seats) && seats === 0)
    return { code: "SOLD_OUT", sellable: false };
  return { code: "SELLABLE", sellable: true };
}

export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return apiResponse(
      { error: "CATALOG_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );
  }
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );

  const queryText = (request.nextUrl.searchParams.get("q") || "")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .slice(0, 80);
  const destination = (request.nextUrl.searchParams.get("destination") || "")
    .trim()
    .toLocaleLowerCase("ko-KR")
    .slice(0, 80);
  const productId = request.nextUrl.searchParams.get("product_id") || "";
  if (productId && !isValidUuid(productId))
    return apiResponse({ error: "INVALID_PRODUCT_ID" }, { status: 400 });
  const limit = Math.min(
    48,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") || 24)),
  );
  let catalogQuery = supabaseAdmin
    .from("travel_packages")
    .select(
      "id, title, display_title, destination, country, status, publication_state, price, normalized_surcharges, confirmed_dates, price_dates, departure_days, seats_confirmed, cancellation_policy, affiliate_commission_rate, product_summary, product_tags, updated_at, audit_status, audit_report, package_revision, optional_tours, itinerary_data",
    )
    .in("status", [...CUSTOMER_VISIBLE_STATUSES])
    .in("publication_state", ["approved", "published"])
    .order("updated_at", { ascending: false })
    .limit(200);
  if (productId) catalogQuery = catalogQuery.eq("id", productId);
  const { data, error } = await catalogQuery;
  if (error) {
    return apiResponse(
      { error: "CATALOG_QUERY_FAILED", state: "data_unavailable" },
      { status: 503 },
    );
  }

  const excludedReasons: Record<string, number> = {};
  const visible = ((data || []) as unknown as CatalogRow[])
    .filter((row) => {
      if (!isCustomerPubliclyOpenable(row)) {
        excludedReasons.PUBLIC_ELIGIBILITY_BLOCKED =
          (excludedReasons.PUBLIC_ELIGIBILITY_BLOCKED || 0) + 1;
        return false;
      }
      const haystack = [
        row.title,
        row.display_title,
        row.destination,
        row.country,
        ...(Array.isArray(row.product_tags) ? row.product_tags : []),
      ]
        .map((value) => String(value || "").toLocaleLowerCase("ko-KR"))
        .join(" ");
      if (queryText && !haystack.includes(queryText)) return false;
      if (
        destination &&
        !String(row.destination || "")
          .toLocaleLowerCase("ko-KR")
          .includes(destination)
      )
        return false;
      return true;
    })
    .slice(0, limit);

  const productIds = visible.map((row) => row.id);
  const { data: savedRows, error: savedError } =
    productIds.length > 0
      ? await supabaseAdmin
          .from("affiliate_saved_products")
          .select("product_id")
          .eq("affiliate_id", String(auth.affiliate.id))
          .in("product_id", productIds)
      : { data: [], error: null };
  if (savedError) {
    return apiResponse(
      { error: "SAVED_PRODUCTS_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );
  }
  const saved = new Set((savedRows || []).map((row) => String(row.product_id)));

  const products = await Promise.all(
    visible.map(async (row) => {
      const departures = [
        ...new Set([
          ...dateCandidates(row.confirmed_dates),
          ...dateCandidates(row.price_dates),
        ]),
      ].sort();
      const price = Math.max(0, Math.round(Number(row.price) || 0));
      const state = availability(row, departures);
      const quote = await calculateCommissionQuote({
        productId: row.id,
        affiliateId: String(auth.affiliate.id),
        commissionBaseKrw: price,
      });
      return {
        id: row.id,
        title: stringValue(row.display_title) || stringValue(row.title),
        destination: stringValue(row.destination),
        country: stringValue(row.country),
        summary: stringValue(row.product_summary),
        tags: Array.isArray(row.product_tags)
          ? row.product_tags.map(String).slice(0, 8)
          : [],
        status: row.status,
        availability: state,
        next_departure: departures[0] || null,
        departure_dates: departures.slice(0, 12),
        customer_price_krw: price || null,
        required_local_costs: row.normalized_surcharges || null,
        cancellation_risk: cancellationRisk(row.cancellation_policy),
        cancellation_policy: row.cancellation_policy || null,
        expected_commission:
          quote.status === "CALCULATED"
            ? {
                state: "available",
                amount_krw: quote.commissionAmountKrw,
                rate: quote.finalRate,
                formula: "커미션 기준금액 × 예약 시점 적용률",
                policy_set_version: quote.policySetVersion,
              }
            : {
                state: "calculation_hold",
                amount_krw: null,
                rate: null,
                formula: null,
              },
        saved: saved.has(row.id),
        updated_at: row.updated_at || null,
      };
    }),
  );
  const lastSyncedAt =
    visible
      .map((row) => stringValue(row.updated_at))
      .filter(Boolean)
      .sort()
      .at(-1) || null;

  return apiResponse({
    state: products.length > 0 ? "ready" : "empty",
    products,
    result_count: products.length,
    visible_statuses: CUSTOMER_VISIBLE_STATUSES,
    excluded_reason_counts: excludedReasons,
    last_synced_at: lastSyncedAt,
    updated_at: new Date().toISOString(),
  });
}
