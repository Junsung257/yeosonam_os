import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

/**
 * Compatibility route. A code returned here is attribution-only and never
 * changes the customer price. Approved discounts have a separate contract.
 */
export async function GET(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: 'DB_UNAVAILABLE' }, { status: 503 });
  }

  const code = normalizeAffiliateReferralCode(request.nextUrl.searchParams.get('code') || '');
  if (!code) return apiResponse({ valid: false, reason: 'INVALID_CODE' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('creator_codes')
    .select('id, code, affiliate_id, status')
    .eq('code', code)
    .maybeSingle();
  if (error) return apiResponse({ error: sanitizeDbError(error), code: 'CODE_LOOKUP_UNAVAILABLE' }, { status: 503 });
  if (!data) return apiResponse({ valid: false, reason: 'NOT_FOUND' });
  if (data.status !== 'ACTIVE') return apiResponse({ valid: false, reason: 'INACTIVE' });

  const { data: affiliate, error: affiliateError } = await supabaseAdmin
    .from('affiliates')
    .select('id, is_active, partner_status')
    .eq('id', data.affiliate_id)
    .maybeSingle();
  if (affiliateError) {
    return apiResponse({ error: sanitizeDbError(affiliateError), code: 'PARTNER_LOOKUP_UNAVAILABLE' }, { status: 503 });
  }
  if (
    !affiliate
    || affiliate.is_active !== true
    || ['suspended', 'terminated'].includes(String(affiliate.partner_status || 'active'))
  ) {
    return apiResponse({ valid: false, reason: 'PARTNER_RESTRICTED' });
  }

  return apiResponse({
    valid: true,
    kind: 'creator_code',
    changes_customer_price: false,
    creator_code: {
      id: data.id,
      code: data.code,
      affiliate_id: data.affiliate_id,
    },
  });
}
