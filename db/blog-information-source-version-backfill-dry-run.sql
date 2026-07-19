-- READ-ONLY dry run for informational source version migration.
-- This file contains no mutation statements.

SELECT
  COUNT(*) AS legacy_source_identities,
  COUNT(*) FILTER (WHERE COALESCE(metadata ->> 'content_hash', '') !~ '^[0-9a-fA-F]{64}$') AS derived_hash_candidates,
  COUNT(*) FILTER (WHERE NULLIF(btrim(source_url), '') IS NULL AND NULLIF(btrim(internal_identifier), '') IS NULL) AS missing_locator
FROM public.blog_information_sources;

SELECT
  COALESCE(tenant_id::text, 'public') AS tenant_scope,
  'www.yeosonam.com' AS predicted_site_scope,
  source_key,
  COUNT(*) AS identity_count
FROM public.blog_information_sources
GROUP BY 1, 2, 3
HAVING COUNT(*) > 1;

SELECT
  COUNT(*) AS legacy_evidence_rows,
  COUNT(*) FILTER (WHERE s.id IS NULL) AS evidence_missing_source_identity,
  COUNT(*) FILTER (WHERE NULLIF(btrim(e.evidence_key), '') IS NULL) AS evidence_missing_logical_key_candidate
FROM public.blog_information_evidence e
LEFT JOIN public.blog_information_sources s ON s.id = e.source_id;
