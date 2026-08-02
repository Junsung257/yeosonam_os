-- An excluded historical row may describe the same physical transaction as
-- its authoritative active replacement. Enforce fingerprint uniqueness only
-- within the active settlement ledger.
DROP INDEX CONCURRENTLY IF EXISTS public.uq_bank_transactions_fingerprint;

CREATE UNIQUE INDEX CONCURRENTLY uq_bank_transactions_fingerprint
  ON public.bank_transactions (
    COALESCE(tenant_id::TEXT, 'platform'),
    transaction_fingerprint
  )
  WHERE transaction_fingerprint IS NOT NULL
    AND status IS DISTINCT FROM 'excluded';

COMMENT ON INDEX public.uq_bank_transactions_fingerprint IS
  'Transaction fingerprints are unique among active bank rows; excluded historical evidence may retain the same fingerprint.';
