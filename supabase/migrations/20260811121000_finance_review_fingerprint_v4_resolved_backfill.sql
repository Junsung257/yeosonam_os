BEGIN;

-- The v4 hash intentionally changes the fingerprint algorithm. Refresh every
-- current resolved decision once without changing its operator decision.
UPDATE public.booking_settlement_reviews review
SET departure_month = live.departure_month,
    review_fingerprint = live.review_fingerprint,
    deposits = live.deposits,
    withdrawals = live.withdrawals,
    customer_refunds = live.customer_refunds,
    bank_fees = live.bank_fees,
    cash_margin = live.cash_margin,
    transaction_ids = live.transaction_ids,
    updated_at = now(),
    snapshot = review.snapshot || jsonb_build_object(
      'fingerprint_version', 4,
      'v4_resolved_backfill_at', now()
    )
FROM public.finance_booking_review_live_snapshots(NULL::uuid[]) live
WHERE review.booking_id = live.booking_id
  AND review.is_current
  AND review.review_fingerprint IS DISTINCT FROM live.review_fingerprint;

COMMIT;
