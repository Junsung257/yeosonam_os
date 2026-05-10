/**
 * @file semantic-cache.ts
 * @description GPTCache 패턴 의미 기반 LLM 응답 캐시 (arXiv:2306.13782).
 *
 * 동작:
 *   1. lookupSemanticCache(task, prompt) → 동일 의미 쿼리 있으면 캐시된 응답 반환
 *   2. storeSemanticCache(task, prompt, response, ttl) → 신규 응답 저장
 *
 * 인프라 재사용:
 *   - Supabase pgvector (HNSW)
 *   - gemini-embedding-001 (1536d, embeddings.ts 동일)
 *
 * 안전성:
 *   - SAFE_TASKS 화이트리스트만 적용 (PII/가격/날짜 캐싱 위험 task 차단)
 *   - 호출 측이 명시적으로 옵트인 (자동 적용 X)
 *   - cosine threshold 기본 0.97 (매우 높음)
 *   - TTL 기본 24h
 *
 * 미설치(키/테이블 없음) 시 모든 함수 no-op 반환 → 호출 측 LLM 직행.
 */

import { createHash } from 'node:crypto';
import { supabaseAdmin, isSupabaseConfigured } from '@/lib/supabase';
import { embedText } from '@/lib/embeddings';
import { getSecret } from '@/lib/secret-registry';
import type { LlmTask } from '@/lib/llm-gateway';

/**
 * 의미 캐시를 적용해도 안전한 task 화이트리스트.
 *
 * 차단 대상:
 *   - 가격/실시간 정보 포함 (concierge/search 등 — 가격 변동 위험)
 *   - 개인 식별 정보 포함 가능 (jarvis-* 류)
 *   - 모델 특화 출력 형태 (normalize-* — 정확도 critical)
 */
export const SAFE_CACHE_TASKS: ReadonlyArray<LlmTask> = [
  'qa-chat',              // 공개 QA — 동일 질문 반복 빈도 높음
  'free-travel-extract',  // 자유여행 파라미터 추출 — 결정론적
  'parse_travel_doc',     // 문서 구조화 — 동일 원문이면 동일 결과
];

const DEFAULT_THRESHOLD = 0.97;
const DEFAULT_TTL_HOURS = 24;
const MAX_PROMPT_CHARS = 8000;

export interface SemanticCacheLookupResult {
  hit: boolean;
  response?: string;
  similarity?: number;
  hitType?: 'exact' | 'semantic';
  cacheId?: string;
}

export interface SemanticCacheOptions {
  threshold?: number;
  ttlHours?: number;
  metadata?: Record<string, unknown>;
}

function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt.trim().slice(0, MAX_PROMPT_CHARS)).digest('hex').slice(0, 32);
}

function isSafeTask(task: string): task is LlmTask {
  return (SAFE_CACHE_TASKS as ReadonlyArray<string>).includes(task);
}

function getEmbedKey(): string | null {
  return getSecret('GEMINI_API_KEY') || getSecret('GOOGLE_AI_API_KEY') || getSecret('GOOGLE_API_KEY');
}

/**
 * 의미 캐시 조회.
 *
 * @returns hit=true 이면 LLM 호출 스킵하고 response 반환. 그 외엔 LLM 호출 진행.
 */
export async function lookupSemanticCache(
  task: LlmTask | string,
  prompt: string,
  opts: SemanticCacheOptions = {},
): Promise<SemanticCacheLookupResult> {
  if (!isSafeTask(task)) return { hit: false };
  if (!isSupabaseConfigured) return { hit: false };
  if (!prompt?.trim()) return { hit: false };

  const apiKey = getEmbedKey();
  if (!apiKey) return { hit: false };

  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const promptHash = hashPrompt(prompt);

  try {
    const emb = await embedText(prompt, apiKey, 'SEMANTIC_SIMILARITY');
    if (!emb) return { hit: false };

    const { data, error } = await supabaseAdmin.rpc('lookup_semantic_cache', {
      p_task: task,
      p_prompt_hash: promptHash,
      p_query_emb: emb as unknown as string, // pgvector wire format은 자동 직렬화
      p_threshold: threshold,
    });

    if (error) {
      console.warn('[semantic-cache] lookup RPC error:', error.message);
      return { hit: false };
    }

    const row = Array.isArray(data) ? data[0] : null;
    if (!row || !row.response) return { hit: false };

    // analytics — fail-open
    void supabaseAdmin
      .rpc('increment_semantic_cache_hit', { p_id: row.id })
      .then(({ error: e }: { error: { message: string } | null }) => {
        if (e) console.warn('[semantic-cache] hit increment error:', e.message);
      });

    return {
      hit: true,
      response: row.response,
      similarity: typeof row.similarity === 'number' ? row.similarity : undefined,
      hitType: row.hit_type === 'exact' ? 'exact' : 'semantic',
      cacheId: row.id,
    };
  } catch (e) {
    console.warn('[semantic-cache] lookup unexpected error:', e instanceof Error ? e.message : String(e));
    return { hit: false };
  }
}

/**
 * 응답 캐시 저장. LLM 호출 성공 후 호출.
 * 실패해도 호출 측 동작에 영향 없음 (fail-open).
 */
export async function storeSemanticCache(
  task: LlmTask | string,
  prompt: string,
  response: string,
  opts: SemanticCacheOptions = {},
): Promise<void> {
  if (!isSafeTask(task)) return;
  if (!isSupabaseConfigured) return;
  if (!prompt?.trim() || !response?.trim()) return;
  if (response.length > 64000) return; // CHECK constraint 와 일치

  const apiKey = getEmbedKey();
  if (!apiKey) return;

  const ttlHours = opts.ttlHours ?? DEFAULT_TTL_HOURS;
  const promptHash = hashPrompt(prompt);
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();

  try {
    const emb = await embedText(prompt, apiKey, 'SEMANTIC_SIMILARITY');
    if (!emb) return;

    const { error } = await supabaseAdmin.from('llm_semantic_cache').insert({
      task,
      prompt_hash: promptHash,
      prompt_emb: emb as unknown as string,
      prompt_text: prompt.slice(0, MAX_PROMPT_CHARS),
      response,
      metadata: opts.metadata ?? {},
      expires_at: expiresAt,
    });

    if (error) {
      // unique violation 등은 동일 prompt 동시 저장 → 무시
      if (!/duplicate key/i.test(error.message)) {
        console.warn('[semantic-cache] store error:', error.message);
      }
    }
  } catch (e) {
    console.warn('[semantic-cache] store unexpected error:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * 의미 캐시 통합 헬퍼: lookup → 미스 시 fn() 실행 → 결과를 캐시에 저장.
 *
 * 사용:
 * ```ts
 * const text = await withSemanticCache(
 *   'parse_travel_doc',
 *   `${systemPrompt}\n---\n${userPrompt}`,
 *   async () => {
 *     const r = await llmCall({ task: 'parse_travel_doc', systemPrompt, userPrompt });
 *     return r.rawText ?? '';
 *   },
 * );
 * ```
 *
 * @param task LlmTask (SAFE_CACHE_TASKS 에 포함되지 않으면 캐시 우회)
 * @param prompt 캐시 키 (system+user 합성 권장)
 * @param fn 캐시 미스 시 실행할 LLM 호출 함수 — 응답 문자열 반환
 * @param opts threshold/ttlHours/metadata
 * @returns LLM 응답 (캐시 또는 신규)
 */
export async function withSemanticCache(
  task: LlmTask | string,
  prompt: string,
  fn: () => Promise<string>,
  opts: SemanticCacheOptions = {},
): Promise<{ text: string; cached: boolean; similarity?: number }> {
  const lookup = await lookupSemanticCache(task, prompt, opts);
  if (lookup.hit && lookup.response) {
    return { text: lookup.response, cached: true, similarity: lookup.similarity };
  }
  const text = await fn();
  if (text && text.length > 0 && text.length <= 64000) {
    void storeSemanticCache(task, prompt, text, opts);
  }
  return { text, cached: false };
}

/**
 * 캐시 통계 (어드민 대시보드용).
 */
export async function getSemanticCacheStats(): Promise<{
  total: number;
  byTask: Record<string, { count: number; hits: number }>;
}> {
  if (!isSupabaseConfigured) return { total: 0, byTask: {} };
  const { data, error } = await supabaseAdmin
    .from('llm_semantic_cache')
    .select('task, hit_count')
    .gte('expires_at', new Date().toISOString());
  if (error || !Array.isArray(data)) return { total: 0, byTask: {} };

  const byTask: Record<string, { count: number; hits: number }> = {};
  for (const row of data as Array<{ task: string; hit_count: number }>) {
    if (!byTask[row.task]) byTask[row.task] = { count: 0, hits: 0 };
    byTask[row.task].count++;
    byTask[row.task].hits += row.hit_count || 0;
  }
  return { total: data.length, byTask };
}
