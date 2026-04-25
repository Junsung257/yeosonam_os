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

interface CacheEntry {
  value: string;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

/**
 * 토큰 조회. env 우선, 미설정/만료 의심 시 DB 조회.
 * @param key 'META_ACCESS_TOKEN' | 'THREADS_ACCESS_TOKEN' 등
 */
export async function resolveMetaToken(key: string): Promise<string | null> {
  // env 값이 있으면 먼저 사용 (기본 경로)
  const envValue = process.env[key];
  if (envValue) return envValue;

  // 캐시
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  if (!isSupabaseConfigured) return null;

  try {
    const { data } = await supabaseAdmin
      .from('system_secrets')
      .select('value')
      .eq('key', key)
      .maybeSingle();
    const value = (data?.value as string | undefined) ?? null;
    if (value) {
      cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return value;
  } catch {
    return null;
  }
}

/** 캐시 강제 무효화 — 토큰 refresh 크론이 호출. */
export function invalidateMetaTokenCache(key?: string) {
  if (key) cache.delete(key);
  else cache.clear();
}
