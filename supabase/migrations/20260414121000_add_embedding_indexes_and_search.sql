-- ============================================================
-- 여소남 OS: 시맨틱 검색 인프라
-- 마이그레이션: 20260414121000
-- 목적:
--   1. travel_packages에 embedding 컬럼 + HNSW 인덱스 추가 (고객 검색 대상)
--   2. customer_facts embedding HNSW 인덱스
--   3. search_travel_packages_semantic RPC (자비스/채팅 툴에서 호출)
--   4. search_customer_facts_semantic RPC (Generative Agents 복합 점수)
-- 전제: 20260414120000 (customer_facts) 이후 실행
-- 주의: products 테이블(internal_code PK)과 혼동 금지 — 고객 응대는 travel_packages(id PK)
-- ============================================================

-- pgvector 확장 확인
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- ── travel_packages.embedding 추가 ──
ALTER TABLE travel_packages
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(1536);

COMMENT ON COLUMN travel_packages.embedding IS
  '시맨틱 검색용 임베딩 (Gemini gemini-embedding-001 @ 1536 dim). /api/cron/embed-products 로 배치 생성.';

-- ── HNSW 인덱스 (travel_packages) ──
CREATE INDEX IF NOT EXISTS idx_travel_packages_embedding_hnsw
  ON travel_packages USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ── HNSW 인덱스 (customer_facts) ──
CREATE INDEX IF NOT EXISTS idx_customer_facts_embedding_hnsw
  ON customer_facts USING hnsw (embedding extensions.vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ============================================================
-- RPC: search_travel_packages_semantic
-- 고객 자연어 질의 임베딩 → TOP-N 유사 상품 (status='active' 필터)
-- tenant_id 지원 (멀티테넌시 대비)
-- ============================================================
CREATE OR REPLACE FUNCTION search_travel_packages_semantic(
  query_embedding extensions.vector(1536),
  match_limit INTEGER DEFAULT 5,
  min_similarity NUMERIC DEFAULT 0.5,
  p_tenant_id UUID DEFAULT NULL
)
RETURNS TABLE (
  package_id UUID,
  title VARCHAR,
  destination VARCHAR,
  price INTEGER,
  duration INTEGER,
  similarity NUMERIC
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    tp.id AS package_id,
    tp.title,
    tp.destination,
    tp.price,
    tp.duration,
    (1 - (tp.embedding <=> query_embedding))::NUMERIC AS similarity
  FROM travel_packages tp
  WHERE tp.embedding IS NOT NULL
    AND COALESCE(tp.status, 'active') IN ('active', 'approved', 'published')
    AND (p_tenant_id IS NULL OR tp.tenant_id = p_tenant_id OR tp.tenant_id IS NULL)
    AND (1 - (tp.embedding <=> query_embedding)) >= min_similarity
  ORDER BY tp.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(match_limit, 50));
$$;

COMMENT ON FUNCTION search_travel_packages_semantic IS
  '시맨틱 상품 검색. travel_packages(고객 응대 대상) 기준. 1 - cosine_distance = similarity. 자비스 툴/채팅 API에서 호출.';

-- ============================================================
-- RPC: search_customer_facts_semantic
-- 현재 대화 컨텍스트로 과거 팩트 회수
-- Generative Agents 공식: importance × similarity × recency
-- ============================================================
CREATE OR REPLACE FUNCTION search_customer_facts_semantic(
  query_embedding extensions.vector(1536),
  p_customer_id UUID DEFAULT NULL,
  p_conversation_id UUID DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL,
  match_limit INTEGER DEFAULT 10,
  min_similarity NUMERIC DEFAULT 0.3
)
RETURNS TABLE (
  fact_id UUID,
  fact_text TEXT,
  category TEXT,
  importance NUMERIC,
  similarity NUMERIC,
  score NUMERIC
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    f.id AS fact_id,
    f.fact_text,
    f.category,
    f.importance,
    (1 - (f.embedding <=> query_embedding))::NUMERIC AS similarity,
    (f.importance
      * (1 - (f.embedding <=> query_embedding))
      * (1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - f.extracted_at)) / 86400.0 / 30.0))
    )::NUMERIC AS score
  FROM customer_facts f
  WHERE f.embedding IS NOT NULL
    AND f.is_active = true
    AND f.superseded_by IS NULL
    AND (p_customer_id IS NULL OR f.customer_id = p_customer_id)
    AND (p_conversation_id IS NULL OR f.conversation_id = p_conversation_id)
    AND (p_tenant_id IS NULL OR f.tenant_id = p_tenant_id)
    AND (1 - (f.embedding <=> query_embedding)) >= min_similarity
  ORDER BY score DESC
  LIMIT GREATEST(1, LEAST(match_limit, 50));
$$;

COMMENT ON FUNCTION search_customer_facts_semantic IS
  'Generative Agents 공식: score = importance × similarity × recency. 현재 대화 컨텍스트로 과거 팩트 회수.';
