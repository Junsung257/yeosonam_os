-- Production hardening for tenant-scoped social publishing.
-- Apply before deploying the matching application commit.

BEGIN;

-- A provider token must be able to represent a tenant's Twitter connection.
ALTER TABLE public.tenant_api_tokens
  DROP CONSTRAINT IF EXISTS tenant_api_tokens_provider_check;

ALTER TABLE public.tenant_api_tokens
  ADD CONSTRAINT tenant_api_tokens_provider_check
  CHECK (provider IN (
    'google_ads',
    'meta',
    'naver',
    'google_analytics',
    'kakao_biz',
    'clobe',
    'twitter'
  ));

-- Prevent two workers from sending the same approved row to an external API.
-- Expired leases are deliberately not auto-reclaimed: an external API call may
-- have succeeded before the worker crashed. Operators must reconcile the
-- external account first, then explicitly return a row to approved.
ALTER TABLE public.content_distributions
  ADD COLUMN IF NOT EXISTS publish_claim_token UUID,
  ADD COLUMN IF NOT EXISTS publish_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS publish_lease_expires_at TIMESTAMPTZ;

ALTER TABLE public.content_distributions
  DROP CONSTRAINT IF EXISTS content_distributions_status_check;

ALTER TABLE public.content_distributions
  ADD CONSTRAINT content_distributions_status_check
  CHECK (status IN ('draft', 'approved', 'publishing', 'needs_reconcile', 'scheduled', 'published', 'archived', 'failed'));

CREATE INDEX IF NOT EXISTS idx_cd_publish_claims
  ON public.content_distributions (status, publish_lease_expires_at, updated_at)
  WHERE status IN ('approved', 'publishing');

COMMENT ON COLUMN public.content_distributions.publish_claim_token IS
  'Worker-owned claim token for an in-flight external social publish.';
COMMENT ON COLUMN public.content_distributions.publish_lease_expires_at IS
  'Lease expiry for an in-flight social publish; expired rows require manual reconciliation before retry.';

COMMIT;

NOTIFY pgrst, 'reload schema';
