-- Follow-up hardening after the raw-label unmatched RPC was prepared locally.
-- Existing remote grants can survive REVOKE ... FROM PUBLIC when anon or
-- authenticated were granted explicitly, so revoke those roles directly as well.

ALTER FUNCTION public.touch_entity_master_candidates_updated_at()
  SET search_path = public;

ALTER FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT
) SET search_path = public;

REVOKE ALL ON FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT
) TO service_role;

ALTER FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT, TEXT
) SET search_path = public;

REVOKE ALL ON FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT, TEXT
) TO service_role;
