/**
 * Web Push 발송 어댑터.
 *
 * 환경변수가 설정되어 있지 않거나 web-push 실행이 실패해도 throw 하지 않는다.
 * push 실패는 기존 API 흐름을 깨뜨리면 안 되기 때문.
 */

import webpush from 'web-push';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';

export interface PushPayload {
  title: string;
  body?: string;
  deepLink?: string;
  kind?: string;
  tag?: string;
  extra?: Record<string, unknown>;
}

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@yeosonam.com';

let vapidReady = false;
function ensureVapid(): boolean {
  if (vapidReady) return true;
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return false;
  try {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    vapidReady = true;
    return true;
  } catch (err) {
    console.warn('[push-dispatcher] VAPID 설정 실패:', err);
    return false;
  }
}

interface SubscriptionRow {
  id: string;
  user_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * 활성 구독 전원에게 fan-out. 실패한 구독은 revoked 처리.
 * push_notifications 에도 이력을 남긴다.
 */
export async function dispatchPush(payload: PushPayload): Promise<{
  sent: number;
  failed: number;
  skipped: string | null;
}> {
  if (!isSupabaseConfigured) return { sent: 0, failed: 0, skipped: 'supabase-disabled' };
  if (!ensureVapid()) return { sent: 0, failed: 0, skipped: 'vapid-missing' };

  const { data: subs, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .is('revoked_at', null);

  if (error || !subs || subs.length === 0) {
    return { sent: 0, failed: 0, skipped: error ? error.message : 'no-subs' };
  }

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body ?? '',
    deepLink: payload.deepLink ?? '/m/admin',
    tag: payload.tag,
  });

  let sent = 0;
  let failed = 0;
  const failedIds: string[] = [];

  await Promise.all(
    (subs as SubscriptionRow[]).map(async sub => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 60 * 60 * 24 },
        );
        sent += 1;
        // 수신함 이력 기록 (user_id 있는 것만)
        if (sub.user_id) {
          supabaseAdmin
            .from('push_notifications')
            .insert({
              user_id: sub.user_id,
              title: payload.title,
              body: payload.body ?? null,
              deep_link: payload.deepLink ?? null,
              kind: payload.kind ?? null,
              payload: payload.extra ?? null,
            })
            .then(() => {})
            .catch(() => {});
        }
      } catch (err: any) {
        failed += 1;
        // 404/410 = 구독 만료. revoked 처리.
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          failedIds.push(sub.id);
        } else {
          console.warn('[push-dispatcher] sendNotification 실패:', sub.id, err?.statusCode);
        }
      }
    }),
  );

  if (failedIds.length > 0) {
    await supabaseAdmin
      .from('push_subscriptions')
      .update({ revoked_at: new Date().toISOString() })
      .in('id', failedIds);
  }

  return { sent, failed, skipped: null };
}

/** fire-and-forget 헬퍼 — 호출부에서 await 할 필요 없음 */
export function dispatchPushAsync(payload: PushPayload): void {
  dispatchPush(payload).catch(err =>
    console.warn('[push-dispatcher] 비동기 실패:', err),
  );
}
