-- ============================================================================
-- Atomic Increment RPCs (race-condition free)
-- ============================================================================
-- Replaces read-modify-write patterns found by db-query-analyzer.js:
--   - src/lib/affiliate/settlement-calc.ts:122 — affiliate booking_count
--   - src/app/api/bank-transactions/route.ts:658 — customer mileage overflow
--
-- These atomic UPDATE expressions prevent lost-update race conditions when
-- multiple concurrent transactions update the same row.
-- ============================================================================

-- ─── Affiliate booking count increment ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_affiliate_booking_count(
  p_affiliate_id uuid,
  p_delta integer
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE affiliates
  SET booking_count = COALESCE(booking_count, 0) + p_delta
  WHERE id = p_affiliate_id
  RETURNING booking_count;
$$;

REVOKE ALL ON FUNCTION public.increment_affiliate_booking_count(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_affiliate_booking_count(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.increment_affiliate_booking_count IS
'Atomically increment affiliates.booking_count. Prevents race conditions in concurrent settlement approvals.';

-- ─── Customer mileage increment ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_customer_mileage(
  p_customer_id uuid,
  p_delta integer
)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE customers
  SET mileage = GREATEST(0, COALESCE(mileage, 0) + p_delta)
  WHERE id = p_customer_id
  RETURNING mileage;
$$;

REVOKE ALL ON FUNCTION public.increment_customer_mileage(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_customer_mileage(uuid, integer) TO authenticated, service_role;

COMMENT ON FUNCTION public.increment_customer_mileage IS
'Atomically adjust customers.mileage by delta. GREATEST(0,...) prevents negative balance from concurrent debits. Used by overflow credit + reservation accrual.';
