-- Repair the historical migration chain before tenant-aware analytics views.
ALTER TABLE public.post_engagement_snapshots
  ADD COLUMN IF NOT EXISTS tenant_id UUID
  REFERENCES public.tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_post_engagement_snapshots_tenant
  ON public.post_engagement_snapshots(tenant_id);
