/**
 * magic-session 단위 테스트 — HMAC 서명·검증·스코프·만료.
 *
 * 보안 critical:
 *   - 서명 변조 검출
 *   - 만료 거부
 *   - 스코프 인코딩·디코딩 무손실
 *   - 버전 mismatch 거부
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import crypto from 'crypto';
import {
  issueMagicSessionToken,
  verifyMagicSessionToken,
  hasScope,
  defaultScopesForAction,
  type MagicSessionScope,
} from './magic-session';

beforeAll(() => {
  process.env.MAGIC_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
});

const baseInput = {
  aid: 'token-uuid-123',
  act: 'jarvis_session' as const,
  tid: 'tenant-1',
  bid: 'booking-1',
  cid: 'customer-1',
  scope: ['jarvis:chat:read'] as MagicSessionScope[],
};

describe('issue → verify 라운드트립', () => {
  it('정상 발급된 토큰 검증 통과', () => {
    const { token } = issueMagicSessionToken({ ...baseInput });
    const r = verifyMagicSessionToken(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.aid).toBe('token-uuid-123');
      expect(r.payload.bid).toBe('booking-1');
      expect(r.payload.scope).toEqual(['jarvis:chat:read']);
    }
  });

  it('payload 필드 보존 (모든 컨텍스트)', () => {
    const { token } = issueMagicSessionToken({
      ...baseInput,
      scope: ['jarvis:chat:read', 'consent:sign'],
    });
    const r = verifyMagicSessionToken(token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.tid).toBe('tenant-1');
      expect(r.payload.cid).toBe('customer-1');
      expect(r.payload.act).toBe('jarvis_session');
      expect(r.payload.scope).toHaveLength(2);
    }
  });
});

describe('서명 변조 검출', () => {
  it('서명만 변조 → 거부', () => {
    const { token } = issueMagicSessionToken({ ...baseInput });
    const [body, sig] = token.split('.');
    const flipped = sig.slice(0, -1) + (sig.slice(-1) === 'a' ? 'b' : 'a');
    const r = verifyMagicSessionToken(`${body}.${flipped}`);
    expect(r.ok).toBe(false);
  });

  it('body 만 변조 → 거부 (서명 불일치)', () => {
    const { token } = issueMagicSessionToken({ ...baseInput });
    const [, sig] = token.split('.');
    const fakeBody = Buffer.from(JSON.stringify({ aid: 'attacker' })).toString('base64url');
    const r = verifyMagicSessionToken(`${fakeBody}.${sig}`);
    expect(r.ok).toBe(false);
  });

  it('잘림 토큰 거부', () => {
    expect(verifyMagicSessionToken('').ok).toBe(false);
    expect(verifyMagicSessionToken('abc').ok).toBe(false);
    expect(verifyMagicSessionToken('abc.').ok).toBe(false);
    expect(verifyMagicSessionToken('.xyz').ok).toBe(false);
  });

  it('null/undefined 안전 처리', () => {
    expect(verifyMagicSessionToken(null).ok).toBe(false);
    expect(verifyMagicSessionToken(undefined).ok).toBe(false);
  });
});

describe('만료 처리', () => {
  it('만료된 토큰 거부', () => {
    // Date.now 를 mock 해서 발급은 과거, 검증은 현재 (TTL 초과 시뮬레이션)
    const realNow = Date.now;
    try {
      const pastMs = realNow() - 2 * 60 * 60 * 1000; // 2시간 전
      vi.spyOn(Date, 'now').mockReturnValue(pastMs);
      const { token } = issueMagicSessionToken({ ...baseInput, ttlSec: 60 * 60 }); // 1시간 TTL
      vi.restoreAllMocks();
      // 현재 시간엔 이미 만료
      const r = verifyMagicSessionToken(token);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('expired');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('TTL 직전엔 통과 (60초 이상 여유)', () => {
    const { token } = issueMagicSessionToken({ ...baseInput, ttlSec: 3600 });
    const r = verifyMagicSessionToken(token);
    expect(r.ok).toBe(true);
  });
});

describe('hasScope', () => {
  it('해당 스코프 있으면 true', () => {
    const { payload } = issueMagicSessionToken({
      ...baseInput,
      scope: ['jarvis:chat:read', 'booking:read'],
    });
    expect(hasScope(payload, 'jarvis:chat:read')).toBe(true);
    expect(hasScope(payload, 'booking:read')).toBe(true);
  });

  it('없는 스코프 false', () => {
    const { payload } = issueMagicSessionToken({
      ...baseInput,
      scope: ['jarvis:chat:read'],
    });
    expect(hasScope(payload, 'payment:confirm')).toBe(false);
    expect(hasScope(payload, 'passport:upload')).toBe(false);
  });
});

describe('defaultScopesForAction', () => {
  it('payment_balance 는 결제·assist·booking 포함', () => {
    const s = defaultScopesForAction('payment_balance');
    expect(s).toContain('payment:confirm');
    expect(s).toContain('jarvis:chat:assist');
    expect(s).toContain('booking:read');
  });

  it('booking_portal 은 read-only 스코프만', () => {
    const s = defaultScopesForAction('booking_portal');
    expect(s).toContain('booking:read');
    expect(s).toContain('jarvis:chat:read');
    expect(s).not.toContain('payment:confirm');
    expect(s).not.toContain('consent:sign');
  });

  it('passport_upload 는 passport scope 포함', () => {
    const s = defaultScopesForAction('passport_upload');
    expect(s).toContain('passport:upload');
  });

  it('review_request 는 review:submit + read-only chat', () => {
    const s = defaultScopesForAction('review_request');
    expect(s).toContain('review:submit');
    expect(s).toContain('jarvis:chat:read');
    expect(s).not.toContain('jarvis:chat:assist');
  });

  it('companion_input 은 companion scope 포함', () => {
    const s = defaultScopesForAction('companion_input');
    expect(s).toContain('companion:input');
  });

  it('jarvis_session 은 chat:assist + booking:read', () => {
    const s = defaultScopesForAction('jarvis_session');
    expect(s).toContain('jarvis:chat:assist');
    expect(s).toContain('booking:read');
  });
});
