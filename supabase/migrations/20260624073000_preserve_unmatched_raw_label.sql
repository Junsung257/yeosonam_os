-- Preserve source labels for every unmatched itinerary entity queue row.
--
-- The V3 upload path primarily uses upsert_unmatched_activity(). The previous
-- RPC signature stored activity but not raw_label, so admin review and entity
-- automation lost the exact label even though the queue row existed.

CREATE OR REPLACE FUNCTION public.increment_unmatched_count(
  p_activity TEXT,
  p_package_id UUID,
  p_package_title TEXT,
  p_day_number INT,
  p_country TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.unmatched_activities (
    activity, raw_label, package_id, package_title, day_number, country,
    occurrence_count, status, segment_kind_guess, confidence,
    suggested_action, created_at, updated_at
  ) VALUES (
    p_activity, COALESCE(NULLIF(p_activity, ''), 'unknown'), p_package_id, p_package_title, p_day_number, p_country,
    1, 'pending', 'attraction', 0.6,
    'needs_review', NOW(), NOW()
  )
  ON CONFLICT (unmatched_scope_key, activity) DO UPDATE
    SET occurrence_count   = public.unmatched_activities.occurrence_count + 1,
        updated_at         = NOW(),
        package_id         = COALESCE(EXCLUDED.package_id, public.unmatched_activities.package_id),
        package_title      = COALESCE(EXCLUDED.package_title, public.unmatched_activities.package_title),
        day_number         = COALESCE(EXCLUDED.day_number, public.unmatched_activities.day_number),
        country            = COALESCE(EXCLUDED.country, public.unmatched_activities.country),
        raw_label          = COALESCE(public.unmatched_activities.raw_label, EXCLUDED.raw_label, public.unmatched_activities.activity),
        segment_kind_guess = COALESCE(public.unmatched_activities.segment_kind_guess, EXCLUDED.segment_kind_guess),
        confidence         = COALESCE(public.unmatched_activities.confidence, EXCLUDED.confidence),
        suggested_action   = COALESCE(public.unmatched_activities.suggested_action, EXCLUDED.suggested_action),
        status             = CASE
                               WHEN public.unmatched_activities.status IN ('added', 'ignored')
                               THEN public.unmatched_activities.status
                               ELSE 'pending'
                             END;
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_unmatched_activity(
  p_activity TEXT,
  p_package_id UUID DEFAULT NULL,
  p_package_title TEXT DEFAULT NULL,
  p_day_number INT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL,
  p_segment_kind_guess TEXT DEFAULT 'attraction',
  p_confidence NUMERIC DEFAULT 0.6,
  p_suggested_action TEXT DEFAULT NULL,
  p_suggested_resolution JSONB DEFAULT NULL,
  p_source_context JSONB DEFAULT NULL,
  p_classification_version TEXT DEFAULT NULL,
  p_raw_label TEXT DEFAULT NULL
) RETURNS public.unmatched_activities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_out public.unmatched_activities;
BEGIN
  INSERT INTO public.unmatched_activities (
    activity, raw_label, package_id, package_title, day_number, country, region,
    occurrence_count, status, segment_kind_guess, normalizer_version,
    confidence, suggested_action, suggested_resolution, source_context,
    classification_version, created_at, updated_at
  ) VALUES (
    p_activity, COALESCE(NULLIF(p_raw_label, ''), NULLIF(p_activity, ''), 'unknown'),
    p_package_id, p_package_title, p_day_number, p_country, p_region,
    1, 'pending', COALESCE(p_segment_kind_guess, 'attraction'), 'unmatched-activity-rpc',
    COALESCE(p_confidence, 0.6), p_suggested_action, p_suggested_resolution, p_source_context,
    p_classification_version, NOW(), NOW()
  )
  ON CONFLICT (unmatched_scope_key, activity) DO UPDATE
    SET occurrence_count       = public.unmatched_activities.occurrence_count + 1,
        updated_at             = NOW(),
        raw_label              = COALESCE(public.unmatched_activities.raw_label, EXCLUDED.raw_label, public.unmatched_activities.activity),
        package_id             = COALESCE(EXCLUDED.package_id, public.unmatched_activities.package_id),
        package_title          = COALESCE(EXCLUDED.package_title, public.unmatched_activities.package_title),
        day_number             = COALESCE(EXCLUDED.day_number, public.unmatched_activities.day_number),
        country                = COALESCE(EXCLUDED.country, public.unmatched_activities.country),
        region                 = COALESCE(EXCLUDED.region, public.unmatched_activities.region),
        segment_kind_guess     = COALESCE(EXCLUDED.segment_kind_guess, public.unmatched_activities.segment_kind_guess),
        confidence             = COALESCE(EXCLUDED.confidence, public.unmatched_activities.confidence),
        suggested_action       = COALESCE(EXCLUDED.suggested_action, public.unmatched_activities.suggested_action),
        suggested_resolution   = COALESCE(EXCLUDED.suggested_resolution, public.unmatched_activities.suggested_resolution),
        source_context         =
          COALESCE(public.unmatched_activities.source_context, '{}'::jsonb) ||
          COALESCE(EXCLUDED.source_context, '{}'::jsonb) ||
          jsonb_build_object(
            'reingest_count',
            (
              CASE
                WHEN COALESCE(public.unmatched_activities.source_context->>'reingest_count', '') ~ '^\d+$'
                THEN (public.unmatched_activities.source_context->>'reingest_count')::int
                ELSE 0
              END
            ) + 1,
            'last_reingested_at',
            NOW(),
            'terminal_reingest_blocked',
            public.unmatched_activities.status IN ('added', 'ignored') OR public.unmatched_activities.resolved_at IS NOT NULL
          ),
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

REVOKE ALL ON FUNCTION public.increment_unmatched_count(TEXT, UUID, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_unmatched_count(TEXT, UUID, TEXT, INT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_unmatched_activity(
  TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT, TEXT
) TO service_role;

UPDATE public.unmatched_activities
   SET raw_label = COALESCE(NULLIF(raw_label, ''), NULLIF(activity, ''), 'unknown'),
       segment_kind_guess = COALESCE(segment_kind_guess, 'attraction'),
       confidence = COALESCE(confidence, 0.6),
       suggested_action = COALESCE(suggested_action, 'needs_review'),
       updated_at = NOW()
 WHERE status = 'pending'
   AND (raw_label IS NULL OR raw_label = '');
