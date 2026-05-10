/**
 * @file env.test.ts
 * @description requireEnv / requireEnvAll 헬퍼 회귀 방지.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('requireEnv / requireEnvAll', () => {
  beforeEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    // t3-env 의 env 객체는 첫 평가 시점에 frozen 됨 → 매 케이스 fresh import
    vi.resetModules();
  });

  it('requireEnv: 키 미설정 시 throw + 키명 + hint 포함', async () => {
    const { requireEnv } = await import('./env');
    expect(() => requireEnv('ANTHROPIC_API_KEY', 'qa-chat 라우트')).toThrowError(
      /ANTHROPIC_API_KEY.*qa-chat 라우트/,
    );
  });

  it('requireEnv: 키 설정 시 string 반환', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-test';
    // env 모듈 재로드를 위해 reset 필요 — t3-env 가 lazy 평가하므로 동일 module instance 에서도 process.env 반영
    const { requireEnv } = await import('./env');
    const v = requireEnv('ANTHROPIC_API_KEY');
    expect(v).toBe('sk-test');
  });

  it('requireEnv: 빈 문자열도 누락으로 처리 (emptyStringAsUndefined 정책 정합)', async () => {
    process.env.ANTHROPIC_API_KEY = '';
    const { requireEnv } = await import('./env');
    expect(() => requireEnv('ANTHROPIC_API_KEY')).toThrow();
  });

  it('requireEnvAll: 모든 키 누락 시 한 번에 메시지', async () => {
    const { requireEnvAll } = await import('./env');
    expect(() =>
      requireEnvAll(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'], 'rate limit'),
    ).toThrowError(/UPSTASH_REDIS_REST_URL.*UPSTASH_REDIS_REST_TOKEN/);
  });

  it('requireEnvAll: 모두 설정 시 Record 반환', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token-123';
    const { requireEnvAll } = await import('./env');
    const r = requireEnvAll(['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']);
    expect(r.UPSTASH_REDIS_REST_URL).toBe('https://example.upstash.io');
    expect(r.UPSTASH_REDIS_REST_TOKEN).toBe('token-123');
  });
});
