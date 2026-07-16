-- Public package snapshot and publish gate foundation.
-- Customer routes must eventually read approved immutable snapshots instead of raw
-- travel_packages fields. This migration backfills a safe first snapshot for
-- currently customer-visible packages so rollout does not blank the storefront.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.travel_packages
  ADD COLUMN IF NOT EXISTS publication_state text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS package_revision bigint NOT NULL DEFAULT 1;

ALTER TABLE public.travel_packages
  DROP CONSTRAINT IF EXISTS travel_packages_publication_state_check;

ALTER TABLE public.travel_packages
  ADD CONSTRAINT travel_packages_publication_state_check
  CHECK (publication_state IN (
    'draft',
    'needs_review',
    'blocked',
    'approved',
    'published',
    'needs_reaudit',
    'quarantined'
  ));

CREATE INDEX IF NOT EXISTS idx_travel_packages_publication_state
  ON public.travel_packages(publication_state);

CREATE INDEX IF NOT EXISTS idx_travel_packages_package_revision
  ON public.travel_packages(package_revision);

UPDATE public.travel_packages
SET publication_state = CASE
  WHEN to_jsonb(travel_packages) ->> 'audit_status' = 'blocked'
    OR status IN ('blocked', 'archived', 'expired') THEN 'blocked'
  WHEN status IN ('active', 'approved', 'selling', 'available') THEN 'published'
  WHEN to_jsonb(travel_packages) ->> 'audit_status' = 'warnings' THEN 'needs_review'
  ELSE publication_state
END
WHERE publication_state = 'draft';

CREATE TABLE IF NOT EXISTS public.public_package_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  package_revision bigint NOT NULL,
  snapshot_hash text NOT NULL,
  snapshot_version text NOT NULL DEFAULT 'public-package-snapshot-v1',
  snapshot_json jsonb NOT NULL,
  card_projection jsonb NOT NULL DEFAULT '{}'::jsonb,
  lp_projection jsonb NOT NULL DEFAULT '{}'::jsonb,
  route_text_dump jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_raw_text_hash text,
  parser_revision text,
  audit_revision text,
  mobile_proof_revision text,
  app_build_id text,
  status text NOT NULL DEFAULT 'approved',
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  superseded_at timestamptz,
  CONSTRAINT public_package_snapshots_status_check
    CHECK (status IN ('candidate', 'approved', 'published', 'superseded', 'blocked'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_public_package_snapshots_package_hash
  ON public.public_package_snapshots(package_id, snapshot_hash);

CREATE INDEX IF NOT EXISTS idx_public_package_snapshots_latest
  ON public.public_package_snapshots(package_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.package_publish_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  package_revision bigint NOT NULL,
  public_snapshot_id uuid REFERENCES public.public_package_snapshots(id) ON DELETE SET NULL,
  public_snapshot_hash text,
  publication_state text NOT NULL,
  publishable boolean NOT NULL DEFAULT false,
  hard_blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  soft_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  audit_run_ref text,
  mobile_proof_ref text,
  decision_source text NOT NULL DEFAULT 'publish_gate_v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_publish_decisions_state_check
    CHECK (publication_state IN (
      'draft',
      'needs_review',
      'blocked',
      'approved',
      'published',
      'needs_reaudit',
      'quarantined'
    ))
);

CREATE INDEX IF NOT EXISTS idx_package_publish_decisions_package_latest
  ON public.package_publish_decisions(package_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.quarantined_package_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  package_revision bigint,
  field_path text NOT NULL,
  old_value jsonb NOT NULL,
  reason text NOT NULL,
  source_span jsonb,
  repair_job_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quarantined_package_fields_package
  ON public.quarantined_package_fields(package_id, created_at DESC);

ALTER TABLE public.public_package_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.package_publish_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quarantined_package_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_package_snapshots_service_all ON public.public_package_snapshots;
CREATE POLICY public_package_snapshots_service_all
  ON public.public_package_snapshots
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS package_publish_decisions_service_all ON public.package_publish_decisions;
CREATE POLICY package_publish_decisions_service_all
  ON public.package_publish_decisions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS quarantined_package_fields_service_all ON public.quarantined_package_fields;
CREATE POLICY quarantined_package_fields_service_all
  ON public.quarantined_package_fields
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.public_package_snapshots FROM anon, authenticated;
REVOKE ALL ON TABLE public.package_publish_decisions FROM anon, authenticated;
REVOKE ALL ON TABLE public.quarantined_package_fields FROM anon, authenticated;

GRANT ALL ON TABLE public.public_package_snapshots TO service_role;
GRANT ALL ON TABLE public.package_publish_decisions TO service_role;
GRANT ALL ON TABLE public.quarantined_package_fields TO service_role;

DO $$
BEGIN
  -- The product snapshot schema is managed by the product-registration project.
  -- Only backfill when that pre-existing schema is complete; do not invent its
  -- omitted columns as part of the informational-content remediation.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'travel_packages'
      AND column_name = 'audit_status'
  ) THEN
INSERT INTO public.public_package_snapshots (
  package_id,
  package_revision,
  snapshot_hash,
  snapshot_json,
  card_projection,
  lp_projection,
  route_text_dump,
  source_raw_text_hash,
  audit_revision,
  status,
  published_at
)
SELECT
  p.id,
  p.package_revision,
  encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'package_id', p.id,
          'package_revision', p.package_revision,
          'title', COALESCE(NULLIF(p.display_title, ''), p.title),
          'updated_at', p.updated_at
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ),
  jsonb_strip_nulls(jsonb_build_object(
    'snapshot_version', 'public-package-snapshot-v1',
    'package', jsonb_build_object(
      'id', p.id,
      'title', COALESCE(NULLIF(p.display_title, ''), p.title),
      'display_title', COALESCE(NULLIF(p.display_title, ''), p.title),
      'destination', p.destination,
      'country', p.country,
      'category', p.category,
      'product_type', p.product_type,
      'trip_style', p.trip_style,
      'duration', p.duration,
      'nights', p.nights,
      'price', p.price,
      'price_tiers', p.price_tiers,
      'price_dates', p.price_dates,
      'price_list', p.price_list,
      'departure_days', p.departure_days,
      'departure_airport', p.departure_airport,
      'airline', p.airline,
      'min_participants', p.min_participants,
      'ticketing_deadline', p.ticketing_deadline,
      'inclusions', p.inclusions,
      'excludes', p.excludes,
      'surcharges', p.surcharges,
      'optional_tours', COALESCE(p.optional_tours, '[]'::jsonb),
      'product_tags', p.product_tags,
      'product_highlights', p.product_highlights,
      'product_summary', p.product_summary,
      'hero_tagline', p.hero_tagline,
      'customer_notes', p.customer_notes,
      'notices_parsed', p.notices_parsed,
      'itinerary_data', p.itinerary_data,
      'accommodations', p.accommodations,
      'is_airtel', p.is_airtel,
      'avg_rating', p.avg_rating,
      'review_count', p.review_count,
      'status', p.status,
      'publication_state', p.publication_state,
      'package_revision', p.package_revision,
      'products', jsonb_build_object(
        'internal_code', pr.internal_code,
        'display_name', pr.display_name,
        'departure_region', pr.departure_region
      )
    ),
    'public_title', COALESCE(NULLIF(p.display_title, ''), p.title),
    'card_projection', jsonb_build_object(
      'id', p.id,
      'title', COALESCE(NULLIF(p.display_title, ''), p.title),
      'destination', p.destination,
      'duration', p.duration,
      'nights', p.nights,
      'price', p.price
    ),
    'lp_projection', jsonb_build_object(
      'id', p.id,
      'title', COALESCE(NULLIF(p.display_title, ''), p.title),
      'destination', p.destination,
      'summary', p.product_summary,
      'price', p.price
    )
  )),
  jsonb_build_object(
    'id', p.id,
    'title', COALESCE(NULLIF(p.display_title, ''), p.title),
    'destination', p.destination,
    'duration', p.duration,
    'nights', p.nights,
    'price', p.price
  ),
  jsonb_build_object(
    'id', p.id,
    'title', COALESCE(NULLIF(p.display_title, ''), p.title),
    'destination', p.destination,
    'summary', p.product_summary,
    'price', p.price
  ),
  jsonb_build_array(
    COALESCE(NULLIF(p.display_title, ''), p.title),
    p.destination,
    p.product_summary
  ),
  p.raw_text_hash,
  p.audit_checked_at::text,
  'published',
  now()
FROM public.travel_packages p
LEFT JOIN public.products pr ON pr.internal_code = p.internal_code
WHERE p.publication_state = 'published'
ON CONFLICT (package_id, snapshot_hash) DO NOTHING;
  END IF;
END
$$;

INSERT INTO public.package_publish_decisions (
  package_id,
  package_revision,
  public_snapshot_id,
  public_snapshot_hash,
  publication_state,
  publishable,
  hard_blockers,
  soft_warnings
)
SELECT
  p.id,
  p.package_revision,
  s.id,
  s.snapshot_hash,
  p.publication_state,
  p.publication_state IN ('approved', 'published'),
  CASE WHEN p.publication_state IN ('approved', 'published') THEN '[]'::jsonb ELSE jsonb_build_array('legacy_not_public') END,
  jsonb_build_array('legacy_backfill_snapshot')
FROM public.travel_packages p
LEFT JOIN LATERAL (
  SELECT id, snapshot_hash
  FROM public.public_package_snapshots
  WHERE package_id = p.id
  ORDER BY created_at DESC
  LIMIT 1
) s ON true
WHERE p.publication_state IN ('published', 'blocked', 'needs_review')
ON CONFLICT DO NOTHING;
