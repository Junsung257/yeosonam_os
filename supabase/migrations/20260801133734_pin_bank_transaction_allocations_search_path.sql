-- Pin the search_path for the service-role-only bank allocation RPC.
-- Production evidence: Supabase Advisor WARN 0011 and pg_proc.proconfig = NULL.
-- Apply only through the normal migration workflow after non-production review.

ALTER FUNCTION public.match_bank_transaction_allocations(
  uuid,
  jsonb,
  numeric,
  text,
  text
)
SET search_path = public, pg_catalog;
