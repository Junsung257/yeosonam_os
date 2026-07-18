-- Existing-table index must be created outside a transaction to avoid blocking
-- Band import writers while the index is built.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_band_import_log_product_internal_code
  ON public.band_import_log(product_internal_code)
  WHERE product_internal_code IS NOT NULL;
