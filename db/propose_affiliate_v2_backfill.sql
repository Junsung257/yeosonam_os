-- Read-only candidate report for operator-reviewed backfill.
-- No INSERT/UPDATE is executed by this file.

SELECT a.id AS affiliate_id, a.referral_code, a.name,
       count(b.id) FILTER (WHERE b.affiliate_id = a.id AND b.commission_status = 'CALCULATED') AS calculated_bookings,
       count(l.id) AS existing_ledger_entries
FROM public.affiliates a
LEFT JOIN public.bookings b ON b.affiliate_id = a.id
LEFT JOIN public.commission_ledger_entries l ON l.affiliate_id = a.id
GROUP BY a.id, a.referral_code, a.name
ORDER BY a.created_at;

SELECT s.id AS legacy_settlement_id, s.affiliate_id, s.settlement_period,
       s.final_payout, s.status,
       CASE WHEN s.status = 'COMPLETED' THEN 'MANUAL_RECONCILIATION_REQUIRED' ELSE 'REVIEW_ONLY' END AS migration_decision
FROM public.settlements s
ORDER BY s.settlement_period DESC;

-- Proposed operator workflow (execute only after a signed reconciliation worksheet):
-- BEGIN;
-- INSERT INTO public.commission_ledger_entries (..., entry_type, amount_krw, entry_snapshot, created_by)
-- SELECT ... FROM the reviewed worksheet;
-- INSERT INTO public.settlement_runs (..., calculation_snapshot, created_by)
-- SELECT ... FROM the reviewed worksheet;
-- COMMIT;
