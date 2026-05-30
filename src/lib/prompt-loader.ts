/**
 * 여소남 OS — 프로프트 관리 시스템 SDK
 *
 * 두 가지 백엔드 지원:
 *   1. llm_prompts (기존) — key 기반 단일 프롬프트
 *   2. prompt_registry (Phase 1-2) — name + label 기반, 버전 관리, A/B variant 라우팅
 *
 * 사용:
 *   import { getPrompt, getRegistryPrompt } from '@/lib/prompt-loader'
 *
 *   // 기존 방식
 *   const system = await getPrompt('qa-system', 'fallback text...')
 *
 *   // Registry 방식 (label 기반)
 *   const prompt = await getRegistryPrompt({ name: 'qa-system', label: 'production' })
 *
 *   // A/B 테스트 (customerId 기반 variant 버킷)
 *   const ab = await getRegistryPrompt({
 *     name: 'qa-system',
 *     label: 'production',
 *     customerId: 'user_abc123',
 *     variants: ['variant-a', 'variant-b'],
 *   })
 */

import { supabaseAdmin, isSupabaseConfigured } from './supabase';

const CACHE_TTL_MS = Number(process.env.PROMPT_CACHE_TTL_MS ?? 5 * 60 * 1000);

interface CacheEntry {
  body: string;
  version: number;
  fetchedAt: number;
}

/** prompt_registry 용 캐시 키 */
function registryCacheKey(name: string, label: string): string {
  return `registry:${name}:${label}`;
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

// ─── prompt_registry SDK ────────────────────────────────────────────────

export interface GetRegistryPromptOptions {
  /** prompt_registry.name */
  name: string;
  /** label 필터 (예: 'production', 'staging') */
  label?: string;
  /** A/B variant 라우팅용 고객 ID (customerId 기반 hash → variant 버킷) */
  customerId?: string;
  /** A/B variant 목록 (customerId 필수) */
  variants?: string[];
  /** fallback 텍스트 */
  fallback?: string;
}

async function fetchRegistryFromDb(
  name: string,
  label: string,
): Promise<CacheEntry | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const { data, error } = await supabaseAdmin
      .from('prompt_registry')
      .select('prompt_text, version')
      .eq('name', name)
      .contains('labels', [label])
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    return { body: data.prompt_text, version: data.version, fetchedAt: Date.now() };
  } catch (err) {
    console.error(`[prompt-loader] registry 조회 실패 name="${name}" label="${label}":`, err);
    return null;
  }
}

/**
 * 고객 ID 기반 variant 결정 (deterministic hash).
 * 같은 customerId는 항상 같은 variant를 받는다.
 */
function resolveVariant(customerId: string, variants: string[]): string {
  let hash = 0;
  for (let i = 0; i < customerId.length; i++) {
    const chr = customerId.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  const idx = Math.abs(hash) % variants.length;
  return variants[idx];
}

/**
 * prompt_registry 에서 label 기반으로 프롬프트를 조회한다.
 *
 * A/B 테스트 예:
 *   const prompt = await getRegistryPrompt({
 *     name: 'qa-system',
 *     label: 'production',
 *     customerId: 'user_abc123',
 *     variants: ['variant-a', 'variant-b'],
 *     fallback: '기본 시스템 프롬프트...',
 *   })
 *   // variant-a 또는 variant-b 중 하나가 label로 사용됨
 */
export async function getRegistryPrompt(options: GetRegistryPromptOptions): Promise<string> {
  const { name, label = 'production', customerId, variants, fallback = '' } = options;

  // A/B variant 결정
  const effectiveLabel =
    customerId && variants && variants.length > 0
      ? resolveVariant(customerId, variants)
      : label;

  const cacheKey = registryCacheKey(name, effectiveLabel);
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.body;
  }

  const entry = await fetchRegistryFromDb(name, effectiveLabel);

  if (entry) {
    cache.set(cacheKey, entry);
    return entry.body;
  }

  // stale 캐시 fallback
  if (cached) {
    console.warn(
      `[prompt-loader] registry DB 실패, stale 캐시 사용 name="${name}" label="${effectiveLabel}" (v${cached.version})`,
    );
    return cached.body;
  }

  // 같은 name + 'production' label로 재시도
  if (effectiveLabel !== 'production') {
    console.warn(
      `[prompt-loader] label="${effectiveLabel}" 없음, production fallback name="${name}"`,
    );
    const prodCacheKey = registryCacheKey(name, 'production');
    const prodCached = cache.get(prodCacheKey);
    if (prodCached && Date.now() - prodCached.fetchedAt < CACHE_TTL_MS) {
      return prodCached.body;
    }
    const prodEntry = await fetchRegistryFromDb(name, 'production');
    if (prodEntry) {
      cache.set(prodCacheKey, prodEntry);
      return prodEntry.body;
    }
  }

  if (fallback) {
    console.warn(`[prompt-loader] registry fallback 사용 name="${name}"`);
  }
  return fallback;
}

/**
 * prompt_registry 의 특정 name 캐시를 무효화한다.
 */
export function invalidateRegistryCache(name?: string, label?: string): void {
  if (name && label) {
    cache.delete(registryCacheKey(name, label));
  } else if (name) {
    // 해당 name의 모든 label 캐시 삭제
    for (const key of cache.keys()) {
      if (key.startsWith(`registry:${name}:`)) {
        cache.delete(key);
      }
    }
  }
}
