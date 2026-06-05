-- Preserve unmatched review rows per package.
--
-- Previous behavior used a global UNIQUE(activity), so the same golf-course
-- phrase appearing in multiple registered products overwrote package_id and
-- made some products look clean while another inherited the review queue.
-- Keep global de-duplication only for rows without package_id by deriving a
-- stable scope key, then de-duplicate by (scope, activity).

ALTER TABLE public.unmatched_activities
  ADD COLUMN IF NOT EXISTS unmatched_scope_key text
  GENERATED ALWAYS AS (COALESCE(package_id::text, 'global')) STORED;

ALTER TABLE public.unmatched_activities
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT NOW();

UPDATE public.unmatched_activities
   SET updated_at = COALESCE(updated_at, created_at, NOW())
 WHERE updated_at IS NULL;

DROP INDEX IF EXISTS public.idx_unmatched_activity;

ALTER TABLE public.unmatched_activities
  DROP CONSTRAINT IF EXISTS unmatched_activities_scope_activity_key;

ALTER TABLE public.unmatched_activities
  ADD CONSTRAINT unmatched_activities_scope_activity_key
  UNIQUE (unmatched_scope_key, activity);

CREATE INDEX IF NOT EXISTS idx_unmatched_activities_scope_status
  ON public.unmatched_activities (unmatched_scope_key, status, created_at DESC);

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
    activity, package_id, package_title, day_number, country,
    occurrence_count, status, created_at, updated_at
  ) VALUES (
    p_activity, p_package_id, p_package_title, p_day_number, p_country,
    1, 'pending', NOW(), NOW()
  )
  ON CONFLICT (unmatched_scope_key, activity) DO UPDATE
    SET occurrence_count = public.unmatched_activities.occurrence_count + 1,
        updated_at       = NOW(),
        package_id       = EXCLUDED.package_id,
        package_title    = EXCLUDED.package_title,
        day_number       = EXCLUDED.day_number,
        country          = COALESCE(EXCLUDED.country, public.unmatched_activities.country),
        status           = 'pending';
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_unmatched_activity(
  p_activity TEXT,
  p_package_id UUID DEFAULT NULL,
  p_package_title TEXT DEFAULT NULL,
  p_day_number INT DEFAULT NULL,
  p_country TEXT DEFAULT NULL,
  p_region TEXT DEFAULT NULL
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
    confidence, created_at, updated_at
  ) VALUES (
    p_activity, p_package_id, p_package_title, p_day_number, p_country, p_region,
    1, 'pending', 'attraction', 'unmatched-activity-rpc',
    0.6, NOW(), NOW()
  )
  ON CONFLICT (unmatched_scope_key, activity) DO UPDATE
    SET occurrence_count = public.unmatched_activities.occurrence_count + 1,
        updated_at       = NOW(),
        package_id       = EXCLUDED.package_id,
        package_title    = EXCLUDED.package_title,
        day_number       = EXCLUDED.day_number,
        country          = COALESCE(EXCLUDED.country, public.unmatched_activities.country),
        region           = COALESCE(EXCLUDED.region, public.unmatched_activities.region),
        status           = 'pending'
  RETURNING * INTO row_out;

  RETURN row_out;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_unmatched_count(TEXT, UUID, TEXT, INT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_unmatched_count(TEXT, UUID, TEXT, INT, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.upsert_unmatched_activity(TEXT, UUID, TEXT, INT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_unmatched_activity(TEXT, UUID, TEXT, INT, TEXT, TEXT) TO service_role;

COMMENT ON COLUMN public.unmatched_activities.unmatched_scope_key IS
  'Generated de-duplication scope for unmatched review rows: package UUID when available, otherwise global.';

COMMENT ON CONSTRAINT unmatched_activities_scope_activity_key ON public.unmatched_activities IS
  'One pending/review row per package scope and activity; prevents cross-product queue overwrites.';
