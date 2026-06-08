-- Restrict itinerary entity queue RPC execution to service_role only.
-- The function is SECURITY DEFINER, so anon/authenticated must not call it.

REVOKE ALL ON FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT
) TO service_role;
