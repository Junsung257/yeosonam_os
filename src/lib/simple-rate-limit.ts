/**
 * 프로세스 메모리 기반 고정 윈도우 rate limit (서버리스 인스턴스별).
 * 과도한 스팸만 막는 용도 — 엄격한 전역 한도는 Edge/KV 등 별도 필요.
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
