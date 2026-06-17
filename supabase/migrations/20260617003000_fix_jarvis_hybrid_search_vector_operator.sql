-- Fix Jarvis hybrid RAG vector operator resolution.
--
-- Production vector extension lives in the `extensions` schema. The previous
-- function search_path omitted `extensions`, so `<=>` failed at runtime.
-- Keep execution restricted to service_role and avoid SECURITY DEFINER.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

DROP FUNCTION IF EXISTS public.jarvis_hybrid_search(extensions.vector, text, uuid, text[], integer);

CREATE OR REPLACE FUNCTION public.jarvis_hybrid_search(
  p_query_embedding extensions.vector(1536),
  p_query_text      text,
  p_tenant_id       uuid DEFAULT NULL,
  p_source_types    text[] DEFAULT NULL,
  p_limit           integer DEFAULT 10
) RETURNS TABLE (
  id uuid,
  tenant_id uuid,
  source_type text,
  source_id uuid,
  source_url text,
  source_title text,
  chunk_text text,
  contextual_text text,
  metadata jsonb,
  vector_score double precision,
  bm25_score double precision,
  rrf_score double precision
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  rrf_k integer := 60;
  query_tsq tsquery;
BEGIN
  query_tsq := plainto_tsquery('simple', COALESCE(p_query_text, ''));

  RETURN QUERY
  WITH
    scope AS (
      SELECT *
      FROM public.jarvis_knowledge_chunks c
      WHERE
        (p_tenant_id IS NULL AND c.tenant_id IS NULL)
        OR (p_tenant_id IS NOT NULL AND (c.tenant_id = p_tenant_id OR c.tenant_id IS NULL))
    ),
    filtered AS (
      SELECT *
      FROM scope c
      WHERE p_source_types IS NULL OR c.source_type = ANY(p_source_types)
    ),
    vec AS (
      SELECT
        c.id,
        1 - (c.embedding OPERATOR(extensions.<=>) p_query_embedding) AS sim,
        ROW_NUMBER() OVER (ORDER BY c.embedding OPERATOR(extensions.<=>) p_query_embedding) AS rank
      FROM filtered c
      WHERE p_query_embedding IS NOT NULL
        AND c.embedding IS NOT NULL
      ORDER BY c.embedding OPERATOR(extensions.<=>) p_query_embedding
      LIMIT GREATEST(p_limit * 4, 30)
    ),
    bm AS (
      SELECT
        c.id,
        ts_rank(c.bm25_tokens, query_tsq) AS rank_score,
        ROW_NUMBER() OVER (ORDER BY ts_rank(c.bm25_tokens, query_tsq) DESC) AS rank
      FROM filtered c
      WHERE query_tsq <> ''::tsquery
        AND c.bm25_tokens @@ query_tsq
      ORDER BY ts_rank(c.bm25_tokens, query_tsq) DESC
      LIMIT GREATEST(p_limit * 4, 30)
    ),
    fused AS (
      SELECT
        c.id,
        COALESCE(vec.sim, 0)::double precision AS vector_score,
        COALESCE(bm.rank_score, 0)::double precision AS bm25_score,
        COALESCE(1.0 / (rrf_k + vec.rank), 0)::double precision +
        COALESCE(1.0 / (rrf_k + bm.rank), 0)::double precision AS rrf_score
      FROM filtered c
      LEFT JOIN vec ON vec.id = c.id
      LEFT JOIN bm ON bm.id = c.id
      WHERE vec.id IS NOT NULL OR bm.id IS NOT NULL
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
    f.vector_score,
    f.bm25_score,
    f.rrf_score
  FROM fused f
  JOIN public.jarvis_knowledge_chunks c ON c.id = f.id
  ORDER BY f.rrf_score DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.jarvis_hybrid_search(extensions.vector, text, uuid, text[], integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.jarvis_hybrid_search(extensions.vector, text, uuid, text[], integer) FROM anon;
REVOKE ALL ON FUNCTION public.jarvis_hybrid_search(extensions.vector, text, uuid, text[], integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.jarvis_hybrid_search(extensions.vector, text, uuid, text[], integer) TO service_role;

COMMENT ON FUNCTION public.jarvis_hybrid_search(extensions.vector, text, uuid, text[], integer) IS
  'Server-side Jarvis RAG hybrid search. Uses explicit pgvector operators in extensions schema and is restricted to service_role.';
