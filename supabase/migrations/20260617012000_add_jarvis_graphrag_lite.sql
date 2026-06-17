-- GraphRAG-lite support for Jarvis RAG.
-- Stores lightweight entities and chunk links so retrieval can later expand
-- by destination, policy intent, channel, product, and source clusters.

CREATE TABLE IF NOT EXISTS public.jarvis_knowledge_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN (
    'destination',
    'policy_intent',
    'channel',
    'product',
    'source_type'
  )),
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  occurrence_count integer NOT NULL DEFAULT 0 CHECK (occurrence_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'jarvis_knowledge_entities_unique_name'
      AND conrelid = 'public.jarvis_knowledge_entities'::regclass
  ) THEN
    ALTER TABLE public.jarvis_knowledge_entities
      ADD CONSTRAINT jarvis_knowledge_entities_unique_name
      UNIQUE NULLS NOT DISTINCT (tenant_id, entity_type, normalized_name);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.jarvis_knowledge_entity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES public.jarvis_knowledge_entities(id) ON DELETE CASCADE,
  chunk_id uuid NOT NULL REFERENCES public.jarvis_knowledge_chunks(id) ON DELETE CASCADE,
  relation text NOT NULL DEFAULT 'mentions',
  confidence numeric(4,3) NOT NULL DEFAULT 0.700 CHECK (confidence >= 0 AND confidence <= 1),
  evidence_text text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, chunk_id, relation)
);

CREATE INDEX IF NOT EXISTS jarvis_knowledge_entities_type_name_idx
  ON public.jarvis_knowledge_entities (entity_type, normalized_name);

CREATE INDEX IF NOT EXISTS jarvis_knowledge_entity_links_chunk_idx
  ON public.jarvis_knowledge_entity_links (chunk_id);

CREATE INDEX IF NOT EXISTS jarvis_knowledge_entity_links_entity_idx
  ON public.jarvis_knowledge_entity_links (entity_id);

CREATE OR REPLACE FUNCTION public.refresh_jarvis_knowledge_entity_counts()
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  UPDATE public.jarvis_knowledge_entities e
  SET
    occurrence_count = COALESCE(link_counts.count, 0),
    updated_at = now()
  FROM (
    SELECT entity_id, count(*)::integer AS count
    FROM public.jarvis_knowledge_entity_links
    GROUP BY entity_id
  ) link_counts
  WHERE e.id = link_counts.entity_id;

  UPDATE public.jarvis_knowledge_entities e
  SET
    occurrence_count = 0,
    updated_at = now()
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.jarvis_knowledge_entity_links l
    WHERE l.entity_id = e.id
  );
$$;

ALTER TABLE public.jarvis_knowledge_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jarvis_knowledge_entity_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.jarvis_knowledge_entities FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.jarvis_knowledge_entity_links FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_knowledge_entities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.jarvis_knowledge_entity_links TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_jarvis_knowledge_entity_counts() TO service_role;

COMMENT ON TABLE public.jarvis_knowledge_entities IS
  'Lightweight GraphRAG entities extracted from Jarvis knowledge chunks.';

COMMENT ON TABLE public.jarvis_knowledge_entity_links IS
  'Links Jarvis RAG chunks to GraphRAG-lite entities for graph expansion and diagnostics.';
