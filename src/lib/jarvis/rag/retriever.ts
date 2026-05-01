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

const EMBED_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent'
const RERANK_MODEL = 'gemini-2.5-flash'

export type SourceType = 'package' | 'blog' | 'attraction' | 'policy' | 'custom'

export interface RetrievalQuery {
  query: string
  tenantId?: string
  sourceTypes?: SourceType[]
  limit?: number
  rerank?: boolean
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

/** 쿼리 → 임베딩 벡터. 실패 시 null (retrieval 은 BM25 only 로 폴백). */
async function embedQuery(query: string): Promise<number[] | null> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
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
    p_query_embedding: embedding ?? new Array(1536).fill(0),
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

  if (!q.rerank || hits.length <= limit) return hits.slice(0, limit)

  return rerankWithFlash(q.query, hits, limit)
}

/**
 * Gemini Flash rerank — top-N 후보를 쿼리 관련성 순으로 재정렬.
 * 실패 시 원본 RRF 순서 유지 (fail-open).
 */
async function rerankWithFlash(query: string, hits: RetrievalHit[], limit: number): Promise<RetrievalHit[]> {
  const apiKey = process.env.GOOGLE_AI_API_KEY
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
    const scores: Array<{ i: number; s: number }> = JSON.parse(raw)

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
