-- Product registration V3 may be deployed from a parallel branch. Harden the
-- trigger function when it is already present, while keeping fresh main
-- migrations valid before that feature migration lands.

DO $$
BEGIN
  IF to_regprocedure('public.set_product_registration_drafts_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.set_product_registration_drafts_updated_at()
      SET search_path = public, pg_temp;
  END IF;
END $$;
