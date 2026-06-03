import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { AFFILIATE_CONFIG } from '@/lib/affiliateConfig';
import { getSecret } from '@/lib/secret-registry';
import { isSupabaseConfigured, supabaseAdmin } from '@/lib/supabase';
import { issueAffiliateToken, verifyAffiliateToken } from '@/lib/affiliate/jwt-auth';

const { PIN_MAX_ATTEMPTS, PIN_WINDOW_MINUTES } = AFFILIATE_CONFIG;

export type AuthAffiliateResult =
  | { ok: true; affiliate: Record<string, unknown>; token?: string }
  | { ok: false; error: string; status: number; code?: string };

function pinSecret(): string {
  return (
    getSecret('AFFILIATE_JWT_SECRET') ||
    getSecret('SUPABASE_JWT_SECRET') ||
    'yeosonam-dev-affiliate-pin-secret'
  );
}

export function hashAffiliatePin(pin: string): string {
  return crypto
    .createHmac('sha256', pinSecret())
    .update(pin.trim())
    .digest('hex');
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function attemptIdentifier(referralCode: string): string {
  return `affiliate:${referralCode}`;
}

async function countRecentFailures(identifier: string): Promise<number> {
  const since = new Date(Date.now() - PIN_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { count } = await supabaseAdmin
    .from('pin_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('identifier', identifier)
    .gte('attempted_at', since);
  return count || 0;
}

async function recordFailure(identifier: string) {
  await supabaseAdmin.from('pin_attempts').insert({
    identifier,
    attempted_at: new Date().toISOString(),
  });
}

async function clearFailures(identifier: string) {
  await supabaseAdmin.from('pin_attempts').delete().eq('identifier', identifier);
}

async function loadAffiliateById(id: string) {
  const { data } = await supabaseAdmin
    .from('affiliates')
    .select('id, name, referral_code, grade, grade_label, bonus_rate, booking_count, total_commission, payout_type, logo_url, created_at, is_active, partner_status, portal_pin, pin_hash, portal_login_count, onboarded_at, branding_level, content_quota, content_used')
    .eq('id', id)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

async function loadAffiliateByCode(referralCode: string) {
  const { data } = await supabaseAdmin
    .from('affiliates')
    .select('id, name, referral_code, grade, grade_label, bonus_rate, booking_count, total_commission, payout_type, logo_url, created_at, is_active, partner_status, portal_pin, pin_hash, portal_login_count, onboarded_at, branding_level, content_quota, content_used')
    .eq('referral_code', referralCode)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

function ensureActive(affiliate: Record<string, unknown>): AuthAffiliateResult | null {
  if (affiliate.is_active === false) {
    return { ok: false, error: '비활성 파트너입니다.', status: 403, code: 'INACTIVE' };
  }
  const status = typeof affiliate.partner_status === 'string' ? affiliate.partner_status : 'active';
  if (status === 'suspended' || status === 'terminated') {
    return { ok: false, error: '접근이 제한된 파트너입니다.', status: 403, code: 'PARTNER_RESTRICTED' };
  }
  return null;
}

async function verifyPinAndBackfill(
  affiliate: Record<string, unknown>,
  pin: string,
): Promise<boolean> {
  const rawPin = pin.trim();
  if (!/^\d{4,12}$/.test(rawPin)) return false;

  const pinHash = typeof affiliate.pin_hash === 'string' ? affiliate.pin_hash : '';
  const nextHash = hashAffiliatePin(rawPin);
  if (pinHash && constantTimeEqual(pinHash, nextHash)) return true;

  const portalPin = typeof affiliate.portal_pin === 'string' ? affiliate.portal_pin : '';
  if (portalPin && constantTimeEqual(portalPin, rawPin)) {
    await supabaseAdmin
      .from('affiliates')
      .update({ pin_hash: nextHash, updated_at: new Date().toISOString() })
      .eq('id', affiliate.id as string);
    affiliate.pin_hash = nextHash;
    return true;
  }

  return false;
}

export async function authAffiliate(request: NextRequest, options: {
  referralCode?: string;
  pin?: string | null;
  issueToken?: boolean;
} = {}): Promise<AuthAffiliateResult> {
  if (!isSupabaseConfigured) {
    return { ok: false, error: 'DB 미설정', status: 503, code: 'DB_UNAVAILABLE' };
  }

  const expectedCode = options.referralCode ? normalizeAffiliateReferralCode(options.referralCode) : '';

  const token = request.cookies.get('inf_token')?.value;
  if (token) {
    const jwt = await verifyAffiliateToken(token);
    if (jwt.ok && (!expectedCode || jwt.code === expectedCode)) {
      const affiliate = await loadAffiliateById(jwt.affiliateId);
      if (affiliate) {
        const inactive = ensureActive(affiliate);
        if (inactive) return inactive;
        return { ok: true, affiliate };
      }
    }
  }

  if (!expectedCode) {
    return { ok: false, error: '추천코드가 필요합니다.', status: 400, code: 'MISSING_REFERRAL_CODE' };
  }

  const pin = typeof options.pin === 'string'
    ? options.pin
    : request.headers.get('x-influencer-pin') || request.headers.get('x-pin') || '';
  if (!pin.trim()) {
    return { ok: false, error: 'PIN이 필요합니다.', status: 401, code: 'PIN_REQUIRED' };
  }

  const identifier = attemptIdentifier(expectedCode);
  const failures = await countRecentFailures(identifier);
  if (failures >= PIN_MAX_ATTEMPTS) {
    return { ok: false, error: 'PIN 시도 횟수를 초과했습니다. 잠시 후 다시 시도하세요.', status: 423, code: 'PIN_LOCKED' };
  }

  const affiliate = await loadAffiliateByCode(expectedCode);
  if (!affiliate) {
    await recordFailure(identifier);
    return { ok: false, error: '존재하지 않는 코드입니다.', status: 404, code: 'NOT_FOUND' };
  }

  const inactive = ensureActive(affiliate);
  if (inactive) return inactive;

  const verified = await verifyPinAndBackfill(affiliate, pin);
  if (!verified) {
    await recordFailure(identifier);
    return { ok: false, error: 'PIN이 일치하지 않습니다.', status: 401, code: 'PIN_INVALID' };
  }

  await clearFailures(identifier);
  await supabaseAdmin
    .from('affiliates')
    .update({
      portal_last_login_at: new Date().toISOString(),
      portal_login_count: ((Number(affiliate.portal_login_count) || 0) + 1),
      partner_status: affiliate.partner_status === 'approved_not_onboarded' ? 'active' : affiliate.partner_status,
      onboarded_at: affiliate.partner_status === 'approved_not_onboarded' ? new Date().toISOString() : affiliate.onboarded_at ?? null,
    } as never)
    .eq('id', affiliate.id as string);

  const nextAffiliate: Record<string, unknown> = {
    ...affiliate,
    partner_status: affiliate.partner_status === 'approved_not_onboarded' ? 'active' : affiliate.partner_status,
  };

  const nextToken = options.issueToken
    ? await issueAffiliateToken({
        id: nextAffiliate.id as string,
        referral_code: nextAffiliate.referral_code as string,
        name: nextAffiliate.name as string,
      })
    : undefined;

  return { ok: true, affiliate: nextAffiliate, token: nextToken };
}
