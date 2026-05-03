-- =============================================================
-- 여소남 OS — MAS Telemetry (trace spans)
-- =============================================================

CREATE TABLE IF NOT EXISTS agent_trace_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL,
  span_name TEXT NOT NULL,
  session_id UUID,
  task_id UUID REFERENCES agent_tasks(id) ON DELETE SET NULL,
  agent_type TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  duration_ms INT
);

CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_trace
  ON agent_trace_spans (trace_id, started_at);

CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_session
  ON agent_trace_spans (session_id, started_at DESC);

ALTER TABLE agent_trace_spans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_trace_spans service role" ON agent_trace_spans;
CREATE POLICY "agent_trace_spans service role"
  ON agent_trace_spans FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

