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

-- The previous generic policies treated authentication as authorization.
-- Drop them before adding tenant ownership predicates because permissive RLS
-- policies are OR-combined.
DROP POLICY IF EXISTS authenticated_access ON public.tenants;
DROP POLICY IF EXISTS authenticated_access ON public.travel_packages;
DROP POLICY IF EXISTS authenticated_access ON public.inventory_blocks;
DROP POLICY IF EXISTS authenticated_access ON public.api_orders;
DROP POLICY IF EXISTS authenticated_access ON public.group_rfqs;
DROP POLICY IF EXISTS authenticated_access ON public.rfq_bids;
DROP POLICY IF EXISTS authenticated_access ON public.rfq_proposals;
DROP POLICY IF EXISTS authenticated_access ON public.rfq_messages;

-- Untrusted roles must not be able to assign arbitrary request context. Jarvis
-- continues to call this function through service_role. Keep the existing
-- Jarvis policies: after this privilege boundary, browser roles cannot choose
-- app.tenant_id, while the shared (tenant_id IS NULL) package catalog remains
-- readable under its existing policy.
DO $migration$
BEGIN
  IF to_regprocedure('public.set_jarvis_request_context(uuid,text,uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.set_jarvis_request_context(uuid, text, uuid)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.set_jarvis_request_context(uuid, text, uuid)
      TO service_role;
  END IF;
END
$migration$;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_messages ENABLE ROW LEVEL SECURITY;

-- group_rfqs and rfq_messages do not carry an unambiguous tenant ownership
-- column. Keep direct authenticated Data API access default-denied; guarded
-- server routes read them with service_role and return tenant-safe projections.

DROP POLICY IF EXISTS tenant_members_select_tenant ON public.tenants;
CREATE POLICY tenant_members_select_tenant
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    tenants.status = 'active'
    AND
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = tenants.id
        AND membership.is_active
    )
  );

DROP POLICY IF EXISTS tenant_members_manage_products ON public.travel_packages;
CREATE POLICY tenant_members_manage_products
  ON public.travel_packages
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      JOIN public.tenants authorized_tenant
        ON authorized_tenant.id = membership.tenant_id
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = travel_packages.tenant_id
        AND membership.is_active
        AND authorized_tenant.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      JOIN public.tenants authorized_tenant
        ON authorized_tenant.id = membership.tenant_id
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = travel_packages.tenant_id
        AND membership.is_active
        AND authorized_tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS tenant_members_manage_inventory ON public.inventory_blocks;
CREATE POLICY tenant_members_manage_inventory
  ON public.inventory_blocks
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      JOIN public.tenants authorized_tenant
        ON authorized_tenant.id = membership.tenant_id
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = inventory_blocks.tenant_id
        AND membership.is_active
        AND authorized_tenant.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      JOIN public.tenants authorized_tenant
        ON authorized_tenant.id = membership.tenant_id
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = inventory_blocks.tenant_id
        AND membership.is_active
        AND authorized_tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS tenant_members_select_orders ON public.api_orders;
CREATE POLICY tenant_members_select_orders
  ON public.api_orders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      JOIN public.tenants authorized_tenant
        ON authorized_tenant.id = membership.tenant_id
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = api_orders.tenant_id
        AND membership.is_active
        AND authorized_tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS tenant_members_manage_rfq_bids ON public.rfq_bids;
CREATE POLICY tenant_members_manage_rfq_bids
  ON public.rfq_bids
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      JOIN public.tenants authorized_tenant
        ON authorized_tenant.id = membership.tenant_id
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = rfq_bids.tenant_id
        AND membership.is_active
        AND authorized_tenant.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      JOIN public.tenants authorized_tenant
        ON authorized_tenant.id = membership.tenant_id
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = rfq_bids.tenant_id
        AND membership.is_active
        AND authorized_tenant.status = 'active'
    )
  );

DROP POLICY IF EXISTS tenant_members_manage_rfq_proposals ON public.rfq_proposals;
CREATE POLICY tenant_members_manage_rfq_proposals
  ON public.rfq_proposals
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      JOIN public.tenants authorized_tenant
        ON authorized_tenant.id = membership.tenant_id
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = rfq_proposals.tenant_id
        AND membership.is_active
        AND authorized_tenant.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.tenant_memberships membership
      JOIN public.tenants authorized_tenant
        ON authorized_tenant.id = membership.tenant_id
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = rfq_proposals.tenant_id
        AND membership.is_active
        AND authorized_tenant.status = 'active'
    )
  );

COMMIT;
