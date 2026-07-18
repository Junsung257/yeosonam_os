-- PHASE C PROPOSAL — NOT AN EXECUTABLE MIGRATION.
-- Do not copy/apply until all gates in verification.md are complete:
--   1) Phase A migration applied and memberships provisioned/verified.
--   2) Phase B tenant membership-bound application code deployed.
--   3) Every RFQ route and cron persistence path uses service_role.
--   4) Every tenant RFQ actor action verifies active membership + active tenant.

BEGIN;

-- Untrusted roles must not be able to assign arbitrary Jarvis request context.
-- This privilege change is intentionally held until Phase C so Phase A remains
-- purely additive. Jarvis/cron callers must already use service_role.
DO $phase_c$
BEGIN
  IF to_regprocedure('public.set_jarvis_request_context(uuid,text,uuid)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.set_jarvis_request_context(uuid, text, uuid)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.set_jarvis_request_context(uuid, text, uuid)
      TO service_role;
  END IF;
END
$phase_c$;

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

-- All RFQ tables are route-only. After broad policies are removed, direct
-- authenticated Data API access remains default-denied. Guarded routes and
-- cron repositories must already use service_role, and tenant actors must be
-- checked against active membership before repository access.
DROP POLICY IF EXISTS tenant_members_manage_rfq_bids ON public.rfq_bids;
DROP POLICY IF EXISTS tenant_members_manage_rfq_proposals ON public.rfq_proposals;
DROP POLICY IF EXISTS jarvis_v2_tenant_isolation ON public.rfq_proposals;

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

COMMIT;
