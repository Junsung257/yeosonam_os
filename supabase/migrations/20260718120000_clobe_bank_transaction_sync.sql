-- Yeosonam OS - Clobe bank transaction sync
-- Adds provider evidence for automated Clobe imports while keeping the existing
-- bank_transactions ledger/allocation flow as the source of truth.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS external_provider text,
  ADD COLUMN IF NOT EXISTS external_transaction_id text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_source_check;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_source_check
  CHECK (source IN (
    'slack_webhook',
    'slack_gap_fill',
    'bulk_import',
    'manual',
    'dlq_replay',
    'sms',
    'sms_webhook',
    'clobe_mcp',
    'clobe_api'
  ));

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_bank_transactions_external_provider_tx
  ON public.bank_transactions (external_provider, external_transaction_id)
  WHERE external_provider IS NOT NULL
    AND external_transaction_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_clobe_sync_lookup
  ON public.bank_transactions (source, received_at DESC)
  WHERE source IN ('clobe_mcp', 'clobe_api');

COMMENT ON COLUMN public.bank_transactions.external_provider IS
  'External transaction provider for automated imports, e.g. clobe.';

COMMENT ON COLUMN public.bank_transactions.external_transaction_id IS
  'Provider-stable transaction id used as the first dedupe key before local fingerprint fallback.';

COMMENT ON COLUMN public.bank_transactions.raw_payload IS
  'Sanitized provider payload retained for audit/debugging of automated imports.';

COMMENT ON CONSTRAINT bank_transactions_source_check ON public.bank_transactions IS
  'Allowed bank transaction ingestion sources. clobe_mcp/clobe_api are automated Clobe bank statement sync paths.';
