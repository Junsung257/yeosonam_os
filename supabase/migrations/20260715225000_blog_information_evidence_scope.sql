-- Add an immutable-at-capture semantic scope to informational evidence.
-- Existing rows remain private until operators backfill a complete scope.

BEGIN;

ALTER TABLE public.blog_information_evidence
  ADD COLUMN IF NOT EXISTS scope jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.blog_information_evidence
  DROP CONSTRAINT IF EXISTS blog_information_evidence_scope_object;

ALTER TABLE public.blog_information_evidence
  ADD CONSTRAINT blog_information_evidence_scope_object
  CHECK (jsonb_typeof(scope) = 'object');

COMMENT ON COLUMN public.blog_information_evidence.scope IS
  'Capture-time country, destination, applicable audience/nationality, locale, claim type, normalized value, unit/currency, validity window, and conditions. Empty legacy scope is not publish-valid.';

COMMIT;
