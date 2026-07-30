-- The product review screen approves only the internal ERP catalogue row.
-- Customer publication remains exclusively owned by publish_package_snapshot_atomic().
-- These columns existed in the legacy production baseline but were missing from
-- the replayable migration chain; IF NOT EXISTS makes the contract explicit.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS supplier_name varchar,
  ADD COLUMN IF NOT EXISTS thumbnail_urls text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS land_operator_id uuid
    REFERENCES public.land_operators(id) ON DELETE SET NULL;

ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_status_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_status_check
  CHECK (status IN (
    'draft', 'active', 'expired', 'cancelled',
    'DRAFT', 'REVIEW_NEEDED', 'ACTIVE', 'INACTIVE'
  ));

DROP FUNCTION IF EXISTS public.approve_reviewed_product(text, text[], uuid, text, text);

CREATE OR REPLACE FUNCTION public.approve_reviewed_erp_product(
  p_product_id text,
  p_thumbnail_urls text[] DEFAULT '{}'::text[],
  p_resolved_supplier_id uuid DEFAULT NULL,
  p_resolved_supplier_name text DEFAULT NULL,
  p_resolved_supplier_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_product_count integer := 0;
BEGIN
  IF NULLIF(btrim(p_product_id), '') IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = '22023';
  END IF;

  -- Serialize approvals for the same internal code and make retries deterministic.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_product_id, 0));

  UPDATE public.products
  SET
    status = 'ACTIVE',
    thumbnail_urls = COALESCE(p_thumbnail_urls, '{}'::text[]),
    supplier_name = CASE
      WHEN p_resolved_supplier_id IS NOT NULL AND NULLIF(btrim(p_resolved_supplier_name), '') IS NOT NULL
        THEN p_resolved_supplier_name
      ELSE supplier_name
    END,
    land_operator_id = CASE
      WHEN p_resolved_supplier_id IS NOT NULL AND NULLIF(btrim(p_resolved_supplier_name), '') IS NOT NULL
        THEN p_resolved_supplier_id
      ELSE land_operator_id
    END,
    supplier_code = CASE
      WHEN p_resolved_supplier_id IS NOT NULL
        AND NULLIF(btrim(p_resolved_supplier_name), '') IS NOT NULL
        AND NULLIF(btrim(p_resolved_supplier_code), '') IS NOT NULL
        THEN p_resolved_supplier_code
      ELSE supplier_code
    END,
    updated_at = now()
  WHERE internal_code = p_product_id;
  GET DIAGNOSTICS v_product_count = ROW_COUNT;

  IF v_product_count <> 1 THEN
    RAISE EXCEPTION 'review_product_not_found:%', p_product_id USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'product_id', p_product_id,
    'products_updated', v_product_count,
    'product_status', 'ACTIVE',
    'customer_publication_state', 'unchanged'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_reviewed_erp_product(text, text[], uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_reviewed_erp_product(text, text[], uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.approve_reviewed_erp_product(text, text[], uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.approve_reviewed_erp_product(text, text[], uuid, text, text) TO service_role;
GRANT SELECT, UPDATE ON TABLE public.products TO service_role;

COMMENT ON FUNCTION public.approve_reviewed_erp_product(text, text[], uuid, text, text) IS
  'Activates the internal ERP product only. Customer publication must pass publish_package_snapshot_atomic().' ;
