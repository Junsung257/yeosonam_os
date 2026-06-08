-- Expand unmatched_activities from an attraction-only review queue into a
-- review queue for itinerary entities. This keeps the existing table and
-- scope key, and does not allow automatic attraction master creation.

ALTER TABLE public.unmatched_activities
  ADD COLUMN IF NOT EXISTS suggested_action text,
  ADD COLUMN IF NOT EXISTS suggested_resolution jsonb,
  ADD COLUMN IF NOT EXISTS source_context jsonb,
  ADD COLUMN IF NOT EXISTS classification_version text;

CREATE INDEX IF NOT EXISTS idx_unmatched_activities_entity_kind_status
  ON public.unmatched_activities (segment_kind_guess, status, occurrence_count DESC);

CREATE INDEX IF NOT EXISTS idx_unmatched_activities_suggested_action
  ON public.unmatched_activities (suggested_action, status);

COMMENT ON COLUMN public.unmatched_activities.segment_kind_guess IS
  'Standard itinerary entity category: attraction, hotel, meal, transfer, shopping, optional_tour, free_time, notice, price_noise, or unknown.';

COMMENT ON COLUMN public.unmatched_activities.suggested_action IS
  'Suggested safe action: auto_resolve_existing, auto_ignore_noise, suggest_alias, needs_new_master, or needs_review.';

COMMENT ON COLUMN public.unmatched_activities.suggested_resolution IS
  'Structured candidate resolution. Must not be treated as an automatic master-data mutation.';

COMMENT ON COLUMN public.unmatched_activities.source_context IS
  'Source-backed package/day/destination/evidence context for mobile/A4 publish gating.';

COMMENT ON COLUMN public.unmatched_activities.classification_version IS
  'Version of the itinerary entity classifier that produced this review row.';

DROP FUNCTION IF EXISTS public.upsert_unmatched_activity(TEXT, UUID, TEXT, INT, TEXT, TEXT);

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
        package_id             = EXCLUDED.package_id,
        package_title          = EXCLUDED.package_title,
        day_number             = EXCLUDED.day_number,
        country                = COALESCE(EXCLUDED.country, public.unmatched_activities.country),
        region                 = COALESCE(EXCLUDED.region, public.unmatched_activities.region),
        segment_kind_guess     = COALESCE(EXCLUDED.segment_kind_guess, public.unmatched_activities.segment_kind_guess),
        confidence             = COALESCE(EXCLUDED.confidence, public.unmatched_activities.confidence),
        suggested_action       = COALESCE(EXCLUDED.suggested_action, public.unmatched_activities.suggested_action),
        suggested_resolution   = COALESCE(EXCLUDED.suggested_resolution, public.unmatched_activities.suggested_resolution),
        source_context         = COALESCE(EXCLUDED.source_context, public.unmatched_activities.source_context),
        classification_version = COALESCE(EXCLUDED.classification_version, public.unmatched_activities.classification_version),
        status                 = 'pending'
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_unmatched_activity(TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_unmatched_activity(TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT) TO service_role;

COMMENT ON FUNCTION public.upsert_unmatched_activity(TEXT, UUID, TEXT, INT, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, JSONB, TEXT) IS
  'Queues unresolved itinerary entities with category, safe suggested action, and source context. This does not create attractions or other master data.';
