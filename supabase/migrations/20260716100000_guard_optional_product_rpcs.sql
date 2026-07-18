-- The informational-content remediation intentionally does not reconstruct the
-- product-registration schema. Keep product RPCs only when their complete,
-- independently managed prerequisites are present.

DO $$
DECLARE
  v_function regprocedure;
BEGIN
  IF to_regclass('public.product_prices') IS NULL THEN
    DROP FUNCTION IF EXISTS public.replace_product_prices_for_product(text, jsonb);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'travel_packages'
      AND column_name = 'notices_parsed'
  ) THEN
    FOR v_function IN
      SELECT p.oid::regprocedure
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'publish_package_snapshot_atomic'
    LOOP
      EXECUTE format('DROP FUNCTION %s', v_function);
    END LOOP;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'travel_packages'
      AND column_name = 'description'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'card_news'
      AND column_name = 'product_id'
  ) THEN
    DROP FUNCTION IF EXISTS public.auto_heal_content_gaps(integer);
  END IF;
END;
$$;

COMMENT ON SCHEMA public IS
  'Product registration RPCs are retained only when their separately managed schema prerequisites exist.';
