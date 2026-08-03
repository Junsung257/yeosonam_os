-- Preserve every Clobe 4128 transaction while keeping booking settlement rows isolated.
-- Travel matching continues to use bank_transaction_allocations; non-travel rows only
-- participate in bank-balance reconciliation.

ALTER TABLE public.bank_transactions
  ADD COLUMN IF NOT EXISTS settlement_scope text NOT NULL DEFAULT 'travel',
  ADD COLUMN IF NOT EXISTS account_number text,
  ADD COLUMN IF NOT EXISTS balance_after bigint,
  ADD COLUMN IF NOT EXISTS provider_category text,
  ADD COLUMN IF NOT EXISTS provider_is_unclassified boolean;

ALTER TABLE public.bank_transactions
  DROP CONSTRAINT IF EXISTS bank_transactions_settlement_scope_check;

ALTER TABLE public.bank_transactions
  ADD CONSTRAINT bank_transactions_settlement_scope_check
  CHECK (settlement_scope IN ('travel', 'non_travel'));

UPDATE public.bank_transactions
SET
  account_number = NULLIF(regexp_replace(COALESCE(
    account_number,
    raw_payload ->> 'accountNumber',
    source_metadata -> 'clobe_mcp' ->> 'account_number',
    ''
  ), '\D', '', 'g'), ''),
  balance_after = COALESCE(
    balance_after,
    CASE
      WHEN (raw_payload ->> 'afterBalance') ~ '^-?\d+$'
        THEN (raw_payload ->> 'afterBalance')::bigint
      ELSE NULL
    END
  ),
  provider_category = COALESCE(provider_category, raw_payload ->> 'category'),
  provider_is_unclassified = COALESCE(
    provider_is_unclassified,
    CASE
      WHEN raw_payload ? 'isUnclassified' THEN (raw_payload ->> 'isUnclassified')::boolean
      ELSE NULL
    END
  )
WHERE external_provider = 'clobe';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_clobe_account_reality
  ON public.bank_transactions (account_number, received_at DESC)
  WHERE status = 'active' AND external_provider = 'clobe';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bank_transactions_active_settlement_scope
  ON public.bank_transactions (settlement_scope, received_at DESC)
  WHERE status = 'active';

COMMENT ON COLUMN public.bank_transactions.settlement_scope IS
  'travel rows may affect booking settlement; non_travel rows affect bank reality only and never auto-match to a booking.';
COMMENT ON COLUMN public.bank_transactions.balance_after IS
  'Provider-reported account balance immediately after this transaction. Used to reconcile the complete bank ledger.';
