import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { recordAffiliateFunnelEvent } from "@/lib/affiliate/funnel-events";
import { isAllowedPartnerWriteOrigin } from "@/lib/affiliate/write-origin";
import { supabaseAdmin } from "@/lib/supabase";
import { isValidUuid } from "@/lib/supabase-filter-safe";

async function identify(request: NextRequest) {
  const auth = await authAffiliate(request);
  return auth;
}

export async function POST(request: NextRequest) {
  if (!isAllowedPartnerWriteOrigin(request))
    return apiResponse({ error: "ORIGIN_REJECTED" }, { status: 403 });
  const auth = await identify(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const productId = typeof body.product_id === "string" ? body.product_id : "";
  if (!isValidUuid(productId))
    return apiResponse({ error: "INVALID_PRODUCT_ID" }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("affiliate_saved_products")
    .upsert(
      {
        affiliate_id: String(auth.affiliate.id),
        product_id: productId,
      } as never,
      {
        onConflict: "affiliate_id,product_id",
      },
    )
    .select("id, product_id, saved_at")
    .single();
  if (error)
    return apiResponse({ error: "SAVE_PRODUCT_FAILED" }, { status: 500 });
  await recordAffiliateFunnelEvent({
    eventName: "affiliate_product_saved",
    affiliateId: String(auth.affiliate.id),
    productId,
    actorType: "affiliate",
    idempotencyKey: `product-saved:${auth.affiliate.id}:${productId}`,
    payload: { saved: true },
  });
  return apiResponse({ saved_product: data, saved: true });
}

export async function DELETE(request: NextRequest) {
  if (!isAllowedPartnerWriteOrigin(request))
    return apiResponse({ error: "ORIGIN_REJECTED" }, { status: 403 });
  const auth = await identify(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const productId = request.nextUrl.searchParams.get("product_id") || "";
  if (!isValidUuid(productId))
    return apiResponse({ error: "INVALID_PRODUCT_ID" }, { status: 400 });
  const { error } = await supabaseAdmin
    .from("affiliate_saved_products")
    .delete()
    .eq("affiliate_id", String(auth.affiliate.id))
    .eq("product_id", productId);
  if (error)
    return apiResponse({ error: "UNSAVE_PRODUCT_FAILED" }, { status: 500 });
  return apiResponse({ saved: false, product_id: productId });
}
