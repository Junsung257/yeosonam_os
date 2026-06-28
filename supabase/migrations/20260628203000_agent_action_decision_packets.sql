-- Jarvis Autopilot decision packets.
-- Stores the evidence/dry-run packet shown before one-click approval.

CREATE TABLE IF NOT EXISTS public.agent_action_decision_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES public.agent_actions(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'jarvis_autopilot',
  action_type TEXT NOT NULL,
  recommendation TEXT NOT NULL CHECK (recommendation IN ('approve', 'hold', 'reject')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  approval_required BOOLEAN NOT NULL DEFAULT TRUE,
  summary TEXT NOT NULL,
  packet JSONB NOT NULL DEFAULT '{}'::jsonb,
  dry_run JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT NOT NULL DEFAULT 'jarvis_autopilot',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decision TEXT CHECK (decision IN ('approve', 'reject')),
  decision_reason TEXT,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_agent_action_decision_packets_action_created
  ON public.agent_action_decision_packets (action_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_action_decision_packets_recommendation
  ON public.agent_action_decision_packets (recommendation, created_at DESC);

ALTER TABLE public.agent_action_decision_packets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_action_decision_packets FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_action_decision_packets TO service_role;

COMMENT ON TABLE public.agent_action_decision_packets IS
  'Jarvis Autopilot decision packet evidence for one-click agent action approval.';
