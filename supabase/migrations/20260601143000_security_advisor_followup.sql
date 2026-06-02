-- Follow-up security advisor hardening.
--
-- 1) Close the remaining server-only SECURITY DEFINER functions that were
-- still executable through PostgREST by anon/authenticated roles.
-- 2) Keep Web Vitals collection routed through /api/web-vitals instead of
-- exposing direct table writes from browser roles.

DO $$
DECLARE
  function_signatures text[] := ARRAY[
    'public.auto_finalize_ab_experiments()',
    'public.auto_heal_content_gaps(integer)',
    'public.bank_tx_soft_delete_to_blacklist()',
    'public.bank_tx_to_blacklist()',
    'public.check_customer_leak()'
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

ALTER TABLE public.content_creatives
  ADD COLUMN IF NOT EXISTS metrics jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_content_creatives_metrics_gin
  ON public.content_creatives USING gin (metrics);

DO $$
BEGIN
  IF to_regclass('public.web_vitals') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.web_vitals FROM anon, authenticated;
    GRANT ALL ON TABLE public.web_vitals TO service_role;

    DROP POLICY IF EXISTS "web_vitals_anon_insert" ON public.web_vitals;
    DROP POLICY IF EXISTS "web_vitals_authenticated_all" ON public.web_vitals;

    DROP POLICY IF EXISTS "web_vitals_service_role_all" ON public.web_vitals;
    CREATE POLICY "web_vitals_service_role_all" ON public.web_vitals
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;

  IF to_regclass('public.web_vital_alerts') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.web_vital_alerts FROM anon, authenticated;
    GRANT ALL ON TABLE public.web_vital_alerts TO service_role;

    DROP POLICY IF EXISTS "web_vital_alerts_anon_insert" ON public.web_vital_alerts;
    DROP POLICY IF EXISTS "web_vital_alerts_authenticated_all" ON public.web_vital_alerts;

    DROP POLICY IF EXISTS "web_vital_alerts_service_role_all" ON public.web_vital_alerts;
    CREATE POLICY "web_vital_alerts_service_role_all" ON public.web_vital_alerts
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;
