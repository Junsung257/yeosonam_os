import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { isAllowedPartnerWriteOrigin } from "@/lib/affiliate/write-origin";
import { supabaseAdmin } from "@/lib/supabase";

const CHANNEL_TYPES = new Set([
  "BLOG",
  "WEBSITE",
  "INSTAGRAM",
  "YOUTUBE",
  "FACEBOOK",
  "THREADS",
  "KAKAO",
  "OFFLINE",
  "OTHER",
]);

function idempotencyKey(request: NextRequest): string | null {
  const value = request.headers.get("idempotency-key")?.trim() || "";
  return /^[A-Za-z0-9:_-]{8,100}$/.test(value) ? value : null;
}

function channelUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const { data, error } = await supabaseAdmin
    .from("affiliate_channels")
    .select(
      "id, channel_type, channel_url, display_name, verification_status, verified_at, created_at, updated_at",
    )
    .eq("affiliate_id", String(auth.affiliate.id))
    .order("created_at", { ascending: false });
  if (error)
    return apiResponse(
      { error: "CHANNELS_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );
  return apiResponse({
    state: "ready",
    channels: data || [],
    updated_at: new Date().toISOString(),
  });
}

export async function POST(request: NextRequest) {
  if (!isAllowedPartnerWriteOrigin(request))
    return apiResponse({ error: "ORIGIN_REJECTED" }, { status: 403 });
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const key = idempotencyKey(request);
  if (!key)
    return apiResponse({ error: "IDEMPOTENCY_KEY_REQUIRED" }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const type =
    typeof body.channel_type === "string"
      ? body.channel_type.toUpperCase()
      : "";
  const url = channelUrl(body.channel_url);
  const displayName =
    typeof body.display_name === "string"
      ? body.display_name.trim().slice(0, 80)
      : "";
  if (!CHANNEL_TYPES.has(type) || !url)
    return apiResponse({ error: "INVALID_CHANNEL" }, { status: 400 });

  const row = {
    affiliate_id: String(auth.affiliate.id),
    channel_type: type,
    channel_url: url,
    display_name: displayName || null,
    verification_status: "PENDING",
    idempotency_key: key,
  };
  const { data, error } = await supabaseAdmin
    .from("affiliate_channels")
    .insert(row as never)
    .select(
      "id, channel_type, channel_url, display_name, verification_status, created_at",
    )
    .single();
  if (error) {
    const { data: replay } = await supabaseAdmin
      .from("affiliate_channels")
      .select(
        "id, channel_type, channel_url, display_name, verification_status, created_at",
      )
      .eq("affiliate_id", String(auth.affiliate.id))
      .eq("idempotency_key", key)
      .limit(1)
      .maybeSingle();
    const { data: duplicate } = replay
      ? { data: null }
      : await supabaseAdmin
          .from("affiliate_channels")
          .select(
            "id, channel_type, channel_url, display_name, verification_status, created_at",
          )
          .eq("affiliate_id", String(auth.affiliate.id))
          .eq("channel_url", url)
          .limit(1)
          .maybeSingle();
    const existing = replay || duplicate;
    if (existing)
      return apiResponse({ channel: existing, idempotent_replay: true });
    return apiResponse({ error: "CHANNEL_CREATE_FAILED" }, { status: 500 });
  }
  return apiResponse(
    { channel: data, idempotent_replay: false },
    { status: 201 },
  );
}
