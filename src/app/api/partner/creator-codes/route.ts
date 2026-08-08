import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { authAffiliate } from '@/lib/affiliate/auth-service';
import { isAllowedPartnerWriteOrigin } from '@/lib/affiliate/write-origin';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { supabaseAdmin } from '@/lib/supabase';

const FORBIDDEN_CODES = new Set([
  'ADMIN', 'SUPPORT', 'OFFICIAL', 'YEOSONAM', 'YESONAM',
  'COUPON', 'DISCOUNT', 'SALE', 'FREE', 'HELP',
]);

function idempotencyKey(request: NextRequest): string | null {
  const key = request.headers.get('idempotency-key')?.trim() || '';
  return /^[A-Za-z0-9:_-]{8,100}$/.test(key) ? key : null;
}

export async function GET(request: NextRequest) {
  const auth = await authAffiliate(request);
  if (!auth.ok) return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });

  const { data, error } = await supabaseAdmin
    .from('creator_codes')
    .select('id, code, status, source, created_at, updated_at, retired_at')
    .eq('affiliate_id', String(auth.affiliate.id))
    .order('created_at', { ascending: false });
  if (error) return apiResponse({ error: sanitizeDbError(error), code: 'CREATOR_CODES_UNAVAILABLE' }, { status: 503 });
  return apiResponse({
    creator_codes: data || [],
    changes_customer_price: false,
    definition: '추천 귀속 전용 코드',
  });
}

export async function POST(request: NextRequest) {
  if (!isAllowedPartnerWriteOrigin(request)) {
    return apiResponse({ error: 'ORIGIN_REJECTED' }, { status: 403 });
  }
  const auth = await authAffiliate(request);
  if (!auth.ok) return apiResponse({ error: auth.error, code: auth.code }, { status: auth.status });

  const commandKey = idempotencyKey(request);
  if (!commandKey) return apiResponse({ error: 'IDEMPOTENCY_KEY_REQUIRED' }, { status: 400 });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const code = normalizeAffiliateReferralCode(typeof body.code === 'string' ? body.code : '');
  if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code) || FORBIDDEN_CODES.has(code)) {
    return apiResponse({ error: 'CREATOR_CODE_NOT_ALLOWED' }, { status: 400 });
  }

  const row = {
    affiliate_id: String(auth.affiliate.id),
    code,
    status: 'ACTIVE',
    source: 'PARTNER',
    idempotency_key: commandKey,
  };
  const { data, error } = await supabaseAdmin
    .from('creator_codes')
    .insert(row as never)
    .select('id, code, status, source, created_at')
    .single();
  if (error) {
    const { data: replay } = await supabaseAdmin
      .from('creator_codes')
      .select('id, code, status, source, created_at')
      .eq('affiliate_id', String(auth.affiliate.id))
      .eq('idempotency_key', commandKey)
      .maybeSingle();
    if (replay) {
      return apiResponse({ creator_code: replay, changes_customer_price: false, idempotent_replay: true });
    }
    const duplicate = String((error as { code?: string }).code || '') === '23505';
    return apiResponse(
      { error: duplicate ? 'CREATOR_CODE_ALREADY_EXISTS' : sanitizeDbError(error) },
      { status: duplicate ? 409 : 500 },
    );
  }
  return apiResponse({ creator_code: data, changes_customer_price: false, idempotent_replay: false }, { status: 201 });
}
