-- error_patterns 벡터 검색: IVFFlat → HNSW (jarvis_knowledge_chunks 등과 동일 계열)
-- 소규모 테이블이어도 쿼리 지연·정확도 일관성 개선

DROP INDEX IF EXISTS idx_error_patterns_embedding;

CREATE INDEX IF NOT EXISTS idx_error_patterns_embedding_hnsw
  ON public.error_patterns
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

COMMENT ON INDEX idx_error_patterns_embedding_hnsw IS
  'RAG error_patterns 유사도 검색 — IVFFlat 대비 HNSW';
