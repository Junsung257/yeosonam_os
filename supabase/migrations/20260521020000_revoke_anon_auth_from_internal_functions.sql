-- ============================================================================
-- Revoke EXECUTE on internal/admin functions from PUBLIC when they exist.
-- ============================================================================
-- Some historical functions are absent in a clean replay. Keep the hardening
-- effect for existing functions without making clean/staging bootstrap fail.

CREATE OR REPLACE FUNCTION public.revoke_public_execute_if_function_exists(
  p_function_signature text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_function oid;
BEGIN
  BEGIN
    v_function := to_regprocedure(p_function_signature);
  EXCEPTION WHEN undefined_object THEN
    RAISE NOTICE 'Skipping EXECUTE revoke for %, signature cannot be resolved', p_function_signature;
    RETURN;
  END;

  IF v_function IS NULL THEN
    RAISE NOTICE 'Skipping EXECUTE revoke for %, function does not exist', p_function_signature;
    RETURN;
  END IF;

  EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', v_function::regprocedure);
END;
$$;

SELECT public.revoke_public_execute_if_function_exists(function_signature)
FROM (
  VALUES
    ('public.get_admin_badge_counts()'),
    ('public.get_unmatched_summary(integer)'),
    ('public.merge_customer_tags(uuid[], text)'),
    ('public.refresh_mv_destination_aggregates()'),
    ('public.resync_paid_amounts()'),
    ('public.cleanup_expired_semantic_cache()'),
    ('public.calculate_rfm_scores()'),
    ('public.track_price_changes()'),
    ('public.bump_customer_facts_access(uuid[])'),
    ('public.jarvis_hybrid_search(vector, text, uuid, text[], integer)'),
    ('public.jarvis_hybrid_search(vector, text, uuid, text[], integer, integer)'),
    ('public.set_jarvis_request_context(uuid, text, uuid)'),
    ('public.increment_semantic_cache_hit(uuid)')
) AS planned(function_signature);

DROP FUNCTION public.revoke_public_execute_if_function_exists(text);
