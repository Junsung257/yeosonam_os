-- =============================================================
-- 여소남 OS — MAS Core Tasking (Concierge PoC)
-- =============================================================
-- 목적:
--   - 기존 agent_actions(기안/승인 큐) 위에 task 단위 실행 상태머신을 추가
--   - 승인 게이트와 인시던트 감사 로그를 분리해 추적성 강화
--   - PoC 범위: 생성만. 기존 테이블/로직 파괴 변경 없음
-- =============================================================

-- [1] agent_tasks: 에이전트 작업 단위 상태머신
CREATE TABLE IF NOT EXISTS agent_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID NOT NULL DEFAULT gen_random_uuid(),
  session_id UUID,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  affiliate_id UUID REFERENCES affiliates(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'qa_chat',
  agent_type TEXT NOT NULL,
  specialist_id TEXT,
  performative TEXT NOT NULL DEFAULT 'request'
    CHECK (performative IN ('request', 'propose', 'inform', 'approve', 'reject')),
  risk_level TEXT NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'frozen', 'resumed', 'done', 'failed', 'expired', 'cancelled')),
  task_context JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_payload JSONB,
  idempotency_key TEXT,
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 2,
  last_error TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  assigned_to TEXT,
  approved_by TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_status_created
  ON agent_tasks (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_correlation
  ON agent_tasks (correlation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_tenant_status
  ON agent_tasks (tenant_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_tasks_idempotency
  ON agent_tasks (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP TRIGGER IF EXISTS trg_agent_tasks_updated_at ON agent_tasks;
CREATE TRIGGER trg_agent_tasks_updated_at
  BEFORE UPDATE ON agent_tasks
  FOR EACH ROW EXECUTE FUNCTION update_bank_tx_timestamp();

ALTER TABLE agent_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_tasks service role" ON agent_tasks;
CREATE POLICY "agent_tasks service role"
  ON agent_tasks FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- [2] agent_approvals: 승인 게이트 이력
CREATE TABLE IF NOT EXISTS agent_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  action_id UUID REFERENCES agent_actions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  reason TEXT,
  requested_by TEXT NOT NULL DEFAULT 'system',
  reviewed_by TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_agent_approvals_task
  ON agent_approvals (task_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_approvals_status
  ON agent_approvals (status, requested_at DESC);

ALTER TABLE agent_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_approvals service role" ON agent_approvals;
CREATE POLICY "agent_approvals service role"
  ON agent_approvals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- [3] agent_incidents: 환각/정책위반/장애 감사
CREATE TABLE IF NOT EXISTS agent_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id UUID,
  task_id UUID REFERENCES agent_tasks(id) ON DELETE SET NULL,
  session_id UUID,
  tenant_id UUID REFERENCES tenants(id) ON DELETE SET NULL,
  severity TEXT NOT NULL DEFAULT 'warn'
    CHECK (severity IN ('info', 'warn', 'error', 'critical')),
  category TEXT NOT NULL
    CHECK (category IN (
      'hallucination',
      'policy_violation',
      'prompt_injection',
      'tool_validation',
      'timeout',
      'rate_limit',
      'manual_handoff',
      'unknown'
    )),
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_by TEXT NOT NULL DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_incidents_created
  ON agent_incidents (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_incidents_category_severity
  ON agent_incidents (category, severity, created_at DESC);

ALTER TABLE agent_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent_incidents service role" ON agent_incidents;
CREATE POLICY "agent_incidents service role"
  ON agent_incidents FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DO $$
BEGIN
  RAISE NOTICE '[mas] agent tasking core migration completed';
END $$;
