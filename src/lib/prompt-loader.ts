import { supabaseAdmin, isSupabaseConfigured } from './supabase';

const CACHE_TTL_MS = Number(process.env.PROMPT_CACHE_TTL_MS ?? 5 * 60 * 1000);

interface CacheEntry {
  body: string;
  version: number;
  fetchedAt: number;
}

// 모듈 수준 싱글턴 캐시 — Next.js 서버 프로세스 내 공유
const cache = new Map<string, CacheEntry>();

async function fetchFromDb(key: string): Promise<CacheEntry | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from('llm_prompts')
      .select('body, version')
      .eq('key', key)
      .eq('is_active', true)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return { body: data.body, version: data.version, fetchedAt: Date.now() };
  } catch (err) {
    console.error(`[prompt-loader] DB 조회 실패 key="${key}":`, err);
    return null;
  }
}

/**
 * DB에서 활성 프롬프트를 조회합니다.
 * DB 장애 시 하드코딩 fallback 반환으로 서비스 무중단 보장.
 */
export async function getPrompt(key: string, fallback: string): Promise<string> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.body;
  }

  const entry = await fetchFromDb(key);

  if (entry) {
    cache.set(key, entry);
    return entry.body;
  }

  // DB 실패 → stale 캐시라도 반환 (stale-while-revalidate)
  if (cached) {
    console.warn(`[prompt-loader] DB 실패, stale 캐시 사용 key="${key}" (v${cached.version})`);
    return cached.body;
  }

  console.warn(`[prompt-loader] 하드코딩 fallback 사용 key="${key}"`);
  return fallback;
}

/** 특정 키(또는 전체)의 캐시를 즉시 무효화합니다. */
export function invalidatePromptCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

/** 현재 캐시 상태 조회 (어드민 디버그용). */
export function getPromptCacheStatus(): Array<{
  key: string;
  version: number;
  ageMs: number;
  expired: boolean;
}> {
  const now = Date.now();
  return Array.from(cache.entries()).map(([key, entry]) => ({
    key,
    version: entry.version,
    ageMs: now - entry.fetchedAt,
    expired: now - entry.fetchedAt >= CACHE_TTL_MS,
  }));
}
