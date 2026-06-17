-- Harden Jarvis RAG chunk uniqueness for shared tenant_id NULL rows.
-- PostgreSQL's normal UNIQUE treats NULL values as distinct, which allowed
-- duplicate shared chunks. Keep the newest row per logical source chunk.

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY tenant_id, source_type, source_id, chunk_index
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.jarvis_knowledge_chunks
)
DELETE FROM public.jarvis_knowledge_chunks c
USING ranked r
WHERE c.id = r.id
  AND r.rn > 1;

ALTER TABLE public.jarvis_knowledge_chunks
  DROP CONSTRAINT IF EXISTS jarvis_knowledge_chunks_tenant_id_source_type_source_id_chu_key;

ALTER TABLE public.jarvis_knowledge_chunks
  ADD CONSTRAINT jarvis_knowledge_chunks_unique_source_chunk
  UNIQUE NULLS NOT DISTINCT (tenant_id, source_type, source_id, chunk_index);
