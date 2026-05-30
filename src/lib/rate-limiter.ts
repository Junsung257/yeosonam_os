/**
 * @file rate-limiter.ts
 * @description Rate limiter with Upstash Redis backend + in-memory fallback.
 *
 * 동작:
 * - UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN 가 있으면 Upstash 슬라이딩 윈도우 사용 (분산 안전)
 * - 둘 중 하나라도 없으면 in-memory 슬라이딩 윈도우 fallback (per-instance)
 * - NODE_ENV === 'development' 항상 통과
 *
 * 사용:
 * ```ts
 * const limited = await rateLimit(request, { limit: 20, window: 60 });
 * if (limited) return limited; // 429 응답 반환
 * ```
 */

import { NextRequest, NextResponse } from 'next/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { getSecret } from '@/lib/secret-registry';

interface RateLimitOptions {
  /** 허용 요청 수 (윈도우 내) */
  limit?: number;
  /** 윈도우 초 */
  window?: number;
  /** 키 추출 함수 (기본: IP, x-vercel-forwarded-for 우선) */
  keyFn?: (req: NextRequest) => string;
  /** Upstash 사용 시 prefix (기본: 'rl') */
  prefix?: string;
  /**
   * Upstash 일시 장애 + in-memory fallback 시도 시:
   *   - false (기본): in-memory fallback 으로 통과 (가용성 우선)
   *   - true: Upstash 에러 시 즉시 429 반환 (정책 무결성 우선) — AI/billing 등 critical 라우트
   *
   * 보안 권고: rateLimitAI 류는 failClosed=true 검토.
   */
  failClosed?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// Upstash backend (있으면 우선 사용)
// ────────────────────────────────────────────────────────────────────────────

let redisClient: Redis | null = null;
function getRedis(): Redis | null {
  if (redisClient) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = getSecret('UPSTASH_REDIS_REST_TOKEN');
  if (!url || !token) return null;
  redisClient = new Redis({ url, token });
  return redisClient;
}

// limiter 인스턴스 캐시 — (limit, window, prefix) 조합별로 1회만 생성
const limiterCache = new Map<string, Ratelimit>();
function getLimiter(limit: number, windowSec: number, prefix: string): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const key = `${prefix}:${limit}:${windowSec}`;
  let lim = limiterCache.get(key);
  if (!lim) {
    lim = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      analytics: true,
      prefix,
    });
    limiterCache.set(key, lim);
  }
  return lim;
}

// ────────────────────────────────────────────────────────────────────────────
// In-memory fallback (Upstash 미설정 시)
// ────────────────────────────────────────────────────────────────────────────

interface BucketEntry {
  count: number;
  resetAt: number;
}

// 메모리 보호: 위조 IP 무한 생성 공격 시 OOM 방지.
// 청소는 60s 마다 (윈도우 60s 와 동조) + MAX_KEYS 도달 시 LRU eviction.
const MEMORY_MAX_KEYS = 50_000;
const memoryStore = new Map<string, BucketEntry>();

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of memoryStore.entries()) {
      if (entry.resetAt < now) memoryStore.delete(key);
    }
  }, 60_000).unref?.();
}

function memoryCheck(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = memoryStore.get(key);
  if (!entry || entry.resetAt < now) {
    // MAX_KEYS 도달 시 가장 오래된 항목 1개 evict (LRU 근사 — Map 삽입 순서)
    if (memoryStore.size >= MEMORY_MAX_KEYS) {
      const firstKey = memoryStore.keys().next().value;
      if (firstKey !== undefined) memoryStore.delete(firstKey);
    }
    const resetAt = now + windowMs;
    memoryStore.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt };
  }
  entry.count++;
  if (entry.count > limit) {
    return { ok: false, remaining: 0, resetAt: entry.resetAt };
  }
  return { ok: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

/**
 * Vercel 환경의 신뢰 가능한 IP 추출.
 *
 * 우선순위:
 *   1. x-vercel-forwarded-for: Vercel edge 가 직접 주입, 위조 불가능 (left-most = 진짜 클라)
 *   2. x-real-ip: Vercel 동일 출처
 *   3. x-forwarded-for: 일반 프록시 — 위조 가능. left-most 만 사용
 *   4. 'unknown' fallback
 *
 * 보안: 일반 x-forwarded-for 단독 사용은 spoofing 위험 (curl -H "X-Forwarded-For: 1.2.3.4")
 */
export function extractClientIp(req: NextRequest): string {
  const vercelFwd = req.headers.get('x-vercel-forwarded-for');
  if (vercelFwd) return vercelFwd.split(',')[0]?.trim() || 'unknown';
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim() || 'unknown';
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim() || 'unknown';
  return 'unknown';
}

/** 테스트/디버깅용 — 메모리 스토어 강제 리셋 */
export function _resetRateLimiterStateForTest(): void {
  memoryStore.clear();
  redisClient = null;
  limiterCache.clear();
}

// ────────────────────────────────────────────────────────────────────────────
// Public API (인터페이스 호환 유지)
// ────────────────────────────────────────────────────────────────────────────

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
  const windowSec = opts.window ?? 60;
  const prefix = opts.prefix ?? 'rl';
  const failClosed = opts.failClosed === true;
  const key = opts.keyFn ? opts.keyFn(req) : extractClientIp(req);

  const limiter = getLimiter(limit, windowSec, prefix);

  let ok: boolean;
  let remaining: number;
  let resetAt: number;

  if (limiter) {
    try {
      const r = await limiter.limit(key);
      ok = r.success;
      remaining = r.remaining;
      resetAt = r.reset;
    } catch (err) {
      console.warn('[rate-limiter] Upstash error:', err);
      if (failClosed) {
        // 정책 무결성 우선 — 즉시 429 반환 (AI/billing 등 critical)
        return NextResponse.json(
          { error: 'Rate limit 일시 장애. 잠시 후 다시 시도.' },
          { status: 429, headers: { 'Retry-After': '5' } },
        );
      }
      // 가용성 우선 — in-memory fallback (분산 카운트 정확도 손해)
      const m = memoryCheck(key, limit, windowSec * 1000);
      ok = m.ok;
      remaining = m.remaining;
      resetAt = m.resetAt;
    }
  } else {
    const m = memoryCheck(key, limit, windowSec * 1000);
    ok = m.ok;
    remaining = m.remaining;
    resetAt = m.resetAt;
  }

  if (ok) return null;

  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return NextResponse.json(
    { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(retryAfter),
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': String(Math.max(0, remaining)),
        'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
      },
    },
  );
}

/**
 * AI 호출 라우트용 — 더 엄격한 제한 + Upstash 장애 시 fail-closed.
 * 비싼 LLM 호출이라 분산 카운트가 깨지면 비용 폭발 → 정책 무결성 우선.
 */
export async function rateLimitAI(req: NextRequest): Promise<NextResponse | null> {
  return rateLimit(req, { limit: 20, window: 60, prefix: 'rl-ai', failClosed: true });
}

/** 일반 mutation 라우트용 */
export async function rateLimitMutation(req: NextRequest): Promise<NextResponse | null> {
  return rateLimit(req, { limit: 100, window: 60, prefix: 'rl-mut' });
}

/** 백엔드 상태 확인 (테스트/디버깅용) */
export function getRateLimitBackend(): 'upstash' | 'memory' {
  return getRedis() ? 'upstash' : 'memory';
}
