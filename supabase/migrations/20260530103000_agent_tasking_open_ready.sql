-- Open-ready Jarvis/QA tasking alignment.
-- Keeps public customer intake server-side only and aligns production tables
-- with the tasking code paths used by /api/qa/chat and admin MAS screens.

DROP FUNCTION IF EXISTS public.insert_public_qa_inquiry(TEXT, TEXT, UUID[], TEXT, TEXT, TEXT);

ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_retries INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS result_payload JSONB;

UPDATE public.agent_tasks
SET started_at = COALESCE(started_at, created_at)
WHERE status IN ('running', 'done', 'failed', 'frozen', 'resumed')
  AND started_at IS NULL;

UPDATE public.agent_tasks
SET completed_at = COALESCE(completed_at, updated_at)
WHERE status IN ('done', 'failed', 'expired', 'cancelled')
  AND completed_at IS NULL;

ALTER TABLE public.agent_approvals
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

UPDATE public.agent_approvals
SET requested_at = COALESCE(requested_at, created_at, now())
WHERE requested_at IS NULL;

UPDATE public.agent_approvals
SET reviewed_by = COALESCE(reviewed_by, decided_by),
    reviewed_at = COALESCE(reviewed_at, decided_at)
WHERE reviewed_by IS NULL
   OR reviewed_at IS NULL;

ALTER TABLE public.agent_approvals
  ALTER COLUMN requested_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_agent_tasks_status_created
  ON public.agent_tasks (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_completed_at
  ON public.agent_tasks (completed_at DESC)
  WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_approvals_requested
  ON public.agent_approvals (status, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_incidents_task
  ON public.agent_incidents (task_id);

CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_task
  ON public.agent_trace_spans (task_id);

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_trace_spans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_tasks service role" ON public.agent_tasks;
CREATE POLICY "agent_tasks service role"
  ON public.agent_tasks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "agent_approvals service role" ON public.agent_approvals;
CREATE POLICY "agent_approvals service role"
  ON public.agent_approvals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "agent_incidents service role" ON public.agent_incidents;
CREATE POLICY "agent_incidents service role"
  ON public.agent_incidents FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "agent_trace_spans service role" ON public.agent_trace_spans;
CREATE POLICY "agent_trace_spans service role"
  ON public.agent_trace_spans FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
