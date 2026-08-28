BEGIN;

-- Tenant portal authorization SSOT.
CREATE TABLE IF NOT EXISTS public.tenant_memberships (
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('tenant_admin', 'tenant_staff')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_active
  ON public.tenant_memberships (user_id, tenant_id)
  WHERE is_active;

ALTER TABLE public.tenant_memberships ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.tenant_memberships FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.tenant_memberships FROM authenticated;
GRANT SELECT ON TABLE public.tenant_memberships TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tenant_memberships TO service_role;

DROP POLICY IF EXISTS tenant_memberships_select_own ON public.tenant_memberships;
CREATE POLICY tenant_memberships_select_own
  ON public.tenant_memberships
  FOR SELECT
  TO authenticated
  USING (
    (SELECT auth.uid()) IS NOT NULL
    AND user_id = (SELECT auth.uid())
    AND is_active
  );

-- One-time OAuth callback state. Only the server service role can read/write it.
CREATE TABLE IF NOT EXISTS public.oauth_states (
  state_hash text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('google', 'meta', 'naver', 'threads', 'clobe')),
  scope text NOT NULL CHECK (scope IN ('tenant', 'platform')),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope = 'tenant' AND tenant_id IS NOT NULL) OR (scope = 'platform' AND tenant_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry
  ON public.oauth_states (expires_at)
  WHERE consumed_at IS NULL;

-- At most one live flow per actor/tenant/provider. The app deletes the
-- previous flow before inserting a new one; this index also closes the race.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_states_active_actor
  ON public.oauth_states (
    provider,
    scope,
    COALESCE(tenant_id, '00000000-0000-4000-8000-000000000000'::uuid),
    COALESCE(actor_user_id, '00000000-0000-4000-8000-000000000001'::uuid)
  )
  WHERE consumed_at IS NULL;

ALTER TABLE public.oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.oauth_states FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.oauth_states TO service_role;

COMMIT;
