/**
 * @file rate-limiter.ts
 * @description In-memory 슬라이딩 윈도우 rate limiter.
 *
 * 사용:
 * ```ts
 * // API 라우트 최상단
 * const limited = await rateLimit(request, { limit: 20, window: 60 });
 * if (limited) return limited; // 429 응답 반환
 * ```
 *
 * 주의:
 * - 서버리스/엣지 환경에서는 인스턴스가 분산되므로 per-instance 제한만 가능.
 *   글로벌 제한이 필요하면 Upstash Redis 기반으로 교체 필요.
 * - 개발 환경에서는 항상 통과.
 */

import { NextRequest, NextResponse } from 'next/server';

interface RateLimitOptions {
  /** 허용 요청 수 (윈도우 내) */
  limit?: number;
  /** 윈도우 초 */
  window?: number;
  /** 키 추출 함수 (기본: IP) */
  keyFn?: (req: NextRequest) => string;
}

interface BucketEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, BucketEntry>();

// 메모리 누수 방지: 만료된 항목 주기적으로 정리 (10분마다)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt < now) store.delete(key);
    }
  }, 600_000).unref?.();
}

/**
 * 요청을 rate limit 체크한다.
 * @returns `null` — 통과 | `NextResponse(429)` — 초과
 */
export async function rateLimit(
  req: NextRequest,
  opts: RateLimitOptions = {},
): Promise<NextResponse | null> {
  if (process.env.NODE_ENV === 'development') return null;

  const limit = opts.limit ?? 60;
  const windowMs = (opts.window ?? 60) * 1000;
  const key = opts.keyFn
    ? opts.keyFn(req)
    : (req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? 'unknown');

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return null;
  }

  entry.count++;
  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return NextResponse.json(
      { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
        },
      },
    );
  }

  return null;
}

/** AI 호출 라우트용 — 더 엄격한 제한 */
export async function rateLimitAI(req: NextRequest): Promise<NextResponse | null> {
  return rateLimit(req, { limit: 20, window: 60 });
}

/** 일반 mutation 라우트용 */
export async function rateLimitMutation(req: NextRequest): Promise<NextResponse | null> {
  return rateLimit(req, { limit: 100, window: 60 });
}
