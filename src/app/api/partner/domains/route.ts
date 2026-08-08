import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/api-response";
import { authAffiliate } from "@/lib/affiliate/auth-service";
import { hashOpaqueValue } from "@/lib/affiliate/auth-crypto";
import { isAllowedPartnerWriteOrigin } from "@/lib/affiliate/write-origin";
import { supabaseAdmin } from "@/lib/supabase";

const HOSTNAME_RE =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

function idempotencyKey(request: NextRequest): string | null {
  const value = request.headers.get("idempotency-key")?.trim() || "";
  return /^[A-Za-z0-9:_-]{8,100}$/.test(value) ? value : null;
}

function hostname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\.$/, "");
  if (!HOSTNAME_RE.test(raw) || raw.length > 253 || raw === "localhost")
    return null;
  return raw;
}

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok)
    return apiResponse(
      { error: auth.error, code: auth.code },
      { status: auth.status },
    );
  const { data, error } = await supabaseAdmin
    .from("affiliate_domains")
    .select(
      "id, hostname, verification_method, verification_status, verified_at, last_checked_at, created_at, updated_at",
    )
    .eq("affiliate_id", String(auth.affiliate.id))
    .order("created_at", { ascending: false });
  if (error)
    return apiResponse(
      { error: "DOMAINS_UNAVAILABLE", state: "data_unavailable" },
      { status: 503 },
    );
  return apiResponse({
    state: "ready",
    domains: data || [],
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
  const host = hostname(body.hostname);
  if (!host) return apiResponse({ error: "INVALID_DOMAIN" }, { status: 400 });
  const token = `yeosonam-verification=${crypto.randomBytes(24).toString("base64url")}`;
  const { data, error } = await supabaseAdmin
    .from("affiliate_domains")
    .insert({
      affiliate_id: String(auth.affiliate.id),
      hostname: host,
      verification_method: "DNS_TXT",
      verification_token_hash: hashOpaqueValue(token),
      verification_status: "PENDING",
      idempotency_key: key,
    } as never)
    .select(
      "id, hostname, verification_method, verification_status, created_at",
    )
    .single();
  if (error) {
    const { data: existing } = await supabaseAdmin
      .from("affiliate_domains")
      .select(
        "id, hostname, verification_method, verification_status, created_at",
      )
      .eq("affiliate_id", String(auth.affiliate.id))
      .eq("hostname", host)
      .maybeSingle();
    if (existing)
      return apiResponse({
        domain: existing,
        idempotent_replay: true,
        verification_record: null,
      });
    return apiResponse({ error: "DOMAIN_CREATE_FAILED" }, { status: 409 });
  }
  return apiResponse(
    {
      domain: data,
      verification_record: {
        type: "TXT",
        name: `_yeosonam-affiliate.${host}`,
        value: token,
      },
      verification_record_visible_once: true,
      idempotent_replay: false,
    },
    { status: 201 },
  );
}
