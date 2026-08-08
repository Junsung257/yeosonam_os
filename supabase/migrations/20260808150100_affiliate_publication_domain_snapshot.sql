BEGIN;

-- A PUBLISHED web publication must retain the exact verified domain used for
-- the decision. This is evidence, not a live re-check performed by analytics.
CREATE OR REPLACE FUNCTION public.bind_affiliate_publication_verified_domain_v2(
  p_affiliate_id uuid,
  p_publication_id uuid,
  p_domain_id uuid
)
RETURNS public.affiliate_publications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_publication public.affiliate_publications%ROWTYPE;
BEGIN
  SELECT * INTO v_publication
  FROM public.affiliate_publications
  WHERE id = p_publication_id AND affiliate_id = p_affiliate_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PUBLICATION_NOT_FOUND'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.affiliate_domains
    WHERE id = p_domain_id
      AND affiliate_id = p_affiliate_id
      AND verification_status = 'VERIFIED'
  ) THEN
    RAISE EXCEPTION 'VERIFIED_DOMAIN_REQUIRED';
  END IF;

  UPDATE public.affiliate_publications
  SET verified_domain_id = p_domain_id, updated_at = now()
  WHERE id = p_publication_id
  RETURNING * INTO v_publication;
  RETURN v_publication;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bind_affiliate_publication_verified_domain_v2(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bind_affiliate_publication_verified_domain_v2(uuid, uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.bind_affiliate_publication_verified_domain_v2(uuid, uuid, uuid) IS
  'Binds an owner-scoped, currently verified domain to a partner publication as immutable publication evidence.';

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Reversible rollback before publication evidence is relied upon:
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.bind_affiliate_publication_verified_domain_v2(uuid, uuid, uuid);
-- COMMIT;
