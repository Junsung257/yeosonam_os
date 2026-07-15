-- Separate informational source identity from immutable fetch/version snapshots.
-- Product evidence and product snapshots are intentionally outside this namespace.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.blog_information_sources
  ADD COLUMN IF NOT EXISTS site_scope text NOT NULL DEFAULT 'www.yeosonam.com';

ALTER TABLE public.blog_information_sources
  ADD COLUMN IF NOT EXISTS tenant_scope_key text
  GENERATED ALWAYS AS (
    COALESCE(tenant_id::text, 'public') || ':' || lower(site_scope)
  ) STORED;

ALTER TABLE public.blog_information_sources
  DROP CONSTRAINT IF EXISTS blog_information_sources_source_key_key;

ALTER TABLE public.blog_information_sources
  DROP CONSTRAINT IF EXISTS blog_information_sources_tenant_scope_source_key_key;

ALTER TABLE public.blog_information_sources
  ADD CONSTRAINT blog_information_sources_tenant_scope_source_key_key
  UNIQUE (tenant_scope_key, source_key);

CREATE TABLE IF NOT EXISTS public.blog_information_source_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  source_id uuid NOT NULL REFERENCES public.blog_information_sources(id) ON DELETE RESTRICT,
  site_scope text NOT NULL DEFAULT 'www.yeosonam.com',
  version_key char(64) NOT NULL,
  content_hash char(64) NOT NULL,
  source_type text NOT NULL,
  authority_level text NOT NULL CHECK (authority_level IN (
    'official_primary', 'official_secondary', 'editorial_secondary',
    'field_observation', 'internal_reference'
  )),
  source_url text NULL,
  internal_identifier text NULL,
  publisher text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  valid_from timestamptz NULL,
  valid_until timestamptz NULL,
  destination text NULL,
  country text NULL,
  claim_types text[] NOT NULL DEFAULT '{}'::text[],
  risk_level text NOT NULL DEFAULT 'LOW' CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  reviewer_id uuid NULL,
  reviewed_at timestamptz NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blog_information_source_versions_version_key_format
    CHECK (version_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT blog_information_source_versions_content_hash_format
    CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT blog_information_source_versions_locator_required
    CHECK (NULLIF(btrim(source_url), '') IS NOT NULL OR NULLIF(btrim(internal_identifier), '') IS NOT NULL),
  CONSTRAINT blog_information_source_versions_valid_window
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  CONSTRAINT blog_information_source_versions_review_pair
    CHECK (
      (reviewer_id IS NULL AND reviewed_at IS NULL)
      OR (reviewer_id IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
  UNIQUE (source_id, version_key)
);

WITH legacy_versions AS (
  SELECT
    s.*,
    CASE
      WHEN COALESCE(s.metadata ->> 'content_hash', '') ~ '^[0-9a-fA-F]{64}$'
        THEN lower(s.metadata ->> 'content_hash')
      ELSE encode(extensions.digest(concat_ws(E'\n', s.source_url, s.internal_identifier, s.publisher), 'sha256'), 'hex')
    END AS backfill_content_hash
  FROM public.blog_information_sources s
)
INSERT INTO public.blog_information_source_versions (
  tenant_id, source_id, site_scope, version_key, content_hash,
  source_type, authority_level, source_url, internal_identifier, publisher,
  retrieved_at, valid_from, valid_until, destination, country, claim_types,
  risk_level, reviewer_id, reviewed_at, status, metadata
)
SELECT
  s.tenant_id,
  s.id,
  s.site_scope,
  encode(extensions.digest(concat_ws(E'\n', s.source_key, COALESCE(s.source_url, s.internal_identifier, ''), s.retrieved_at::text, s.backfill_content_hash), 'sha256'), 'hex'),
  s.backfill_content_hash,
  s.source_type,
  s.authority_level,
  s.source_url,
  s.internal_identifier,
  s.publisher,
  s.retrieved_at,
  s.valid_from,
  s.valid_until,
  s.destination,
  s.country,
  s.claim_types,
  s.risk_level,
  s.reviewer_id,
  s.reviewed_at,
  s.status,
  s.metadata || jsonb_build_object('legacy_backfill', true)
FROM legacy_versions s
ON CONFLICT (source_id, version_key) DO NOTHING;

ALTER TABLE public.blog_information_evidence
  ADD COLUMN IF NOT EXISTS source_version_id uuid NULL
  REFERENCES public.blog_information_source_versions(id) ON DELETE RESTRICT;

ALTER TABLE public.blog_information_evidence
  ADD COLUMN IF NOT EXISTS logical_evidence_key text;

UPDATE public.blog_information_evidence
SET logical_evidence_key = evidence_key
WHERE logical_evidence_key IS NULL;

ALTER TABLE public.blog_information_evidence
  ALTER COLUMN logical_evidence_key SET NOT NULL;

UPDATE public.blog_information_evidence e
SET source_version_id = v.id
FROM public.blog_information_source_versions v
WHERE e.source_version_id IS NULL
  AND v.source_id = e.source_id
  AND (v.metadata ->> 'legacy_backfill')::boolean IS TRUE;

ALTER TABLE public.blog_information_evidence
  DROP CONSTRAINT IF EXISTS blog_information_evidence_content_key_evidence_key_key;

ALTER TABLE public.blog_information_evidence
  DROP CONSTRAINT IF EXISTS blog_information_evidence_content_logical_source_version_key;

ALTER TABLE public.blog_information_evidence
  ADD CONSTRAINT blog_information_evidence_content_logical_source_version_key
  UNIQUE (content_key, logical_evidence_key, source_version_id);

CREATE UNIQUE INDEX IF NOT EXISTS blog_information_evidence_legacy_logical_key
  ON public.blog_information_evidence (content_key, logical_evidence_key)
  WHERE source_version_id IS NULL;

CREATE OR REPLACE FUNCTION public.reject_blog_information_source_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'blog_information_source_versions are immutable';
END;
$$;

DROP TRIGGER IF EXISTS blog_information_source_versions_immutable
  ON public.blog_information_source_versions;
CREATE TRIGGER blog_information_source_versions_immutable
  BEFORE UPDATE OR DELETE ON public.blog_information_source_versions
  FOR EACH ROW EXECUTE FUNCTION public.reject_blog_information_source_version_mutation();

ALTER TABLE public.blog_information_source_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.blog_information_source_versions FROM public, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.blog_information_source_versions TO service_role;

DROP POLICY IF EXISTS blog_information_source_versions_service_select
  ON public.blog_information_source_versions;
CREATE POLICY blog_information_source_versions_service_select
  ON public.blog_information_source_versions FOR SELECT TO service_role USING (true);

DROP POLICY IF EXISTS blog_information_source_versions_service_insert
  ON public.blog_information_source_versions;
CREATE POLICY blog_information_source_versions_service_insert
  ON public.blog_information_source_versions FOR INSERT TO service_role WITH CHECK (true);

REVOKE ALL ON FUNCTION public.reject_blog_information_source_version_mutation() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_blog_information_source_version_mutation() TO service_role;

COMMENT ON TABLE public.blog_information_source_versions IS
  'Immutable information-only source fetch snapshots. Claims pin evidence rows that pin one source version.';
COMMENT ON COLUMN public.blog_information_evidence.source_version_id IS
  'Specific immutable source fetch/version used by this evidence span; legacy nulls remain private until backfilled.';

COMMIT;
