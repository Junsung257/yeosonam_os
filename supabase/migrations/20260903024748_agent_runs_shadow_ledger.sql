-- Agent Office PR-01B: new-execution-only shadow run evidence.
--
-- Authority remains:
--   agent_tasks       = business task state SSOT
--   agent_trace_spans = existing observation evidence
--   agent_runs        = non-authoritative execution-attempt evidence
--
-- This migration intentionally provides no queue claim, dispatch, retry, task
-- transition, approval, command, KPI, delete, or historical backfill surface.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE RESTRICT,

  actor_id text NOT NULL,
  actor_session_id text NOT NULL,
  role_key text NOT NULL,
  role_version text NOT NULL,
  task_key text NOT NULL,
  task_contract_version text NOT NULL,
  runtime_key text NOT NULL,
  runtime_version text NOT NULL,
  tool_profile_key text NOT NULL,
  tool_profile_version text NOT NULL,
  provider_key text,
  model_key text,

  execution_mode text NOT NULL DEFAULT 'shadow',
  authoritative boolean NOT NULL DEFAULT false,
  command_access_allowed boolean NOT NULL DEFAULT false,
  production_access boolean NOT NULL DEFAULT false,
  data_classification text NOT NULL DEFAULT 'public',

  status text NOT NULL DEFAULT 'created',
  lease_owner text,
  lease_token_hash bytea,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0,

  input_schema_hash text NOT NULL,
  input_hash text NOT NULL,
  output_artifact_ref text,
  output_hash text,
  trace_id text,
  error_code text,

  policy_snapshot jsonb NOT NULL,
  budget_snapshot jsonb NOT NULL,
  max_elapsed_ms integer NOT NULL,
  max_turns integer NOT NULL,
  max_tool_calls integer NOT NULL,
  max_input_tokens integer NOT NULL,
  max_output_tokens integer NOT NULL,
  max_cost_usd numeric(12, 6),

  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  tool_calls integer NOT NULL DEFAULT 0,
  elapsed_ms integer NOT NULL DEFAULT 0,
  cost_usd numeric(12, 6),

  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT uq_agent_runs_task_attempt UNIQUE (task_id, attempt_number),
  CONSTRAINT agent_runs_actor_id_ck CHECK (
    actor_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,239}$'
    AND actor_id !~ '://'
    AND actor_id !~ '\.\.'
    AND actor_id !~ '\\'
  ),
  CONSTRAINT agent_runs_actor_session_id_ck CHECK (
    actor_session_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,239}$'
    AND actor_session_id !~ '://'
    AND actor_session_id !~ '\.\.'
    AND actor_session_id !~ '\\'
  ),
  CONSTRAINT agent_runs_contract_keys_ck CHECK (
    role_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
    AND task_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
    AND runtime_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
    AND tool_profile_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$'
    AND (provider_key IS NULL OR provider_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$')
  ),
  CONSTRAINT agent_runs_contract_versions_ck CHECK (
    role_version ~ '^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$'
    AND task_contract_version ~ '^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$'
    AND runtime_version ~ '^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$'
    AND tool_profile_version ~ '^\d+\.\d+\.\d+(-[a-z0-9.-]+)?$'
  ),
  CONSTRAINT agent_runs_model_key_ck CHECK (
    model_key IS NULL OR (
      model_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$'
      AND model_key !~ '://'
      AND model_key !~ '\.\.'
      AND model_key !~ '\\'
    )
  ),
  CONSTRAINT agent_runs_provider_model_pair_ck CHECK (
    (provider_key IS NULL) = (model_key IS NULL)
  ),
  CONSTRAINT agent_runs_shadow_only_ck CHECK (
    execution_mode = 'shadow'
    AND authoritative = false
    AND command_access_allowed = false
    AND production_access = false
    AND data_classification = 'public'
  ),
  CONSTRAINT agent_runs_status_ck CHECK (status IN (
    'created',
    'leased',
    'starting',
    'running',
    'waiting_approval',
    'succeeded',
    'failed',
    'timed_out',
    'cancelled',
    'orphaned'
  )),
  CONSTRAINT agent_runs_hashes_ck CHECK (
    input_schema_hash ~ '^sha256:[a-f0-9]{64}$'
    AND input_hash ~ '^sha256:[a-f0-9]{64}$'
    AND (output_hash IS NULL OR output_hash ~ '^sha256:[a-f0-9]{64}$')
  ),
  CONSTRAINT agent_runs_output_pair_ck CHECK (
    (output_artifact_ref IS NULL) = (output_hash IS NULL)
    AND (
      output_artifact_ref IS NULL
      OR (
        output_artifact_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,239}$'
        AND output_artifact_ref !~ '://'
        AND output_artifact_ref !~ '\.\.'
        AND output_artifact_ref !~ '\\'
      )
    )
  ),
  CONSTRAINT agent_runs_trace_id_ck CHECK (
    trace_id IS NULL OR (
      trace_id ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{1,239}$'
      AND trace_id !~ '://'
      AND trace_id !~ '\.\.'
      AND trace_id !~ '\\'
    )
  ),
  CONSTRAINT agent_runs_error_code_ck CHECK (
    error_code IS NULL OR error_code ~ '^[A-Za-z][A-Za-z0-9_.:-]{1,119}$'
  ),
  CONSTRAINT agent_runs_policy_snapshot_ck CHECK (
    jsonb_typeof(policy_snapshot) = 'object'
    AND octet_length(policy_snapshot::text) <= 4096
  ),
  CONSTRAINT agent_runs_budget_snapshot_ck CHECK (
    jsonb_typeof(budget_snapshot) = 'object'
    AND octet_length(budget_snapshot::text) <= 4096
  ),
  CONSTRAINT agent_runs_budget_ck CHECK (
    max_elapsed_ms BETWEEN 1000 AND 86400000
    AND max_turns BETWEEN 1 AND 100
    AND max_tool_calls BETWEEN 0 AND 1000
    AND max_input_tokens BETWEEN 1 AND 10000000
    AND max_output_tokens BETWEEN 1 AND 1000000
    AND (max_cost_usd IS NULL OR max_cost_usd BETWEEN 0 AND 10000)
  ),
  CONSTRAINT agent_runs_usage_ck CHECK (
    input_tokens BETWEEN 0 AND max_input_tokens
    AND output_tokens BETWEEN 0 AND max_output_tokens
    AND tool_calls BETWEEN 0 AND max_tool_calls
    AND elapsed_ms BETWEEN 0 AND max_elapsed_ms
    AND (cost_usd IS NULL OR (
      cost_usd >= 0
      AND cost_usd::text NOT IN ('NaN', 'Infinity', '-Infinity')
    ))
    AND (max_cost_usd IS NULL OR cost_usd IS NULL OR cost_usd <= max_cost_usd)
  ),
  CONSTRAINT agent_runs_lease_state_ck CHECK (
    (
      status = 'created'
      AND lease_owner IS NULL
      AND lease_token_hash IS NULL
      AND lease_expires_at IS NULL
      AND heartbeat_at IS NULL
      AND fencing_token = 0
    )
    OR (
      status IN ('leased', 'starting', 'running', 'waiting_approval')
      AND lease_owner IS NOT NULL
      AND lease_token_hash IS NOT NULL
      AND octet_length(lease_token_hash) = 32
      AND lease_expires_at IS NOT NULL
      AND heartbeat_at IS NOT NULL
      AND fencing_token > 0
    )
    OR (
      status IN ('succeeded', 'failed', 'timed_out', 'cancelled', 'orphaned')
      AND lease_owner IS NOT NULL
      AND lease_token_hash IS NULL
      AND lease_expires_at IS NULL
      AND heartbeat_at IS NOT NULL
      AND fencing_token > 0
    )
  ),
  CONSTRAINT agent_runs_timestamps_ck CHECK (
    updated_at >= created_at
    AND (
      (status IN ('created', 'leased', 'starting', 'running', 'waiting_approval') AND completed_at IS NULL)
      OR (status IN ('succeeded', 'failed', 'timed_out', 'cancelled', 'orphaned') AND completed_at IS NOT NULL)
    )
    AND (status NOT IN ('starting', 'running', 'waiting_approval', 'succeeded') OR started_at IS NOT NULL)
  ),
  CONSTRAINT agent_runs_terminal_result_ck CHECK (
    (status = 'succeeded' AND output_hash IS NOT NULL AND error_code IS NULL)
    OR (status IN ('failed', 'timed_out', 'cancelled', 'orphaned') AND error_code IS NOT NULL)
    OR status IN ('created', 'leased', 'starting', 'running', 'waiting_approval')
  )
);

COMMENT ON TABLE public.agent_runs IS
  'PR-01B shadow execution evidence only. agent_tasks remains business-state SSOT; this table cannot authorize workers, retries, approvals, commands, or Office KPIs.';
COMMENT ON COLUMN public.agent_runs.lease_token_hash IS
  'SHA-256 digest of a high-entropy task-bound lease secret. The raw secret is never persisted or returned.';
COMMENT ON COLUMN public.agent_runs.policy_snapshot IS
  'Server-constructed non-content policy metadata only. Raw prompts, tool arguments, model responses, PII, secrets, and URLs are forbidden.';
COMMENT ON COLUMN public.agent_runs.budget_snapshot IS
  'Server-constructed numeric budget metadata corresponding to the normalized max_* columns.';

CREATE INDEX idx_agent_runs_task_status
  ON public.agent_runs (task_id, status, attempt_number DESC);

CREATE INDEX idx_agent_runs_tenant_created
  ON public.agent_runs (tenant_id, created_at DESC);

CREATE INDEX idx_agent_runs_active_lease_expiry
  ON public.agent_runs (lease_expires_at)
  WHERE status IN ('leased', 'starting', 'running', 'waiting_approval');

CREATE INDEX idx_agent_runs_trace_id
  ON public.agent_runs (trace_id)
  WHERE trace_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_agent_run_shadow_update_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_terminal_states constant text[] := ARRAY['succeeded', 'failed', 'timed_out', 'cancelled', 'orphaned'];
  v_active_states constant text[] := ARRAY['leased', 'starting', 'running', 'waiting_approval'];
BEGIN
  IF OLD.status = ANY(v_terminal_states) THEN
    RAISE EXCEPTION 'terminal agent run is immutable' USING ERRCODE = '23514';
  END IF;

  IF ROW(
    NEW.id,
    NEW.task_id,
    NEW.attempt_number,
    NEW.tenant_id,
    NEW.actor_id,
    NEW.actor_session_id,
    NEW.role_key,
    NEW.role_version,
    NEW.task_key,
    NEW.task_contract_version,
    NEW.runtime_key,
    NEW.runtime_version,
    NEW.tool_profile_key,
    NEW.tool_profile_version,
    NEW.provider_key,
    NEW.model_key,
    NEW.execution_mode,
    NEW.authoritative,
    NEW.command_access_allowed,
    NEW.production_access,
    NEW.data_classification,
    NEW.input_schema_hash,
    NEW.input_hash,
    NEW.trace_id,
    NEW.policy_snapshot,
    NEW.budget_snapshot,
    NEW.max_elapsed_ms,
    NEW.max_turns,
    NEW.max_tool_calls,
    NEW.max_input_tokens,
    NEW.max_output_tokens,
    NEW.max_cost_usd,
    NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.task_id,
    OLD.attempt_number,
    OLD.tenant_id,
    OLD.actor_id,
    OLD.actor_session_id,
    OLD.role_key,
    OLD.role_version,
    OLD.task_key,
    OLD.task_contract_version,
    OLD.runtime_key,
    OLD.runtime_version,
    OLD.tool_profile_key,
    OLD.tool_profile_version,
    OLD.provider_key,
    OLD.model_key,
    OLD.execution_mode,
    OLD.authoritative,
    OLD.command_access_allowed,
    OLD.production_access,
    OLD.data_classification,
    OLD.input_schema_hash,
    OLD.input_hash,
    OLD.trace_id,
    OLD.policy_snapshot,
    OLD.budget_snapshot,
    OLD.max_elapsed_ms,
    OLD.max_turns,
    OLD.max_tool_calls,
    OLD.max_input_tokens,
    OLD.max_output_tokens,
    OLD.max_cost_usd,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'agent run contract identity is immutable' USING ERRCODE = '23514';
  END IF;

  IF OLD.status <> NEW.status AND NOT (
    (OLD.status = 'created' AND NEW.status = 'leased')
    OR (OLD.status = 'leased' AND NEW.status = 'starting')
    OR (OLD.status = 'starting' AND NEW.status = 'running')
    OR (OLD.status = 'running' AND NEW.status = 'waiting_approval')
    OR (OLD.status = 'waiting_approval' AND NEW.status = 'running')
    OR (OLD.status = ANY(v_active_states) AND NEW.status = ANY(v_terminal_states))
  ) THEN
    RAISE EXCEPTION 'invalid agent run status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'created' AND NEW.status = 'leased' THEN
    IF NEW.fencing_token <> OLD.fencing_token + 1
      OR NEW.lease_owner IS NULL
      OR NEW.lease_token_hash IS NULL
      OR NEW.lease_expires_at IS NULL
      OR NEW.heartbeat_at IS NULL
      OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN
      RAISE EXCEPTION 'invalid agent run lease claim' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status = ANY(v_terminal_states) THEN
    IF NEW.fencing_token <> OLD.fencing_token
      OR NEW.lease_owner IS DISTINCT FROM OLD.lease_owner
      OR NEW.lease_token_hash IS NOT NULL
      OR NEW.lease_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'invalid terminal agent run lease state' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.fencing_token <> OLD.fencing_token
      OR NEW.lease_owner IS DISTINCT FROM OLD.lease_owner
      OR NEW.lease_token_hash IS DISTINCT FROM OLD.lease_token_hash THEN
      RAISE EXCEPTION 'agent run lease identity is immutable after claim' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF OLD.status = 'leased' AND NEW.status = 'starting' THEN
    IF NEW.started_at IS NULL THEN
      RAISE EXCEPTION 'starting agent run requires started_at' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.started_at IS DISTINCT FROM OLD.started_at THEN
    RAISE EXCEPTION 'agent run started_at may only be set on leased to starting'
      USING ERRCODE = '23514';
  END IF;

  IF NOT (NEW.status = ANY(v_terminal_states)) AND ROW(
    NEW.output_artifact_ref,
    NEW.output_hash,
    NEW.error_code,
    NEW.input_tokens,
    NEW.output_tokens,
    NEW.tool_calls,
    NEW.elapsed_ms,
    NEW.cost_usd,
    NEW.completed_at
  ) IS DISTINCT FROM ROW(
    OLD.output_artifact_ref,
    OLD.output_hash,
    OLD.error_code,
    OLD.input_tokens,
    OLD.output_tokens,
    OLD.tool_calls,
    OLD.elapsed_ms,
    OLD.cost_usd,
    OLD.completed_at
  ) THEN
    RAISE EXCEPTION 'agent run result fields may change only at terminal completion'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_agent_run_shadow_update_v1() FROM PUBLIC;

CREATE TRIGGER trg_guard_agent_run_shadow_update_v1
  BEFORE UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_agent_run_shadow_update_v1();

CREATE OR REPLACE FUNCTION public.agent_run_shadow_safe_json_v1(p_run public.agent_runs)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT to_jsonb(p_run) - 'lease_token_hash';
$$;

REVOKE ALL ON FUNCTION public.agent_run_shadow_safe_json_v1(public.agent_runs) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.create_agent_run_shadow_v1(
  p_task_id uuid,
  p_tenant_id uuid,
  p_actor_id text,
  p_actor_session_id text,
  p_role_key text,
  p_role_version text,
  p_task_key text,
  p_task_contract_version text,
  p_runtime_key text,
  p_runtime_version text,
  p_tool_profile_key text,
  p_tool_profile_version text,
  p_provider_key text,
  p_model_key text,
  p_input_schema_hash text,
  p_input_hash text,
  p_trace_id text,
  p_max_elapsed_ms integer,
  p_max_turns integer,
  p_max_tool_calls integer,
  p_max_input_tokens integer,
  p_max_output_tokens integer,
  p_max_cost_usd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_task public.agent_tasks%ROWTYPE;
  v_attempt_number integer;
  v_run public.agent_runs%ROWTYPE;
BEGIN
  IF p_actor_id IS NULL
    OR p_actor_session_id IS NULL
    OR p_role_key IS NULL
    OR p_role_version IS NULL
    OR p_task_key IS NULL
    OR p_task_contract_version IS NULL
    OR p_runtime_key IS NULL
    OR p_runtime_version IS NULL
    OR p_tool_profile_key IS NULL
    OR p_tool_profile_version IS NULL
    OR p_input_schema_hash IS NULL
    OR p_input_hash IS NULL THEN
    RAISE EXCEPTION 'missing required agent run contract identity' USING ERRCODE = '22023';
  END IF;

  IF (p_provider_key IS NULL) <> (p_model_key IS NULL) THEN
    RAISE EXCEPTION 'provider and model must both be null or both be present' USING ERRCODE = '22023';
  END IF;

  IF p_max_elapsed_ms NOT BETWEEN 1000 AND 86400000
    OR p_max_turns NOT BETWEEN 1 AND 100
    OR p_max_tool_calls NOT BETWEEN 0 AND 1000
    OR p_max_input_tokens NOT BETWEEN 1 AND 10000000
    OR p_max_output_tokens NOT BETWEEN 1 AND 1000000
    OR (p_max_cost_usd IS NOT NULL AND p_max_cost_usd NOT BETWEEN 0 AND 10000) THEN
    RAISE EXCEPTION 'invalid agent run budget' USING ERRCODE = '22023';
  END IF;

  -- Lock the task first. This serializes attempt allocation without turning the
  -- run ledger into a queue or a source of worker authorization.
  SELECT *
    INTO v_task
    FROM public.agent_tasks
   WHERE id = p_task_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agent task not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_task.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'agent run tenant does not match task tenant' USING ERRCODE = '42501';
  END IF;

  -- PR-01B is technically limited to the one PR-01A pilot contract. A future
  -- role requires an explicit migration, not an unreviewed registry expansion.
  IF p_role_key <> 'research.technology_scout'
    OR p_task_key <> 'research.technology_scout'
    OR v_task.agent_type <> 'system'
    OR v_task.specialist_id IS DISTINCT FROM 'research.technology_scout' THEN
    RAISE EXCEPTION 'task is not bound to the PR-01B technology scout pilot'
      USING ERRCODE = '42501';
  END IF;

  IF p_role_version <> '1.0.0'
    OR p_task_contract_version <> '1.0.0'
    OR p_runtime_key <> 'codex_subscription_worker'
    OR p_runtime_version <> '1.0.0'
    OR p_tool_profile_key <> 'research.technology_scout_no_tools'
    OR p_tool_profile_version <> '1.0.0'
    OR p_provider_key IS NOT NULL
    OR p_model_key IS NOT NULL
    OR p_input_schema_hash <> 'sha256:eaa48f597e687e7cbd3f10cb93b6440d11828bfc49c43dd75716b7e0453a37dc'
    OR p_max_elapsed_ms <> 900000
    OR p_max_turns <> 8
    OR p_max_tool_calls <> 12
    OR p_max_input_tokens <> 80000
    OR p_max_output_tokens <> 12000
    OR p_max_cost_usd IS NOT NULL THEN
    RAISE EXCEPTION 'contract snapshot does not match the approved PR-01A pilot'
      USING ERRCODE = '42501';
  END IF;

  IF v_task.status NOT IN ('queued', 'running', 'frozen', 'resumed') THEN
    RAISE EXCEPTION 'terminal agent task cannot receive a new shadow run'
      USING ERRCODE = '23514';
  END IF;

  SELECT coalesce(max(attempt_number), 0) + 1
    INTO v_attempt_number
    FROM public.agent_runs
   WHERE task_id = p_task_id;

  INSERT INTO public.agent_runs (
    task_id,
    attempt_number,
    tenant_id,
    actor_id,
    actor_session_id,
    role_key,
    role_version,
    task_key,
    task_contract_version,
    runtime_key,
    runtime_version,
    tool_profile_key,
    tool_profile_version,
    provider_key,
    model_key,
    input_schema_hash,
    input_hash,
    trace_id,
    policy_snapshot,
    budget_snapshot,
    max_elapsed_ms,
    max_turns,
    max_tool_calls,
    max_input_tokens,
    max_output_tokens,
    max_cost_usd
  ) VALUES (
    p_task_id,
    v_attempt_number,
    p_tenant_id,
    p_actor_id,
    p_actor_session_id,
    p_role_key,
    p_role_version,
    p_task_key,
    p_task_contract_version,
    p_runtime_key,
    p_runtime_version,
    p_tool_profile_key,
    p_tool_profile_version,
    p_provider_key,
    p_model_key,
    p_input_schema_hash,
    p_input_hash,
    p_trace_id,
    jsonb_build_object(
      'taskRisk', v_task.risk_level,
      'sideEffectMode', 'forbidden',
      'triggerMode', 'manual',
      'reviewRequired', true,
      'dataClassifications', jsonb_build_array('public'),
      'productionAccess', false,
      'commandAccessAllowed', false,
      'authoritative', false
    ),
    jsonb_build_object(
      'maxElapsedMs', p_max_elapsed_ms,
      'maxTurns', p_max_turns,
      'maxToolCalls', p_max_tool_calls,
      'maxInputTokens', p_max_input_tokens,
      'maxOutputTokens', p_max_output_tokens,
      'maxCostUsd', p_max_cost_usd
    ),
    p_max_elapsed_ms,
    p_max_turns,
    p_max_tool_calls,
    p_max_input_tokens,
    p_max_output_tokens,
    p_max_cost_usd
  )
  RETURNING * INTO v_run;

  RETURN public.agent_run_shadow_safe_json_v1(v_run);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_agent_run_shadow_v1(
  p_run_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.agent_runs%ROWTYPE;
BEGIN
  SELECT *
    INTO v_run
    FROM public.agent_runs
   WHERE id = p_run_id
     AND tenant_id IS NOT DISTINCT FROM p_tenant_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN public.agent_run_shadow_safe_json_v1(v_run);
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_agent_run_shadow_v1(
  p_run_id uuid,
  p_tenant_id uuid,
  p_lease_owner text,
  p_lease_token text,
  p_lease_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.agent_runs%ROWTYPE;
BEGIN
  IF p_lease_owner IS NULL
    OR p_lease_owner !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{2,119}$'
    OR p_lease_owner ~ '://'
    OR p_lease_owner ~ '\.\.'
    OR p_lease_owner ~ '\\'
    OR p_lease_token IS NULL
    OR octet_length(p_lease_token) < 32
    OR octet_length(p_lease_token) > 256
    OR p_lease_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'invalid agent run lease input' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agent_runs AS r
     SET status = 'leased',
         lease_owner = p_lease_owner,
         lease_token_hash = extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256'),
         lease_expires_at = LEAST(
           clock_timestamp() + make_interval(secs => p_lease_seconds),
           coalesce(t.expires_at, 'infinity'::timestamptz),
           r.created_at + make_interval(secs => r.max_elapsed_ms::double precision / 1000.0)
         ),
         heartbeat_at = clock_timestamp(),
         fencing_token = r.fencing_token + 1
    FROM public.agent_tasks AS t
   WHERE r.id = p_run_id
     AND r.task_id = t.id
     AND r.tenant_id IS NOT DISTINCT FROM p_tenant_id
     AND t.tenant_id IS NOT DISTINCT FROM p_tenant_id
     AND r.status = 'created'
     AND LEAST(
       coalesce(t.expires_at, 'infinity'::timestamptz),
       r.created_at + make_interval(secs => r.max_elapsed_ms::double precision / 1000.0)
     ) > clock_timestamp()
  RETURNING r.* INTO v_run;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN public.agent_run_shadow_safe_json_v1(v_run);
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_agent_run_shadow_v1(
  p_run_id uuid,
  p_tenant_id uuid,
  p_lease_token text,
  p_fencing_token bigint,
  p_expected_status text,
  p_next_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.agent_runs%ROWTYPE;
BEGIN
  IF NOT (
    (p_expected_status = 'leased' AND p_next_status = 'starting')
    OR (p_expected_status = 'starting' AND p_next_status = 'running')
    OR (p_expected_status = 'running' AND p_next_status = 'waiting_approval')
    OR (p_expected_status = 'waiting_approval' AND p_next_status = 'running')
  ) THEN
    RAISE EXCEPTION 'invalid nonterminal agent run transition' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agent_runs
     SET status = p_next_status,
         started_at = CASE
           WHEN p_next_status = 'starting' THEN coalesce(started_at, clock_timestamp())
           ELSE started_at
         END,
         heartbeat_at = clock_timestamp()
   WHERE id = p_run_id
     AND tenant_id IS NOT DISTINCT FROM p_tenant_id
     AND status = p_expected_status
     AND lease_expires_at > clock_timestamp()
     AND fencing_token = p_fencing_token
     AND lease_token_hash = extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256')
  RETURNING * INTO v_run;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN public.agent_run_shadow_safe_json_v1(v_run);
END;
$$;

CREATE OR REPLACE FUNCTION public.heartbeat_agent_run_shadow_v1(
  p_run_id uuid,
  p_tenant_id uuid,
  p_lease_token text,
  p_fencing_token bigint,
  p_extend_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.agent_runs%ROWTYPE;
BEGIN
  IF p_extend_seconds NOT BETWEEN 30 AND 900 THEN
    RAISE EXCEPTION 'invalid agent run heartbeat duration' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agent_runs AS r
     SET lease_expires_at = LEAST(
           GREATEST(r.lease_expires_at, clock_timestamp() + make_interval(secs => p_extend_seconds)),
           coalesce(t.expires_at, 'infinity'::timestamptz),
           r.created_at + make_interval(secs => r.max_elapsed_ms::double precision / 1000.0)
         ),
         heartbeat_at = clock_timestamp()
    FROM public.agent_tasks AS t
   WHERE r.id = p_run_id
     AND r.task_id = t.id
     AND r.tenant_id IS NOT DISTINCT FROM p_tenant_id
     AND t.tenant_id IS NOT DISTINCT FROM p_tenant_id
     AND r.status IN ('leased', 'starting', 'running', 'waiting_approval')
     AND r.lease_expires_at > clock_timestamp()
     AND r.fencing_token = p_fencing_token
     AND r.lease_token_hash = extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256')
     AND LEAST(
       coalesce(t.expires_at, 'infinity'::timestamptz),
       r.created_at + make_interval(secs => r.max_elapsed_ms::double precision / 1000.0)
     ) > clock_timestamp()
  RETURNING r.* INTO v_run;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN public.agent_run_shadow_safe_json_v1(v_run);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_agent_run_shadow_v1(
  p_run_id uuid,
  p_tenant_id uuid,
  p_lease_token text,
  p_fencing_token bigint,
  p_outcome text,
  p_output_artifact_ref text,
  p_output_hash text,
  p_error_code text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_tool_calls integer,
  p_elapsed_ms integer,
  p_cost_usd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.agent_runs%ROWTYPE;
BEGIN
  IF p_outcome NOT IN ('succeeded', 'failed', 'timed_out', 'cancelled') THEN
    RAISE EXCEPTION 'invalid agent run terminal outcome' USING ERRCODE = '22023';
  END IF;

  IF (p_output_artifact_ref IS NULL) <> (p_output_hash IS NULL)
    OR (p_outcome = 'succeeded' AND (p_output_hash IS NULL OR p_error_code IS NOT NULL))
    OR (p_outcome <> 'succeeded' AND p_error_code IS NULL)
    OR p_input_tokens IS NULL
    OR p_output_tokens IS NULL
    OR p_tool_calls IS NULL
    OR p_elapsed_ms IS NULL THEN
    RAISE EXCEPTION 'invalid agent run terminal result' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agent_runs
     SET status = p_outcome,
         output_artifact_ref = p_output_artifact_ref,
         output_hash = p_output_hash,
         error_code = p_error_code,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         tool_calls = p_tool_calls,
         elapsed_ms = p_elapsed_ms,
         cost_usd = p_cost_usd,
         completed_at = clock_timestamp(),
         heartbeat_at = clock_timestamp(),
         lease_token_hash = NULL,
         lease_expires_at = NULL
   WHERE id = p_run_id
     AND tenant_id IS NOT DISTINCT FROM p_tenant_id
     AND status IN ('leased', 'starting', 'running', 'waiting_approval')
     AND (p_outcome <> 'succeeded' OR status IN ('running', 'waiting_approval'))
     AND lease_expires_at > clock_timestamp()
     AND fencing_token = p_fencing_token
     AND lease_token_hash = extensions.digest(convert_to(p_lease_token, 'UTF8'), 'sha256')
  RETURNING * INTO v_run;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN public.agent_run_shadow_safe_json_v1(v_run);
END;
$$;

CREATE OR REPLACE FUNCTION public.orphan_expired_agent_run_shadow_v1(
  p_run_id uuid,
  p_tenant_id uuid,
  p_expected_fencing_token bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_run public.agent_runs%ROWTYPE;
BEGIN
  UPDATE public.agent_runs
     SET status = 'orphaned',
         error_code = 'lease_expired',
         elapsed_ms = LEAST(
           max_elapsed_ms,
           GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - coalesce(started_at, created_at))) * 1000)::integer)
         ),
         completed_at = clock_timestamp(),
         heartbeat_at = clock_timestamp(),
         lease_token_hash = NULL,
         lease_expires_at = NULL
   WHERE id = p_run_id
     AND tenant_id IS NOT DISTINCT FROM p_tenant_id
     AND status IN ('leased', 'starting', 'running', 'waiting_approval')
     AND lease_expires_at <= clock_timestamp()
     AND fencing_token = p_expected_fencing_token
  RETURNING * INTO v_run;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN public.agent_run_shadow_safe_json_v1(v_run);
END;
$$;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_runs_service_read_v1
  ON public.agent_runs
  FOR SELECT
  TO service_role
  USING (true);

REVOKE ALL PRIVILEGES ON TABLE public.agent_runs FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_agent_run_shadow_v1(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, integer, integer, integer, integer, integer, numeric
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_agent_run_shadow_v1(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_agent_run_shadow_v1(uuid, uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transition_agent_run_shadow_v1(uuid, uuid, text, bigint, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_agent_run_shadow_v1(uuid, uuid, text, bigint, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_agent_run_shadow_v1(
  uuid, uuid, text, bigint, text, text, text, text, integer, integer, integer, integer, numeric
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.orphan_expired_agent_run_shadow_v1(uuid, uuid, bigint)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_agent_run_shadow_v1(
  uuid, uuid, text, text, text, text, text, text, text, text, text, text,
  text, text, text, text, text, integer, integer, integer, integer, integer, numeric
) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_agent_run_shadow_v1(uuid, uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_agent_run_shadow_v1(uuid, uuid, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.transition_agent_run_shadow_v1(uuid, uuid, text, bigint, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_agent_run_shadow_v1(uuid, uuid, text, bigint, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_agent_run_shadow_v1(
  uuid, uuid, text, bigint, text, text, text, text, integer, integer, integer, integer, numeric
) TO service_role;
GRANT EXECUTE ON FUNCTION public.orphan_expired_agent_run_shadow_v1(uuid, uuid, bigint)
  TO service_role;
