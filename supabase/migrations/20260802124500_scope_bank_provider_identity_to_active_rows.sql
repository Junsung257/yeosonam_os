-- Excluded bank evidence is immutable history and may refer to the same
-- provider transaction that replaced it in the active Clobe ledger.
DROP INDEX IF EXISTS public.uq_bank_transactions_external_provider_tx;

CREATE UNIQUE INDEX uq_bank_transactions_external_provider_tx
  ON public.bank_transactions (external_provider, external_transaction_id)
  WHERE external_provider IS NOT NULL
    AND external_transaction_id IS NOT NULL
    AND status IS DISTINCT FROM 'excluded';

COMMENT ON INDEX public.uq_bank_transactions_external_provider_tx IS
  'Provider transaction identity is unique among active bank rows; excluded historical evidence may retain the same identity.';

