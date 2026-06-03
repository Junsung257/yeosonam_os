-- Affiliate promo code hardening:
-- - prevent public/authenticated direct table access
-- - keep server-side APIs on service_role
-- - replace read-modify-write uses_count updates with one atomic RPC

ALTER TABLE IF EXISTS public.affiliate_promo_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.affiliate_promo_codes FROM anon;
REVOKE ALL ON TABLE public.affiliate_promo_codes FROM authenticated;
GRANT ALL ON TABLE public.affiliate_promo_codes TO service_role;

DROP POLICY IF EXISTS affiliate_promo_codes_service_all ON public.affiliate_promo_codes;
CREATE POLICY affiliate_promo_codes_service_all
ON public.affiliate_promo_codes
AS PERMISSIVE
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.increment_affiliate_promo_uses(
  p_promo_code text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_uses integer;
BEGIN
  UPDATE public.affiliate_promo_codes
  SET
    uses_count = COALESCE(uses_count, 0) + 1,
    updated_at = now()
  WHERE code = upper(btrim(p_promo_code))
    AND is_active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (ends_at IS NULL OR ends_at >= now())
    AND (max_uses IS NULL OR COALESCE(uses_count, 0) < max_uses)
  RETURNING uses_count INTO v_uses;

  RETURN v_uses;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_affiliate_promo_uses(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_affiliate_promo_uses(text) TO service_role;

COMMENT ON FUNCTION public.increment_affiliate_promo_uses(text) IS
'Atomically increments affiliate_promo_codes.uses_count for active promo codes without exposing table writes to anon/authenticated clients.';
