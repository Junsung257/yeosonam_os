import { decryptAffiliateOutboxPayload } from '@/lib/affiliate/auth-crypto';
import { sendTransactionalSms } from '@/lib/kakao';
import { isSupabaseAdminConfigured, supabaseAdmin } from '@/lib/supabase';

interface AffiliateInvitationPayload extends Record<string, unknown> {
  kind: 'affiliate_invitation';
  phone: string;
  name: string;
  activationUrl: string;
  expiresAt: string;
}

export type OutboxDeliveryResult =
  | { ok: true; status: 'sent' | 'already_sent' }
  | { ok: false; status: 'not_found' | 'not_ready' | 'delivery_failed'; error: string };

function retryAt(attempts: number): string {
  const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
  return new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

async function markFailed(id: string, attempts: number, error: string): Promise<void> {
  await supabaseAdmin
    .from('notification_outbox')
    .update({
      status: 'failed',
      attempts,
      last_attempt_at: new Date().toISOString(),
      available_at: retryAt(attempts),
      last_error: error.slice(0, 500),
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', id);
}

export async function deliverAffiliateNotification(outboxId: string): Promise<OutboxDeliveryResult> {
  if (!isSupabaseAdminConfigured) {
    return { ok: false, status: 'delivery_failed', error: 'DB_UNAVAILABLE' };
  }

  const { data: row, error } = await supabaseAdmin
    .from('notification_outbox')
    .select('id, event_type, encrypted_payload, status, attempts, available_at')
    .eq('id', outboxId)
    .maybeSingle();

  if (error || !row) return { ok: false, status: 'not_found', error: 'OUTBOX_NOT_FOUND' };
  const outbox = row as Record<string, unknown>;
  if (outbox.status === 'sent') return { ok: true, status: 'already_sent' };
  if (!['pending', 'failed'].includes(String(outbox.status))) {
    return { ok: false, status: 'not_ready', error: 'OUTBOX_NOT_READY' };
  }
  if (new Date(String(outbox.available_at)).getTime() > Date.now()) {
    return { ok: false, status: 'not_ready', error: 'OUTBOX_RETRY_NOT_DUE' };
  }

  const nextAttempt = Number(outbox.attempts || 0) + 1;
  const { data: claimed } = await supabaseAdmin
    .from('notification_outbox')
    .update({
      status: 'processing',
      attempts: nextAttempt,
      last_attempt_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq('id', outboxId)
    .in('status', ['pending', 'failed'])
    .select('id')
    .maybeSingle();

  if (!claimed) return { ok: false, status: 'not_ready', error: 'OUTBOX_ALREADY_CLAIMED' };

  try {
    if (outbox.event_type !== 'affiliate_invitation_created') {
      throw new Error('UNSUPPORTED_OUTBOX_EVENT');
    }
    const payload = decryptAffiliateOutboxPayload<AffiliateInvitationPayload>(
      String(outbox.encrypted_payload),
    );
    if (
      payload.kind !== 'affiliate_invitation' ||
      typeof payload.phone !== 'string' ||
      typeof payload.name !== 'string' ||
      typeof payload.activationUrl !== 'string'
    ) {
      throw new Error('INVALID_OUTBOX_PAYLOAD');
    }

    const result = await sendTransactionalSms({
      to: payload.phone,
      text: `[여소남] ${payload.name}님 파트너 승인이 완료되었습니다. 30분 안에 계정을 활성화해 주세요. ${payload.activationUrl}`,
    });
    if (result.skipped) throw new Error(result.reason || 'DELIVERY_SKIPPED');

    await supabaseAdmin
      .from('notification_outbox')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', outboxId);
    return { ok: true, status: 'sent' };
  } catch (deliveryError) {
    const message = deliveryError instanceof Error ? deliveryError.message : 'DELIVERY_FAILED';
    await markFailed(outboxId, nextAttempt, message);
    return { ok: false, status: 'delivery_failed', error: message };
  }
}

export async function deliverDueAffiliateNotifications(limit = 20): Promise<{
  attempted: number;
  sent: number;
  failed: number;
}> {
  if (!isSupabaseAdminConfigured) return { attempted: 0, sent: 0, failed: 0 };
  const { data } = await supabaseAdmin
    .from('notification_outbox')
    .select('id')
    .in('status', ['pending', 'failed'])
    .lte('available_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));

  let sent = 0;
  let failed = 0;
  for (const item of (data || []) as Array<{ id: string }>) {
    const result = await deliverAffiliateNotification(item.id);
    if (result.ok) sent += 1;
    else if (result.status === 'delivery_failed') failed += 1;
  }
  return { attempted: (data || []).length, sent, failed };
}

