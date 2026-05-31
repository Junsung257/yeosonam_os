-- Ad OS Autopilot foundation
-- - Separates generated candidates from live spend.
-- - Adds channel budget guardrails and decision logs for future L3-L5 automation.

ALTER TABLE ad_landing_mappings
  ADD COLUMN IF NOT EXISTS operational_status text NOT NULL DEFAULT 'candidate',
  ADD COLUMN IF NOT EXISTS automation_level integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS intent_cluster text,
  ADD COLUMN IF NOT EXISTS scenario_type text,
  ADD COLUMN IF NOT EXISTS funnel_stage text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text,
  ADD COLUMN IF NOT EXISTS quality_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE ad_landing_mappings
  DROP CONSTRAINT IF EXISTS ad_landing_mappings_operational_status_check,
  ADD CONSTRAINT ad_landing_mappings_operational_status_check
  CHECK (operational_status IN (
    'candidate', 'approved', 'testing', 'active', 'winning', 'scaled',
    'paused', 'rejected', 'expired'
  ));

ALTER TABLE ad_landing_mappings
  DROP CONSTRAINT IF EXISTS ad_landing_mappings_automation_level_check,
  ADD CONSTRAINT ad_landing_mappings_automation_level_check
  CHECK (automation_level >= 0 AND automation_level <= 5);

UPDATE ad_landing_mappings
SET
  operational_status = CASE
    WHEN active = false THEN 'paused'
    WHEN campaign_id IS NOT NULL OR clicks > 0 OR conversions > 0 THEN 'active'
    ELSE 'candidate'
  END,
  decision_reason = COALESCE(decision_reason, 'Backfilled: generated mappings are candidates until deployed or receiving traffic.')
WHERE operational_status = 'candidate'
  AND (active = true OR active = false);

ALTER TABLE search_ad_keyword_plans
  ADD COLUMN IF NOT EXISTS autopilot_status text NOT NULL DEFAULT 'candidate',
  ADD COLUMN IF NOT EXISTS automation_level integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS intent_cluster text,
  ADD COLUMN IF NOT EXISTS scenario_type text,
  ADD COLUMN IF NOT EXISTS expected_cpa_krw integer,
  ADD COLUMN IF NOT EXISTS expected_roas numeric,
  ADD COLUMN IF NOT EXISTS opportunity_score numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_cpc_krw integer,
  ADD COLUMN IF NOT EXISTS test_budget_cap_krw integer,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_decision_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text;

ALTER TABLE search_ad_keyword_plans
  DROP CONSTRAINT IF EXISTS search_ad_keyword_plans_autopilot_status_check,
  ADD CONSTRAINT search_ad_keyword_plans_autopilot_status_check
  CHECK (autopilot_status IN (
    'candidate', 'approved', 'testing', 'active', 'winning', 'scaled',
    'paused', 'negative', 'rejected', 'expired'
  ));

ALTER TABLE search_ad_keyword_plans
  DROP CONSTRAINT IF EXISTS search_ad_keyword_plans_automation_level_check,
  ADD CONSTRAINT search_ad_keyword_plans_automation_level_check
  CHECK (automation_level >= 0 AND automation_level <= 5);

UPDATE search_ad_keyword_plans
SET
  autopilot_status = CASE
    WHEN plan_status = 'published' THEN 'active'
    WHEN plan_status = 'approved' THEN 'approved'
    WHEN plan_status = 'archived' THEN 'paused'
    WHEN plan_status = 'failed' THEN 'rejected'
    ELSE 'candidate'
  END,
  decision_reason = COALESCE(decision_reason, 'Backfilled from plan_status for Ad OS.')
WHERE autopilot_status = 'candidate';

CREATE TABLE IF NOT EXISTS ad_os_channel_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  monthly_budget_krw integer NOT NULL DEFAULT 0 CHECK (monthly_budget_krw >= 0),
  daily_budget_cap_krw integer NOT NULL DEFAULT 0 CHECK (daily_budget_cap_krw >= 0),
  max_cpc_krw integer NOT NULL DEFAULT 0 CHECK (max_cpc_krw >= 0),
  max_test_loss_krw integer NOT NULL DEFAULT 0 CHECK (max_test_loss_krw >= 0),
  target_cpa_krw integer NULL CHECK (target_cpa_krw IS NULL OR target_cpa_krw >= 0),
  target_roas numeric NULL CHECK (target_roas IS NULL OR target_roas >= 0),
  automation_level integer NOT NULL DEFAULT 1 CHECK (automation_level >= 0 AND automation_level <= 5),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform)
);

ALTER TABLE ad_os_channel_budgets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_channel_budgets service" ON ad_os_channel_budgets;
CREATE POLICY "ad_os_channel_budgets service"
  ON ad_os_channel_budgets
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS ad_os_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  run_type text NOT NULL CHECK (run_type IN (
    'analysis', 'candidate_generation', 'budget_pacing', 'bid_optimization',
    'search_term_harvest', 'expiry_cleanup', 'full_autopilot'
  )),
  mode text NOT NULL DEFAULT 'dry_run' CHECK (mode IN ('dry_run', 'guarded', 'full')),
  platform text NULL CHECK (platform IS NULL OR platform IN ('naver', 'google', 'meta', 'kakao')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'blocked')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb
);

ALTER TABLE ad_os_automation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_automation_runs service" ON ad_os_automation_runs;
CREATE POLICY "ad_os_automation_runs service"
  ON ad_os_automation_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS ad_os_decision_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NULL REFERENCES ad_os_automation_runs(id) ON DELETE SET NULL,
  tenant_id uuid NULL,
  platform text NULL CHECK (platform IS NULL OR platform IN ('naver', 'google', 'meta', 'kakao')),
  decision_type text NOT NULL CHECK (decision_type IN (
    'create_candidate', 'approve', 'start_test', 'pause', 'scale',
    'decrease_bid', 'increase_bid', 'add_negative', 'replace_landing',
    'expire', 'reject', 'no_change'
  )),
  target_table text NOT NULL,
  target_id text NOT NULL,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text NOT NULL,
  confidence numeric NULL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  expected_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  applied boolean NOT NULL DEFAULT false,
  blocked_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE ad_os_decision_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ad_os_decision_logs service" ON ad_os_decision_logs;
CREATE POLICY "ad_os_decision_logs service"
  ON ad_os_decision_logs
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_ad_landing_mappings_operational_status
  ON ad_landing_mappings(operational_status, platform);
CREATE INDEX IF NOT EXISTS idx_search_ad_keyword_plans_autopilot_status
  ON search_ad_keyword_plans(autopilot_status, platform);
CREATE INDEX IF NOT EXISTS idx_ad_os_decision_logs_created
  ON ad_os_decision_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_os_automation_runs_started
  ON ad_os_automation_runs(started_at DESC);
