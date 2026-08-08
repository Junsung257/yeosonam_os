import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { resolveAdminActorLabel, withAdminGuard } from '@/lib/admin-guard';
import {
  assertAffiliateAuthConfigured,
  encryptAffiliateOutboxPayload,
  generateInvitationToken,
  hashOpaqueValue,
} from '@/lib/affiliate/auth-crypto';
import { normalizeAffiliateReferralCode } from '@/lib/affiliate-ref-code';
import { getDefaultAffiliateCommissionRate } from '@/lib/affiliate-config';
import { deliverAffiliateNotification } from '@/lib/affiliate/notification-outbox';
import { recordAffiliateFunnelEvent } from '@/lib/affiliate/funnel-events';
import { logAndSanitize, sanitizeDbError } from '@/lib/error-sanitizer';
import { buildPublicUrl } from '@/lib/public-app-origin';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

const REFERRAL_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const INVITATION_TTL_MS = 30 * 60_000;

function secureReferralSuffix(length = 6): string {
  return Array.from({ length }, () => REFERRAL_ALPHABET[crypto.randomInt(REFERRAL_ALPHABET.length)]).join('');
}

async function generateUniqueReferralCode(name: string): Promise<string> {
  const prefix = name.replace(/[^a-zA-Z가-힣]/g, '').slice(0, 4).toUpperCase() || 'YSN';
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = normalizeAffiliateReferralCode(`${prefix}_${secureReferralSuffix()}`);
    const { count, error } = await supabaseAdmin
      .from('affiliates')
      .select('id', { count: 'exact', head: true })
      .eq('referral_code', candidate);
    if (error) throw error;
    if (!count) return candidate;
  }
  throw new Error('REFERRAL_CODE_EXHAUSTED');
}

const getHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: 'DB_UNAVAILABLE', applications: [] }, { status: 503 });
  }
  const status = request.nextUrl.searchParams.get('status') || undefined;
  let query = supabaseAdmin
    .from('affiliate_applications')
    .select('*')
    .order('applied_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
  return apiResponse({ applications: data || [] });
};

const postHandler = async (request: NextRequest) => {
  if (!isSupabaseAdminConfigured) return apiResponse({ error: 'DB_UNAVAILABLE' }, { status: 503 });

  try {
    const body = await request.json() as {
      applicationId?: unknown;
      action?: unknown;
      reject_reason?: unknown;
    };
    const applicationId = typeof body.applicationId === 'string' ? body.applicationId : '';
    const action = typeof body.action === 'string' ? body.action : '';
    if (!applicationId || !['approve', 'reject'].includes(action)) {
      return apiResponse({ error: 'INVALID_REVIEW_REQUEST' }, { status: 400 });
    }

    const { data: application, error: appError } = await supabaseAdmin
      .from('affiliate_applications')
      .select('id, name, phone, status')
      .eq('id', applicationId)
      .maybeSingle();
    const app = application as Record<string, unknown> | null;
    if (appError || !app) return apiResponse({ error: 'APPLICATION_NOT_FOUND' }, { status: 404 });
    if (app.status !== 'PENDING') return apiResponse({ error: 'APPLICATION_ALREADY_REVIEWED' }, { status: 409 });

    if (action === 'reject') {
      const rejectReason = typeof body.reject_reason === 'string' ? body.reject_reason.trim() : '';
      const { data: rejected, error } = await supabaseAdmin
        .from('affiliate_applications')
        .update({
          status: 'REJECTED',
          reject_reason: rejectReason || null,
          reviewed_at: new Date().toISOString(),
        } as never)
        .eq('id', applicationId)
        .eq('status', 'PENDING')
        .select('id')
        .maybeSingle();
      if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
      if (!rejected) return apiResponse({ error: 'APPLICATION_ALREADY_REVIEWED' }, { status: 409 });
      return apiResponse({ message: '거절 완료' });
    }

    assertAffiliateAuthConfigured();
    const actor = await resolveAdminActorLabel(request);
    const referralCode = await generateUniqueReferralCode(String(app.name));
    const rawToken = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const activationUrl = buildPublicUrl(`/partner/activate?token=${encodeURIComponent(rawToken)}`);
    const recipientHash = hashOpaqueValue(String(app.phone).replace(/\D/g, ''));
    const encryptedPayload = encryptAffiliateOutboxPayload({
      kind: 'affiliate_invitation',
      phone: String(app.phone),
      name: String(app.name),
      activationUrl,
      expiresAt: expiresAt.toISOString(),
    });

    const { data, error } = await supabaseAdmin.rpc('approve_affiliate_application_v2', {
      p_application_id: applicationId,
      p_referral_code: referralCode,
      p_token_hash: hashOpaqueValue(rawToken),
      p_recipient_hash: recipientHash,
      p_invitation_expires_at: expiresAt.toISOString(),
      p_encrypted_payload: encryptedPayload,
      p_created_by: actor,
      p_commission_rate: getDefaultAffiliateCommissionRate(),
    });
    if (error) {
      const message = String(error.message || '');
      if (message.includes('APPLICATION_ALREADY_REVIEWED')) {
        return apiResponse({ error: 'APPLICATION_ALREADY_REVIEWED' }, { status: 409 });
      }
      throw error;
    }

    const approved = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
    if (!approved?.affiliate_id || !approved.outbox_id) throw new Error('APPROVAL_RESULT_INVALID');

    const delivery = await deliverAffiliateNotification(String(approved.outbox_id));
    await recordAffiliateFunnelEvent({
      eventName: 'affiliate_application_approved',
      affiliateId: String(approved.affiliate_id),
      actorType: 'admin',
      traceId: String(approved.invitation_id),
      idempotencyKey: `application-approved:${applicationId}`,
      payload: {
        application_id: applicationId,
        invitation_id: approved.invitation_id,
      },
    });
    await recordAffiliateFunnelEvent({
      eventName: 'affiliate_invitation_sent',
      affiliateId: String(approved.affiliate_id),
      actorType: 'system',
      traceId: String(approved.invitation_id),
      idempotencyKey: `invitation-sent:${approved.invitation_id}`,
      payload: {
        delivery_status: delivery.ok ? delivery.status : 'queued_for_retry',
      },
    });
    return apiResponse({
      affiliate: {
        id: approved.affiliate_id,
        name: approved.affiliate_name,
        referral_code: approved.referral_code,
      },
      invitation: {
        id: approved.invitation_id,
        expires_at: expiresAt.toISOString(),
        delivery_status: delivery.ok ? delivery.status : 'queued_for_retry',
      },
      message: delivery.ok ? '승인 및 초대 발송 완료' : '승인 완료, 초대 발송 재시도 대기',
    });
  } catch (error) {
    const authMisconfigured = error instanceof Error && error.message.includes('AFFILIATE_AUTH_SECRET');
    return apiResponse({
      error: authMisconfigured
        ? 'AFFILIATE_AUTH_NOT_CONFIGURED'
        : logAndSanitize('admin-applications', error, '처리 실패'),
    }, { status: authMisconfigured ? 503 : 500 });
  }
};

export const GET = withAdminGuard(getHandler);
export const POST = withAdminGuard(postHandler);
