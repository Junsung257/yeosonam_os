BEGIN;

REVOKE ALL ON FUNCTION public.replace_product_prices_for_product(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.replace_product_prices_for_product(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_product_prices_for_product(text, jsonb) TO service_role;

DROP POLICY IF EXISTS product_registration_section_jobs_service_role_all
  ON public.product_registration_section_jobs;

CREATE POLICY product_registration_section_jobs_service_role_all
  ON public.product_registration_section_jobs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;
