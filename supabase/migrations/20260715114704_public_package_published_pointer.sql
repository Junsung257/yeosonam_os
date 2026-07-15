-- Close the customer publication boundary around one immutable, explicitly
-- promoted snapshot. Raw travel_packages fields remain available to trusted
-- ingestion/audit workers, but customer and external consumers read only the
-- versioned projection views below.

ALTER TABLE public.public_package_snapshots
  ADD COLUMN IF NOT EXISTS snapshot_schema_version text NOT NULL DEFAULT 'public-package-snapshot-v1',
  ADD COLUMN IF NOT EXISTS publish_gate_version text NOT NULL DEFAULT 'publish_gate_v1',
  ADD COLUMN IF NOT EXISTS source_evidence_digest text,
  ADD COLUMN IF NOT EXISTS public_api_projection jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS marketing_projection jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS partner_projection jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revocation_reason text;

ALTER TABLE public.travel_packages
  ADD COLUMN IF NOT EXISTS candidate_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS published_snapshot_id uuid;

ALTER TABLE public.ad_creatives
  ADD COLUMN IF NOT EXISTS source_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS source_snapshot_hash text,
  ADD COLUMN IF NOT EXISTS marketing_projection_version text;

ALTER TABLE public.ad_creatives
  DROP CONSTRAINT IF EXISTS ad_creatives_source_snapshot_id_fkey;

ALTER TABLE public.ad_creatives
  ADD CONSTRAINT ad_creatives_source_snapshot_id_fkey
    FOREIGN KEY (source_snapshot_id)
    REFERENCES public.public_package_snapshots(id)
    ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_ad_creatives_source_snapshot
  ON public.ad_creatives(source_snapshot_id)
  WHERE source_snapshot_id IS NOT NULL;

ALTER TABLE public.travel_packages
  DROP CONSTRAINT IF EXISTS travel_packages_candidate_snapshot_id_fkey,
  DROP CONSTRAINT IF EXISTS travel_packages_published_snapshot_id_fkey;

ALTER TABLE public.travel_packages
  ADD CONSTRAINT travel_packages_candidate_snapshot_id_fkey
    FOREIGN KEY (candidate_snapshot_id)
    REFERENCES public.public_package_snapshots(id)
    ON DELETE SET NULL,
  ADD CONSTRAINT travel_packages_published_snapshot_id_fkey
    FOREIGN KEY (published_snapshot_id)
    REFERENCES public.public_package_snapshots(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_travel_packages_candidate_snapshot
  ON public.travel_packages(candidate_snapshot_id)
  WHERE candidate_snapshot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_travel_packages_published_snapshot
  ON public.travel_packages(published_snapshot_id)
  WHERE published_snapshot_id IS NOT NULL;

-- A snapshot row is immutable for a package revision. Reusing the same visible
-- hash in a later revision creates a new row instead of rewriting old proof
-- provenance.
DROP INDEX IF EXISTS public.idx_public_package_snapshots_package_hash;
CREATE UNIQUE INDEX idx_public_package_snapshots_package_revision_hash
  ON public.public_package_snapshots(package_id, package_revision, snapshot_hash);

CREATE INDEX IF NOT EXISTS idx_public_package_snapshots_not_revoked
  ON public.public_package_snapshots(package_id, status, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.field_evidence_ledger (
  evidence_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  package_revision bigint NOT NULL,
  ingest_run_id text,
  parse_candidate_id text,
  field_path text NOT NULL,
  normalized_value_hash text NOT NULL,
  source_document_id text,
  source_section text,
  source_span_start integer,
  source_span_end integer,
  source_excerpt_hash text,
  evidence_type text NOT NULL,
  extractor_version text NOT NULL,
  confidence numeric(5,4),
  validation_status text NOT NULL DEFAULT 'candidate',
  contradiction_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT field_evidence_ledger_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  CONSTRAINT field_evidence_ledger_validation_status_check
    CHECK (validation_status IN ('candidate', 'validated', 'rejected', 'contradicted', 'superseded'))
);

CREATE INDEX IF NOT EXISTS idx_field_evidence_ledger_package_field
  ON public.field_evidence_ledger(package_id, field_path, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_field_evidence_ledger_idempotency
  ON public.field_evidence_ledger(
    package_id,
    package_revision,
    field_path,
    normalized_value_hash,
    extractor_version,
    COALESCE(source_span_start, -1),
    COALESCE(source_span_end, -1)
  );

ALTER TABLE public.quarantined_package_fields
  ADD COLUMN IF NOT EXISTS ingest_run_id text,
  ADD COLUMN IF NOT EXISTS parse_candidate_id text,
  ADD COLUMN IF NOT EXISTS original_value_hash text,
  ADD COLUMN IF NOT EXISTS source_section text,
  ADD COLUMN IF NOT EXISTS source_span_start integer,
  ADD COLUMN IF NOT EXISTS source_span_end integer,
  ADD COLUMN IF NOT EXISTS reason_code text,
  ADD COLUMN IF NOT EXISTS detector_rule_version text,
  ADD COLUMN IF NOT EXISTS evidence_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS quarantined_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS resolution_status text NOT NULL DEFAULT 'active_unresolved',
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS replacement_candidate_id text,
  ADD COLUMN IF NOT EXISTS audit_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.quarantined_package_fields
SET
  original_value_hash = COALESCE(
    original_value_hash,
    encode(extensions.digest(convert_to(old_value::text, 'UTF8'), 'sha256'), 'hex')
  ),
  reason_code = COALESCE(NULLIF(reason_code, ''), NULLIF(reason, ''), 'legacy_quarantine'),
  detector_rule_version = COALESCE(NULLIF(detector_rule_version, ''), 'legacy-v1'),
  quarantined_at = COALESCE(quarantined_at, created_at)
WHERE original_value_hash IS NULL
   OR reason_code IS NULL
   OR detector_rule_version IS NULL;

ALTER TABLE public.quarantined_package_fields
  ALTER COLUMN original_value_hash SET NOT NULL,
  ALTER COLUMN reason_code SET NOT NULL,
  ALTER COLUMN detector_rule_version SET NOT NULL;

ALTER TABLE public.quarantined_package_fields
  DROP CONSTRAINT IF EXISTS quarantined_package_fields_resolution_status_check;

ALTER TABLE public.quarantined_package_fields
  ADD CONSTRAINT quarantined_package_fields_resolution_status_check
  CHECK (resolution_status IN (
    'active_unresolved',
    'historical_quarantined',
    'released',
    'false_positive'
  ));

CREATE UNIQUE INDEX IF NOT EXISTS idx_quarantined_package_fields_idempotency
  ON public.quarantined_package_fields(
    package_id,
    field_path,
    original_value_hash,
    detector_rule_version
  );

CREATE INDEX IF NOT EXISTS idx_quarantined_package_fields_active
  ON public.quarantined_package_fields(package_id, field_path)
  WHERE resolution_status = 'active_unresolved';

ALTER TABLE public.field_evidence_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS field_evidence_ledger_service_all ON public.field_evidence_ledger;
CREATE POLICY field_evidence_ledger_service_all
  ON public.field_evidence_ledger
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.field_evidence_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.field_evidence_ledger TO service_role;

CREATE TABLE IF NOT EXISTS public.package_render_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.travel_packages(id) ON DELETE CASCADE,
  snapshot_id uuid NOT NULL REFERENCES public.public_package_snapshots(id) ON DELETE CASCADE,
  public_snapshot_hash text NOT NULL,
  proof_input_hash text NOT NULL,
  route text NOT NULL,
  viewport_profile_version text NOT NULL,
  locale text NOT NULL DEFAULT 'ko-KR',
  status text NOT NULL,
  screen_hash text,
  customer_visible_hash text,
  app_build_id text,
  copy_template_version text,
  proof_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_render_proofs_status_check
    CHECK (status IN ('passed', 'failed', 'stale_content', 'stale_render', 'stale_asset', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_package_render_proofs_input_surface
  ON public.package_render_proofs(
    package_id,
    snapshot_id,
    proof_input_hash,
    route,
    viewport_profile_version,
    locale
  );

CREATE INDEX IF NOT EXISTS idx_package_render_proofs_current
  ON public.package_render_proofs(package_id, snapshot_id, status, created_at DESC);

ALTER TABLE public.package_render_proofs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS package_render_proofs_service_all ON public.package_render_proofs;
CREATE POLICY package_render_proofs_service_all
  ON public.package_render_proofs
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.package_render_proofs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.package_render_proofs TO service_role;

-- Only snapshots with a real publish-gate decision are eligible for the
-- rollout backfill. The legacy bootstrap snapshot intentionally remains
-- unpointed so it cannot become a raw-copy fallback.
WITH eligible AS (
  SELECT
    p.id AS package_id,
    s.id AS snapshot_id,
    row_number() OVER (
      PARTITION BY p.id
      ORDER BY d.created_at DESC, s.created_at DESC
    ) AS rank
  FROM public.travel_packages p
  JOIN public.package_publish_decisions d
    ON d.package_id = p.id
   AND d.package_revision = p.package_revision
   AND d.publishable = true
   AND d.public_snapshot_id IS NOT NULL
   AND NOT (d.soft_warnings @> '["legacy_backfill_snapshot"]'::jsonb)
  JOIN public.public_package_snapshots s
    ON s.id = d.public_snapshot_id
   AND s.package_id = p.id
   AND s.package_revision = p.package_revision
   AND s.snapshot_hash = d.public_snapshot_hash
   AND s.status IN ('approved', 'published')
   AND s.revoked_at IS NULL
  WHERE p.publication_state IN ('approved', 'published')
)
UPDATE public.travel_packages p
SET
  candidate_snapshot_id = eligible.snapshot_id,
  published_snapshot_id = eligible.snapshot_id
FROM eligible
WHERE p.id = eligible.package_id
  AND eligible.rank = 1
  AND p.published_snapshot_id IS NULL;

CREATE OR REPLACE VIEW public.published_public_packages_v1
WITH (security_invoker = true)
AS
SELECT
  p.id AS package_id,
  p.published_snapshot_id,
  s.package_revision,
  s.snapshot_hash,
  s.snapshot_schema_version,
  s.publish_gate_version,
  s.source_evidence_digest,
  s.snapshot_json,
  s.card_projection,
  s.lp_projection AS detail_projection,
  s.public_api_projection,
  s.marketing_projection,
  s.partner_projection,
  s.route_text_dump AS route_text_projection,
  s.created_at AS snapshot_created_at,
  s.published_at
FROM public.travel_packages p
JOIN public.public_package_snapshots s
  ON s.id = p.published_snapshot_id
 AND s.package_id = p.id
 AND s.status IN ('approved', 'published')
 AND s.revoked_at IS NULL
WHERE EXISTS (
    SELECT 1
    FROM public.package_publish_decisions d
    WHERE d.package_id = p.id
      AND d.package_revision = s.package_revision
      AND d.public_snapshot_id = s.id
      AND d.public_snapshot_hash = s.snapshot_hash
      AND d.publishable = true
  );

CREATE OR REPLACE VIEW public.published_public_package_cards_v1
WITH (security_invoker = true)
AS
SELECT
  package_id,
  published_snapshot_id,
  package_revision,
  snapshot_hash,
  snapshot_schema_version,
  publish_gate_version,
  source_evidence_digest,
  snapshot_json,
  card_projection,
  route_text_projection,
  snapshot_created_at,
  published_at
FROM public.published_public_packages_v1;

CREATE OR REPLACE VIEW public.published_public_package_details_v1
WITH (security_invoker = true)
AS
SELECT
  package_id,
  published_snapshot_id,
  package_revision,
  snapshot_hash,
  snapshot_schema_version,
  publish_gate_version,
  source_evidence_digest,
  snapshot_json,
  detail_projection,
  route_text_projection,
  snapshot_created_at,
  published_at
FROM public.published_public_packages_v1;

CREATE OR REPLACE VIEW public.published_public_package_api_v1
WITH (security_invoker = true)
AS
SELECT
  package_id,
  published_snapshot_id,
  snapshot_hash,
  snapshot_schema_version,
  source_evidence_digest,
  public_api_projection,
  published_at
FROM public.published_public_packages_v1;

CREATE OR REPLACE VIEW public.published_public_package_marketing_v1
WITH (security_invoker = true)
AS
SELECT
  package_id,
  published_snapshot_id,
  snapshot_hash,
  snapshot_schema_version,
  source_evidence_digest,
  marketing_projection,
  published_at
FROM public.published_public_packages_v1;

CREATE OR REPLACE VIEW public.published_public_package_partner_v1
WITH (security_invoker = true)
AS
SELECT
  package_id,
  published_snapshot_id,
  snapshot_hash,
  snapshot_schema_version,
  source_evidence_digest,
  partner_projection,
  published_at
FROM public.published_public_packages_v1;

REVOKE ALL ON TABLE public.published_public_packages_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.published_public_package_cards_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.published_public_package_details_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.published_public_package_api_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.published_public_package_marketing_v1 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.published_public_package_partner_v1 FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.published_public_packages_v1 TO service_role;
GRANT SELECT ON TABLE public.published_public_package_cards_v1 TO service_role;
GRANT SELECT ON TABLE public.published_public_package_details_v1 TO service_role;
GRANT SELECT ON TABLE public.published_public_package_api_v1 TO service_role;
GRANT SELECT ON TABLE public.published_public_package_marketing_v1 TO service_role;
GRANT SELECT ON TABLE public.published_public_package_partner_v1 TO service_role;

DROP FUNCTION IF EXISTS public.publish_package_snapshot_atomic(
  uuid, bigint, jsonb, text, jsonb, jsonb, jsonb, jsonb, text, text,
  text, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text
);

CREATE OR REPLACE FUNCTION public.publish_package_snapshot_atomic(
  p_package_id uuid,
  p_package_revision bigint,
  p_package_patch jsonb,
  p_snapshot_hash text,
  p_snapshot_json jsonb,
  p_card_projection jsonb DEFAULT '{}'::jsonb,
  p_lp_projection jsonb DEFAULT '{}'::jsonb,
  p_route_text_dump jsonb DEFAULT '[]'::jsonb,
  p_source_raw_text_hash text DEFAULT NULL,
  p_audit_revision text DEFAULT NULL,
  p_mobile_proof_revision text DEFAULT NULL,
  p_app_build_id text DEFAULT NULL,
  p_snapshot_status text DEFAULT 'published',
  p_publication_state text DEFAULT 'published',
  p_publishable boolean DEFAULT true,
  p_hard_blockers jsonb DEFAULT '[]'::jsonb,
  p_soft_warnings jsonb DEFAULT '[]'::jsonb,
  p_required_actions jsonb DEFAULT '[]'::jsonb,
  p_audit_run_ref text DEFAULT NULL,
  p_mobile_proof_ref text DEFAULT NULL,
  p_decision_source text DEFAULT 'publish_gate_v1',
  p_quarantine_candidates jsonb DEFAULT '[]'::jsonb,
  p_field_evidence_records jsonb DEFAULT '[]'::jsonb,
  p_render_proof_payload jsonb DEFAULT '{}'::jsonb,
  p_revoke_previous boolean DEFAULT false,
  p_revocation_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $$
DECLARE
  v_snapshot_id uuid;
  v_updated_count integer;
  v_now timestamptz := now();
  v_patch jsonb := COALESCE(p_package_patch, '{}'::jsonb);
  v_previous_published_snapshot_id uuid;
  v_previous_status text;
  v_previous_publication_state text;
BEGIN
  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'p_package_id is required';
  END IF;
  IF p_package_revision IS NULL OR p_package_revision < 1 THEN
    RAISE EXCEPTION 'p_package_revision must be a positive integer';
  END IF;
  IF COALESCE(p_snapshot_hash, '') = '' THEN
    RAISE EXCEPTION 'p_snapshot_hash is required';
  END IF;
  IF p_snapshot_json IS NULL OR jsonb_typeof(p_snapshot_json) <> 'object' THEN
    RAISE EXCEPTION 'p_snapshot_json must be a JSON object';
  END IF;
  IF p_snapshot_status NOT IN ('candidate', 'approved', 'published', 'superseded', 'blocked') THEN
    RAISE EXCEPTION 'invalid snapshot status: %', p_snapshot_status;
  END IF;
  IF p_publication_state NOT IN ('draft', 'needs_review', 'blocked', 'approved', 'published', 'needs_reaudit', 'quarantined') THEN
    RAISE EXCEPTION 'invalid publication state: %', p_publication_state;
  END IF;

  SELECT published_snapshot_id, status, publication_state
  INTO v_previous_published_snapshot_id, v_previous_status, v_previous_publication_state
  FROM public.travel_packages
  WHERE id = p_package_id
  FOR UPDATE;

  INSERT INTO public.public_package_snapshots (
    package_id,
    package_revision,
    snapshot_hash,
    snapshot_version,
    snapshot_schema_version,
    publish_gate_version,
    source_evidence_digest,
    snapshot_json,
    card_projection,
    lp_projection,
    public_api_projection,
    marketing_projection,
    partner_projection,
    route_text_dump,
    source_raw_text_hash,
    audit_revision,
    mobile_proof_revision,
    app_build_id,
    status,
    published_at,
    superseded_at,
    revoked_at,
    revocation_reason
  )
  VALUES (
    p_package_id,
    p_package_revision,
    p_snapshot_hash,
    COALESCE(NULLIF(p_snapshot_json ->> 'snapshot_version', ''), 'public-package-snapshot-v1'),
    COALESCE(NULLIF(p_snapshot_json ->> 'snapshot_version', ''), 'public-package-snapshot-v1'),
    COALESCE(NULLIF(p_decision_source, ''), 'publish_gate_v1'),
    NULLIF(p_snapshot_json ->> 'source_evidence_digest', ''),
    p_snapshot_json,
    COALESCE(p_card_projection, '{}'::jsonb),
    COALESCE(p_lp_projection, '{}'::jsonb),
    COALESCE(p_snapshot_json -> 'public_api_projection', '{}'::jsonb),
    COALESCE(p_snapshot_json -> 'marketing_projection', '{}'::jsonb),
    COALESCE(p_snapshot_json -> 'partner_projection', '{}'::jsonb),
    COALESCE(p_route_text_dump, '[]'::jsonb),
    p_source_raw_text_hash,
    p_audit_revision,
    p_mobile_proof_revision,
    p_app_build_id,
    p_snapshot_status,
    CASE WHEN p_snapshot_status = 'published' THEN v_now ELSE NULL END,
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT (package_id, package_revision, snapshot_hash)
  DO UPDATE SET
    -- Content and projections stay immutable. A retry may only promote the
    -- exact candidate and attach publication lifecycle metadata.
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at,
    superseded_at = NULL,
    revoked_at = NULL,
    revocation_reason = NULL
  RETURNING id INTO v_snapshot_id;

  INSERT INTO public.package_publish_decisions (
    package_id, package_revision, public_snapshot_id, public_snapshot_hash,
    publication_state, publishable, hard_blockers, soft_warnings,
    required_actions, audit_run_ref, mobile_proof_ref, decision_source
  )
  VALUES (
    p_package_id, p_package_revision, v_snapshot_id, p_snapshot_hash,
    p_publication_state, COALESCE(p_publishable, false),
    COALESCE(p_hard_blockers, '[]'::jsonb),
    COALESCE(p_soft_warnings, '[]'::jsonb),
    COALESCE(p_required_actions, '[]'::jsonb),
    p_audit_run_ref, p_mobile_proof_ref,
    COALESCE(NULLIF(p_decision_source, ''), 'publish_gate_v1')
  );

  IF COALESCE(p_publishable, false)
     AND p_snapshot_status IN ('approved', 'published')
     AND p_publication_state IN ('approved', 'published') THEN
    UPDATE public.public_package_snapshots
    SET status = 'superseded', superseded_at = v_now
    WHERE id = v_previous_published_snapshot_id
      AND id <> v_snapshot_id
      AND revoked_at IS NULL;
  END IF;

  IF NOT COALESCE(p_publishable, false)
     AND COALESCE(p_revoke_previous, false)
     AND v_previous_published_snapshot_id IS NOT NULL THEN
    UPDATE public.public_package_snapshots
    SET
      revoked_at = v_now,
      revocation_reason = COALESCE(NULLIF(p_revocation_reason, ''), 'explicit_candidate_rejection')
    WHERE id = v_previous_published_snapshot_id
      AND revoked_at IS NULL;
  END IF;

  UPDATE public.travel_packages AS tp
  SET
    status = CASE
      WHEN p_publishable THEN COALESCE(NULLIF(v_patch ->> 'status', ''), 'active')
      WHEN v_previous_published_snapshot_id IS NOT NULL AND NOT COALESCE(p_revoke_previous, false)
        THEN v_previous_status
      WHEN v_patch ? 'status' THEN v_patch ->> 'status'
      ELSE 'draft'
    END,
    publication_state = CASE
      WHEN p_publishable THEN p_publication_state
      WHEN v_previous_published_snapshot_id IS NOT NULL AND NOT COALESCE(p_revoke_previous, false)
        THEN v_previous_publication_state
      ELSE p_publication_state
    END,
    package_revision = p_package_revision,
    candidate_snapshot_id = v_snapshot_id,
    published_snapshot_id = CASE
      WHEN COALESCE(p_publishable, false)
       AND p_snapshot_status IN ('approved', 'published')
       AND p_publication_state IN ('approved', 'published')
        THEN v_snapshot_id
      WHEN v_previous_published_snapshot_id IS NOT NULL AND NOT COALESCE(p_revoke_previous, false)
        THEN v_previous_published_snapshot_id
      ELSE NULL
    END,
    title = CASE WHEN v_patch ? 'title' THEN v_patch ->> 'title' ELSE tp.title END,
    product_summary = CASE WHEN v_patch ? 'product_summary' THEN v_patch ->> 'product_summary' ELSE tp.product_summary END,
    notices_parsed = CASE WHEN v_patch ? 'notices_parsed' THEN v_patch -> 'notices_parsed' ELSE tp.notices_parsed END,
    customer_notes = CASE WHEN v_patch ? 'customer_notes' THEN v_patch ->> 'customer_notes' ELSE tp.customer_notes END,
    marketing_copies = CASE WHEN v_patch ? 'marketing_copies' THEN v_patch -> 'marketing_copies' ELSE tp.marketing_copies END,
    airline = CASE WHEN v_patch ? 'airline' THEN v_patch ->> 'airline' ELSE tp.airline END,
    price_dates = CASE WHEN v_patch ? 'price_dates' THEN v_patch -> 'price_dates' ELSE tp.price_dates END,
    optional_tours = CASE
      WHEN v_patch ? 'optional_tours' AND jsonb_typeof(v_patch -> 'optional_tours') = 'array'
        THEN v_patch -> 'optional_tours'
      ELSE tp.optional_tours
    END,
    itinerary_data = CASE
      WHEN v_patch ? 'itinerary_data' AND jsonb_typeof(v_patch -> 'itinerary_data') = 'object'
        THEN v_patch -> 'itinerary_data'
      ELSE tp.itinerary_data
    END,
    inclusions = CASE
      WHEN v_patch ? 'inclusions' AND jsonb_typeof(v_patch -> 'inclusions') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_patch -> 'inclusions'))
      ELSE tp.inclusions
    END,
    excludes = CASE
      WHEN v_patch ? 'excludes' AND jsonb_typeof(v_patch -> 'excludes') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(v_patch -> 'excludes'))
      ELSE tp.excludes
    END,
    audit_status = CASE WHEN v_patch ? 'audit_status' THEN v_patch ->> 'audit_status' ELSE tp.audit_status END,
    audit_report = CASE WHEN v_patch ? 'audit_report' THEN v_patch -> 'audit_report' ELSE tp.audit_report END,
    audit_checked_at = CASE
      WHEN v_patch ? 'audit_checked_at' AND NULLIF(v_patch ->> 'audit_checked_at', '') IS NOT NULL
        THEN (v_patch ->> 'audit_checked_at')::timestamptz
      ELSE tp.audit_checked_at
    END,
    updated_at = CASE
      WHEN v_patch ? 'updated_at' AND NULLIF(v_patch ->> 'updated_at', '') IS NOT NULL
        THEN (v_patch ->> 'updated_at')::timestamptz
      ELSE v_now
    END
  WHERE tp.id = p_package_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION 'travel_packages row not found for package_id %', p_package_id;
  END IF;

  IF jsonb_typeof(COALESCE(p_quarantine_candidates, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_quarantine_candidates must be a JSON array';
  END IF;

  IF jsonb_typeof(COALESCE(p_field_evidence_records, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_field_evidence_records must be a JSON array';
  END IF;

  INSERT INTO public.field_evidence_ledger (
    package_id,
    package_revision,
    field_path,
    normalized_value_hash,
    source_document_id,
    source_section,
    evidence_type,
    extractor_version,
    confidence,
    validation_status
  )
  SELECT
    p_package_id,
    p_package_revision,
    evidence ->> 'field_path',
    evidence ->> 'normalized_value_hash',
    p_source_raw_text_hash,
    NULLIF(evidence ->> 'source_section', ''),
    evidence ->> 'evidence_type',
    evidence ->> 'extractor_version',
    NULLIF(evidence ->> 'confidence', '')::numeric,
    COALESCE(NULLIF(evidence ->> 'validation_status', ''), 'candidate')
  FROM jsonb_array_elements(COALESCE(p_field_evidence_records, '[]'::jsonb)) AS evidence
  WHERE NULLIF(evidence ->> 'field_path', '') IS NOT NULL
    AND NULLIF(evidence ->> 'normalized_value_hash', '') IS NOT NULL
    AND NULLIF(evidence ->> 'evidence_type', '') IS NOT NULL
    AND NULLIF(evidence ->> 'extractor_version', '') IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.quarantined_package_fields (
    package_id,
    package_revision,
    field_path,
    old_value,
    original_value_hash,
    source_section,
    reason,
    reason_code,
    detector_rule_version,
    resolution_status,
    audit_payload,
    quarantined_at
  )
  SELECT
    p_package_id,
    p_package_revision,
    candidate ->> 'field_path',
    COALESCE(candidate -> 'old_value', 'null'::jsonb),
    candidate ->> 'original_value_hash',
    NULLIF(candidate ->> 'source_section', ''),
    candidate ->> 'reason_code',
    candidate ->> 'reason_code',
    candidate ->> 'detector_rule_version',
    COALESCE(NULLIF(candidate ->> 'resolution_status', ''), 'historical_quarantined'),
    COALESCE(candidate -> 'audit_payload', '{}'::jsonb),
    v_now
  FROM jsonb_array_elements(COALESCE(p_quarantine_candidates, '[]'::jsonb)) AS candidate
  WHERE NULLIF(candidate ->> 'field_path', '') IS NOT NULL
    AND NULLIF(candidate ->> 'original_value_hash', '') IS NOT NULL
    AND NULLIF(candidate ->> 'reason_code', '') IS NOT NULL
    AND NULLIF(candidate ->> 'detector_rule_version', '') IS NOT NULL
  ON CONFLICT (package_id, field_path, original_value_hash, detector_rule_version)
  DO UPDATE SET
    package_revision = EXCLUDED.package_revision,
    resolution_status = EXCLUDED.resolution_status,
    audit_payload = EXCLUDED.audit_payload,
    quarantined_at = EXCLUDED.quarantined_at,
    released_at = CASE
      WHEN EXCLUDED.resolution_status = 'released' THEN v_now
      ELSE NULL
    END;

  IF jsonb_typeof(COALESCE(p_render_proof_payload, '{}'::jsonb)) = 'object'
     AND NULLIF(p_render_proof_payload ->> 'proof_input_hash', '') IS NOT NULL
     AND jsonb_typeof(COALESCE(p_render_proof_payload -> 'surface_results', '[]'::jsonb)) = 'array' THEN
    INSERT INTO public.package_render_proofs (
      package_id,
      snapshot_id,
      public_snapshot_hash,
      proof_input_hash,
      route,
      viewport_profile_version,
      locale,
      status,
      screen_hash,
      customer_visible_hash,
      app_build_id,
      copy_template_version,
      proof_payload
    )
    SELECT
      p_package_id,
      v_snapshot_id,
      p_snapshot_hash,
      p_render_proof_payload ->> 'proof_input_hash',
      CASE surface_result ->> 'surface'
        WHEN 'packages' THEN '/packages/[id]'
        WHEN 'lp' THEN '/lp/[id]'
        ELSE '/' || (surface_result ->> 'surface')
      END,
      COALESCE(NULLIF(p_render_proof_payload ->> 'viewport_profile_version', ''), 'mobile-v1'),
      COALESCE(NULLIF(p_render_proof_payload ->> 'locale', ''), 'ko-KR'),
      CASE
        WHEN NULLIF(p_render_proof_payload ->> 'public_snapshot_hash', '') IS DISTINCT FROM p_snapshot_hash
          THEN 'stale_content'
        WHEN p_render_proof_payload ->> 'status' = 'pass'
          AND surface_result ->> 'status' = 'pass'
          THEN 'passed'
        ELSE 'failed'
      END,
      NULLIF(surface_result ->> 'screen_hash', ''),
      NULLIF(surface_result ->> 'customer_visible_hash', ''),
      NULLIF(p_render_proof_payload ->> 'app_build_id', ''),
      NULLIF(p_render_proof_payload ->> 'copy_template_version', ''),
      p_render_proof_payload
    FROM jsonb_array_elements(p_render_proof_payload -> 'surface_results') AS surface_result
    WHERE NULLIF(surface_result ->> 'surface', '') IS NOT NULL
    ON CONFLICT (
      package_id,
      snapshot_id,
      proof_input_hash,
      route,
      viewport_profile_version,
      locale
    )
    DO UPDATE SET
      status = EXCLUDED.status,
      screen_hash = EXCLUDED.screen_hash,
      customer_visible_hash = EXCLUDED.customer_visible_hash,
      app_build_id = EXCLUDED.app_build_id,
      copy_template_version = EXCLUDED.copy_template_version,
      proof_payload = EXCLUDED.proof_payload,
      created_at = v_now;
  END IF;

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'package_revision', p_package_revision,
    'candidate_snapshot_id', v_snapshot_id,
    'published_snapshot_id', CASE
      WHEN COALESCE(p_publishable, false)
       AND p_snapshot_status IN ('approved', 'published')
       AND p_publication_state IN ('approved', 'published')
        THEN v_snapshot_id
      WHEN v_previous_published_snapshot_id IS NOT NULL AND NOT COALESCE(p_revoke_previous, false)
        THEN v_previous_published_snapshot_id
      ELSE NULL
    END,
    'public_snapshot_hash', p_snapshot_hash,
    'publication_state', p_publication_state,
    'publishable', COALESCE(p_publishable, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_package_snapshot_atomic(
  uuid, bigint, jsonb, text, jsonb, jsonb, jsonb, jsonb, text, text,
  text, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text,
  jsonb, jsonb, jsonb, boolean, text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.publish_package_snapshot_atomic(
  uuid, bigint, jsonb, text, jsonb, jsonb, jsonb, jsonb, text, text,
  text, text, text, text, boolean, jsonb, jsonb, jsonb, text, text, text,
  jsonb, jsonb, jsonb, boolean, text
) TO service_role;
