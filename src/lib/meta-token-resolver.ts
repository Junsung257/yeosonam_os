/**
 * Meta access token 해석기.
 *
 * 우선순위: env → DB (system_secrets).
 * Meta long-lived token 자동 갱신 크론이 DB에 최신 값을 써두므로,
 * env 가 만료됐어도 DB 값으로 동작 가능.
 *
 * 메모리 캐시 (1분) — publish 호출마다 DB 치면 부하.
 */
import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { createSingleFlight } from './async-single-flight';

interface CacheEntry {
  value: string;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;
const dbFetchFlight = createSingleFlight<string, string | null>();

/**
 * 토큰 조회. env 우선, 미설정/만료 의심 시 DB 조회.
 * @param key 'META_ACCESS_TOKEN' | 'THREADS_ACCESS_TOKEN' 등
 */
export async function resolveMetaToken(key: string): Promise<string | null> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  // Runtime env cannot be updated after a token refresh. The database value is
  // therefore authoritative; env is only a bootstrap/failure fallback.
  const envValue = process.env[key] ?? null;
  if (!isSupabaseConfigured) return envValue;

  try {
    const value = await dbFetchFlight(key, async () => {
      const { data } = await supabaseAdmin
        .from('system_secrets')
        .select('value, expires_at')
        .eq('key', key)
        .maybeSingle();
      const dbValue = (data?.value as string | undefined) ?? null;
      const expiresAt = (data?.expires_at as string | null | undefined) ?? null;
      const isExpired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;
      return dbValue && !isExpired ? dbValue : envValue;
    });
    if (value) {
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return value;
  } catch {
    return envValue;
  }
}

/** 캐시 강제 무효화 — 토큰 refresh 크론이 호출. */
export function invalidateMetaTokenCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
