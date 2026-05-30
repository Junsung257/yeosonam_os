import { NextRequest } from 'next/server';
import { verifyAffiliateReferralAndPin } from '@/lib/influencer-pin-auth';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { verifyAffiliateToken } from '@/lib/affiliate/jwt-auth';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * JWT 쿠키(inf_token) 우선, 없으면 PIN 헤더/바디로 인증.
 * 서브 API 라우트(GET/POST) 공용.
 */
export async function authInfluencer(
  req: NextRequest,
  referral_code: string,
  bodyPin?: string | null,
): Promise<
  { ok: true; affiliate: Record<string, unknown> }
  | { ok: false; error: string; status: number }
> {
  // 1. JWT 쿠키
  const token = req.cookies.get('inf_token')?.value;
  if (token) {
    const jwtResult = await verifyAffiliateToken(token);
    if (jwtResult.ok && jwtResult.code === normalizeAffiliateReferralCode(referral_code)) {
      const { data: affiliate } = await supabaseAdmin
        .from('affiliates')
        .select('*')
        .eq('id', jwtResult.affiliateId)
        .single();
      if (affiliate) {
        return { ok: true, affiliate: affiliate as Record<string, unknown> };
      }
    }
  }

  // 2. PIN 인증
  const pin = bodyPin ?? req.headers.get('x-influencer-pin')?.trim() ?? null;
  if (!pin) {
    return { ok: false, error: '인증 필요', status: 401 };
  }

  const auth = await verifyAffiliateReferralAndPin(supabaseAdmin, referral_code, pin);
  if (!auth.ok) {
    return { ok: false, error: auth.message, status: auth.status };
  }

  return { ok: true, affiliate: auth.affiliate };
}
