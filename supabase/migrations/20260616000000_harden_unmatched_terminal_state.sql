-- Keep resolved unmatched rows terminal when the same source text is seen again.
-- Active queue rows are defined as status='pending' AND resolved_at IS NULL.

DROP FUNCTION IF EXISTS public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT
);

CREATE OR REPLACE FUNCTION public.upsert_unmatched_activity(
  p_activity TEXT,
  p_package_id UUID DEFAULT NULL,
  p_package_title TEXT DEFAULT NULL,
  p_day_number INT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL,
  p_segment_kind_guess TEXT DEFAULT 'attraction',
  p_confidence NUMERIC DEFAULT NULL,
  p_suggested_action TEXT DEFAULT NULL,
  p_suggested_resolution JSONB DEFAULT NULL,
  p_source_context JSONB DEFAULT NULL,
  p_classification_version TEXT DEFAULT NULL
) RETURNS public.unmatched_activities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_out public.unmatched_activities;
BEGIN
  INSERT INTO public.unmatched_activities (
    activity, package_id, package_title, day_number, country, region,
    occurrence_count, status, segment_kind_guess, normalizer_version,
    confidence, suggested_action, suggested_resolution, source_context,
    classification_version, created_at, updated_at
  ) VALUES (
    p_activity, p_package_id, p_package_title, p_day_number, p_country, p_region,
    1, 'pending', COALESCE(p_segment_kind_guess, 'attraction'), 'unmatched-activity-rpc',
    COALESCE(p_confidence, 0.6), p_suggested_action, p_suggested_resolution, p_source_context,
    p_classification_version, NOW(), NOW()
  )
  ON CONFLICT (unmatched_scope_key, activity) DO UPDATE
    SET occurrence_count       = public.unmatched_activities.occurrence_count + 1,
        updated_at             = NOW(),
        package_id             = COALESCE(EXCLUDED.package_id, public.unmatched_activities.package_id),
        package_title          = COALESCE(EXCLUDED.package_title, public.unmatched_activities.package_title),
        day_number             = COALESCE(EXCLUDED.day_number, public.unmatched_activities.day_number),
        country                = COALESCE(EXCLUDED.country, public.unmatched_activities.country),
        region                 = COALESCE(EXCLUDED.region, public.unmatched_activities.region),
        segment_kind_guess     = COALESCE(EXCLUDED.segment_kind_guess, public.unmatched_activities.segment_kind_guess),
        confidence             = COALESCE(EXCLUDED.confidence, public.unmatched_activities.confidence),
        suggested_action       = COALESCE(EXCLUDED.suggested_action, public.unmatched_activities.suggested_action),
        suggested_resolution   = COALESCE(EXCLUDED.suggested_resolution, public.unmatched_activities.suggested_resolution),
        source_context         = COALESCE(EXCLUDED.source_context, public.unmatched_activities.source_context),
        classification_version = COALESCE(EXCLUDED.classification_version, public.unmatched_activities.classification_version),
        status                 = CASE
                                   WHEN public.unmatched_activities.status = 'resolved'
                                   THEN 'added'
                                   WHEN public.unmatched_activities.status IN ('added', 'ignored')
                                   THEN public.unmatched_activities.status
                                   WHEN public.unmatched_activities.resolved_at IS NOT NULL
                                     AND (
                                       public.unmatched_activities.resolved_kind ILIKE '%ignore%'
                                       OR public.unmatched_activities.resolved_kind ILIKE '%noise%'
                                     )
                                   THEN 'ignored'
                                   WHEN public.unmatched_activities.resolved_at IS NOT NULL
                                   THEN 'added'
                                   ELSE 'pending'
                                 END
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT
) TO service_role;

UPDATE public.unmatched_activities
SET status = 'added',
    updated_at = NOW()
WHERE status = 'resolved';

UPDATE public.unmatched_activities
SET status = CASE
    WHEN resolved_kind ILIKE '%ignore%' OR resolved_kind ILIKE '%noise%' THEN 'ignored'
    ELSE 'added'
  END,
  updated_at = NOW()
WHERE status = 'pending'
  AND resolved_at IS NOT NULL;
