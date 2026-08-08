import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  assertAffiliateAuthConfigured,
  fingerprintAffiliateRequest,
  generateAffiliateOtp,
  hashAffiliateOtp,
  hashOpaqueValue,
} from '@/lib/affiliate/auth-crypto';
import { PARTNER_SESSION_COOKIE } from '@/lib/affiliate/auth-service';
import { issueAffiliateToken } from '@/lib/affiliate/jwt-auth';
import { sendTransactionalSms } from '@/lib/kakao';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

const OTP_TTL_MS = 5 * 60_000;
const OTP_RESEND_WINDOW_MS = 60_000;
const SESSION_TTL_MS = 12 * 60 * 60_000;

type ServiceFailure = { ok: false; status: number; code: string; error: string };

interface InvitationRow {
  id: string;
  affiliate_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  otp_sent_at: string | null;
}

function requestIp(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || null;
}

async function loadInvitation(rawToken: string): Promise<InvitationRow | null> {
  const { data, error } = await supabaseAdmin
    .from('affiliate_invitations')
    .select('id, affiliate_id, expires_at, used_at, revoked_at, otp_sent_at')
    .eq('token_hash', hashOpaqueValue(rawToken))
    .maybeSingle();
  return error ? null : data as InvitationRow | null;
}

export async function requestAffiliateOtp(rawToken: string): Promise<
  { ok: true; expiresInSeconds: number } | ServiceFailure
> {
  if (!isSupabaseAdminConfigured) {
    return { ok: false, status: 503, code: 'DB_UNAVAILABLE', error: '인증 저장소를 사용할 수 없습니다.' };
  }
  try {
    assertAffiliateAuthConfigured();
  } catch {
    return { ok: false, status: 503, code: 'AUTH_NOT_CONFIGURED', error: '파트너 인증 설정이 완료되지 않았습니다.' };
  }
  if (rawToken.length < 32 || rawToken.length > 128) {
    return { ok: false, status: 404, code: 'INVITATION_INVALID', error: '유효하지 않은 초대입니다.' };
  }

  const invitation = await loadInvitation(rawToken);
  if (
    !invitation || invitation.used_at || invitation.revoked_at ||
    new Date(invitation.expires_at).getTime() <= Date.now()
  ) {
    return { ok: false, status: 410, code: 'INVITATION_EXPIRED', error: '초대가 만료되었거나 이미 사용되었습니다.' };
  }
  if (
    invitation.otp_sent_at &&
    Date.now() - new Date(invitation.otp_sent_at).getTime() < OTP_RESEND_WINDOW_MS
  ) {
    return { ok: false, status: 429, code: 'OTP_RATE_LIMITED', error: '잠시 후 인증번호를 다시 요청해 주세요.' };
  }

  const { data: affiliate, error: affiliateError } = await supabaseAdmin
    .from('affiliates')
    .select('id, name, phone, is_active, partner_status')
    .eq('id', invitation.affiliate_id)
    .maybeSingle();
  const affiliateRow = affiliate as Record<string, unknown> | null;
  if (
    affiliateError || !affiliateRow || !affiliateRow.phone || affiliateRow.is_active === false ||
    ['suspended', 'terminated'].includes(String(affiliateRow.partner_status))
  ) {
    return { ok: false, status: 403, code: 'AFFILIATE_RESTRICTED', error: '활성화할 수 없는 파트너 계정입니다.' };
  }

  const otp = generateAffiliateOtp();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();
  const { error: updateError } = await supabaseAdmin
    .from('affiliate_invitations')
    .update({
      otp_hash: hashAffiliateOtp(invitation.id, otp),
      otp_expires_at: expiresAt,
      otp_sent_at: new Date().toISOString(),
      otp_attempts: 0,
    } as never)
    .eq('id', invitation.id)
    .is('used_at', null)
    .is('revoked_at', null);
  if (updateError) {
    return { ok: false, status: 503, code: 'OTP_STORE_FAILED', error: '인증번호를 발급할 수 없습니다.' };
  }

  try {
    const delivery = await sendTransactionalSms({
      to: String(affiliateRow.phone),
      text: `[여소남] 파트너 계정 인증번호는 [${otp}]입니다. 5분 안에 입력해 주세요.`,
    });
    if (delivery.skipped) throw new Error(delivery.reason || 'OTP_DELIVERY_SKIPPED');
  } catch {
    await supabaseAdmin
      .from('affiliate_invitations')
      .update({ otp_hash: null, otp_expires_at: null } as never)
      .eq('id', invitation.id);
    return { ok: false, status: 503, code: 'OTP_DELIVERY_FAILED', error: '인증번호를 발송하지 못했습니다. 잠시 후 다시 시도해 주세요.' };
  }

  return { ok: true, expiresInSeconds: OTP_TTL_MS / 1000 };
}

export async function activateAffiliateInvitation(
  request: NextRequest,
  rawToken: string,
  otp: string,
): Promise<
  | { ok: true; token: string; expiresAt: Date; affiliate: Record<string, unknown> }
  | ServiceFailure
> {
  if (!isSupabaseAdminConfigured) {
    return { ok: false, status: 503, code: 'DB_UNAVAILABLE', error: '인증 저장소를 사용할 수 없습니다.' };
  }
  try {
    assertAffiliateAuthConfigured();
  } catch {
    return { ok: false, status: 503, code: 'AUTH_NOT_CONFIGURED', error: '파트너 인증 설정이 완료되지 않았습니다.' };
  }
  if (rawToken.length < 32 || rawToken.length > 128 || !/^\d{6}$/.test(otp)) {
    return { ok: false, status: 400, code: 'INVALID_ACTIVATION_REQUEST', error: '초대 링크와 인증번호를 확인해 주세요.' };
  }

  const invitation = await loadInvitation(rawToken);
  if (!invitation) {
    return { ok: false, status: 410, code: 'INVITATION_INVALID', error: '초대가 만료되었거나 이미 사용되었습니다.' };
  }

  const sessionId = crypto.randomUUID();
  const jti = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const { data, error } = await supabaseAdmin.rpc('activate_affiliate_invitation_v2', {
    p_token_hash: hashOpaqueValue(rawToken),
    p_otp_hash: hashAffiliateOtp(invitation.id, otp),
    p_session_id: sessionId,
    p_jti: jti,
    p_session_expires_at: expiresAt.toISOString(),
    p_ip_hash: fingerprintAffiliateRequest(requestIp(request)),
    p_ua_hash: fingerprintAffiliateRequest(request.headers.get('user-agent')),
  });
  if (error) {
    return { ok: false, status: 503, code: 'ACTIVATION_UNAVAILABLE', error: '계정을 활성화할 수 없습니다.' };
  }

  const result = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
  const outcome = String(result?.outcome || 'invalid_invitation');
  if (outcome !== 'activated') {
    const statuses: Record<string, number> = {
      otp_invalid: 401,
      otp_required: 409,
      otp_expired: 410,
      otp_locked: 423,
      affiliate_restricted: 403,
      expired_invitation: 410,
      invalid_invitation: 410,
    };
    return {
      ok: false,
      status: statuses[outcome] || 400,
      code: outcome.toUpperCase(),
      error: outcome === 'otp_invalid'
        ? '인증번호가 일치하지 않습니다.'
        : '초대가 만료되었거나 활성화할 수 없습니다.',
    };
  }

  const tokenVersion = Number(result?.token_version);
  try {
    const token = await issueAffiliateToken({
      affiliateId: String(result?.affiliate_id),
      referralCode: String(result?.referral_code),
      name: String(result?.affiliate_name || ''),
      sessionId,
      jti,
      tokenVersion,
      expiresAt,
    });
    return {
      ok: true,
      token,
      expiresAt,
      affiliate: {
        id: result?.affiliate_id,
        name: result?.affiliate_name,
        referral_code: result?.referral_code,
      },
    };
  } catch {
    await supabaseAdmin
      .from('affiliate_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'token_issue_failed' } as never)
      .eq('id', sessionId);
    return { ok: false, status: 503, code: 'TOKEN_ISSUE_FAILED', error: '세션을 발급할 수 없습니다.' };
  }
}

export function setPartnerSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
): void {
  response.cookies.set(PARTNER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearPartnerSessionCookie(response: NextResponse): void {
  response.cookies.set(PARTNER_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

