-- Ad OS budget pacing V3
-- Tracks spend pace by tenant/channel and records budget-control decisions.

CREATE TABLE IF NOT EXISTS public.ad_os_budget_pacing_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL,
  platform text NOT NULL CHECK (platform IN ('naver', 'google', 'meta', 'kakao')),
  budget_id uuid NULL REFERENCES public.ad_os_channel_budgets(id) ON DELETE SET NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  days_elapsed integer NOT NULL DEFAULT 0 CHECK (days_elapsed >= 0),
  days_total integer NOT NULL DEFAULT 0 CHECK (days_total >= 0),
  monthly_budget_krw integer NOT NULL DEFAULT 0 CHECK (monthly_budget_krw >= 0),
  expected_spend_krw integer NOT NULL DEFAULT 0 CHECK (expected_spend_krw >= 0),
  actual_spend_krw integer NOT NULL DEFAULT 0 CHECK (actual_spend_krw >= 0),
  pace_ratio numeric NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('no_budget', 'on_track', 'underspend', 'overspend', 'exhausted', 'blocked')),
  recommended_action text NOT NULL CHECK (recommended_action IN (
    'no_change',
    'increase_tests',
    'decrease_daily_cap',
    'pause_channel',
    'require_budget_review'
  )),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_os_budget_pacing_snapshots_recent
  ON public.ad_os_budget_pacing_snapshots(created_at DESC, platform);

CREATE INDEX IF NOT EXISTS idx_ad_os_budget_pacing_snapshots_tenant
  ON public.ad_os_budget_pacing_snapshots(tenant_id, platform, created_at DESC)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.ad_os_budget_pacing_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ad_os_budget_pacing_snapshots_service" ON public.ad_os_budget_pacing_snapshots;
CREATE POLICY "ad_os_budget_pacing_snapshots_service"
  ON public.ad_os_budget_pacing_snapshots
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.ad_os_decision_logs
  DROP CONSTRAINT IF EXISTS ad_os_decision_logs_decision_type_check,
  ADD CONSTRAINT ad_os_decision_logs_decision_type_check
  CHECK (decision_type IN (
    'create_candidate', 'approve', 'start_test', 'pause', 'scale',
    'decrease_bid', 'increase_bid', 'add_negative', 'replace_landing',
    'expire', 'reject', 'no_change', 'budget_change'
  ));
