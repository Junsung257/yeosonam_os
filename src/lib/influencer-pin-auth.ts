import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';

/** 대시보드·링크·소재 API 공통: referral_code + PIN 일치 */
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
      'id, name, referral_code, grade, grade_label, bonus_rate, booking_count, total_commission, payout_type, logo_url, pin, phone, created_at, is_active'
    )
    .eq('referral_code', code)
    .maybeSingle();

  if (error || !affiliate) {
    return { ok: false, message: '존재하지 않는 코드입니다', status: 404 };
  }

  const row = affiliate as {
    is_active?: boolean;
    pin: string | null;
    phone: string | null;
  };
  if (row.is_active === false) {
    return { ok: false, message: '비활성 파트너입니다', status: 403 };
  }

  const storedPin = row.pin || (row.phone ? row.phone.replace(/\D/g, '').slice(-4) : null);
  if (!storedPin || raw !== storedPin) {
    return { ok: false, message: 'PIN이 일치하지 않습니다', status: 401 };
  }

  return { ok: true, affiliate: affiliate as Record<string, unknown> };
}
