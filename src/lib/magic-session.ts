/**
 * magic-session — 자비스 게스트 진입 + 매직링크 후속 액션 페이지의 단명 인증 쿠키.
 *
 * 설계 결정 (S1, 자비스 통합):
 *   - 자비스 V2 (`/api/jarvis/stream`) 는 sb-access-token 쿠키만 인증으로 받음.
 *     매직링크로 들어온 게스트는 Supabase 유저가 아니므로, 별도 magic-session 쿠키를 발급.
 *   - HMAC-SHA256 서명 (Supabase auth 무수정).
 *   - 쿠키 자체에 컨텍스트(tenant_id, booking_id, customer_id, scope[], action_token_id, exp) 박힘.
 *   - 자비스 endpoint 는 sb-access-token 우선, 없으면 magic-session 시도.
 *
 * 스코프 (Stripe ACP / MCP 패턴 차용):
 *   - 'booking:read'       — 예약 조회
 *   - 'jarvis:chat:read'   — 자비스 read-only 채팅 (조회/안내/FAQ)
 *   - 'jarvis:chat:assist' — 자비스 mutation 액션 제안(HITL 거쳐 폼으로)
 *   - 'payment:confirm'    — 잔금결제 페이지 진입 (S2)
 *   - 'consent:sign'       — 일정변경 동의 (S3)
 *   - 'passport:upload'    — 여권 업로드 (S4)
 *   - 'review:submit'      — 리뷰 제출 (S3)
 *
 * 결정 액션은 자비스가 직접 발사 X — 폼/모달로만. 자비스는 안내/대화 전용.
 * (Air Canada 패턴 방지 — 자비스 발언이 실 트랜잭션을 일으키지 않음)
 */

import crypto from 'crypto';
import { getSecret } from '@/lib/secret-registry';
import { recordMagicLinkAudit } from '@/lib/magic-link-audit';
import type { MagicActionType } from '@/lib/magic-link';

export type MagicSessionScope =
  | 'booking:read'
  | 'jarvis:chat:read'
  | 'jarvis:chat:assist'
  | 'payment:confirm'
  | 'consent:sign'
  | 'passport:upload'
  | 'review:submit'
  | 'companion:input';

export interface MagicSessionPayload {
  /** 1회 magic_action_tokens.id — 감사·취소·확장 추적용 */
  aid: string;
  /** 토큰 액션 타입 (자비스 컨텍스트 분기에 사용) */
  act: MagicActionType;
  /** 테넌트 id (RLS 격리·자비스 surface 분기) */
  tid: string | null;
  /** 예약 id */
  bid: string | null;
  /** 고객 id (있다면) */
  cid: string | null;
  /** 부여된 스코프 (자비스 surface 의 권한 화이트리스트) */
  scope: MagicSessionScope[];
  /** issued at (unix sec) */
  iat: number;
  /** expires at (unix sec) */
  exp: number;
  /** version (스키마 마이그레이션 대비) */
  v: 1;
}

const COOKIE_NAME = 'magic-session';
const DEFAULT_TTL_SEC = 60 * 60; // 1h

function getSigningSecret(): string {
  const s =
    getSecret('MAGIC_SESSION_SECRET') ||
    getSecret('MAGIC_LINK_SECRET') ||
    getSecret('GUIDEBOOK_TOKEN_SECRET') ||
    getSecret('SUPABASE_JWT_SECRET');
  if (!s) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('MAGIC_SESSION_SECRET 미설정 — production 발급 거부');
    }
    return 'dev-magic-session-secret';
  }
  return s;
}

function b64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}
function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(body: string): string {
  return crypto.createHmac('sha256', getSigningSecret()).update(body).digest('base64url');
}

/**
 * magic-session 토큰 발급. 쿠키 set 은 호출자(서버 컴포넌트 / Route Handler) 책임.
 */
export function issueMagicSessionToken(input: {
  aid: string;
  act: MagicActionType;
  tid?: string | null;
  bid?: string | null;
  cid?: string | null;
  scope: MagicSessionScope[];
  ttlSec?: number;
}): { token: string; payload: MagicSessionPayload; cookieName: string; maxAgeSec: number } {
  const now = Math.floor(Date.now() / 1000);
  const ttl = input.ttlSec ?? DEFAULT_TTL_SEC;

  const payload: MagicSessionPayload = {
    aid: input.aid,
    act: input.act,
    tid: input.tid ?? null,
    bid: input.bid ?? null,
    cid: input.cid ?? null,
    scope: input.scope,
    iat: now,
    exp: now + ttl,
    v: 1,
  };

  const body = b64urlEncode(JSON.stringify(payload));
  const sig = sign(body);
  const token = `${body}.${sig}`;

  // fire-and-forget audit
  void recordMagicLinkAudit({
    tokenId: input.aid,
    actionType: input.act,
    event: 'session_issue',
    metadata: {
      scope: input.scope,
      ttl_sec: ttl,
    },
  });

  return { token, payload, cookieName: COOKIE_NAME, maxAgeSec: ttl };
}

export function verifyMagicSessionToken(
  token: string | undefined | null,
  opts: { ip?: string; ua?: string } = {},
): { ok: true; payload: MagicSessionPayload } | { ok: false; reason: string } {
  if (!token) return { ok: false, reason: 'missing' };

  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  const [body, sig] = parts;
  if (!body || !sig) return { ok: false, reason: 'malformed' };

  const expected = sign(body);
  if (sig.length !== expected.length) {
    void recordMagicLinkAudit({
      event: 'session_verify_fail',
      success: false,
      metadata: { reason: 'sig_length' },
      ip: opts.ip,
      ua: opts.ua,
    });
    return { ok: false, reason: 'sig_mismatch' };
  }

  let ok: boolean;
  try {
    ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch {
    return { ok: false, reason: 'sig_mismatch' };
  }
  if (!ok) {
    void recordMagicLinkAudit({
      event: 'session_verify_fail',
      success: false,
      metadata: { reason: 'sig_mismatch' },
      ip: opts.ip,
      ua: opts.ua,
    });
    return { ok: false, reason: 'sig_mismatch' };
  }

  let payload: MagicSessionPayload;
  try {
    payload = JSON.parse(b64urlDecode(body)) as MagicSessionPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.v !== 1) return { ok: false, reason: 'version' };
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' };
  }
  if (!Array.isArray(payload.scope)) return { ok: false, reason: 'malformed' };

  return { ok: true, payload };
}

/** 자비스 endpoint·게스트 페이지에서 공통으로 사용하는 쿠키 옵션 */
export function magicSessionCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeSec,
  };
}

export const MAGIC_SESSION_COOKIE = COOKIE_NAME;

/** 스코프 권한 체크 (자비스 endpoint 에서 사용) */
export function hasScope(payload: MagicSessionPayload, required: MagicSessionScope): boolean {
  return payload.scope.includes(required);
}

/**
 * 매직링크 action_type → 디폴트 스코프 매핑.
 * /m/[token] POST-confirm 페이지가 액션 페이지로 이동할 때 magic-session 발급 시 사용.
 */
export function defaultScopesForAction(actionType: MagicActionType): MagicSessionScope[] {
  switch (actionType) {
    case 'booking_portal':
      return ['booking:read', 'jarvis:chat:read'];
    case 'guidebook':
      return ['booking:read', 'jarvis:chat:read'];
    case 'payment_balance':
      return ['booking:read', 'payment:confirm', 'jarvis:chat:assist'];
    case 'itinerary_consent':
      return ['booking:read', 'consent:sign', 'jarvis:chat:assist'];
    case 'passport_upload':
      return ['booking:read', 'passport:upload', 'jarvis:chat:assist'];
    case 'review_request':
      return ['booking:read', 'review:submit', 'jarvis:chat:read'];
    case 'companion_input':
      return ['booking:read', 'companion:input', 'jarvis:chat:read'];
    case 'jarvis_session':
      return ['booking:read', 'jarvis:chat:assist'];
  }
}
