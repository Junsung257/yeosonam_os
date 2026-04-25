/**
 * Meta webhook 공통 유틸 — IG / Threads / Messenger 모두 동일 프로토콜
 *
 * 1. GET  /api/webhooks/X?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...
 *    → verify_token 일치 시 hub.challenge 를 plain text 로 echo
 *
 * 2. POST /api/webhooks/X
 *    Header: X-Hub-Signature-256: sha256=XXXX
 *    Body:   { object, entry: [...] }
 *    → HMAC-SHA256(body, APP_SECRET) 이 서명과 일치해야 함
 *    → 1초 이내 200 응답. 실패 시 Meta 가 재시도 (exponential backoff)
 */
import crypto from 'crypto';

/**
 * GET verify 응답. env 에서 verify_token 과 비교.
 * 첫 구독 시 Meta 가 한 번만 호출.
 */
export function verifyWebhookChallenge(
  mode: string | null,
  verifyToken: string | null,
  challenge: string | null,
  expectedToken: string | undefined,
): { ok: boolean; response?: string; error?: string } {
  if (!expectedToken) return { ok: false, error: 'verify_token env 미설정' };
  if (mode !== 'subscribe') return { ok: false, error: 'mode 가 subscribe 아님' };
  if (verifyToken !== expectedToken) return { ok: false, error: 'verify_token 불일치' };
  return { ok: true, response: challenge ?? '' };
}

/**
 * POST 페이로드 서명 검증. X-Hub-Signature-256 헤더 사용.
 * constant-time 비교 (timing attack 방어).
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string | undefined,
): { ok: boolean; error?: string } {
  if (!appSecret) return { ok: false, error: 'APP_SECRET env 미설정' };
  if (!signatureHeader) return { ok: false, error: 'X-Hub-Signature-256 헤더 없음' };
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  // length 다르면 timingSafeEqual 가 throw → 사전 체크
  if (expected.length !== signatureHeader.length) {
    return { ok: false, error: '서명 길이 불일치' };
  }
  const match = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  return match ? { ok: true } : { ok: false, error: '서명 검증 실패' };
}

export interface WebhookEntry {
  id: string;                   // IG user ID or page ID
  time: number;                 // unix ts
  changes?: Array<{ field: string; value: Record<string, unknown> }>;
  messaging?: Array<Record<string, unknown>>;
}

export interface WebhookPayload {
  object: string;               // 'instagram' | 'threads' | 'page' …
  entry: WebhookEntry[];
}
