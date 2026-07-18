BEGIN;

-- Canonical user -> tenant authorization mapping for the tenant portal.
-- Application code reads this table with service_role after verifying the
-- caller's Supabase JWT. Browser clients may only read their own active rows.
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

COMMENT ON TABLE public.tenant_memberships IS
  'Tenant portal authorization SSOT. Only active rows bind an auth.users account to one tenant.';

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

-- Phase A is intentionally additive. Existing functions, grants, tenant/RFQ
-- policies, and existing-table RLS settings are unchanged until the staged
-- rollout gates and service-role companions are verified.

COMMIT;
