import { hashAffiliatePin } from '@/lib/affiliate/auth-service';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

/** Verify affiliate PIN for dashboard/PDF compatibility paths. No phone-last-4 fallback. */
export async function verifyInfluencerPinForReferral(
  referralCode: string,
  pin: string,
): Promise<{ ok: true; affiliateId: string } | { ok: false }> {
  const code = normalizeAffiliateReferralCode(referralCode);
  const rawPin = pin.trim();
  if (!code || !/^\d{4,12}$/.test(rawPin)) return { ok: false };
  if (!isSupabaseConfigured || !supabaseAdmin) return { ok: false };

  const { data: affiliate, error } = await supabaseAdmin
    .from('affiliates')
    .select('id, portal_pin, pin_hash, is_active, partner_status')
    .eq('referral_code', code)
    .maybeSingle();

  if (error || !affiliate || affiliate.is_active === false) return { ok: false };

  const row = affiliate as {
    id: string;
    portal_pin?: string | null;
    pin_hash?: string | null;
    partner_status?: string | null;
  };
  if (row.partner_status === 'suspended' || row.partner_status === 'terminated') return { ok: false };

  const nextHash = hashAffiliatePin(rawPin);
  const matched = row.pin_hash === nextHash || (!!row.portal_pin && row.portal_pin === rawPin);
  if (!matched) return { ok: false };

  if (!row.pin_hash && row.portal_pin === rawPin) {
    await supabaseAdmin.from('affiliates').update({ pin_hash: nextHash }).eq('id', row.id);
  }

  return { ok: true, affiliateId: row.id };
}
