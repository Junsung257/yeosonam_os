-- Threads rewrite candidates can be queued by recurring engagement syncs.
-- A durable idempotency key prevents duplicate pending actions when marker updates fail.

BEGIN;

ALTER TABLE agent_actions
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_actions_idempotency_key_unique
  ON agent_actions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN agent_actions.idempotency_key IS
  'Optional unique key for recurring/automated actions that must be queued at most once.';

COMMIT;

NOTIFY pgrst, 'reload schema';
