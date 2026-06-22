CREATE TABLE IF NOT EXISTS public.ad_os_campaign_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  workspace_id uuid NULL REFERENCES public.tenant_ad_workspaces(id) ON DELETE SET NULL,
  memory_key text NOT NULL DEFAULT 'default',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready', 'needs_attention', 'blocked', 'archived')),
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  purpose text NOT NULL DEFAULT '',
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  failed_experiments jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_tests jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_diagnostic jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_os_campaign_memories_global_key
  ON public.ad_os_campaign_memories(memory_key)
  WHERE tenant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ad_os_campaign_memories_tenant_key
  ON public.ad_os_campaign_memories(tenant_id, memory_key)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_campaign_memories_workspace
  ON public.ad_os_campaign_memories(workspace_id, updated_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ad_os_campaign_memories_status
  ON public.ad_os_campaign_memories(status, updated_at DESC);

ALTER TABLE public.ad_os_campaign_memories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_os_campaign_memories_service" ON public.ad_os_campaign_memories;
CREATE POLICY "ad_os_campaign_memories_service"
  ON public.ad_os_campaign_memories
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

REVOKE ALL ON TABLE public.ad_os_campaign_memories FROM anon, authenticated;
