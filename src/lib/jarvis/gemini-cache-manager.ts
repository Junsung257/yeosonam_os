/**
 * 여소남 OS — Gemini Context Caching 매니저 (V2 §B.1.3a)
 *
 * 목적:
 * - 시스템 프롬프트 + tool 정의를 `cachedContents` 로 한 번 생성 → 5분 TTL 동안 재사용
 * - 캐시 hit 시 해당 토큰은 25~75% 할인 (implicit + explicit 중첩 적용)
 * - 프롬프트 해시를 key 로 쓰므로 agent/프롬프트가 동일한 한 5분 내 재호출은 cache 재사용
 *
 * 제약:
 * - Gemini 2.5 의 `cachedContents` 는 최소 토큰 임계(약 1024+)를 충족해야 생성 성공
 *   — 미충족 시 `getOrCreateCache()` 가 null 반환, 호출자는 일반 경로로 폴백
 * - `@google/generative-ai` 0.24.x 의 고수준 래퍼 대신 REST 직접 호출
 *   (프로젝트 전 레이어가 fetch 스타일로 통일되어 있음)
 */

type CacheRecord = { name: string; expiresAt: number }
const registry = new Map<string, CacheRecord>()

const CACHE_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/cachedContents'

/** 시스템 프롬프트 + tool schema 합친 rough 토큰 수. 4 chars ≈ 1 token 근사. */
function roughTokenCount(systemInstruction: string, tools: unknown): number {
  return Math.ceil((systemInstruction.length + JSON.stringify(tools).length) / 4)
}

/** FNV-1a 32bit — 충돌은 무시 가능, 동일 프롬프트 감지용 */
function hashKey(systemInstruction: string, tools: unknown): string {
  let h = 2166136261
  const s = systemInstruction + JSON.stringify(tools)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export interface CreateCacheParams {
  model: string                      // 예: 'models/gemini-2.5-pro'
  systemInstruction: string
  tools: Array<{ function_declarations: any[] }>
  ttlSeconds?: number                // default 300
  keyHint: string                    // agentType 등 네임스페이스
}

export interface CachedHandle {
  name: string                       // 'cachedContents/xxxxx' 형태
  fromReuse: boolean                 // true = 레지스트리에서 재사용
}

/**
 * 캐시가 있으면 재사용, 없으면 새로 생성. 토큰 임계 미만 또는 생성 실패 시 null 반환.
 * 호출자는 null 을 받으면 일반 generateContent 경로로 폴백해야 한다.
 */
export async function getOrCreateCache(p: CreateCacheParams): Promise<CachedHandle | null> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) return null

  if (roughTokenCount(p.systemInstruction, p.tools) < 1024) {
    // 토큰 임계 미만 — 캐시 생성 시도 자체가 실패하므로 스킵
    return null
  }

  const ttl = p.ttlSeconds ?? 300
  const key = `${p.keyHint}:${hashKey(p.systemInstruction, p.tools)}`
  const now = Date.now()

  const existing = registry.get(key)
  if (existing && existing.expiresAt > now + 10_000) {
    return { name: existing.name, fromReuse: true }
  }

  try {
    const res = await fetch(`${CACHE_API_BASE}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: p.model.startsWith('models/') ? p.model : `models/${p.model}`,
        systemInstruction: { parts: [{ text: p.systemInstruction }] },
        tools: p.tools,
        ttl: `${ttl}s`,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.warn(`[jarvis-cache] create HTTP ${res.status} — fallback to non-cached. ${errText.slice(0, 200)}`)
      return null
    }

    const json = await res.json() as { name?: string }
    if (!json.name) {
      console.warn('[jarvis-cache] response missing name — fallback')
      return null
    }

    registry.set(key, { name: json.name, expiresAt: now + ttl * 1000 })
    return { name: json.name, fromReuse: false }
  } catch (err) {
    console.warn('[jarvis-cache] create 실패 — fallback:', err)
    return null
  }
}

/** 레지스트리 명시적 만료 (테스트/긴급 갱신용) */
export function invalidateCache(keyHint: string): number {
  let removed = 0
  for (const [k] of registry) {
    if (k.startsWith(`${keyHint}:`)) {
      registry.delete(k)
      removed++
    }
  }
  return removed
}

/** 디버깅용 — 현재 살아있는 캐시 개수 */
export function cacheStats() {
  const now = Date.now()
  let alive = 0
  for (const r of registry.values()) if (r.expiresAt > now) alive++
  return { total: registry.size, alive }
}
