/**
 * Instagram Graph Webhook
 *
 * GET : 구독 초기 verify (Meta 가 1회 호출)
 * POST: 실시간 이벤트 수신 (comments, mentions, live_comments 등)
 *
 * 설정 순서 (Meta 개발자 콘솔):
 *   1. App Dashboard → Instagram > Webhooks 구성
 *   2. Callback URL: https://yeosonam.com/api/webhooks/instagram
 *   3. Verify Token: env META_WEBHOOK_VERIFY_TOKEN (임의 문자열, 여기와 동일해야 verify 통과)
 *   4. 구독 field: comments, mentions, live_comments, message_reactions, messages
 *
 * 서명 검증 env: META_APP_SECRET (App Dashboard > Settings > Basic > App Secret)
 *
 * 중요: 웹훅은 **1초 이내 200** 응답 필수. DB INSERT 만 하고 비동기 처리는 크론에 위임.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { getSecret } from '@/lib/secret-registry';
import {
  verifyWebhookChallenge,
  verifyWebhookSignature,
  type WebhookPayload,
} from '@/lib/meta-webhook';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  const result = verifyWebhookChallenge(mode, token, challenge, getSecret('META_WEBHOOK_VERIFY_TOKEN') ?? undefined);
  if (!result.ok) {
    console.warn('[webhook:ig] verify 실패:', result.error);
    return new NextResponse(result.error ?? 'verify failed', { status: 403 });
  }
  return new NextResponse(result.response ?? '', { status: 200 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const sig = request.headers.get('x-hub-signature-256');

  const sigCheck = verifyWebhookSignature(rawBody, sig, getSecret('META_APP_SECRET') ?? undefined);
  if (!sigCheck.ok) {
    console.warn('[webhook:ig] 서명 실패:', sigCheck.error);
    return new NextResponse(sigCheck.error ?? 'invalid signature', { status: 403 });
  }

  // 1초 룰 준수 — DB insert 1회만
  try {
    const payload = JSON.parse(rawBody) as WebhookPayload;
    if (!isSupabaseConfigured) return NextResponse.json({ ok: true }); // 그래도 200 반환

    const rows: Array<Record<string, unknown>> = [];
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        // comments / mentions 이벤트는 change.value 안에 media_id
        const value = (change.value ?? {}) as Record<string, unknown>;
        const mediaField = value.media as Record<string, unknown> | undefined;
        const mediaId =
          (value.media_id as string | undefined) ??
          (mediaField?.id as string | undefined) ??
          null;
        rows.push({
          platform: 'instagram',
          event_type: change.field,
          external_id: mediaId,
          raw_payload: value,
        });
      }
      // DM / messaging 같은 messaging 배열 지원
      for (const m of entry.messaging ?? []) {
        rows.push({
          platform: 'instagram',
          event_type: 'messaging',
          external_id: null,
          raw_payload: m,
        });
      }
    }
    if (rows.length > 0) {
      await supabaseAdmin.from('social_webhook_events').insert(rows as never);
    }
  } catch (err) {
    console.error('[webhook:ig] 처리 에러 (응답은 200 유지):', err instanceof Error ? err.message : err);
  }

  return NextResponse.json({ ok: true });
}
