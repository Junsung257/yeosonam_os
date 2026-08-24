-- Financial allocation is a server-side admin command. Supabase's default
-- routine grants left this invoker function callable by anon/authenticated
-- even though every application call already uses the service-role client.
-- Remove that unused direct-RPC bypass without changing the function body.

BEGIN;

REVOKE ALL ON FUNCTION public.match_bank_transaction_allocations(
  UUID,
  JSONB,
  NUMERIC,
  TEXT,
  TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.match_bank_transaction_allocations(
  UUID,
  JSONB,
  NUMERIC,
  TEXT,
  TEXT
) TO service_role;

COMMIT;
