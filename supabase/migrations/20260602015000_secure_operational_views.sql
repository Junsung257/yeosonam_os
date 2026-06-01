-- Operational analytics views are consumed by server APIs/jobs. Run normal
-- views with invoker privileges and remove browser-key grants from both normal
-- and materialized operational views.

DO $$
DECLARE
  target_views text[] := ARRAY[
    'anomaly_booking_volume_alerts',
    'anomaly_settlement_alerts',
    'booking_task_resolution_stats',
    'pgvector_index_stats',
    'prompt_active_view',
    'recommendation_conversion_stats'
  ];
  target_view text;
BEGIN
  FOREACH target_view IN ARRAY target_views LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = target_view
        AND c.relkind = 'v'
    ) THEN
      RAISE NOTICE 'Skipping missing view public.%', target_view;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', target_view);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', target_view);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', target_view);
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'daily_registration_stats'
      AND c.relkind = 'm'
  ) THEN
    REVOKE ALL ON TABLE public.daily_registration_stats FROM PUBLIC, anon, authenticated;
    GRANT SELECT ON TABLE public.daily_registration_stats TO service_role;
  END IF;
END $$;
