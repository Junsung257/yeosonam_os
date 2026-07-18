-- PHASE C PROPOSAL — NOT AN EXECUTABLE MIGRATION.
-- Do not copy/apply until all gates in verification.md are complete:
--   1) Phase A migration applied and memberships provisioned/verified.
--   2) Phase B tenant membership-bound application code deployed.
--   3) RFQ service-role repository companion commit deployed and verified.

BEGIN;

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

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.travel_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_rfqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfq_messages ENABLE ROW LEVEL SECURITY;

-- group_rfqs and rfq_messages have no unambiguous tenant ownership column.
-- Direct authenticated Data API access remains default-denied after the broad
-- policy is removed. Guarded server repositories must already use service_role.

DROP POLICY IF EXISTS tenant_members_select_tenant ON public.tenants;
CREATE POLICY tenant_members_select_tenant
  ON public.tenants
  FOR SELECT
  TO authenticated
  USING (
    tenants.status = 'active'
    AND EXISTS (
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
      JOIN public.tenants authorized_tenant ON authorized_tenant.id = membership.tenant_id
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
      JOIN public.tenants authorized_tenant ON authorized_tenant.id = membership.tenant_id
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
      JOIN public.tenants authorized_tenant ON authorized_tenant.id = membership.tenant_id
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
      JOIN public.tenants authorized_tenant ON authorized_tenant.id = membership.tenant_id
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
      JOIN public.tenants authorized_tenant ON authorized_tenant.id = membership.tenant_id
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
      JOIN public.tenants authorized_tenant ON authorized_tenant.id = membership.tenant_id
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
      JOIN public.tenants authorized_tenant ON authorized_tenant.id = membership.tenant_id
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
      JOIN public.tenants authorized_tenant ON authorized_tenant.id = membership.tenant_id
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
      JOIN public.tenants authorized_tenant ON authorized_tenant.id = membership.tenant_id
      WHERE membership.user_id = (SELECT auth.uid())
        AND membership.tenant_id = rfq_proposals.tenant_id
        AND membership.is_active
        AND authorized_tenant.status = 'active'
    )
  );

COMMIT;
