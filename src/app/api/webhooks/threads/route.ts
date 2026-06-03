/**
 * Threads Webhook
 *
 * 2025-08-15 추가된 publish / replies / mentions 웹훅 지원.
 *
 * GET:  구독 verify (IG와 동일 프로토콜)
 * POST: 실시간 이벤트 (publish, replies, mentions, delete, ...)
 *
 * 설정 (Meta 개발자 콘솔 > Threads > Webhooks):
 *   - Callback URL: https://yeosonam.com/api/webhooks/threads
 *   - Verify Token: env META_WEBHOOK_VERIFY_TOKEN (IG와 공유 가능)
 *   - 구독 fields: publish, replies, mentions, delete
 *
 * publish 웹훅은 우리가 Threads 에 발행 요청한 게 실제로 live 됐을 때 발사됨 →
 * card_news.threads_post_id 확정에 사용 가능 (polling 보완).
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import {
  verifyWebhookChallenge,
  verifyWebhookSignature,
  type WebhookPayload,
} from '@/lib/meta-webhook';
import { sanitizeWebhookPayload } from '@/lib/webhook-payload-sanitizer';
import { apiResponse } from '@/lib/api-response';
import { sanitizeDbError } from '@/lib/error-sanitizer';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const result = verifyWebhookChallenge(mode, token, challenge, getSecret('META_WEBHOOK_VERIFY_TOKEN') ?? undefined);
  if (!result.ok) {
    const message = sanitizeDbError(result.error, 'verify failed');
    console.warn('[webhook:threads] verify failed:', message);
    return new NextResponse(message, { status: 403 });
  }
  return new NextResponse(result.response ?? '', { status: 200 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const sig = request.headers.get('x-hub-signature-256');

  const sigCheck = verifyWebhookSignature(rawBody, sig, getSecret('META_APP_SECRET') ?? undefined);
  if (!sigCheck.ok) {
    const message = sanitizeDbError(sigCheck.error, 'invalid signature');
    console.warn('[webhook:threads] signature failed:', message);
    return new NextResponse(message, { status: 403 });
  }

  try {
    const payload = JSON.parse(rawBody) as WebhookPayload;
    if (!isSupabaseConfigured) return apiResponse({ ok: true });

    const rows: Array<Record<string, unknown>> = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value as Record<string, unknown>;
        // publish 이벤트는 value.media_id 에 Threads post ID
        const mediaId =
          (value?.media_id as string | undefined) ??
          (value?.thread_id as string | undefined) ??
          null;
        rows.push({
          platform: 'threads',
          event_type: change.field,
          external_id: mediaId,
          raw_payload: sanitizeWebhookPayload(value),
        });
      }
    }
    if (rows.length > 0) {
      const { error } = await supabaseAdmin.from('social_webhook_events').insert(rows as never);
      if (error) {
        console.error('[webhook:threads] insert error (responding 200):', sanitizeDbError(error));
      }
    }
  } catch (err) {
    console.error('[webhook:threads] processing error:', sanitizeDbError(err));
  }

  return apiResponse({ ok: true });
}
