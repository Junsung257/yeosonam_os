import { NextRequest } from "next/server";
import { encryptAffiliateOutboxPayload } from "@/lib/affiliate/auth-crypto";
import { supabaseAdmin } from "@/lib/supabase";

export function sameOriginWrite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  return !origin || origin === request.nextUrl.origin;
}

export function idempotencyKey(request: NextRequest): string | null {
  const value = request.headers.get("idempotency-key")?.trim() || "";
  return /^[A-Za-z0-9:_-]{8,100}$/.test(value) ? value : null;
}

export function maskedLast4(value: string): string {
  const normalized = value.replace(/\s+/g, "");
  return normalized.length >= 4 ? `••••${normalized.slice(-4)}` : "••••";
}

export async function submitPayoutProfile(input: {
  affiliateId: string;
  idempotencyKey: string;
  payoutType: "PERSONAL" | "BUSINESS";
  accountHolder: string;
  bankName: string;
  accountNumber: string;
}) {
  const encryptedPayload = encryptAffiliateOutboxPayload({
    payout_type: input.payoutType,
    account_holder: input.accountHolder,
    bank_name: input.bankName,
    account_number: input.accountNumber,
  });
  const { data, error } = await supabaseAdmin
    .from("affiliate_payout_profiles")
    .upsert(
      {
        affiliate_id: input.affiliateId,
        encrypted_payload: encryptedPayload,
        masked_account: maskedLast4(input.accountNumber),
        payout_type: input.payoutType,
        status: "PENDING_REVIEW",
        idempotency_key: input.idempotencyKey,
        submitted_at: new Date().toISOString(),
        reviewed_at: null,
        reviewed_by: null,
        review_reason: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "affiliate_id" },
    )
    .select("id, masked_account, payout_type, status, submitted_at, review_reason")
    .single();
  if (error) throw error;
  const affiliateUpdate = await supabaseAdmin
    .from("affiliates")
    .update({
      payout_profile_status: "PENDING_REVIEW",
      payout_type: input.payoutType,
    })
    .eq("id", input.affiliateId);
  if (affiliateUpdate.error) throw affiliateUpdate.error;
  return data;
}

export async function submitTaxProfile(input: {
  affiliateId: string;
  idempotencyKey: string;
  taxType: "PERSONAL" | "BUSINESS";
  identifier: string;
  legalName: string;
}) {
  const encryptedPayload = encryptAffiliateOutboxPayload({
    tax_type: input.taxType,
    identifier: input.identifier,
    legal_name: input.legalName,
  });
  const { data, error } = await supabaseAdmin
    .from("affiliate_tax_profiles")
    .upsert(
      {
        affiliate_id: input.affiliateId,
        encrypted_payload: encryptedPayload,
        masked_identifier: maskedLast4(input.identifier),
        tax_type: input.taxType,
        status: "PENDING_REVIEW",
        idempotency_key: input.idempotencyKey,
        submitted_at: new Date().toISOString(),
        reviewed_at: null,
        reviewed_by: null,
        review_reason: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "affiliate_id" },
    )
    .select("id, masked_identifier, tax_type, status, submitted_at, review_reason")
    .single();
  if (error) throw error;
  const affiliateUpdate = await supabaseAdmin
    .from("affiliates")
    .update({ tax_profile_status: "PENDING_REVIEW" })
    .eq("id", input.affiliateId);
  if (affiliateUpdate.error) throw affiliateUpdate.error;
  return data;
}
