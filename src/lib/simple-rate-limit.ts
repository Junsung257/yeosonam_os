/**
 * @file simple-rate-limit.ts
 * @description 동기 boolean 반환 rate limit (사용처 호환 유지).
 *
 * 백엔드:
 * - 기본: in-memory 고정 윈도우 (per-instance)
 * - 비동기 분산 한도가 필요하면 src/lib/rate-limiter.ts 의 rateLimit() 사용
 *
 * 참고: 이 모듈은 동기 인터페이스를 유지하기 위해 in-memory만 사용한다.
 *       Upstash 통합은 NextRequest 기반 async API(rateLimit)에서 자동 적용됨.
 */

const DEFAULT_WINDOW_MS = 60_000;
const MAX_STORE_KEYS = 8_000;

type Bucket = { count: number; windowStart: number };
const store = new Map<string, Bucket>();

function prune(now: number, windowMs: number) {
  if (store.size <= MAX_STORE_KEYS) return;
  for (const [k, v] of store) {
    if (now - v.windowStart > windowMs * 2) store.delete(k);
  }
}

/** @returns true 허용, false 차단 */
export function allowRateLimit(key: string, maxInWindow: number, windowMs = DEFAULT_WINDOW_MS): boolean {
  const now = Date.now();
  const b = store.get(key);
  if (!b || now - b.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now });
    prune(now, windowMs);
    return true;
  }
  if (b.count >= maxInWindow) return false;
  b.count++;
  return true;
}

export function getClientIpFromRequest(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() || 'unknown';
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}
