-- ============================================================================
-- Threads Autopilot Closure
-- ============================================================================
-- Purpose:
--   1) Add tenant_id to post_engagement_snapshots so best-time learning can be tenant-scoped.
--   2) Speed up Threads rewrite candidate lookup.
--   3) Speed up Threads autopilot status lookup in content_distributions.
-- ============================================================================

BEGIN;

ALTER TABLE post_engagement_snapshots
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_peng_tenant_platform_time
  ON post_engagement_snapshots (tenant_id, platform, captured_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cd_threads_autopilot_candidates
  ON content_distributions (status, created_at)
  WHERE platform = 'threads_post'
    AND status IN ('draft', 'approved', 'scheduled', 'published');

CREATE INDEX IF NOT EXISTS idx_agent_actions_threads_rewrite
  ON agent_actions (action_type, status, created_at DESC)
  WHERE action_type = 'threads_rewrite_candidate';

COMMENT ON COLUMN post_engagement_snapshots.tenant_id IS
  'Tenant-scoped best-time and engagement learning. NULL means platform/global scope.';

COMMIT;

NOTIFY pgrst, 'reload schema';
