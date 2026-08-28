-- ChatGPT-authenticated Codex worker handoff for the shared media ledger.
-- The public table remains service-role only; the worker receives only the
-- narrow Next.js API token and never a Supabase service key.

ALTER TABLE public.media_assets
  DROP CONSTRAINT IF EXISTS media_assets_provider_check,
  DROP CONSTRAINT IF EXISTS media_assets_status_check;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_provider_check
    CHECK (provider IS NULL OR provider IN ('openai', 'codex_builtin', 'code')),
  ADD CONSTRAINT media_assets_status_check
    CHECK (status IN (
      'pending',
      'generating',
      'pending_review',
      'approved',
      'rejected',
      'failed',
      'superseded'
    )),
  ADD COLUMN IF NOT EXISTS attempt_count smallint NOT NULL DEFAULT 0
    CHECK (attempt_count >= 0 AND attempt_count <= 2),
  ADD COLUMN IF NOT EXISTS attempt_day date NULL,
  ADD COLUMN IF NOT EXISTS attempts_on_day smallint NOT NULL DEFAULT 0
    CHECK (attempts_on_day >= 0 AND attempts_on_day <= 2),
  ADD COLUMN IF NOT EXISTS lease_owner text NULL
    CHECK (lease_owner IS NULL OR char_length(lease_owner) BETWEEN 8 AND 120),
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_error_code text NULL
    CHECK (last_error_code IS NULL OR char_length(last_error_code) <= 80);

CREATE INDEX IF NOT EXISTS media_assets_codex_claim_idx
  ON public.media_assets (status, next_attempt_at, created_at)
  WHERE provider = 'codex_builtin';

CREATE INDEX IF NOT EXISTS media_assets_codex_attempt_day_idx
  ON public.media_assets (attempt_day)
  WHERE provider = 'codex_builtin';

COMMENT ON COLUMN public.media_assets.lease_owner IS
  'Short-lived Codex scheduled-task run identifier; never an admin or Supabase credential.';
COMMENT ON COLUMN public.media_assets.attempts_on_day IS
  'Conservative KST daily subscription-generation guard, reset when attempt_day changes.';

CREATE OR REPLACE FUNCTION public.claim_codex_media_job_v1(
  p_worker_run_id text,
  p_now timestamptz,
  p_attempt_day date,
  p_lease_expires_at timestamptz,
  p_daily_limit integer
)
RETURNS SETOF public.media_assets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_candidate public.media_assets%ROWTYPE;
  v_used integer;
  v_limit integer := greatest(1, least(coalesce(p_daily_limit, 6), 30));
BEGIN
  IF p_worker_run_id IS NULL
    OR p_worker_run_id !~ '^[a-zA-Z0-9:_-]{8,120}$'
    OR p_now IS NULL
    OR p_attempt_day IS NULL
    OR p_lease_expires_at IS NULL
    OR p_lease_expires_at <= p_now THEN
    RAISE EXCEPTION 'invalid codex media claim input';
  END IF;

  -- One transaction at a time owns the KST allowance counter. Row locking alone
  -- is insufficient because concurrent workers could claim different rows.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('media_codex_daily:' || p_attempt_day::text)
  );

  SELECT coalesce(sum(attempts_on_day), 0)::integer
    INTO v_used
    FROM public.media_assets
   WHERE provider = 'codex_builtin'
     AND attempt_day = p_attempt_day;

  IF v_used >= v_limit THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_candidate
    FROM public.media_assets
   WHERE provider = 'codex_builtin'
     AND status = 'pending'
     AND attempt_count < 2
     AND (next_attempt_at IS NULL OR next_attempt_at <= p_now)
   ORDER BY created_at ASC
   FOR UPDATE SKIP LOCKED
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.media_assets
     SET status = 'generating',
         attempt_count = v_candidate.attempt_count + 1,
         attempt_day = p_attempt_day,
         attempts_on_day = CASE
           WHEN v_candidate.attempt_day = p_attempt_day THEN v_candidate.attempts_on_day + 1
           ELSE 1
         END,
         lease_owner = p_worker_run_id,
         lease_expires_at = p_lease_expires_at,
         last_error_code = NULL,
         updated_at = p_now
   WHERE id = v_candidate.id
   RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_codex_media_job_v1(text, timestamptz, date, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_codex_media_job_v1(text, timestamptz, date, timestamptz, integer)
  TO service_role;

COMMENT ON FUNCTION public.claim_codex_media_job_v1(text, timestamptz, date, timestamptz, integer) IS
  'Atomically claims one Codex media row with SKIP LOCKED and a KST daily advisory lock. Service-role only.';
