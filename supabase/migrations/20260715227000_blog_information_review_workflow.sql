-- Durable information-only evidence review workflow.
-- Product evidence, product snapshots, and product publication remain untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS public.blog_information_review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE SET NULL,
  creative_id uuid NOT NULL REFERENCES public.content_creatives(id) ON DELETE CASCADE,
  content_key text NOT NULL,
  intent_type text NOT NULL,
  risk_level text NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'researching', 'pending_review', 'changes_requested',
    'approved', 'ready', 'published', 'rejected'
  )),
  content_fingerprint char(64) NOT NULL CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
  validator_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by uuid NULL,
  approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT blog_information_review_cases_approval_pair CHECK (
    (approved_by IS NULL AND approved_at IS NULL)
    OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
  ),
  UNIQUE (creative_id)
);

CREATE TABLE IF NOT EXISTS public.blog_information_review_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_case_id uuid NOT NULL REFERENCES public.blog_information_review_cases(id) ON DELETE CASCADE,
  creative_id uuid NOT NULL REFERENCES public.content_creatives(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'research_validated', 'research_missing', 'approved', 'changes_requested',
    'rejected', 'publish_revalidated', 'published'
  )),
  actor_id uuid NULL,
  from_status text NULL,
  to_status text NULL,
  content_fingerprint char(64) NOT NULL CHECK (content_fingerprint ~ '^[0-9a-f]{64}$'),
  validator_report jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.content_review_queue
  ADD COLUMN IF NOT EXISTS information_review_case_id uuid NULL
  REFERENCES public.blog_information_review_cases(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_blog_information_review_cases_status
  ON public.blog_information_review_cases (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_blog_information_review_events_case
  ON public.blog_information_review_events (review_case_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.reject_blog_information_review_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'blog_information_review_events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS blog_information_review_events_append_only
  ON public.blog_information_review_events;
CREATE TRIGGER blog_information_review_events_append_only
  BEFORE UPDATE OR DELETE ON public.blog_information_review_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_blog_information_review_event_mutation();

CREATE OR REPLACE FUNCTION public.decide_blog_information_review(
  p_case_id uuid,
  p_creative_id uuid,
  p_decision text,
  p_actor_id uuid,
  p_content_fingerprint char(64),
  p_validator_report jsonb,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case public.blog_information_review_cases%ROWTYPE;
  v_creative public.content_creatives%ROWTYPE;
  v_actual_fingerprint text;
  v_target_status text;
BEGIN
  IF p_decision NOT IN ('approved', 'rejected', 'changes_requested') THEN
    RAISE EXCEPTION 'invalid information review decision';
  END IF;

  SELECT * INTO v_case
  FROM public.blog_information_review_cases
  WHERE id = p_case_id AND creative_id = p_creative_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'information review case not found'; END IF;

  SELECT * INTO v_creative
  FROM public.content_creatives
  WHERE id = p_creative_id
  FOR UPDATE;
  IF NOT FOUND OR v_creative.product_id IS NOT NULL THEN
    RAISE EXCEPTION 'information-only creative required';
  END IF;

  v_actual_fingerprint := encode(extensions.digest(concat_ws(E'\n',
    COALESCE(v_creative.blog_html, ''),
    COALESCE(v_creative.seo_title, ''),
    COALESCE(v_creative.seo_description, ''),
    COALESCE(v_creative.slug, '')
  ), 'sha256'), 'hex');

  IF p_decision = 'approved' THEN
    IF v_actual_fingerprint <> p_content_fingerprint::text THEN
      RAISE EXCEPTION 'reviewed content changed';
    END IF;
    IF COALESCE((p_validator_report ->> 'passed')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'latest evidence validation did not pass';
    END IF;
    v_target_status := 'approved';
  ELSE
    v_target_status := p_decision;
  END IF;

  UPDATE public.blog_information_review_cases
  SET status = v_target_status,
      content_fingerprint = v_actual_fingerprint,
      validator_report = COALESCE(p_validator_report, '{}'::jsonb),
      approved_by = CASE WHEN p_decision = 'approved' THEN p_actor_id ELSE NULL END,
      approved_at = CASE WHEN p_decision = 'approved' THEN now() ELSE NULL END,
      updated_at = now()
  WHERE id = p_case_id;

  UPDATE public.content_creatives
  SET review_status = CASE
        WHEN p_decision = 'approved' THEN 'approved'
        WHEN p_decision = 'rejected' THEN 'rejected'
        ELSE 'changes_requested'
      END,
      status = CASE WHEN p_decision = 'approved' THEN status ELSE 'draft' END,
      published_at = CASE WHEN p_decision = 'approved' THEN published_at ELSE NULL END
  WHERE id = p_creative_id;

  INSERT INTO public.content_reviews (
    creative_id, reviewer_id, status, review_note, review_round,
    reviewed_at, completed_at
  ) VALUES (
    p_creative_id, p_actor_id, p_decision, p_note,
    COALESCE((SELECT max(review_round) + 1 FROM public.content_reviews WHERE creative_id = p_creative_id), 1),
    now(), now()
  );

  UPDATE public.content_review_queue
  SET status = 'completed'
  WHERE information_review_case_id = p_case_id
    AND status IN ('queued', 'assigned');

  INSERT INTO public.blog_information_review_events (
    review_case_id, creative_id, action, actor_id, from_status, to_status,
    content_fingerprint, validator_report, note
  ) VALUES (
    p_case_id, p_creative_id, p_decision, p_actor_id, v_case.status, v_target_status,
    v_actual_fingerprint, COALESCE(p_validator_report, '{}'::jsonb), p_note
  );

  RETURN p_case_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_blog_information_reviewed_draft(
  p_case_id uuid,
  p_creative_id uuid,
  p_actor_id uuid,
  p_content_fingerprint char(64),
  p_validation_meta jsonb,
  p_published_at timestamptz
)
RETURNS TABLE (creative_id uuid, slug text, published_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case public.blog_information_review_cases%ROWTYPE;
  v_creative public.content_creatives%ROWTYPE;
  v_actual_fingerprint text;
BEGIN
  SELECT * INTO v_case
  FROM public.blog_information_review_cases
  WHERE id = p_case_id AND creative_id = p_creative_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'information review case not found'; END IF;

  SELECT * INTO v_creative
  FROM public.content_creatives
  WHERE id = p_creative_id
  FOR UPDATE;
  IF NOT FOUND OR v_creative.product_id IS NOT NULL THEN
    RAISE EXCEPTION 'information-only creative required';
  END IF;
  IF v_creative.status NOT IN ('draft', 'pending') THEN
    RAISE EXCEPTION 'information creative is not a private draft';
  END IF;
  IF v_case.status NOT IN ('ready', 'approved') THEN
    RAISE EXCEPTION 'information review case is not publishable';
  END IF;
  IF v_case.risk_level = 'HIGH' AND v_case.status <> 'approved' THEN
    RAISE EXCEPTION 'high-risk information requires human approval';
  END IF;

  v_actual_fingerprint := encode(extensions.digest(concat_ws(E'\n',
    COALESCE(v_creative.blog_html, ''),
    COALESCE(v_creative.seo_title, ''),
    COALESCE(v_creative.seo_description, ''),
    COALESCE(v_creative.slug, '')
  ), 'sha256'), 'hex');
  IF v_actual_fingerprint <> p_content_fingerprint::text
    OR v_actual_fingerprint <> v_case.content_fingerprint::text THEN
    RAISE EXCEPTION 'approved content changed; reapproval required';
  END IF;

  INSERT INTO public.blog_information_review_events (
    review_case_id, creative_id, action, actor_id, from_status, to_status,
    content_fingerprint, validator_report
  ) VALUES (
    p_case_id, p_creative_id, 'publish_revalidated', p_actor_id,
    v_case.status, v_case.status, v_actual_fingerprint,
    COALESCE(p_validation_meta -> 'information_claim_validation', '{}'::jsonb)
  );

  UPDATE public.content_creatives
  SET status = 'published',
      published_at = p_published_at,
      generation_meta = COALESCE(generation_meta, '{}'::jsonb) || COALESCE(p_validation_meta, '{}'::jsonb),
      updated_at = now()
  WHERE id = p_creative_id;

  UPDATE public.blog_information_review_cases
  SET status = 'published', updated_at = now()
  WHERE id = p_case_id;

  UPDATE public.content_review_queue
  SET status = 'completed'
  WHERE information_review_case_id = p_case_id
    AND status IN ('queued', 'assigned');

  INSERT INTO public.blog_information_review_events (
    review_case_id, creative_id, action, actor_id, from_status, to_status,
    content_fingerprint, validator_report
  ) VALUES (
    p_case_id, p_creative_id, 'published', p_actor_id,
    v_case.status, 'published', v_actual_fingerprint,
    COALESCE(p_validation_meta -> 'information_claim_validation', '{}'::jsonb)
  );

  RETURN QUERY SELECT p_creative_id, v_creative.slug, p_published_at;
END;
$$;

ALTER TABLE public.blog_information_review_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_information_review_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.blog_information_review_cases FROM public, anon, authenticated;
REVOKE ALL ON TABLE public.blog_information_review_events FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.blog_information_review_cases TO service_role;
GRANT SELECT, INSERT ON TABLE public.blog_information_review_events TO service_role;

CREATE POLICY blog_information_review_cases_service_role
  ON public.blog_information_review_cases FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY blog_information_review_events_service_select
  ON public.blog_information_review_events FOR SELECT TO service_role USING (true);
CREATE POLICY blog_information_review_events_service_insert
  ON public.blog_information_review_events FOR INSERT TO service_role WITH CHECK (true);

REVOKE ALL ON FUNCTION public.reject_blog_information_review_event_mutation() FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_blog_information_review(uuid, uuid, text, uuid, char, jsonb, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_blog_information_reviewed_draft(uuid, uuid, uuid, char, jsonb, timestamptz) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_blog_information_review_event_mutation() TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_blog_information_review(uuid, uuid, text, uuid, char, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_blog_information_reviewed_draft(uuid, uuid, uuid, char, jsonb, timestamptz) TO service_role;

COMMIT;
