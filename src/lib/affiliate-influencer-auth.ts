import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

/** 파트너 대시보드·정산 PDF 등 — PIN(또는 전화 뒷 4자리) 일치 여부 */
export async function verifyInfluencerPinForReferral(
  referralCode: string,
  pin: string,
): Promise<{ ok: true; affiliateId: string } | { ok: false }> {
  const code = normalizeAffiliateReferralCode(referralCode);
  const p = pin.trim();
  if (!code || !/^\d{4}$/.test(p)) return { ok: false };
  if (!isSupabaseConfigured || !supabaseAdmin) return { ok: false };

  const { data: affiliate, error } = await supabaseAdmin
    .from('affiliates')
    .select('id, pin, phone, is_active')
    .eq('referral_code', code)
    .maybeSingle();

  if (error || !affiliate || affiliate.is_active === false) return { ok: false };

  const row = affiliate as { id: string; pin?: string | null; phone?: string | null };
  const stored =
    row.pin ||
    (row.phone ? String(row.phone).replace(/\D/g, '').slice(-4) : null);
  if (!stored || p !== stored) return { ok: false };

  return { ok: true, affiliateId: row.id };
}
