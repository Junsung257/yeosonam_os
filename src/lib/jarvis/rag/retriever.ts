/**
 * 여소남 OS — Jarvis V2 RAG Retriever (Contextual + Hybrid)
 *
 * 설계 근거: db/JARVIS_V2_DESIGN.md §B.3
 *
 * 동작:
 *   1) 쿼리 임베딩 (gemini-embedding-001, 1536 dim)
 *   2) jarvis_hybrid_search RPC 호출 (vector + BM25 + RRF)
 *   3) 옵션: Gemini Flash 로 LLM rerank (top-20 → top-5)
 *   4) 결과 반환 — concierge agent 가 tool result 로 소비
 *
 * 격리:
 *   - tenantId 지정 시 Silo: 자기 tenant + NULL(공유) 만
 *   - tenantId 미지정 시 NULL(공유) 만
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getSecret } from '@/lib/secret-registry'
import { selectEvidenceHits } from './evidence-selection'

const EMBED_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'
const RERANK_MODEL = 'gemini-2.5-flash'

export type SourceType = 'package' | 'blog' | 'attraction' | 'policy' | 'custom'

export interface RetrievalQuery {
  query: string
  tenantId?: string
  sourceTypes?: SourceType[]
  limit?: number
  rerank?: boolean
  graphExpand?: boolean
}

export interface RetrievalHit {
  id: string
  tenantId: string | null
  sourceType: SourceType
  sourceId: string | null
  sourceUrl: string | null
  sourceTitle: string | null
  chunkText: string
  contextualText: string
  metadata: Record<string, any>
  score: number          // 최종 score (rerank 여부에 따라 rrf 또는 rerank 점수)
  vectorScore: number
  bm25Score: number
}

export function serializePgVector(values: number[] | null): string | null {
  if (!values) return null

  if (values.length !== 1536) {
    throw new Error(`[rag] embedding dimension mismatch: expected 1536, got ${values.length}`)
  }

  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error('[rag] embedding contains a non-finite value')
    }
  }

  return `[${values.join(',')}]`
}

export function parseRerankScores(raw: string): Array<{ i: number; s: number }> {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim()
  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  if (start < 0 || end <= start) return []

  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1))
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((item): item is { i: number; s: number } => (
        Number.isInteger(item?.i) &&
        Number.isFinite(item?.s)
      ))
      .map((item) => ({ i: item.i, s: Math.max(0, Math.min(1, item.s)) }))
  } catch (err) {
    return []
  }
}

/** 쿼리 → 임베딩 벡터. 실패 시 null (retrieval 은 BM25 only 로 폴백). */
async function embedQuery(query: string): Promise<number[] | null> {
  const apiKey = getSecret('GOOGLE_AI_API_KEY')
  if (!apiKey) return null

  try {
    const res = await fetch(`${EMBED_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: query }] },
        taskType: 'RETRIEVAL_QUERY',
        outputDimensionality: 1536,  // v4 fix: DB schema 와 일치 (default 3072)
      }),
    })
    if (!res.ok) {
      console.warn('[rag] embedQuery HTTP', res.status)
      return null
    }
    const json = await res.json() as { embedding?: { values?: number[] } }
    return json.embedding?.values ?? null
  } catch (err) {
    console.warn('[rag] embedQuery 실패:', err)
    return null
  }
}

/** Hybrid search — vector + BM25 + RRF. embedding 이 null 이면 BM25 only. */
export async function retrieve(q: RetrievalQuery): Promise<RetrievalHit[]> {
  const limit = q.limit ?? 5
  const queryLimit = q.rerank ? Math.max(limit * 4, 20) : limit
  const embedding = await embedQuery(q.query)

  const { data, error } = await supabaseAdmin.rpc('jarvis_hybrid_search', {
    p_query_embedding: serializePgVector(embedding),
    p_query_text: q.query,
    p_tenant_id: q.tenantId ?? null,
    p_source_types: q.sourceTypes ?? null,
    p_limit: queryLimit,
  })

  if (error) {
    console.error('[rag] hybrid_search 오류:', error)
    return []
  }

  const hits: RetrievalHit[] = (data ?? []).map((r: any) => ({
    id: r.id,
    tenantId: r.tenant_id,
    sourceType: r.source_type,
    sourceId: r.source_id,
    sourceUrl: r.source_url,
    sourceTitle: r.source_title,
    chunkText: r.chunk_text,
    contextualText: r.contextual_text,
    metadata: r.metadata ?? {},
    score: r.rrf_score,
    vectorScore: r.vector_score,
    bm25Score: r.bm25_score,
  }))

  const graphHits = q.graphExpand
    ? await expandWithGraphLite(hits, {
        tenantId: q.tenantId ?? null,
        sourceTypes: q.sourceTypes ?? null,
        maxHits: Math.max(8, limit * 2),
      })
    : []
  const evidenceHits = selectEvidenceHits(q.query, mergeHits(hits, graphHits), queryLimit)

  if (!q.rerank || evidenceHits.length <= limit) return evidenceHits.slice(0, limit)

  return rerankWithFlash(q.query, evidenceHits, limit)
}

function mergeHits(primary: RetrievalHit[], secondary: RetrievalHit[]): RetrievalHit[] {
  const seen = new Set(primary.map((hit) => hit.id))
  const merged = [...primary]
  for (const hit of secondary) {
    if (seen.has(hit.id)) continue
    seen.add(hit.id)
    merged.push(hit)
  }
  return merged
}

async function expandWithGraphLite(
  hits: RetrievalHit[],
  options: { tenantId: string | null; sourceTypes: SourceType[] | null; maxHits: number },
): Promise<RetrievalHit[]> {
  const seedIds = hits.slice(0, 5).map((hit) => hit.id)
  if (seedIds.length === 0) return []

  try {
    const { data: seedLinks, error: seedError } = await supabaseAdmin
      .from('jarvis_knowledge_entity_links')
      .select('entity_id')
      .in('chunk_id', seedIds)
      .gte('confidence', 0.75)
      .limit(20)
    if (seedError || !seedLinks?.length) return []

    const entityIds = [...new Set(seedLinks.map((row: any) => row.entity_id).filter(Boolean))]
    if (entityIds.length === 0) return []

    const { data: links, error: linkError } = await supabaseAdmin
      .from('jarvis_knowledge_entity_links')
      .select('chunk_id, confidence')
      .in('entity_id', entityIds)
      .gte('confidence', 0.75)
      .order('confidence', { ascending: false })
      .limit(options.maxHits * 3)
    if (linkError || !links?.length) return []

    const existing = new Set(seedIds)
    const chunkScores = new Map<string, number>()
    for (const row of links as Array<{ chunk_id: string; confidence: number }>) {
      if (!row.chunk_id || existing.has(row.chunk_id)) continue
      chunkScores.set(row.chunk_id, Math.max(chunkScores.get(row.chunk_id) ?? 0, Number(row.confidence) || 0))
    }
    const chunkIds = [...chunkScores.keys()].slice(0, options.maxHits * 2)
    if (chunkIds.length === 0) return []

    let chunkQuery = supabaseAdmin
      .from('jarvis_knowledge_chunks')
      .select('id, tenant_id, source_type, source_id, source_url, source_title, chunk_text, contextual_text, metadata')
      .in('id', chunkIds)
      .limit(options.maxHits * 2)

    if (options.tenantId) {
      chunkQuery = chunkQuery.or(`tenant_id.eq.${options.tenantId},tenant_id.is.null`)
    } else {
      chunkQuery = chunkQuery.is('tenant_id', null)
    }
    if (options.sourceTypes?.length) chunkQuery = chunkQuery.in('source_type', options.sourceTypes)

    const { data: chunks, error: chunkError } = await chunkQuery
    if (chunkError || !chunks?.length) return []

    return (chunks as any[]).map((chunk) => {
      const graphScore = Math.max(0.1, Math.min(0.65, (chunkScores.get(chunk.id) ?? 0.75) * 0.65))
      return {
        id: chunk.id,
        tenantId: chunk.tenant_id,
        sourceType: chunk.source_type,
        sourceId: chunk.source_id,
        sourceUrl: chunk.source_url,
        sourceTitle: chunk.source_title,
        chunkText: chunk.chunk_text,
        contextualText: chunk.contextual_text,
        metadata: { ...(chunk.metadata ?? {}), graphExpanded: true },
        score: graphScore,
        vectorScore: graphScore,
        bm25Score: 0,
      }
    })
  } catch {
    return []
  }
}

/**
 * Gemini Flash rerank — top-N 후보를 쿼리 관련성 순으로 재정렬.
 * 실패 시 원본 RRF 순서 유지 (fail-open).
 */
async function rerankWithFlash(query: string, hits: RetrievalHit[], limit: number): Promise<RetrievalHit[]> {
  const apiKey = getSecret('GOOGLE_AI_API_KEY')
  if (!apiKey) return hits.slice(0, limit)

  const prompt = `다음 여행 문서들을 "${query}"와의 관련성 순으로 재정렬.
각 문서에 0.0~1.0 점수만 부여하고 JSON 배열로 응답 (설명 금지).

문서:
${hits.map((h, i) => `[${i}] ${h.sourceTitle ?? '(제목 없음)'} — ${h.chunkText.slice(0, 300)}`).join('\n\n')}

응답 형식: [{"i":0,"s":0.92},{"i":1,"s":0.81},...]`

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${RERANK_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 512 },
        }),
      },
    )
    if (!res.ok) return hits.slice(0, limit)
    const json = await res.json()
    const raw = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]'
    const scores = parseRerankScores(raw)
    if (scores.length === 0) return hits.slice(0, limit)

    // rerank score 적용
    const scored = scores
      .filter(x => Number.isInteger(x.i) && x.i >= 0 && x.i < hits.length)
      .map(x => ({ ...hits[x.i], score: x.s }))
      .sort((a, b) => b.score - a.score)

    // rerank 결과에 없는 항목은 뒤에 붙임
    const included = new Set(scored.map(s => s.id))
    const remainder = hits.filter(h => !included.has(h.id))
    return [...scored, ...remainder].slice(0, limit)
  } catch (err) {
    console.warn('[rag] rerank 실패 — RRF 순서 유지:', err)
    return hits.slice(0, limit)
  }
}
