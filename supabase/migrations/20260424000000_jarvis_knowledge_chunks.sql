-- V2 §B.3.2 — Contextual Retrieval 인덱스 테이블 + Hybrid Search RPC
--
-- 아키텍처:
--   - tenant_id 로 Silo 격리 (NULL = 여소남 본사 공유)
--   - contextual_text: chunk 앞에 Gemini Flash 로 생성한 50~100 토큰 문맥 prepend
--     (Anthropic Contextual Retrieval 가이드 — retrieval 실패율 49~67% ↓)
--   - pgvector HNSW index (cosine)
--   - BM25 tsvector + GIN index → keyword fallback
--   - Hybrid search: RRF (Reciprocal Rank Fusion, k=60)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS jarvis_knowledge_chunks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = 공유 카탈로그
  source_type      TEXT NOT NULL CHECK (source_type IN ('package','blog','attraction','policy','custom')),
  source_id        UUID,
  source_url       TEXT,
  source_title     TEXT,
  chunk_index      INTEGER NOT NULL,
  chunk_text       TEXT NOT NULL,
  contextual_text  TEXT NOT NULL,                                  -- [문맥 문장] + chunk_text
  embedding        VECTOR(1536),                                    -- gemini-embedding-001
  bm25_tokens      TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', contextual_text)) STORED,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,             -- { destination, price_range, season, tags[] }
  content_hash     TEXT,                                            -- 재인덱싱 dedupe 용
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now(),

  UNIQUE (tenant_id, source_type, source_id, chunk_index)
);

-- ─── 인덱스 ────────────────────────────────────────────────────────────
-- 글로벌 (tenant_id IS NULL) 파티셜 HNSW — 공유 카탈로그 조회 최적화
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_shared
  ON jarvis_knowledge_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE tenant_id IS NULL;

-- 전역 HNSW (작은 테넌트 포함). 큰 테넌트는 별도 partial index 추가 권장.
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_all
  ON jarvis_knowledge_chunks USING hnsw (embedding vector_cosine_ops);

-- BM25
CREATE INDEX IF NOT EXISTS idx_chunks_bm25
  ON jarvis_knowledge_chunks USING GIN (bm25_tokens);

-- 필터 보조 인덱스
CREATE INDEX IF NOT EXISTS idx_chunks_tenant_source
  ON jarvis_knowledge_chunks (tenant_id, source_type);
CREATE INDEX IF NOT EXISTS idx_chunks_source_ref
  ON jarvis_knowledge_chunks (source_type, source_id);

-- ─── Hybrid Search RPC (RRF 기반) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION jarvis_hybrid_search(
  p_query_embedding VECTOR(1536),
  p_query_text      TEXT,
  p_tenant_id       UUID  DEFAULT NULL,
  p_source_types    TEXT[] DEFAULT NULL,
  p_limit           INT   DEFAULT 20,
  p_rrf_k           INT   DEFAULT 60
) RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  source_type TEXT,
  source_id UUID,
  source_url TEXT,
  source_title TEXT,
  chunk_text TEXT,
  contextual_text TEXT,
  metadata JSONB,
  vector_score FLOAT,
  bm25_score FLOAT,
  rrf_score FLOAT
)
LANGUAGE sql
STABLE
AS $$
  WITH
  vector_hits AS (
    SELECT
      c.id,
      1 - (c.embedding <=> p_query_embedding) AS score,
      ROW_NUMBER() OVER (ORDER BY c.embedding <=> p_query_embedding) AS rank
    FROM jarvis_knowledge_chunks c
    WHERE (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id OR c.tenant_id IS NULL)
      AND (p_source_types IS NULL OR c.source_type = ANY(p_source_types))
      AND c.embedding IS NOT NULL
    ORDER BY c.embedding <=> p_query_embedding
    LIMIT GREATEST(p_limit * 3, 30)
  ),
  bm25_hits AS (
    SELECT
      c.id,
      ts_rank(c.bm25_tokens, plainto_tsquery('simple', p_query_text)) AS score,
      ROW_NUMBER() OVER (ORDER BY ts_rank(c.bm25_tokens, plainto_tsquery('simple', p_query_text)) DESC) AS rank
    FROM jarvis_knowledge_chunks c
    WHERE (p_tenant_id IS NULL OR c.tenant_id = p_tenant_id OR c.tenant_id IS NULL)
      AND (p_source_types IS NULL OR c.source_type = ANY(p_source_types))
      AND c.bm25_tokens @@ plainto_tsquery('simple', p_query_text)
    LIMIT GREATEST(p_limit * 3, 30)
  )
  SELECT
    c.id,
    c.tenant_id,
    c.source_type,
    c.source_id,
    c.source_url,
    c.source_title,
    c.chunk_text,
    c.contextual_text,
    c.metadata,
    COALESCE(v.score, 0)::float AS vector_score,
    COALESCE(b.score, 0)::float AS bm25_score,
    (COALESCE(1.0 / (p_rrf_k + v.rank), 0) + COALESCE(1.0 / (p_rrf_k + b.rank), 0))::float AS rrf_score
  FROM jarvis_knowledge_chunks c
  LEFT JOIN vector_hits v ON c.id = v.id
  LEFT JOIN bm25_hits   b ON c.id = b.id
  WHERE v.id IS NOT NULL OR b.id IS NOT NULL
  ORDER BY rrf_score DESC NULLS LAST
  LIMIT p_limit
$$;

GRANT EXECUTE ON FUNCTION jarvis_hybrid_search TO authenticated, service_role;

COMMENT ON TABLE jarvis_knowledge_chunks IS
  'Contextual Retrieval — chunk 앞에 Gemini Flash 로 생성한 문맥 prepend. tenant_id NULL = 공유 카탈로그.';
COMMENT ON FUNCTION jarvis_hybrid_search IS
  'Vector + BM25 Hybrid search (RRF). Phase 4 §B.3.2.';
