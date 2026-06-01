-- Pin search_path for app-owned public functions so SECURITY DEFINER and trigger
-- functions do not resolve objects through an attacker-controlled schema.

ALTER FUNCTION public.claim_queue_items(integer)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.increment_api_key_usage(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.increment(integer)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.increment_login_count(uuid)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.prompt_variant_bucket(text, text[])
  SET search_path = public, pg_temp;

ALTER FUNCTION public.update_attribution_chains_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.update_social_platform_configs_updated_at()
  SET search_path = public, pg_temp;

ALTER FUNCTION public.update_upload_jobs_updated_at()
  SET search_path = public, pg_temp;
