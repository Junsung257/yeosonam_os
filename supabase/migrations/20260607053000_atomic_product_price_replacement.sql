BEGIN;

CREATE OR REPLACE FUNCTION public.replace_product_prices_for_product(
  p_product_id text,
  p_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row jsonb;
  v_saved integer := 0;
BEGIN
  IF p_product_id IS NULL OR btrim(p_product_id) = '' THEN
    RAISE EXCEPTION 'product_id is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('product_prices:' || p_product_id, 0));

  PERFORM 1
  FROM public.products
  WHERE internal_code = p_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product not found: %', p_product_id;
  END IF;

  DELETE FROM public.product_prices
  WHERE product_id = p_product_id;

  FOR v_row IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_rows, '[]'::jsonb))
  LOOP
    INSERT INTO public.product_prices (
      product_id,
      target_date,
      day_of_week,
      net_price,
      adult_selling_price,
      child_price,
      note
    )
    VALUES (
      p_product_id,
      NULLIF(v_row->>'target_date', '')::date,
      NULLIF(v_row->>'day_of_week', ''),
      COALESCE(NULLIF(v_row->>'net_price', '')::numeric, 0),
      COALESCE(
        NULLIF(v_row->>'adult_selling_price', '')::numeric,
        NULLIF(v_row->>'net_price', '')::numeric,
        0
      ),
      NULLIF(v_row->>'child_price', '')::numeric,
      NULLIF(v_row->>'note', '')
    );
    v_saved := v_saved + 1;
  END LOOP;

  RETURN v_saved;
END;
$$;

COMMENT ON FUNCTION public.replace_product_prices_for_product(text, jsonb) IS
  'Atomically replaces all product_prices rows for one products.internal_code under a per-product advisory transaction lock.';

REVOKE ALL ON FUNCTION public.replace_product_prices_for_product(text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.replace_product_prices_for_product(text, jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_product_prices_for_product(text, jsonb) TO service_role;

COMMIT;
