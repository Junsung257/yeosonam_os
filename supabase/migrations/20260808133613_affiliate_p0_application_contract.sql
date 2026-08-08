BEGIN;

-- Reconcile the active production schema with the application API contract.
-- Existing rows remain untouched: nullable backfill fields are populated only
-- by new submissions, so a deployment can validate legacy rows separately.
ALTER TABLE public.affiliate_applications
  ADD COLUMN IF NOT EXISTS has_invite_code boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS terms_bundle_version text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_applications_normalized_phone_chk'
      AND conrelid = 'public.affiliate_applications'::regclass
  ) THEN
    ALTER TABLE public.affiliate_applications
      ADD CONSTRAINT affiliate_applications_normalized_phone_chk
      CHECK (normalized_phone IS NULL OR normalized_phone ~ '^[0-9]{8,15}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'affiliate_applications_idempotency_key_chk'
      AND conrelid = 'public.affiliate_applications'::regclass
  ) THEN
    ALTER TABLE public.affiliate_applications
      ADD CONSTRAINT affiliate_applications_idempotency_key_chk
      CHECK (
        idempotency_key IS NULL
        OR char_length(idempotency_key) BETWEEN 8 AND 128
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS affiliate_applications_idempotency_key_uq
  ON public.affiliate_applications(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- The partial index is the concurrency boundary for two simultaneous active
-- submissions from the same normalized phone number. Legacy NULL rows are
-- intentionally excluded until the separate verification backfill is approved.
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_applications_active_phone_uq
  ON public.affiliate_applications(normalized_phone)
  WHERE normalized_phone IS NOT NULL
    AND status IN ('PENDING', 'APPROVED');

COMMENT ON COLUMN public.affiliate_applications.has_invite_code IS
  'Compatibility flag only. Replace with invitation_id when affiliate_invitations is deployed.';
COMMENT ON COLUMN public.affiliate_applications.normalized_phone IS
  'Digits-only phone value used for active-application duplicate prevention.';
COMMENT ON COLUMN public.affiliate_applications.idempotency_key IS
  'Stable request key for retry-safe application submission.';
COMMENT ON COLUMN public.affiliate_applications.terms_bundle_version IS
  'Version of the partner terms/disclosure bundle accepted at submission.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback (manual, only before dependent application code is deployed):
-- DROP INDEX IF EXISTS public.affiliate_applications_active_phone_uq;
-- DROP INDEX IF EXISTS public.affiliate_applications_idempotency_key_uq;
-- ALTER TABLE public.affiliate_applications
--   DROP CONSTRAINT IF EXISTS affiliate_applications_idempotency_key_chk,
--   DROP CONSTRAINT IF EXISTS affiliate_applications_normalized_phone_chk,
--   DROP COLUMN IF EXISTS terms_bundle_version,
--   DROP COLUMN IF EXISTS idempotency_key,
--   DROP COLUMN IF EXISTS normalized_phone,
--   DROP COLUMN IF EXISTS has_invite_code;
