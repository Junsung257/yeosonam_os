-- Yeosonam OS - bank transaction import dedupe fingerprints
--
-- SMS is the low-cost primary feed, but SMS can miss rows. When a tenant later
-- pastes bank statement rows, these columns let the importer merge statement
-- evidence into an existing SMS transaction instead of posting money twice.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS transaction_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transactions_fingerprint
  ON public.bank_transactions (
    COALESCE(tenant_id::text, 'platform'),
    transaction_fingerprint
  )
  WHERE transaction_fingerprint IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bank_transactions_fingerprint_lookup
  ON public.bank_transactions (transaction_fingerprint)
  WHERE transaction_fingerprint IS NOT NULL;

COMMENT ON COLUMN public.bank_transactions.transaction_fingerprint IS
  'Stable same-transaction key across SMS and bank-statement imports. Prevents duplicate ledger posting when SMS rows are backfilled from copied bank history.';

COMMENT ON COLUMN public.bank_transactions.source_metadata IS
  'Source-specific evidence, such as SMS webhook ids or pasted bank statement rows, retained without re-posting ledger entries.';
