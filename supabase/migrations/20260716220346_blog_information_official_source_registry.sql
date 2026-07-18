-- Official authority is server-managed. A caller-supplied authority label is
-- never sufficient without an active, reviewed registry entry for the URL host.

BEGIN;

CREATE TABLE public.blog_information_official_source_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname text NOT NULL,
  source_type text NOT NULL,
  authority_level text NOT NULL CHECK (authority_level IN ('official_primary', 'official_secondary')),
  allow_subdomains boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  reviewed_by text NOT NULL,
  reviewed_at timestamptz NOT NULL,
  review_note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blog_information_official_source_registry_hostname_format CHECK (
    hostname = lower(hostname)
    AND hostname = rtrim(hostname, '.')
    AND hostname ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
    AND hostname !~ '\.\.'
  ),
  UNIQUE (hostname, source_type)
);

ALTER TABLE public.blog_information_sources
  ADD COLUMN official_source_registry_id uuid NULL
  REFERENCES public.blog_information_official_source_registry(id) ON DELETE RESTRICT;

ALTER TABLE public.blog_information_source_versions
  ADD COLUMN official_source_registry_id uuid NULL
  REFERENCES public.blog_information_official_source_registry(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.validate_blog_information_official_source_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_registry public.blog_information_official_source_registry%ROWTYPE;
  v_match text[];
  v_hostname text;
BEGIN
  IF NEW.authority_level NOT IN ('official_primary', 'official_secondary') THEN
    IF NEW.official_source_registry_id IS NOT NULL THEN
      RAISE EXCEPTION 'official registry cannot be attached to non-official authority';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.official_source_registry_id IS NULL THEN
    RAISE EXCEPTION 'official authority requires a reviewed source registry entry';
  END IF;

  SELECT * INTO v_registry
  FROM public.blog_information_official_source_registry
  WHERE id = NEW.official_source_registry_id
    AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'official source registry entry is missing or revoked';
  END IF;

  v_match := regexp_match(NEW.source_url, '^[Hh][Tt][Tt][Pp][Ss]://([^/@:?#]+)(?::[0-9]+)?(?:[/?#]|$)');
  v_hostname := lower(rtrim(COALESCE(v_match[1], ''), '.'));
  IF v_hostname = '' OR (
    v_hostname <> v_registry.hostname
    AND NOT (v_registry.allow_subdomains AND v_hostname LIKE '%.' || v_registry.hostname)
  ) THEN
    RAISE EXCEPTION 'source URL hostname does not match reviewed registry entry';
  END IF;
  IF NEW.source_type <> v_registry.source_type OR NEW.authority_level <> v_registry.authority_level THEN
    RAISE EXCEPTION 'source type or authority does not match reviewed registry entry';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER blog_information_source_versions_official_registry_guard
  BEFORE INSERT ON public.blog_information_source_versions
  FOR EACH ROW EXECUTE FUNCTION public.validate_blog_information_official_source_version();

ALTER TABLE public.blog_information_official_source_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blog_information_official_source_registry FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.blog_information_official_source_registry TO service_role;

CREATE POLICY blog_information_official_source_registry_service_select
  ON public.blog_information_official_source_registry FOR SELECT TO service_role USING (true);

REVOKE ALL ON FUNCTION public.validate_blog_information_official_source_version() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_blog_information_official_source_version() TO service_role;

COMMENT ON TABLE public.blog_information_official_source_registry IS
  'Admin-reviewed exact host registry used to derive official authority for informational evidence.';
COMMENT ON COLUMN public.blog_information_source_versions.official_source_registry_id IS
  'Required trust anchor for new official source versions; legacy null rows are not official-trusted.';

COMMIT;
