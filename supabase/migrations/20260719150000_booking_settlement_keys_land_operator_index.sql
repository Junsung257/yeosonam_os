-- The settlement-key table is already live. Build the missing foreign-key
-- support index without blocking production writes.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_booking_settlement_keys_land_operator
  ON public.booking_settlement_keys (land_operator_id)
  WHERE land_operator_id IS NOT NULL;
