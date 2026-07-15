-- Build indexes on the pre-existing evidence table without blocking writers.
-- This file must remain outside an explicit transaction because Postgres
-- forbids CREATE INDEX CONCURRENTLY inside a transaction block.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS blog_information_evidence_content_logical_source_version_key
  ON public.blog_information_evidence (content_key, logical_evidence_key, source_version_id);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS blog_information_evidence_legacy_logical_key
  ON public.blog_information_evidence (content_key, logical_evidence_key)
  WHERE source_version_id IS NULL;
