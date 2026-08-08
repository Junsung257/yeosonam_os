-- Affiliate settlement ledger V2 release validation (read-only).

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('commission_ledger_entries', 'settlement_runs', 'settlement_lines', 'payouts', 'settlement_revisions', 'affiliate_disputes')
ORDER BY table_name;

SELECT count(*) AS invalid_ledger_amount_rows
FROM public.commission_ledger_entries
WHERE (entry_type IN ('EARNED', 'BONUS', 'MIGRATION') AND amount_krw <= 0)
   OR (entry_type = 'ADJUSTMENT' AND amount_krw = 0)
   OR (entry_type = 'REVERSAL' AND (amount_krw >= 0 OR source_entry_id IS NULL));

SELECT count(*) AS duplicate_settlement_lines
FROM (
  SELECT ledger_entry_id FROM public.settlement_lines GROUP BY ledger_entry_id HAVING count(*) > 1
) duplicates;

SELECT id, affiliate_id, settlement_period, status
FROM public.settlement_runs
WHERE status = 'COMPLETED'
  AND (gross_commission_krw < 0 OR withholding_krw < 0 OR net_payout_krw < 0);

SELECT id, settlement_run_id, status
FROM public.payouts
WHERE status = 'COMPLETED'
  AND (approved_by IS NULL OR executed_by IS NULL OR completed_at IS NULL OR payout_reference IS NULL OR receipt_url !~ '^https://');

SELECT count(*) AS legacy_settlement_rows_pending_reconciliation
FROM public.settlements;

-- Expected release-gate results:
-- invalid_ledger_amount_rows = 0
-- duplicate_settlement_lines = 0
-- completed payout evidence query = 0 rows
-- legacy rows are reviewed, not automatically migrated.
