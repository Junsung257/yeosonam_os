-- Persist normalized immutable source content and bind every evidence excerpt
-- to an exact character span. New writes fail closed; legacy nulls stay private.

BEGIN;

ALTER TABLE public.blog_information_source_versions
  ADD COLUMN snapshot_content text NULL;

ALTER TABLE public.blog_information_evidence
  ADD COLUMN span_start integer NULL,
  ADD COLUMN span_end integer NULL;

CREATE OR REPLACE FUNCTION public.validate_blog_information_source_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_normalized text;
  v_hash text;
BEGIN
  v_normalized := btrim(replace(replace(NEW.snapshot_content, E'\r\n', E'\n'), E'\r', E'\n'));
  IF v_normalized IS NULL OR v_normalized = '' OR NEW.snapshot_content <> v_normalized THEN
    RAISE EXCEPTION 'source snapshot must be present and normalized';
  END IF;
  v_hash := encode(extensions.digest(convert_to(NEW.snapshot_content, 'UTF8'), 'sha256'), 'hex');
  IF NEW.content_hash <> v_hash THEN
    RAISE EXCEPTION 'source content hash must be computed from snapshot content';
  END IF;
  IF NEW.retrieved_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'source retrieved_at cannot be in the future';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blog_information_source_versions_snapshot_guard
  BEFORE INSERT ON public.blog_information_source_versions
  FOR EACH ROW EXECUTE FUNCTION public.validate_blog_information_source_snapshot();

CREATE OR REPLACE FUNCTION public.validate_blog_information_evidence_span()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_snapshot text;
  v_verified_at timestamptz;
BEGIN
  SELECT snapshot_content INTO v_snapshot
  FROM public.blog_information_source_versions
  WHERE id = NEW.source_version_id;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'evidence requires an immutable source snapshot';
  END IF;
  IF NEW.span_start IS NULL OR NEW.span_end IS NULL
    OR NEW.span_start < 0 OR NEW.span_end <= NEW.span_start
    OR NEW.span_end > char_length(v_snapshot)
    OR substring(v_snapshot FROM NEW.span_start + 1 FOR NEW.span_end - NEW.span_start) IS DISTINCT FROM NEW.excerpt THEN
    RAISE EXCEPTION 'evidence excerpt must equal its exact source snapshot span';
  END IF;
  IF NEW.observed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'evidence observed_at cannot be in the future';
  END IF;
  IF NEW.scope ? 'verifiedAt' AND NULLIF(NEW.scope ->> 'verifiedAt', '') IS NOT NULL THEN
    BEGIN
      v_verified_at := (NEW.scope ->> 'verifiedAt')::timestamptz;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'evidence scope verifiedAt must be a valid timestamp';
    END;
    IF v_verified_at > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'evidence scope verifiedAt cannot be in the future';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blog_information_evidence_snapshot_span_guard
  BEFORE INSERT OR UPDATE ON public.blog_information_evidence
  FOR EACH ROW EXECUTE FUNCTION public.validate_blog_information_evidence_span();

REVOKE ALL ON FUNCTION public.validate_blog_information_source_snapshot() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_blog_information_evidence_span() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_blog_information_source_snapshot() TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_blog_information_evidence_span() TO service_role;

COMMENT ON COLUMN public.blog_information_source_versions.snapshot_content IS
  'Normalized immutable source content. New versions require a matching server-computed SHA-256 hash.';
COMMENT ON COLUMN public.blog_information_evidence.span_start IS
  'Zero-based inclusive Unicode character offset into the pinned source snapshot.';
COMMENT ON COLUMN public.blog_information_evidence.span_end IS
  'Zero-based exclusive Unicode character offset into the pinned source snapshot.';

COMMIT;
