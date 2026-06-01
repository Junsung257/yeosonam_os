-- Revoke direct client execution from server-only SECURITY DEFINER RPCs.
--
-- These functions are called through trusted server routes with supabaseAdmin
-- or are trigger/cron/internal helpers. Keeping EXECUTE on PUBLIC means anon
-- and authenticated users can invoke SECURITY DEFINER functions directly via
-- PostgREST RPC. We remove client execution and keep service_role explicit.

DO $$
DECLARE
  function_signatures text[] := ARRAY[
    'public.claim_queue_items(integer)',
    'public.cleanup_expired_magic_tokens(integer)',
    'public.fn_attractions_normalize()',
    'public.generate_predictive_insights()',
    'public.get_critique_counts_since(text)',
    'public.get_destinations_aggregate()',
    'public.get_personalized_by_destination(uuid, text)',
    'public.get_simple_recommendations(uuid)',
    'public.get_trending_packages()',
    'public.increment_affiliate_booking_count(uuid, integer)',
    'public.increment_api_key_usage(uuid)',
    'public.increment_customer_mileage(uuid, integer)',
    'public.increment_package_inquiry_count(uuid)',
    'public.increment_package_view_count(uuid)',
    'public.increment_unmatched_count(text, uuid, text, integer, text)',
    'public.lookup_semantic_cache(text, text, extensions.vector, double precision)',
    'public.prewarm_vector_indexes()',
    'public.recompute_rfm_scores()',
    'public.refresh_attribution_summary()',
    'public.refresh_daily_registration_stats()',
    'public.update_customer_profile_on_booking()'
  ];
  function_signature text;
  function_regproc regprocedure;
BEGIN
  FOREACH function_signature IN ARRAY function_signatures LOOP
    function_regproc := to_regprocedure(function_signature);

    IF function_regproc IS NULL THEN
      RAISE NOTICE 'Skipping missing function %', function_signature;
      CONTINUE;
    END IF;

    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      function_regproc
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      function_regproc
    );
  END LOOP;
END $$;
