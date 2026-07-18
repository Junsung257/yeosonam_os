-- Build replay-safe indexes on the evidence table. Supabase CLI applies migration
-- files through a pipeline, where CREATE INDEX CONCURRENTLY is not supported.

CREATE UNIQUE INDEX IF NOT EXISTS blog_information_evidence_content_logical_source_version_key
  ON public.blog_information_evidence (content_key, logical_evidence_key, source_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS blog_information_evidence_legacy_logical_key
  ON public.blog_information_evidence (content_key, logical_evidence_key)
  WHERE source_version_id IS NULL;
