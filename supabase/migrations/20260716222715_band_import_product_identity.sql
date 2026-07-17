-- Band imports create rows in public.products, whose primary key is
-- internal_code (text). Keep the legacy travel_packages UUID reference
-- explicit and add a separate products reference; never overload product_id.

BEGIN;

ALTER TABLE public.band_import_log
  ADD COLUMN product_internal_code varchar NULL
  REFERENCES public.products(internal_code) ON DELETE SET NULL;

ALTER TABLE public.band_import_log
  ADD CONSTRAINT band_import_log_entity_reference_unambiguous CHECK (
    NOT (product_id IS NOT NULL AND product_internal_code IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION public.import_band_product_atomically(
  p_product jsonb,
  p_log jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_internal_code text := NULLIF(btrim(p_product ->> 'internal_code'), '');
  v_display_name text := NULLIF(btrim(p_product ->> 'display_name'), '');
  v_departure_region text := COALESCE(NULLIF(btrim(p_product ->> 'departure_region'), ''), '부산');
  v_supplier_code text := NULLIF(btrim(p_product ->> 'supplier_code'), '');
  v_net_price integer;
  v_margin_rate numeric;
  v_departure_date timestamptz;
  v_ai_tags text[] := '{}'::text[];
  v_post_url text := NULLIF(btrim(p_log ->> 'post_url'), '');
BEGIN
  IF v_internal_code IS NULL OR v_display_name IS NULL OR v_supplier_code IS NULL THEN
    RAISE EXCEPTION 'Band product identity, display name, and supplier are required';
  END IF;
  BEGIN
    v_net_price := (p_product ->> 'net_price')::integer;
    v_margin_rate := COALESCE((p_product ->> 'margin_rate')::numeric, 0.10);
    v_departure_date := NULLIF(p_product ->> 'departure_date', '')::timestamptz;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'Band product price, margin, or departure date is invalid';
  END;
  IF v_net_price IS NULL OR v_net_price <= 0 THEN
    RAISE EXCEPTION 'Band product net price must be positive';
  END IF;
  IF jsonb_typeof(p_product -> 'ai_tags') = 'array' THEN
    SELECT COALESCE(array_agg(value), '{}'::text[]) INTO v_ai_tags
    FROM jsonb_array_elements_text(p_product -> 'ai_tags') AS value;
  END IF;

  INSERT INTO public.products (
    internal_code, display_name, departure_region, supplier_code,
    departure_date, net_price, margin_rate, discount_amount,
    ai_tags, status, source_filename
  ) VALUES (
    v_internal_code, v_display_name, v_departure_region, v_supplier_code,
    v_departure_date, v_net_price, v_margin_rate, 0,
    v_ai_tags, 'draft', NULLIF(btrim(p_product ->> 'source_filename'), '')
  );

  IF v_post_url IS NOT NULL THEN
    INSERT INTO public.band_import_log (
      post_url, post_title, raw_text, product_internal_code, status
    ) VALUES (
      v_post_url,
      NULLIF(btrim(p_log ->> 'post_title'), ''),
      NULLIF(p_log ->> 'raw_text', ''),
      v_internal_code,
      'imported'
    );
  END IF;

  RETURN v_internal_code;
END;
$$;

ALTER TABLE public.band_import_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.band_import_log FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.band_import_log TO service_role;
DROP POLICY IF EXISTS band_import_log_service_role ON public.band_import_log;
CREATE POLICY band_import_log_service_role
  ON public.band_import_log FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON FUNCTION public.import_band_product_atomically(jsonb, jsonb)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_band_product_atomically(jsonb, jsonb)
  TO service_role;

COMMENT ON COLUMN public.band_import_log.product_id IS
  'Legacy explicit reference to travel_packages.id; never stores products.internal_code.';
COMMENT ON COLUMN public.band_import_log.product_internal_code IS
  'Explicit reference to products.internal_code for Band-created product rows.';
COMMENT ON FUNCTION public.import_band_product_atomically(jsonb, jsonb) IS
  'Creates a products row and its Band audit log in one database transaction.';

COMMIT;
