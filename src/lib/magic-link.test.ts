/**
 * magic-link 단위 테스트 (pure functions).
 *
 * 커버:
 *   - hashMagicToken: SHA-256 deterministic
 *   - hashRecipient: lowercase + trim 정규화
 *   - buildMagicLinkUrl: env 기반 URL 빌드 + relative fallback
 *
 * mint/verify/consume 같이 supabaseAdmin 을 호출하는 함수는 통합 테스트(별도) 또는
 * mock 인프라가 필요 — 본 파일은 보안 critical pure logic 만.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { hashMagicToken, hashRecipient, buildMagicLinkUrl } from './magic-link';

describe('hashMagicToken', () => {
  it('동일 입력 → 동일 해시 (deterministic)', () => {
    const a = hashMagicToken('abc123');
    const b = hashMagicToken('abc123');
    expect(a).toBe(b);
  });

  it('다른 입력 → 다른 해시', () => {
    expect(hashMagicToken('abc123')).not.toBe(hashMagicToken('abc124'));
  });

  it('SHA-256 64자 hex 출력', () => {
    const h = hashMagicToken('any-token');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('공백 정규화 — trim 적용', () => {
    expect(hashMagicToken('  abc123  ')).toBe(hashMagicToken('abc123'));
  });

  it('빈 문자열도 해시 생성 (sentinel 값 회피용)', () => {
    expect(hashMagicToken('')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashRecipient', () => {
  it('대소문자 정규화 (이메일 case-insensitive)', () => {
    expect(hashRecipient('Foo@Example.com')).toBe(hashRecipient('foo@example.com'));
  });

  it('전화번호 공백 trim', () => {
    expect(hashRecipient('  010-1234-5678  ')).toBe(hashRecipient('010-1234-5678'));
  });

  it('빈 입력도 안전하게 해시', () => {
    expect(hashRecipient('')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('서로 다른 전화번호는 다른 해시', () => {
    expect(hashRecipient('010-1234-5678')).not.toBe(hashRecipient('010-1234-5679'));
  });
});

describe('buildMagicLinkUrl', () => {
  const origEnv = process.env.NEXT_PUBLIC_BASE_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_BASE_URL = origEnv;
  });

  it('base URL 있으면 절대 URL', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://yeosonam.com';
    expect(buildMagicLinkUrl('abc')).toBe('https://yeosonam.com/m/abc');
  });

  it('base URL 끝 슬래시 처리', () => {
    process.env.NEXT_PUBLIC_BASE_URL = 'https://yeosonam.com/';
    expect(buildMagicLinkUrl('abc')).toBe('https://yeosonam.com/m/abc');
  });

  it('base URL 없으면 상대 경로', () => {
    delete process.env.NEXT_PUBLIC_BASE_URL;
    expect(buildMagicLinkUrl('abc')).toBe('/m/abc');
  });
});
