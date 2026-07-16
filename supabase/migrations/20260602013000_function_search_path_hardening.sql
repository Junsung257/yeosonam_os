-- Pin search_path for app-owned public functions so SECURITY DEFINER and trigger
-- functions do not resolve objects through an attacker-controlled schema.

DO $$
DECLARE
  function_signature TEXT;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.claim_queue_items(integer)',
    'public.increment_api_key_usage(uuid)',
    'public.increment(integer)',
    'public.increment_login_count(uuid)',
    'public.prompt_variant_bucket(text,text[])',
    'public.update_attribution_chains_updated_at()',
    'public.update_social_platform_configs_updated_at()',
    'public.update_upload_jobs_updated_at()'
  ]
  LOOP
    IF to_regprocedure(function_signature) IS NOT NULL THEN
      EXECUTE format(
        'ALTER FUNCTION %s SET search_path = public, pg_temp',
        function_signature
      );
    END IF;
  END LOOP;
END
$$;
