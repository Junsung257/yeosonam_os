-- agent_tasks: 작업 추적 (createAgentTask / transitionAgentTask)
CREATE TABLE IF NOT EXISTS public.agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id TEXT NOT NULL,
  session_id TEXT,
  tenant_id TEXT,
  affiliate_id TEXT,
  source TEXT NOT NULL CHECK (source IN ('jarvis_stream','jarvis_v1','qa_chat','cron','manual')),
  agent_type TEXT NOT NULL CHECK (agent_type IN ('operations','products','finance','marketing','sales','system')),
  specialist_id TEXT,
  performative TEXT NOT NULL CHECK (performative IN ('request','propose','inform','approve','reject')),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','frozen','resumed','done','failed','expired','cancelled')),
  idempotency_key TEXT,
  task_context JSONB NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL,
  assigned_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON public.agent_tasks (status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_correlation ON public.agent_tasks (correlation_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_session ON public.agent_tasks (session_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_tenant ON public.agent_tasks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_created_at ON public.agent_tasks (created_at DESC);

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;

-- agent_approvals: 고위험 작업에 대한 승인 (createApprovalRequest)
CREATE TABLE IF NOT EXISTS public.agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  action_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','cancelled')),
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decided_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_approvals_task ON public.agent_approvals (task_id);
CREATE INDEX IF NOT EXISTS idx_agent_approvals_status ON public.agent_approvals (status);

ALTER TABLE public.agent_approvals ENABLE ROW LEVEL SECURITY;

-- agent_incidents: 보안/정책 위반 기록 (recordAgentIncident)
CREATE TABLE IF NOT EXISTS public.agent_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id TEXT,
  task_id UUID REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  session_id TEXT,
  tenant_id TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('info','warn','error','critical')),
  category TEXT NOT NULL CHECK (category IN ('hallucination','policy_violation','prompt_injection','tool_validation','timeout','rate_limit','manual_handoff','unknown')),
  message TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  detected_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_incidents_severity ON public.agent_incidents (severity);
CREATE INDEX IF NOT EXISTS idx_agent_incidents_category ON public.agent_incidents (category);

ALTER TABLE public.agent_incidents ENABLE ROW LEVEL SECURITY;

-- agent_trace_spans: 분산 추적 (startTraceSpan / endTraceSpan)
CREATE TABLE IF NOT EXISTS public.agent_trace_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id TEXT NOT NULL,
  span_name TEXT NOT NULL,
  session_id TEXT,
  task_id UUID REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  agent_type TEXT,
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_trace ON public.agent_trace_spans (trace_id);
CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_task ON public.agent_trace_spans (task_id);

ALTER TABLE public.agent_trace_spans ENABLE ROW LEVEL SECURITY;
