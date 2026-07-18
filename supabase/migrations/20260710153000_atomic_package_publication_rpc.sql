-- Atomic customer publication RPC.
-- Keeps the final customer-open transition in one database transaction:
-- public_package_snapshots upsert -> package_publish_decisions insert -> travel_packages final update.

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
  p_decision_source text DEFAULT 'publish_gate_v1'
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
    mobile_proof_revision,
    app_build_id,
    status,
    published_at,
    superseded_at
  )
  VALUES (
    p_package_id,
    p_package_revision,
    p_snapshot_hash,
    p_snapshot_json,
    COALESCE(p_card_projection, '{}'::jsonb),
    COALESCE(p_lp_projection, '{}'::jsonb),
    COALESCE(p_route_text_dump, '[]'::jsonb),
    p_source_raw_text_hash,
    p_audit_revision,
    p_mobile_proof_revision,
    p_app_build_id,
    p_snapshot_status,
    CASE WHEN p_snapshot_status = 'published' THEN v_now ELSE NULL END,
    NULL
  )
  ON CONFLICT (package_id, snapshot_hash)
  DO UPDATE SET
    package_revision = EXCLUDED.package_revision,
    snapshot_json = EXCLUDED.snapshot_json,
    card_projection = EXCLUDED.card_projection,
    lp_projection = EXCLUDED.lp_projection,
    route_text_dump = EXCLUDED.route_text_dump,
    source_raw_text_hash = EXCLUDED.source_raw_text_hash,
    audit_revision = EXCLUDED.audit_revision,
    mobile_proof_revision = EXCLUDED.mobile_proof_revision,
    app_build_id = EXCLUDED.app_build_id,
    status = EXCLUDED.status,
    published_at = EXCLUDED.published_at,
    superseded_at = NULL
  RETURNING id INTO v_snapshot_id;

  INSERT INTO public.package_publish_decisions (
    package_id,
    package_revision,
    public_snapshot_id,
    public_snapshot_hash,
    publication_state,
    publishable,
    hard_blockers,
    soft_warnings,
    required_actions,
    audit_run_ref,
    mobile_proof_ref,
    decision_source
  )
  VALUES (
    p_package_id,
    p_package_revision,
    v_snapshot_id,
    p_snapshot_hash,
    p_publication_state,
    COALESCE(p_publishable, false),
    COALESCE(p_hard_blockers, '[]'::jsonb),
    COALESCE(p_soft_warnings, '[]'::jsonb),
    COALESCE(p_required_actions, '[]'::jsonb),
    p_audit_run_ref,
    p_mobile_proof_ref,
    COALESCE(NULLIF(p_decision_source, ''), 'publish_gate_v1')
  );

  UPDATE public.travel_packages AS tp
  SET
    status = CASE
      WHEN v_patch ? 'status' THEN v_patch ->> 'status'
      WHEN p_publishable THEN 'active'
      ELSE 'draft'
    END,
    publication_state = p_publication_state,
    package_revision = p_package_revision,
    title = CASE WHEN v_patch ? 'title' THEN v_patch ->> 'title' ELSE tp.title END,
    product_summary = CASE WHEN v_patch ? 'product_summary' THEN v_patch ->> 'product_summary' ELSE tp.product_summary END,
    notices_parsed = CASE WHEN v_patch ? 'notices_parsed' THEN v_patch -> 'notices_parsed' ELSE tp.notices_parsed END,
    customer_notes = CASE WHEN v_patch ? 'customer_notes' THEN v_patch ->> 'customer_notes' ELSE tp.customer_notes END,
    marketing_copies = CASE WHEN v_patch ? 'marketing_copies' THEN v_patch -> 'marketing_copies' ELSE tp.marketing_copies END,
    airline = CASE WHEN v_patch ? 'airline' THEN v_patch ->> 'airline' ELSE tp.airline END,
    price_dates = CASE WHEN v_patch ? 'price_dates' THEN v_patch -> 'price_dates' ELSE tp.price_dates END,
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

  RETURN jsonb_build_object(
    'package_id', p_package_id,
    'package_revision', p_package_revision,
    'public_snapshot_id', v_snapshot_id,
    'public_snapshot_hash', p_snapshot_hash,
    'publication_state', p_publication_state,
    'publishable', COALESCE(p_publishable, false)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_package_snapshot_atomic(
  uuid,
  bigint,
  jsonb,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.publish_package_snapshot_atomic(
  uuid,
  bigint,
  jsonb,
  text,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  text,
  text,
  text,
  text,
  boolean,
  jsonb,
  jsonb,
  jsonb,
  text,
  text,
  text
) TO service_role;
