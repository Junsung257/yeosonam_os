import { NextRequest } from 'next/server';
import { apiResponse } from '@/lib/api-response';
import { resolveAdminActorLabel, withAdminGuard } from '@/lib/admin-guard';
import {
  assertAffiliateAuthConfigured,
  encryptAffiliateOutboxPayload,
  generateInvitationToken,
  hashOpaqueValue,
} from '@/lib/affiliate/auth-crypto';
import { deliverAffiliateNotification } from '@/lib/affiliate/notification-outbox';
import { sanitizeDbError } from '@/lib/error-sanitizer';
import { buildPublicUrl } from '@/lib/public-app-origin';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
const INVITATION_TTL_MS = 30 * 60_000;

async function postHandler(request: NextRequest) {
  if (!isSupabaseAdminConfigured) {
    return apiResponse({ error: 'DB_UNAVAILABLE' }, { status: 503 });
  }

  let body: { affiliate_id?: unknown; pin?: unknown };
  try {
    body = await request.json();
  } catch {
    return apiResponse({ error: 'INVALID_JSON' }, { status: 400 });
  }
  if (body.pin !== undefined) {
    return apiResponse({ error: 'STATIC_PIN_RETIRED' }, { status: 410 });
  }
  const affiliateId = typeof body.affiliate_id === 'string' ? body.affiliate_id.trim() : '';
  if (!affiliateId) return apiResponse({ error: 'AFFILIATE_ID_REQUIRED' }, { status: 400 });

  try {
    assertAffiliateAuthConfigured();
    const { data: affiliate, error: affiliateError } = await supabaseAdmin
      .from('affiliates')
      .select('id, name, phone')
      .eq('id', affiliateId)
      .maybeSingle();
    const row = affiliate as Record<string, unknown> | null;
    if (affiliateError || !row) return apiResponse({ error: 'AFFILIATE_NOT_FOUND' }, { status: 404 });
    if (!row.phone) return apiResponse({ error: 'AFFILIATE_PHONE_REQUIRED' }, { status: 409 });

    const actor = await resolveAdminActorLabel(request);
    const rawToken = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
    const activationUrl = buildPublicUrl(`/partner/activate?token=${encodeURIComponent(rawToken)}`);
    const recipientHash = hashOpaqueValue(String(row.phone).replace(/\D/g, ''));
    const encryptedPayload = encryptAffiliateOutboxPayload({
      kind: 'affiliate_invitation',
      phone: String(row.phone),
      name: String(row.name),
      activationUrl,
      expiresAt: expiresAt.toISOString(),
    });
    const { data, error } = await supabaseAdmin.rpc('rotate_affiliate_credentials_v2', {
      p_affiliate_id: affiliateId,
      p_token_hash: hashOpaqueValue(rawToken),
      p_recipient_hash: recipientHash,
      p_invitation_expires_at: expiresAt.toISOString(),
      p_encrypted_payload: encryptedPayload,
      p_created_by: actor,
    });
    if (error) return apiResponse({ error: sanitizeDbError(error) }, { status: 500 });
    const rotated = Array.isArray(data) ? data[0] as Record<string, unknown> | undefined : undefined;
    if (!rotated?.outbox_id) return apiResponse({ error: 'ROTATION_RESULT_INVALID' }, { status: 500 });

    const delivery = await deliverAffiliateNotification(String(rotated.outbox_id));
    return apiResponse({
      success: true,
      invitation_id: rotated.invitation_id,
      expires_at: expiresAt.toISOString(),
      delivery_status: delivery.ok ? delivery.status : 'queued_for_retry',
    });
  } catch (error) {
    const misconfigured = error instanceof Error && error.message.includes('AFFILIATE_AUTH_SECRET');
    return apiResponse({ error: misconfigured ? 'AFFILIATE_AUTH_NOT_CONFIGURED' : 'ROTATION_FAILED' }, {
      status: misconfigured ? 503 : 500,
    });
  }
}

export const POST = withAdminGuard(postHandler);
