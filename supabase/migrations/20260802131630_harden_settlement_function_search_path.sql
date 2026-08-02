-- Settlement RPCs run only against trusted built-in and application schemas.
ALTER FUNCTION public.match_bank_transaction_allocations(UUID, JSONB, NUMERIC, TEXT, TEXT)
  SET search_path = pg_catalog, public;

ALTER FUNCTION public.repair_legacy_bank_transaction_allocation(UUID, UUID, TEXT, TEXT)
  SET search_path = pg_catalog, public;
