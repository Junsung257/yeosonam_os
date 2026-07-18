-- Add the supporting indexes required by the informational-content foreign
-- keys. Each index is built concurrently because these tables are already
-- live in production. Nullable foreign keys use a partial index to keep the
-- index compact while still covering referential checks and joins.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_sources_tenant_id
  ON public.blog_information_sources (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_evidence_tenant_id
  ON public.blog_information_evidence (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_evidence_creative_id
  ON public.blog_information_evidence (creative_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_evidence_source_id
  ON public.blog_information_evidence (source_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_claims_tenant_id
  ON public.blog_information_claims (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_claims_creative_id
  ON public.blog_information_claims (creative_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_source_versions_tenant_id
  ON public.blog_information_source_versions (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_review_cases_tenant_id
  ON public.blog_information_review_cases (tenant_id)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_publications_review_case_id
  ON public.blog_information_publications (review_case_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_publications_representative_key
  ON public.blog_information_publications (representative_key);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_publications_indexing_job_id
  ON public.blog_information_publications (indexing_job_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blog_information_cta_events_representative_key
  ON public.blog_information_cta_events (representative_key);
