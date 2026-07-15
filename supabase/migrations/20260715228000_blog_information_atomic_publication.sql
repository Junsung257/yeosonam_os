-- Publish an informational draft, activate its canonical representative, and
-- create its indexing outbox job in one transaction. Product publication is
-- deliberately rejected and no product table or snapshot is touched.

BEGIN;

ALTER TABLE public.blog_information_representatives
  ADD COLUMN IF NOT EXISTS reservation_expires_at timestamptz NULL;

ALTER TABLE public.blog_indexing_jobs
  ADD COLUMN IF NOT EXISTS idempotency_key text NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_indexing_jobs_idempotency_key
  ON public.blog_indexing_jobs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.blog_information_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  creative_id uuid NOT NULL REFERENCES public.content_creatives(id) ON DELETE RESTRICT,
  review_case_id uuid NULL REFERENCES public.blog_information_review_cases(id) ON DELETE RESTRICT,
  representative_key text NOT NULL REFERENCES public.blog_information_representatives(representative_key) ON DELETE RESTRICT,
  content_fingerprint char(64) NOT NULL CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
  canonical_slug text NOT NULL CHECK (btrim(canonical_slug) <> ''),
  indexing_job_id uuid NOT NULL REFERENCES public.blog_indexing_jobs(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL,
  actor_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blog_information_publications_idempotency_not_blank
    CHECK (btrim(idempotency_key) <> ''),
  UNIQUE (creative_id, content_fingerprint)
);

ALTER TABLE public.blog_information_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.blog_information_publications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.blog_information_publications TO service_role;

DROP POLICY IF EXISTS blog_information_publications_service_role
  ON public.blog_information_publications;
CREATE POLICY blog_information_publications_service_role
  ON public.blog_information_publications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.publish_blog_information_atomically(
  p_creative_id uuid,
  p_case_id uuid,
  p_actor_id uuid,
  p_content_fingerprint char(64),
  p_validation_meta jsonb,
  p_quality_gate jsonb,
  p_published_at timestamptz,
  p_representative_key text,
  p_destination_id text,
  p_intent text,
  p_audience text,
  p_locale text,
  p_reservation_owner text,
  p_idempotency_key text
)
RETURNS TABLE (
  creative_id uuid,
  slug text,
  published_at timestamptz,
  representative_key text,
  indexing_job_id uuid,
  idempotent boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case public.blog_information_review_cases%ROWTYPE;
  v_creative public.content_creatives%ROWTYPE;
  v_representative public.blog_information_representatives%ROWTYPE;
  v_publication public.blog_information_publications%ROWTYPE;
  v_claim public.blog_information_claims%ROWTYPE;
  v_actual_fingerprint text;
  v_quality_gate jsonb;
  v_claim_validation jsonb;
  v_brief jsonb;
  v_job_id uuid;
  v_url text;
  v_now timestamptz := COALESCE(p_published_at, now());
BEGIN
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL
    OR NULLIF(btrim(p_representative_key), '') IS NULL
    OR NULLIF(btrim(p_reservation_owner), '') IS NULL THEN
    RAISE EXCEPTION 'informational publication identifiers are required';
  END IF;
  IF p_intent NOT IN (
    'food_budget', 'monthly_weather', 'airport_transport', 'hotel_areas',
    'family_budget', 'itinerary', 'shopping_souvenirs', 'currency_payment',
    'entry_requirements', 'travel_insurance'
  ) THEN
    RAISE EXCEPTION 'invalid informational publication intent';
  END IF;
  IF p_audience NOT IN ('general', 'family', 'couple', 'solo', 'senior', 'student')
    OR p_locale !~ '^[a-z]{2}(-[A-Z]{2})?$' THEN
    RAISE EXCEPTION 'invalid informational publication audience or locale';
  END IF;
  IF p_representative_key <> concat('v1|', p_destination_id, '|', p_intent, '|', p_audience, '|', p_locale) THEN
    RAISE EXCEPTION 'informational representative key does not match identity';
  END IF;

  -- The two advisory locks serialize retries and same-identity contenders.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key, 0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_representative_key, 0));

  SELECT * INTO v_publication
  FROM public.blog_information_publications AS publication
  WHERE publication.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_publication.creative_id <> p_creative_id
      OR v_publication.representative_key <> p_representative_key
      OR v_publication.content_fingerprint::text <> p_content_fingerprint::text THEN
      RAISE EXCEPTION 'informational publication idempotency key was reused for different content';
    END IF;
    RETURN QUERY SELECT
      v_publication.creative_id,
      v_publication.canonical_slug,
      v_publication.published_at,
      v_publication.representative_key,
      v_publication.indexing_job_id,
      true;
    RETURN;
  END IF;

  SELECT * INTO v_case
  FROM public.blog_information_review_cases AS review_case
  WHERE review_case.creative_id = p_creative_id
    AND (p_case_id IS NULL OR review_case.id = p_case_id)
  FOR UPDATE;
  IF p_case_id IS NOT NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'information review case not found';
  END IF;

  SELECT * INTO v_creative
  FROM public.content_creatives AS creative
  WHERE creative.id = p_creative_id
  FOR UPDATE;
  IF NOT FOUND OR v_creative.product_id IS NOT NULL THEN
    RAISE EXCEPTION 'information-only creative required';
  END IF;
  IF v_creative.status NOT IN ('draft', 'pending', 'published') THEN
    RAISE EXCEPTION 'information creative is not publishable';
  END IF;
  IF NULLIF(btrim(v_creative.slug), '') IS NULL THEN
    RAISE EXCEPTION 'information creative slug is required';
  END IF;

  v_actual_fingerprint := encode(extensions.digest(concat_ws(E'\n',
    COALESCE(v_creative.blog_html, ''),
    COALESCE(v_creative.seo_title, ''),
    COALESCE(v_creative.seo_description, ''),
    COALESCE(v_creative.slug, '')
  ), 'sha256'), 'hex');
  IF v_actual_fingerprint <> p_content_fingerprint::text THEN
    RAISE EXCEPTION 'information publication content changed';
  END IF;

  v_quality_gate := COALESCE(p_quality_gate, v_creative.quality_gate, '{}'::jsonb);
  IF COALESCE((v_quality_gate ->> 'passed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'latest information quality gate did not pass';
  END IF;
  v_claim_validation := COALESCE(
    p_validation_meta -> 'information_claim_validation',
    v_creative.generation_meta -> 'information_claim_validation',
    '{}'::jsonb
  );
  IF COALESCE((v_claim_validation ->> 'passed')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'latest information claim validation did not pass';
  END IF;

  v_brief := COALESCE(v_creative.generation_meta -> 'content_brief', '{}'::jsonb);
  IF COALESCE(v_brief ->> 'destination_id', '') <> p_destination_id
    OR COALESCE(v_brief ->> 'intent_type', '') <> p_intent
    OR COALESCE(v_brief ->> 'audience', '') <> p_audience
    OR COALESCE(v_brief ->> 'locale', '') <> p_locale THEN
    RAISE EXCEPTION 'persisted informational identity does not match publication identity';
  END IF;

  IF v_case.id IS NOT NULL THEN
    IF v_case.status NOT IN ('ready', 'approved', 'published')
      OR v_case.content_fingerprint::text <> v_actual_fingerprint
      OR COALESCE((v_case.validator_report ->> 'passed')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'latest information review is not publishable';
    END IF;
  END IF;
  IF p_intent IN ('entry_requirements', 'travel_insurance')
    AND (v_case.id IS NULL OR v_case.status NOT IN ('approved', 'published') OR v_case.approved_by IS NULL) THEN
    RAISE EXCEPTION 'high-risk information requires current human approval';
  END IF;

  -- Lock every persisted claim so a concurrent review mutation cannot race the
  -- final public transition.
  FOR v_claim IN
    SELECT * FROM public.blog_information_claims AS claim
    WHERE claim.creative_id = p_creative_id
    FOR SHARE
  LOOP
    IF v_claim.requires_evidence
      AND v_claim.validation_status NOT IN ('supported', 'approved') THEN
      RAISE EXCEPTION 'information claim is not publishable: %', v_claim.claim_fingerprint;
    END IF;
  END LOOP;

  SELECT * INTO v_representative
  FROM public.blog_information_representatives AS representative
  WHERE representative.representative_key = p_representative_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_representative.destination_id <> p_destination_id
      OR v_representative.intent <> p_intent
      OR v_representative.audience <> p_audience
      OR v_representative.locale <> p_locale THEN
      RAISE EXCEPTION 'informational representative identity mismatch';
    END IF;
    IF v_representative.status = 'retired' THEN
      RAISE EXCEPTION 'informational representative requires human retirement review';
    END IF;
    IF v_representative.status = 'active'
      AND (v_representative.canonical_creative_id <> p_creative_id
        OR v_representative.canonical_slug <> v_creative.slug) THEN
      RAISE EXCEPTION 'informational representative update_existing_required:%', v_representative.canonical_slug;
    END IF;
    IF v_representative.status = 'reserved'
      AND v_representative.canonical_creative_id IS NOT NULL
      AND v_representative.canonical_creative_id <> p_creative_id THEN
      RAISE EXCEPTION 'informational representative reservation belongs to another draft';
    END IF;
    IF v_representative.status = 'reserved'
      AND v_representative.reservation_owner <> p_reservation_owner
      AND v_representative.canonical_creative_id IS NULL
      AND COALESCE(v_representative.reservation_expires_at, v_representative.reserved_at + interval '30 minutes') <= now() THEN
      RAISE EXCEPTION 'informational representative reservation expired; explicit recovery required';
    END IF;
    IF v_representative.status = 'reserved'
      AND v_representative.reservation_owner <> p_reservation_owner
      AND v_representative.canonical_creative_id IS NULL THEN
      RAISE EXCEPTION 'informational representative reservation is owned by another publisher';
    END IF;
  ELSE
    INSERT INTO public.blog_information_representatives (
      representative_key, destination_id, intent, audience, locale,
      status, reservation_owner, reservation_expires_at
    ) VALUES (
      p_representative_key, p_destination_id, p_intent, p_audience, p_locale,
      'reserved', p_reservation_owner, now() + interval '30 minutes'
    )
    RETURNING * INTO v_representative;
  END IF;

  -- The public article transition intentionally occurs before representative
  -- activation and outbox creation. Any later exception rolls all three back.
  UPDATE public.content_creatives
  SET status = 'published',
      published_at = v_now,
      quality_gate = v_quality_gate,
      generation_meta = COALESCE(generation_meta, '{}'::jsonb)
        || COALESCE(p_validation_meta, '{}'::jsonb)
        || jsonb_build_object('information_representative', jsonb_build_object(
          'representative_key', p_representative_key,
          'status', 'active',
          'canonical_slug', v_creative.slug,
          'decision', CASE WHEN v_representative.status = 'active' THEN 'UPDATE_EXISTING' ELSE 'RESERVE_CREATE' END
        )),
      updated_at = now()
  WHERE id = p_creative_id;

  UPDATE public.blog_information_representatives AS representative
  SET canonical_creative_id = p_creative_id,
      canonical_slug = v_creative.slug,
      status = 'active',
      reservation_owner = p_reservation_owner,
      reservation_expires_at = NULL,
      activated_at = COALESCE(activated_at, now()),
      updated_at = now()
  WHERE representative.representative_key = p_representative_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'informational representative activation failed';
  END IF;

  v_url := concat('https://www.yeosonam.com/blog/', v_creative.slug);
  INSERT INTO public.blog_indexing_jobs (
    content_creative_id, slug, url, source, type, status,
    next_attempt_at, updated_at, idempotency_key
  ) VALUES (
    p_creative_id, v_creative.slug, v_url, 'information_atomic_publish',
    'URL_UPDATED', 'pending', now(), now(), p_idempotency_key
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_job_id;

  IF v_job_id IS NULL THEN
    SELECT id INTO v_job_id
    FROM public.blog_indexing_jobs AS indexing_job
    WHERE indexing_job.idempotency_key = p_idempotency_key
      OR (indexing_job.url = v_url
        AND indexing_job.type = 'URL_UPDATED'
        AND indexing_job.status IN ('pending', 'retry', 'processing'))
    ORDER BY CASE WHEN indexing_job.idempotency_key = p_idempotency_key THEN 0 ELSE 1 END,
      indexing_job.created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;
  IF v_job_id IS NULL THEN
    RAISE EXCEPTION 'informational publication indexing outbox failed';
  END IF;

  IF v_case.id IS NOT NULL AND v_case.status <> 'published' THEN
    INSERT INTO public.blog_information_review_events (
      review_case_id, creative_id, action, actor_id, from_status, to_status,
      content_fingerprint, validator_report
    ) VALUES (
      v_case.id, p_creative_id, 'publish_revalidated', p_actor_id,
      v_case.status, v_case.status, v_actual_fingerprint, v_claim_validation
    );
    UPDATE public.blog_information_review_cases
    SET status = 'published', updated_at = now()
    WHERE id = v_case.id;
    UPDATE public.content_review_queue
    SET status = 'completed'
    WHERE information_review_case_id = v_case.id
      AND status IN ('queued', 'assigned');
    INSERT INTO public.blog_information_review_events (
      review_case_id, creative_id, action, actor_id, from_status, to_status,
      content_fingerprint, validator_report
    ) VALUES (
      v_case.id, p_creative_id, 'published', p_actor_id,
      v_case.status, 'published', v_actual_fingerprint, v_claim_validation
    );
  END IF;

  INSERT INTO public.blog_information_publications (
    idempotency_key, creative_id, review_case_id, representative_key,
    content_fingerprint, canonical_slug, indexing_job_id, published_at, actor_id
  ) VALUES (
    p_idempotency_key, p_creative_id, v_case.id, p_representative_key,
    v_actual_fingerprint, v_creative.slug, v_job_id, v_now, p_actor_id
  )
  RETURNING * INTO v_publication;

  RETURN QUERY SELECT
    v_publication.creative_id,
    v_publication.canonical_slug,
    v_publication.published_at,
    v_publication.representative_key,
    v_publication.indexing_job_id,
    false;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_blog_information_atomically(
  uuid, uuid, uuid, char, jsonb, jsonb, timestamptz,
  text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_blog_information_atomically(
  uuid, uuid, uuid, char, jsonb, jsonb, timestamptz,
  text, text, text, text, text, text, text
) TO service_role;

COMMENT ON FUNCTION public.publish_blog_information_atomically(
  uuid, uuid, uuid, char, jsonb, jsonb, timestamptz,
  text, text, text, text, text, text, text
) IS 'Atomic information-only publication: current gates, canonical representative, public state, and indexing outbox.';

-- Remove the earlier public-transition function so new callers cannot bypass
-- representative activation or durable outbox creation.
REVOKE ALL ON FUNCTION public.publish_blog_information_reviewed_draft(
  uuid, uuid, uuid, char, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
DROP FUNCTION public.publish_blog_information_reviewed_draft(
  uuid, uuid, uuid, char, jsonb, timestamptz
);

COMMIT;
