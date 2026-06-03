import type { SupabaseClient } from '@supabase/supabase-js';
import { hashAffiliatePin } from '@/lib/affiliate/auth-service';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

/** Shared referral_code + PIN verifier. No phone-last-4 fallback. */
export async function verifyAffiliateReferralAndPin(
  admin: SupabaseClient,
  referral_code: string,
  pin: string | null | undefined
): Promise<
  | { ok: true; affiliate: Record<string, unknown> }
  | { ok: false; message: string; status: number }
> {
  const raw = typeof pin === 'string' ? pin.trim() : '';
  if (!raw) {
    return { ok: false, message: 'PIN이 필요합니다.', status: 401 };
  }

  const code = normalizeAffiliateReferralCode(referral_code);
  if (!code) {
    return { ok: false, message: '추천코드가 필요합니다.', status: 400 };
  }

  const { data: affiliate, error } = await admin
    .from('affiliates')
    .select(
      'id, name, referral_code, grade, grade_label, bonus_rate, booking_count, total_commission, payout_type, logo_url, portal_pin, pin_hash, created_at, is_active, partner_status'
    )
    .eq('referral_code', code)
    .maybeSingle();

  if (error || !affiliate) {
    return { ok: false, message: '존재하지 않는 코드입니다.', status: 404 };
  }

  const row = affiliate as {
    id: string;
    is_active?: boolean;
    portal_pin?: string | null;
    pin_hash?: string | null;
    partner_status?: string | null;
  };
  if (row.is_active === false) {
    return { ok: false, message: '비활성 파트너입니다.', status: 403 };
  }
  if (row.partner_status === 'suspended' || row.partner_status === 'terminated') {
    return { ok: false, message: '접근이 제한된 파트너입니다.', status: 403 };
  }

  const nextHash = hashAffiliatePin(raw);
  const matched = row.pin_hash === nextHash || (!!row.portal_pin && row.portal_pin === raw);
  if (!matched) {
    return { ok: false, message: 'PIN이 일치하지 않습니다.', status: 401 };
  }

  if (!row.pin_hash && row.portal_pin === raw) {
    await admin.from('affiliates').update({ pin_hash: nextHash }).eq('id', row.id);
  }

  return { ok: true, affiliate: affiliate as Record<string, unknown> };
}
