/**
 * 제휴(어필리에이터) 스코프 — 공개 QA 채팅 등에서 tenant_id(=affiliate.id) 해석
 *
 * 플랫폼 직접 유입: null
 * 제휴 링크(ref 쿠키 / referral_code): affiliates.id
 */

import { looksLikeReferralCode, normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';

/** @deprecated 직접 `@/lib/affiliate-ref-code` import 권장 — 하위 호환용 재보내기 */
export { looksLikeReferralCode };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * customer_facts.tenant_id / conversations.affiliate_id 에 쓸 UUID
 */
export async function resolveAffiliateScopeId(params: {
  affiliateId?: string | null;
  affiliateRef?: string | null;
  /** 클라이언트 tracker getReferrer() — 추천 코드일 때만 사용 */
  referrer?: string | null;
  /** 기존 대화에 이미 저장된 제휴 (후속 메시지에서 우선) */
  existingAffiliateId?: string | null;
}): Promise<string | null> {
  if (params.existingAffiliateId && UUID_RE.test(params.existingAffiliateId)) {
    return params.existingAffiliateId;
  }

  if (!isSupabaseConfigured) return null;

  const rawId = params.affiliateId?.trim();
  if (rawId && UUID_RE.test(rawId)) {
    const { data } = await supabaseAdmin.from('affiliates').select('id').eq('id', rawId).maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }

  const fromRef = normalizeAffiliateReferralCode(params.affiliateRef ?? '');
  const fromCookieRaw = params.referrer?.trim() ?? '';
  const fromCookie =
    fromCookieRaw && looksLikeReferralCode(normalizeAffiliateReferralCode(fromCookieRaw))
      ? normalizeAffiliateReferralCode(fromCookieRaw)
      : '';
  const code = fromRef || fromCookie;
  if (!code) return null;

  const { data } = await supabaseAdmin
    .from('affiliates')
    .select('id')
    .eq('referral_code', code)
    .maybeSingle();

  return (data?.id as string | undefined) ?? null;
}
