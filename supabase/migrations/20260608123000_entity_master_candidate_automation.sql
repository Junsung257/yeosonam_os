-- Verified entity master candidate queue for itinerary normalization.
-- This does not publish new attractions/hotels directly. It stores evidence-backed
-- master candidates and keeps customer visibility behind explicit verification gates.

ALTER TABLE public.attractions
  ADD COLUMN IF NOT EXISTS auto_created boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS customer_publishable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS source_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS review_required_reason text,
  ADD COLUMN IF NOT EXISTS auto_created_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'attractions_verification_status_check'
      AND conrelid = 'public.attractions'::regclass
  ) THEN
    ALTER TABLE public.attractions
      ADD CONSTRAINT attractions_verification_status_check
      CHECK (verification_status IN ('manual', 'candidate', 'auto_internal', 'publishable_ready', 'published', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_attractions_customer_publishable
  ON public.attractions (customer_publishable, is_active);

CREATE INDEX IF NOT EXISTS idx_attractions_verification_status
  ON public.attractions (verification_status, auto_created);

COMMENT ON COLUMN public.attractions.auto_created IS
  'True only for system-created internal master records. These records still require verification before customer exposure.';
COMMENT ON COLUMN public.attractions.verification_status IS
  'manual/candidate/auto_internal/publishable_ready/published/rejected verification gate for attraction master data.';
COMMENT ON COLUMN public.attractions.customer_publishable IS
  'Whether this attraction may be returned to customer-facing payloads. Auto-created records default to false at insertion time.';
COMMENT ON COLUMN public.attractions.source_ids IS
  'Structured references to source unmatched rows, candidate ids, or supplier evidence hashes.';
COMMENT ON COLUMN public.attractions.verification_sources IS
  'External identity/evidence sources such as Wikidata QID, OSM object, Google Place ID, official website, or operator evidence.';

CREATE TABLE IF NOT EXISTS public.entity_master_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_key text NOT NULL UNIQUE,
  category text NOT NULL,
  raw_label text NOT NULL,
  normalized_label text NOT NULL,
  destination_scope text,
  country_scope text,
  region_scope text,
  evidence_count integer NOT NULL DEFAULT 1,
  occurrence_count integer NOT NULL DEFAULT 1,
  package_count integer NOT NULL DEFAULT 0,
  source_unmatched_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  source_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  external_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  suggested_master jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) NOT NULL DEFAULT 0,
  promotion_status text NOT NULL DEFAULT 'candidate',
  auto_action text NOT NULL DEFAULT 'needs_review',
  decision_reason text,
  promoted_at timestamptz,
  promoted_attraction_id uuid REFERENCES public.attractions(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entity_master_candidates_category_check
    CHECK (category IN ('attraction', 'hotel', 'shopping', 'optional_tour', 'notice', 'unknown')),
  CONSTRAINT entity_master_candidates_promotion_status_check
    CHECK (promotion_status IN ('candidate', 'rejected_noise', 'auto_internal', 'publishable_ready', 'needs_review', 'promoted')),
  CONSTRAINT entity_master_candidates_auto_action_check
    CHECK (auto_action IN ('reject_noise', 'structure_non_master', 'create_internal_master', 'create_publishable_master', 'needs_review')),
  CONSTRAINT entity_master_candidates_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_entity_master_candidates_category_status
  ON public.entity_master_candidates (category, promotion_status, confidence DESC);

CREATE INDEX IF NOT EXISTS idx_entity_master_candidates_auto_action
  ON public.entity_master_candidates (auto_action, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_entity_master_candidates_scope
  ON public.entity_master_candidates (country_scope, region_scope, category);

COMMENT ON TABLE public.entity_master_candidates IS
  'Evidence-backed itinerary entity master candidate queue. Automation may create candidates/internal records, but customer-publishable promotion remains gated by verification.';
COMMENT ON COLUMN public.entity_master_candidates.candidate_key IS
  'Stable hash/key from category + normalized label + regional scope.';
COMMENT ON COLUMN public.entity_master_candidates.external_sources IS
  'Structured identity sources. Customer-publishable automation requires independent reliable sources.';
COMMENT ON COLUMN public.entity_master_candidates.promotion_status IS
  'candidate/rejected_noise/auto_internal/publishable_ready/needs_review/promoted lifecycle.';

CREATE OR REPLACE FUNCTION public.touch_entity_master_candidates_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_entity_master_candidates_updated_at ON public.entity_master_candidates;
CREATE TRIGGER trg_entity_master_candidates_updated_at
BEFORE UPDATE ON public.entity_master_candidates
FOR EACH ROW
EXECUTE FUNCTION public.touch_entity_master_candidates_updated_at();

ALTER TABLE public.entity_master_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entity_master_candidates_service_role_all" ON public.entity_master_candidates;
CREATE POLICY "entity_master_candidates_service_role_all"
ON public.entity_master_candidates
FOR ALL
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');
