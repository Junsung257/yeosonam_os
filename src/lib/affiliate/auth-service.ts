import { NextRequest } from 'next/server';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';
import { verifyAffiliateToken } from '@/lib/affiliate/jwt-auth';

export const PARTNER_SESSION_COOKIE = 'partner_session';

const AFFILIATE_PROFILE_SELECT = [
  'id', 'name', 'referral_code', 'grade', 'grade_label', 'grade_rate',
  'bonus_rate', 'booking_count', 'total_commission', 'payout_type', 'logo_url',
  'created_at', 'is_active', 'partner_status', 'token_version',
  'portal_login_count', 'onboarded_at', 'branding_level', 'content_quota', 'content_used',
].join(', ');

type AuthAffiliateFailure = { ok: false; error: string; status: number; code: string };
export type AuthAffiliateResult =
  | { ok: true; affiliate: Record<string, unknown>; sessionId: string }
  | AuthAffiliateFailure;

function restrictedAffiliate(affiliate: Record<string, unknown>): AuthAffiliateFailure | null {
  if (affiliate.is_active === false) {
    return { ok: false, error: '비활성화된 파트너 계정입니다.', status: 403, code: 'INACTIVE' };
  }
  const status = typeof affiliate.partner_status === 'string' ? affiliate.partner_status : 'active';
  if (status === 'suspended' || status === 'terminated') {
    return { ok: false, error: '접근이 제한된 파트너 계정입니다.', status: 403, code: 'PARTNER_RESTRICTED' };
  }
  return null;
}

async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await supabaseAdmin
    .from('affiliate_sessions')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_reason: reason,
    } as never)
    .eq('id', sessionId)
    .is('revoked_at', null);
}

export async function revokeAffiliateSession(request: NextRequest, reason = 'logout'): Promise<void> {
  if (!isSupabaseAdminConfigured) return;
  const raw = request.cookies.get(PARTNER_SESSION_COOKIE)?.value;
  if (!raw) return;
  const verified = await verifyAffiliateToken(raw);
  if (!verified.ok) return;
  await revokeSession(verified.sessionId, reason);
}

export async function authAffiliate(
  request: NextRequest,
  options: { referralCode?: string } = {},
): Promise<AuthAffiliateResult> {
  if (!isSupabaseAdminConfigured) {
    return { ok: false, error: '인증 저장소를 사용할 수 없습니다.', status: 503, code: 'DB_UNAVAILABLE' };
  }

  const rawToken = request.cookies.get(PARTNER_SESSION_COOKIE)?.value;
  if (!rawToken) {
    return { ok: false, error: '로그인이 필요합니다.', status: 401, code: 'SESSION_REQUIRED' };
  }

  const verified = await verifyAffiliateToken(rawToken);
  if (!verified.ok) {
    const status = verified.error === 'AUTH_NOT_CONFIGURED' ? 503 : 401;
    return { ok: false, error: '유효한 파트너 세션이 아닙니다.', status, code: verified.error };
  }

  const expectedCode = normalizeAffiliateReferralCode(options.referralCode || '');
  if (expectedCode && expectedCode !== verified.code) {
    return {
      ok: false,
      error: '다른 파트너의 데이터에는 접근할 수 없습니다.',
      status: 403,
      code: 'CROSS_TENANT',
    };
  }

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('affiliate_sessions')
    .select('id, affiliate_id, jti, token_version, expires_at, revoked_at')
    .eq('id', verified.sessionId)
    .eq('affiliate_id', verified.affiliateId)
    .maybeSingle();

  const sessionRow = session as Record<string, unknown> | null;
  const expired = !sessionRow?.expires_at || new Date(String(sessionRow.expires_at)).getTime() <= Date.now();
  const sessionMismatch =
    !sessionRow ||
    sessionError ||
    sessionRow.revoked_at != null ||
    String(sessionRow.jti) !== verified.jti ||
    Number(sessionRow.token_version) !== verified.tokenVersion ||
    expired;

  if (sessionMismatch) {
    if (sessionRow?.id && sessionRow.revoked_at == null) {
      await revokeSession(String(sessionRow.id), expired ? 'expired' : 'session_claim_mismatch');
    }
    return { ok: false, error: '세션이 만료되었거나 폐기되었습니다.', status: 401, code: 'SESSION_REVOKED' };
  }

  const { data: affiliate, error: affiliateError } = await supabaseAdmin
    .from('affiliates')
    .select(AFFILIATE_PROFILE_SELECT)
    .eq('id', verified.affiliateId)
    .maybeSingle();

  if (affiliateError) {
    return { ok: false, error: '파트너 인증 정보를 확인할 수 없습니다.', status: 503, code: 'AUTH_DATA_UNAVAILABLE' };
  }
  if (!affiliate) {
    await revokeSession(verified.sessionId, 'affiliate_missing');
    return { ok: false, error: '파트너 계정을 찾을 수 없습니다.', status: 401, code: 'AFFILIATE_NOT_FOUND' };
  }

  const affiliateRow = affiliate as unknown as Record<string, unknown>;
  const restricted = restrictedAffiliate(affiliateRow);
  if (restricted) {
    await revokeSession(verified.sessionId, restricted.code.toLowerCase());
    return restricted;
  }
  if (Number(affiliateRow.token_version) !== verified.tokenVersion) {
    await revokeSession(verified.sessionId, 'token_version_mismatch');
    return { ok: false, error: '자격증명이 변경되어 다시 로그인해야 합니다.', status: 401, code: 'TOKEN_VERSION_MISMATCH' };
  }

  await supabaseAdmin
    .from('affiliate_sessions')
    .update({ last_used_at: new Date().toISOString() } as never)
    .eq('id', verified.sessionId);

  return { ok: true, affiliate: affiliateRow, sessionId: verified.sessionId };
}
