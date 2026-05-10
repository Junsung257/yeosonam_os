/**
 * @file rate-limiter.test.ts
 * @description rate-limiter 백엔드 분기 + in-memory 동작 회귀 방지 테스트.
 *
 * Upstash 환경변수가 없으면 in-memory fallback이 정상 동작하는지 확인한다.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { rateLimit, rateLimitAI, rateLimitMutation, getRateLimitBackend } from './rate-limiter';

function makeReq(ip = '1.2.3.4'): NextRequest {
  const headers = new Headers({ 'x-forwarded-for': ip });
  return { headers } as unknown as NextRequest;
}

// NODE_ENV 는 @types/node 에서 readonly 라 직접 대입 불가 → 캐스팅으로 우회
function setNodeEnv(value: string) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

describe('rate-limiter (in-memory fallback)', () => {
  beforeEach(() => {
    // 테스트 환경은 development 가 아님을 보장 — 실제 limit 동작 테스트
    setNodeEnv('production');
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  it('Upstash 환경변수 없으면 memory backend로 식별된다', () => {
    expect(getRateLimitBackend()).toBe('memory');
  });

  it('limit 미만 요청은 통과한다 (null 반환)', async () => {
    const req = makeReq('10.0.0.1');
    const res = await rateLimit(req, { limit: 3, window: 60 });
    expect(res).toBeNull();
  });

  it('limit 초과 시 429와 Retry-After 헤더를 반환한다', async () => {
    const ip = '10.0.0.2';
    const req = makeReq(ip);
    // 5번 호출 (limit 3 초과)
    for (let i = 0; i < 3; i++) {
      const ok = await rateLimit(req, { limit: 3, window: 60 });
      expect(ok).toBeNull();
    }
    const blocked = await rateLimit(req, { limit: 3, window: 60 });
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get('Retry-After')).toBeTruthy();
    expect(blocked!.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(blocked!.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('서로 다른 IP는 독립 카운트', async () => {
    const r1 = makeReq('10.0.0.10');
    const r2 = makeReq('10.0.0.11');
    for (let i = 0; i < 3; i++) await rateLimit(r1, { limit: 3, window: 60 });
    const blocked1 = await rateLimit(r1, { limit: 3, window: 60 });
    const ok2 = await rateLimit(r2, { limit: 3, window: 60 });
    expect(blocked1).not.toBeNull();
    expect(ok2).toBeNull();
  });

  it('rateLimitAI는 limit 20 / window 60 프리셋', async () => {
    const req = makeReq('10.0.0.20');
    for (let i = 0; i < 20; i++) {
      const r = await rateLimitAI(req);
      expect(r).toBeNull();
    }
    const blocked = await rateLimitAI(req);
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get('X-RateLimit-Limit')).toBe('20');
  });

  it('rateLimitMutation은 limit 100 / window 60 프리셋', async () => {
    const req = makeReq('10.0.0.30');
    for (let i = 0; i < 100; i++) {
      const r = await rateLimitMutation(req);
      expect(r).toBeNull();
    }
    const blocked = await rateLimitMutation(req);
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get('X-RateLimit-Limit')).toBe('100');
  });

  it('development 환경에서는 항상 통과', async () => {
    setNodeEnv('development');
    const req = makeReq('10.0.0.40');
    for (let i = 0; i < 100; i++) {
      const r = await rateLimit(req, { limit: 1, window: 60 });
      expect(r).toBeNull();
    }
  });

  it('keyFn 옵션으로 키 추출 커스터마이즈 가능', async () => {
    const req1 = makeReq('99.99.99.99');
    const req2 = makeReq('99.99.99.99');
    const customKey = () => 'shared-bucket';
    for (let i = 0; i < 3; i++) await rateLimit(req1, { limit: 3, window: 60, keyFn: customKey });
    // 다른 req지만 같은 키 → 차단
    const blocked = await rateLimit(req2, { limit: 3, window: 60, keyFn: customKey });
    expect(blocked!.status).toBe(429);
  });
});
