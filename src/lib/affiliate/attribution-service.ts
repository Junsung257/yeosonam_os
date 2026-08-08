import crypto from 'node:crypto';
import type { NextRequest } from 'next/server';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { isValidUuid } from '@/lib/supabase-filter-safe';

export const ATTRIBUTION_POLICY_VERSION = 'affiliate-attribution-v2';
const MAX_TOUCH_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export interface AttributionDecision {
  id: string;
  traceId: string;
  touchpointId: string | null;
  publicationId: string | null;
  linkId: string | null;
  creatorCodeId: string | null;
  reasonCode: 'PUBLICATION_COOKIE' | 'CREATOR_CODE' | 'REFERRAL_COOKIE' | 'ADMIN_OVERRIDE';
  policyVersion: string;
}

interface EligibleTouchpointRow {
  id: string;
  affiliate_id: string | null;
  publication_id: string | null;
  link_id: string | null;
  package_id: string | null;
  clicked_at: string;
  outcome: string;
}

export async function createAttributionDecision(input: {
  request: NextRequest;
  affiliateId: string;
  productId?: string | null;
  creatorCodeId?: string | null;
  referralCode?: string | null;
}): Promise<AttributionDecision> {
  if (!isSupabaseAdminConfigured) throw new Error('ATTRIBUTION_DB_UNAVAILABLE');

  const touchpointCookie = input.request.cookies.get('aff_touchpoint')?.value || '';
  let touchpoint: EligibleTouchpointRow | null = null;

  if (isValidUuid(touchpointCookie)) {
    const { data, error } = await supabaseAdmin
      .from('affiliate_touchpoints')
      .select('id, affiliate_id, publication_id, link_id, package_id, clicked_at, outcome')
      .eq('id', touchpointCookie)
      .maybeSingle();
    if (error) throw new Error('ATTRIBUTION_TOUCHPOINT_UNAVAILABLE');
    touchpoint = data as unknown as EligibleTouchpointRow | null;
    const tooOld = !touchpoint?.clicked_at
      || Date.now() - new Date(touchpoint.clicked_at).getTime() > MAX_TOUCH_AGE_MS;
    const wrongOwner = touchpoint?.affiliate_id !== input.affiliateId;
    const wrongProduct = Boolean(
      touchpoint?.package_id && input.productId && touchpoint.package_id !== input.productId,
    );
    if (tooOld || wrongOwner || wrongProduct || touchpoint?.outcome === 'filtered_bot') touchpoint = null;
  }

  const referralCode = normalizeAffiliateReferralCode(input.referralCode || '');
  const reasonCode: AttributionDecision['reasonCode'] = touchpoint?.publication_id
    ? 'PUBLICATION_COOKIE'
    : input.creatorCodeId
      ? 'CREATOR_CODE'
      : referralCode
        ? 'REFERRAL_COOKIE'
        : 'ADMIN_OVERRIDE';
  const traceId = crypto.randomUUID();
  const evidence = {
    touchpoint_cookie_present: Boolean(touchpointCookie),
    touchpoint_eligible: Boolean(touchpoint),
    publication_id: touchpoint?.publication_id || null,
    link_id: touchpoint?.link_id || null,
    creator_code_id: input.creatorCodeId || null,
    referral_code: referralCode || null,
    product_id: input.productId || null,
    evaluated_at: new Date().toISOString(),
  };
  const { data: decision, error } = await supabaseAdmin
    .from('attribution_decisions')
    .insert({
      affiliate_id: input.affiliateId,
      winning_touchpoint_id: touchpoint?.id || null,
      publication_id: touchpoint?.publication_id || null,
      link_id: touchpoint?.link_id || null,
      creator_code_id: input.creatorCodeId || null,
      product_id: input.productId || null,
      attribution_model: input.creatorCodeId && !touchpoint ? 'CREATOR_CODE' : 'LAST_ELIGIBLE_TOUCH',
      reason_code: reasonCode,
      policy_version: ATTRIBUTION_POLICY_VERSION,
      trace_id: traceId,
      evidence,
    } as never)
    .select('id')
    .single();
  if (error || !decision?.id) throw new Error('ATTRIBUTION_DECISION_CREATE_FAILED');

  return {
    id: String(decision.id),
    traceId,
    touchpointId: touchpoint?.id || null,
    publicationId: touchpoint?.publication_id || null,
    linkId: touchpoint?.link_id || null,
    creatorCodeId: input.creatorCodeId || null,
    reasonCode,
    policyVersion: ATTRIBUTION_POLICY_VERSION,
  };
}

export async function finalizeAttributionDecision(
  decisionId: string,
  bookingId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('finalize_affiliate_attribution_v2', {
    p_decision_id: decisionId,
    p_booking_id: bookingId,
  });
  if (error || data !== true) throw new Error('ATTRIBUTION_FINALIZE_FAILED');
}
