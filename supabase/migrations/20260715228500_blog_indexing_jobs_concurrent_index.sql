-- blog_indexing_jobs is an existing public-outbox table. The idempotency
-- column is added by the preceding atomic-publication migration; build the
-- partial uniqueness index concurrently before any information publish runs.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_indexing_jobs_idempotency_key
  ON public.blog_indexing_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
