-- ============================================================================
-- Drop authenticated-wide `admin_all_*` policies on ad_* / creative_* tables.
-- ============================================================================
-- The original policy cleanup assumed every ad/creative legacy table existed.
-- Make the security cleanup replay-safe: apply it when the table exists, and
-- skip retired tables in clean environments.

CREATE OR REPLACE FUNCTION public.replace_with_service_role_policy_if_table_exists(
  p_table_name text,
  p_legacy_policy_name text,
  p_service_policy_name text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table_name)) IS NULL THEN
    RAISE NOTICE 'Skipping policy cleanup for %.% because table does not exist', 'public', p_table_name;
    RETURN;
  END IF;

  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_legacy_policy_name, p_table_name);
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_service_policy_name, p_table_name);
  EXECUTE format(
    'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true)',
    p_service_policy_name,
    p_table_name
  );
END;
$$;

SELECT public.replace_with_service_role_policy_if_table_exists(table_name, legacy_policy, service_policy)
FROM (
  VALUES
    ('ad_campaigns', 'admin_all_ad_campaigns', 'ad_campaigns_service_all'),
    ('ad_creatives', 'admin_all_ad_creatives', 'ad_creatives_service_all'),
    ('ad_performance_snapshots', 'admin_all_ad_perf_snapshots', 'ad_performance_snapshots_service_all'),
    ('creative_performance', 'admin_all_creative_performance', 'creative_performance_service_all'),
    ('creative_edits', 'admin_all_creative_edits', 'creative_edits_service_all'),
    ('winning_patterns', 'admin_all_winning_patterns', 'winning_patterns_service_all')
) AS planned(table_name, legacy_policy, service_policy);

DROP FUNCTION public.replace_with_service_role_policy_if_table_exists(text, text, text);
