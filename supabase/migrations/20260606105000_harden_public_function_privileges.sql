-- Harden public schema functions before launch.
-- Server APIs use the service role for these paths; browser roles must not be
-- able to execute maintenance/security-definer functions through PostgREST RPC.

ALTER FUNCTION public.update_trend_style_fingerprints_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.fill_product_prices_adult_selling_price()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.upsert_unmatched_activity(text, uuid, text, integer, text, text)
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.upsert_unmatched_activity(text, uuid, text, integer, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_unmatched_activity(text, uuid, text, integer, text, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_trend_style_fingerprints_updated_at()
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.fill_product_prices_adult_selling_price()
  FROM PUBLIC, anon, authenticated;
