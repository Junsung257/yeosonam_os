BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = public, extensions, pg_catalog;

SELECT plan(61);

SELECT has_table('public', 'agent_runs', 'agent_runs shadow ledger exists');

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.agent_runs'::regclass),
  'agent_runs has RLS enabled'
);

SELECT ok(
  (SELECT relforcerowsecurity FROM pg_class WHERE oid = 'public.agent_runs'::regclass),
  'agent_runs forces RLS for non-superuser owners'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS privilege
    WHERE has_table_privilege('anon', 'public.agent_runs', privilege)
  ),
  'anon has no direct agent_runs privilege'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS privilege
    WHERE has_table_privilege('authenticated', 'public.agent_runs', privilege)
  ),
  'authenticated has no direct agent_runs privilege'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS privilege
    WHERE has_table_privilege('service_role', 'public.agent_runs', privilege)
  ),
  'service_role must use bounded RPCs instead of direct table access'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    WHERE policy.polrelid = 'public.agent_runs'::regclass
      AND policy.polcmd = 'r'
      AND 'service_role'::regrole = ANY(policy.polroles)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM pg_policy AS policy
    CROSS JOIN unnest(policy.polroles) AS policy_role
    WHERE policy.polrelid = 'public.agent_runs'::regclass
      AND policy_role IN ('anon'::regrole, 'authenticated'::regrole)
  ),
  'only service_role is named by the shadow ledger RLS policy'
);

CREATE TEMP TABLE shadow_rpc_names(name text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO shadow_rpc_names(name) VALUES
  ('create_agent_run_shadow_v1'),
  ('get_agent_run_shadow_v1'),
  ('claim_agent_run_shadow_v1'),
  ('transition_agent_run_shadow_v1'),
  ('heartbeat_agent_run_shadow_v1'),
  ('complete_agent_run_shadow_v1'),
  ('orphan_expired_agent_run_shadow_v1');

SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_proc AS function
    JOIN shadow_rpc_names AS expected ON expected.name = function.proname
    WHERE function.pronamespace = 'public'::regnamespace
  ),
  7,
  'exactly the seven bounded shadow RPCs exist'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS function
    JOIN shadow_rpc_names AS expected ON expected.name = function.proname
    WHERE function.pronamespace = 'public'::regnamespace
      AND (
        function.prosecdef IS NOT TRUE
        OR array_to_string(function.proconfig, ',') NOT LIKE '%search_path=%'
      )
  ),
  'all bounded shadow RPCs are security definer functions with pinned search paths'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS function
    JOIN shadow_rpc_names AS expected ON expected.name = function.proname
    WHERE function.pronamespace = 'public'::regnamespace
      AND has_function_privilege('anon', function.oid, 'EXECUTE')
  ),
  'anon cannot execute any shadow Run RPC'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS function
    JOIN shadow_rpc_names AS expected ON expected.name = function.proname
    WHERE function.pronamespace = 'public'::regnamespace
      AND has_function_privilege('authenticated', function.oid, 'EXECUTE')
  ),
  'authenticated cannot execute any shadow Run RPC'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc AS function
    JOIN shadow_rpc_names AS expected ON expected.name = function.proname
    WHERE function.pronamespace = 'public'::regnamespace
      AND NOT has_function_privilege('service_role', function.oid, 'EXECUTE')
  ),
  'service_role can execute every bounded shadow Run RPC'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE pronamespace = 'public'::regnamespace
      AND proname ~ '^((delete|dispatch|dequeue|retry|authorize|approve).*agent_run|agent_run.*(command|worker))'
  ),
  'the migration exposes no delete, dispatch, retry, approval, worker, or command RPC'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.agent_runs'::regclass
      AND tgname = 'trg_guard_agent_run_shadow_update_v1'
      AND NOT tgisinternal
  ),
  'agent_runs has a lifecycle and immutability trigger'
);

INSERT INTO public.agent_tasks (
  id,
  correlation_id,
  source,
  agent_type,
  specialist_id,
  performative,
  risk_level,
  status,
  task_context,
  created_by
) VALUES
  (
    '11111111-1111-4111-8111-111111111111',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'manual',
    'system',
    'research.technology_scout',
    'request',
    'medium',
    'queued',
    '{"objective_ref":"technology-radar:test-1"}'::jsonb,
    'test.fixture'
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'manual',
    'system',
    'research.technology_scout',
    'request',
    'medium',
    'queued',
    '{"objective_ref":"technology-radar:test-2"}'::jsonb,
    'test.fixture'
  );

CREATE FUNCTION pg_temp.create_test_shadow_run(
  p_task_id uuid,
  p_tenant_id uuid DEFAULT NULL,
  p_role_key text DEFAULT 'research.technology_scout',
  p_runtime_version text DEFAULT '1.0.0'
)
RETURNS jsonb
LANGUAGE sql
AS $$
  SELECT public.create_agent_run_shadow_v1(
    p_task_id,
    p_tenant_id,
    'service.agent-office',
    'session.shadow-test',
    p_role_key,
    '1.0.0',
    'research.technology_scout',
    '1.0.0',
    'codex_subscription_worker',
    p_runtime_version,
    'research.technology_scout_no_tools',
    '1.0.0',
    NULL,
    NULL,
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'trace.shadow-test',
    900000,
    8,
    12,
    80000,
    12000,
    NULL
  );
$$;

CREATE TEMP TABLE shadow_receipts(
  receipt_key text PRIMARY KEY,
  receipt jsonb
) ON COMMIT DROP;

INSERT INTO shadow_receipts(receipt_key, receipt)
VALUES ('run-1-created', pg_temp.create_test_shadow_run('11111111-1111-4111-8111-111111111111'));

SELECT isnt(
  (SELECT receipt FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
  NULL::jsonb,
  'a valid new Technology Scout execution creates one shadow Run'
);

SELECT is(
  (SELECT (receipt ->> 'attempt_number')::integer FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
  1,
  'the first Run receives attempt number one'
);

SELECT ok(
  (
    SELECT receipt @> '{"execution_mode":"shadow","authoritative":false,"command_access_allowed":false,"production_access":false,"data_classification":"public"}'::jsonb
    FROM shadow_receipts
    WHERE receipt_key = 'run-1-created'
  ),
  'the database fixes every authority flag to shadow-only values'
);

SELECT ok(
  (
    SELECT receipt -> 'policy_snapshot' @> '{"authoritative":false,"commandAccessAllowed":false,"sideEffectMode":"forbidden","triggerMode":"manual","productionAccess":false}'::jsonb
    FROM shadow_receipts
    WHERE receipt_key = 'run-1-created'
  ),
  'the server constructs a fail-closed non-content policy snapshot'
);

SELECT ok(
  NOT (
    SELECT receipt ? 'lease_token_hash'
    FROM shadow_receipts
    WHERE receipt_key = 'run-1-created'
  ),
  'safe RPC receipts never expose the lease token hash column'
);

SELECT is(
  (SELECT status FROM public.agent_tasks WHERE id = '11111111-1111-4111-8111-111111111111'),
  'queued',
  'Run creation does not change the Task SSOT'
);

INSERT INTO shadow_receipts(receipt_key, receipt)
VALUES ('run-1-attempt-2', pg_temp.create_test_shadow_run('11111111-1111-4111-8111-111111111111'));

SELECT is(
  (SELECT (receipt ->> 'attempt_number')::integer FROM shadow_receipts WHERE receipt_key = 'run-1-attempt-2'),
  2,
  'task-row locking allocates the next attempt number'
);

SELECT throws_ok(
  $$SELECT pg_temp.create_test_shadow_run(
      '11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333'
    )$$,
  '42501',
  'agent run tenant does not match task tenant',
  'a tenant mismatch fails before a Run can be inserted'
);

SELECT throws_ok(
  $$SELECT pg_temp.create_test_shadow_run(
      '11111111-1111-4111-8111-111111111111',
      NULL,
      'marketing.blog_writer'
    )$$,
  '42501',
  'task is not bound to the PR-01B technology scout pilot',
  'the database rejects roles outside the single approved pilot'
);

SELECT throws_ok(
  $$SELECT pg_temp.create_test_shadow_run(
      '11111111-1111-4111-8111-111111111111',
      NULL,
      'research.technology_scout',
      '9.9.9'
    )$$,
  '42501',
  'contract snapshot does not match the approved PR-01A pilot',
  'the database rejects forged contract versions outside PR-01A'
);

INSERT INTO shadow_receipts(receipt_key, receipt)
SELECT 'run-1-claimed', public.claim_agent_run_shadow_v1(
  (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
  NULL,
  'worker.shadow-test',
  repeat('lease-secret-', 4),
  300
);

SELECT is(
  (SELECT receipt ->> 'status' FROM shadow_receipts WHERE receipt_key = 'run-1-claimed'),
  'leased',
  'the exact created Run is atomically leased'
);

SELECT is(
  (SELECT (receipt ->> 'fencing_token')::integer FROM shadow_receipts WHERE receipt_key = 'run-1-claimed'),
  1,
  'a successful claim increments the fencing token'
);

SELECT ok(
  NOT (SELECT receipt ? 'lease_token_hash' FROM shadow_receipts WHERE receipt_key = 'run-1-claimed'),
  'claim receipt also hides the token digest'
);

SELECT is(
  public.claim_agent_run_shadow_v1(
    (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
    NULL,
    'worker.shadow-racer',
    repeat('other-secret-', 4),
    300
  ),
  NULL::jsonb,
  'a second claimant cannot acquire the same Run'
);

SELECT is(
  public.transition_agent_run_shadow_v1(
    (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
    NULL,
    repeat('wrong-secret-', 4),
    1,
    'leased',
    'starting'
  ),
  NULL::jsonb,
  'a wrong lease secret changes zero rows'
);

SELECT is(
  public.transition_agent_run_shadow_v1(
    (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
    NULL,
    repeat('lease-secret-', 4),
    2,
    'leased',
    'starting'
  ),
  NULL::jsonb,
  'a stale or forged fencing token changes zero rows'
);

INSERT INTO shadow_receipts(receipt_key, receipt)
SELECT 'run-1-starting', public.transition_agent_run_shadow_v1(
  (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
  NULL,
  repeat('lease-secret-', 4),
  1,
  'leased',
  'starting'
);

SELECT is(
  (SELECT receipt ->> 'status' FROM shadow_receipts WHERE receipt_key = 'run-1-starting'),
  'starting',
  'the valid lease can enter starting'
);

SELECT isnt(
  (SELECT receipt ->> 'started_at' FROM shadow_receipts WHERE receipt_key = 'run-1-starting'),
  NULL::text,
  'starting records the first execution timestamp'
);

INSERT INTO shadow_receipts(receipt_key, receipt)
SELECT 'run-1-running', public.transition_agent_run_shadow_v1(
  (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
  NULL,
  repeat('lease-secret-', 4),
  1,
  'starting',
  'running'
);

SELECT is(
  (SELECT receipt ->> 'status' FROM shadow_receipts WHERE receipt_key = 'run-1-running'),
  'running',
  'starting can enter running'
);

SELECT is(
  public.heartbeat_agent_run_shadow_v1(
    (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
    NULL,
    repeat('wrong-secret-', 4),
    1,
    300
  ),
  NULL::jsonb,
  'a wrong heartbeat secret changes zero rows'
);

SELECT isnt(
  public.heartbeat_agent_run_shadow_v1(
    (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
    NULL,
    repeat('lease-secret-', 4),
    1,
    300
  ),
  NULL::jsonb,
  'a valid heartbeat extends the exact active Run'
);

INSERT INTO shadow_receipts(receipt_key, receipt)
SELECT 'run-1-waiting', public.transition_agent_run_shadow_v1(
  (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
  NULL,
  repeat('lease-secret-', 4),
  1,
  'running',
  'waiting_approval'
);

SELECT is(
  (SELECT receipt ->> 'status' FROM shadow_receipts WHERE receipt_key = 'run-1-waiting'),
  'waiting_approval',
  'running can enter waiting_approval without changing Task state'
);

INSERT INTO shadow_receipts(receipt_key, receipt)
SELECT 'run-1-resumed', public.transition_agent_run_shadow_v1(
  (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
  NULL,
  repeat('lease-secret-', 4),
  1,
  'waiting_approval',
  'running'
);

SELECT is(
  (SELECT receipt ->> 'status' FROM shadow_receipts WHERE receipt_key = 'run-1-resumed'),
  'running',
  'waiting_approval can return to running under the same fence'
);

SELECT throws_ok(
  format(
    'SELECT public.transition_agent_run_shadow_v1(%L::uuid, NULL, %L, 1, %L, %L)',
    (SELECT receipt ->> 'id' FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
    repeat('lease-secret-', 4),
    'running',
    'starting'
  ),
  '22023',
  'invalid nonterminal agent run transition',
  'an invalid lifecycle edge is rejected before update'
);

INSERT INTO shadow_receipts(receipt_key, receipt)
SELECT 'run-1-succeeded', public.complete_agent_run_shadow_v1(
  (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
  NULL,
  repeat('lease-secret-', 4),
  1,
  'succeeded',
  'artifact.radar-test',
  'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  NULL,
  1200,
  300,
  0,
  45000,
  NULL
);

SELECT is(
  (SELECT receipt ->> 'status' FROM shadow_receipts WHERE receipt_key = 'run-1-succeeded'),
  'succeeded',
  'a running Run can finish with validated success evidence'
);

SELECT is(
  (SELECT receipt ->> 'output_artifact_ref' FROM shadow_receipts WHERE receipt_key = 'run-1-succeeded'),
  'artifact.radar-test',
  'the successful receipt carries only an opaque artifact reference'
);

SELECT is(
  (SELECT (receipt ->> 'input_tokens')::integer FROM shadow_receipts WHERE receipt_key = 'run-1-succeeded'),
  1200,
  'bounded usage is recorded at terminal completion'
);

SELECT is(
  (SELECT status FROM public.agent_tasks WHERE id = '11111111-1111-4111-8111-111111111111'),
  'queued',
  'successful shadow completion still does not change the Task SSOT'
);

SELECT is(
  (
    SELECT lease_token_hash
    FROM public.agent_runs
    WHERE id = (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created')
  ),
  NULL::bytea,
  'terminal completion clears the stored lease token digest'
);

SELECT is(
  public.claim_agent_run_shadow_v1(
    (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
    NULL,
    'worker.shadow-reclaim',
    repeat('reclaim-secret-', 4),
    300
  ),
  NULL::jsonb,
  'a terminal Run cannot be reclaimed'
);

SELECT throws_ok(
  format(
    'UPDATE public.agent_runs SET error_code = %L WHERE id = %L::uuid',
    'tamper_attempt',
    (SELECT receipt ->> 'id' FROM shadow_receipts WHERE receipt_key = 'run-1-created')
  ),
  '23514',
  'terminal agent run is immutable',
  'terminal rows reject later mutation even for a privileged database owner'
);

SELECT throws_ok(
  format(
    'UPDATE public.agent_runs SET role_key = %L WHERE id = %L::uuid',
    'research.changed_role',
    (SELECT receipt ->> 'id' FROM shadow_receipts WHERE receipt_key = 'run-1-attempt-2')
  ),
  '23514',
  'agent run contract identity is immutable',
  'a created Run cannot have its contract identity rewritten'
);

SELECT ok(
  NOT (
    public.get_agent_run_shadow_v1(
      (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
      NULL
    ) ? 'lease_token_hash'
  ),
  'the read RPC omits the lease token digest'
);

SELECT is(
  public.get_agent_run_shadow_v1(
    (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-created'),
    '33333333-3333-4333-8333-333333333333'
  ),
  NULL::jsonb,
  'the read RPC fails closed for a different tenant scope'
);

INSERT INTO shadow_receipts(receipt_key, receipt)
VALUES ('run-2-created', pg_temp.create_test_shadow_run('22222222-2222-4222-8222-222222222222'));

INSERT INTO shadow_receipts(receipt_key, receipt)
SELECT 'run-2-claimed', public.claim_agent_run_shadow_v1(
  (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-2-created'),
  NULL,
  'worker.shadow-expiry',
  repeat('expiry-secret-', 4),
  300
);

SELECT is(
  public.orphan_expired_agent_run_shadow_v1(
    (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-2-created'),
    NULL,
    2
  ),
  NULL::jsonb,
  'an incorrect fence cannot orphan an active Run'
);

UPDATE public.agent_runs
   SET lease_expires_at = clock_timestamp() - interval '1 second'
 WHERE id = (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-2-created');

INSERT INTO shadow_receipts(receipt_key, receipt)
SELECT 'run-2-orphaned', public.orphan_expired_agent_run_shadow_v1(
  (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-2-created'),
  NULL,
  1
);

SELECT is(
  (SELECT receipt ->> 'status' FROM shadow_receipts WHERE receipt_key = 'run-2-orphaned'),
  'orphaned',
  'an expired exact Run is marked orphaned under its current fence'
);

SELECT is(
  (SELECT receipt ->> 'error_code' FROM shadow_receipts WHERE receipt_key = 'run-2-orphaned'),
  'lease_expired',
  'orphan reconciliation records a stable reason code'
);

SELECT is(
  (SELECT status FROM public.agent_tasks WHERE id = '22222222-2222-4222-8222-222222222222'),
  'queued',
  'orphan reconciliation does not mutate the Task SSOT'
);

SELECT is(
  (SELECT count(*)::integer FROM public.agent_runs WHERE authoritative),
  0,
  'no Run can become authoritative'
);

SELECT is(
  (SELECT count(*)::integer FROM public.agent_runs WHERE command_access_allowed OR production_access),
  0,
  'no Run can gain Command or Production access'
);

SELECT is(
  (SELECT count(*)::integer FROM public.agent_runs WHERE task_id = '11111111-1111-4111-8111-111111111111'),
  2,
  'failed tenant and role attempts inserted no extra Runs'
);

SELECT throws_ok(
  $$SELECT public.complete_agent_run_shadow_v1(
      (SELECT (receipt ->> 'id')::uuid FROM shadow_receipts WHERE receipt_key = 'run-1-attempt-2'),
      NULL,
      repeat('never-claimed-', 4),
      1,
      'succeeded',
      NULL,
      NULL,
      NULL,
      0,
      0,
      0,
      0,
      NULL
    )$$,
  '22023',
  'invalid agent run terminal result',
  'success without a Work Product reference and hash fails closed'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.agent_runs
    WHERE policy_snapshot::text ~* '(prompt|toolArguments|customer|secret|signedUrl)'
      AND policy_snapshot ?| ARRAY['rawPrompt', 'toolArguments', 'customer', 'secret', 'signedUrl']
  ),
  'server-built policy snapshots contain no raw content or credential fields'
);

SELECT is(
  (SELECT count(*)::integer FROM public.agent_runs WHERE attempt_number < 1),
  0,
  'every persisted Run has a positive attempt number'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM public.agent_runs
    WHERE tenant_id IS DISTINCT FROM (
      SELECT task.tenant_id FROM public.agent_tasks AS task WHERE task.id = agent_runs.task_id
    )
  ),
  'every Run tenant matches its Task tenant'
);

SELECT is(
  (SELECT count(*)::integer FROM public.agent_runs WHERE execution_mode <> 'shadow'),
  0,
  'every persisted Run remains in shadow execution mode'
);

SELECT is(
  (SELECT count(*)::integer FROM public.agent_runs WHERE status = 'created'),
  1,
  'the unclaimed second attempt remains inert and cannot select work'
);

SELECT * FROM finish();
ROLLBACK;
