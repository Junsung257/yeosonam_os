-- A Clobe withdrawal with active unassigned evidence is not approved.
-- Keep that invariant even if a later evidence refresh tries to restore the
-- transaction's previous `manual` status.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_pending_clobe_outflow_review()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(NEW.status, 'active') <> 'excluded'
     AND (NEW.source IN ('clobe_mcp', 'clobe_api') OR NEW.external_provider = 'clobe')
     AND NEW.settlement_scope = 'travel'
     AND (NEW.transaction_type = '출금' OR COALESCE(NEW.is_refund, FALSE)) THEN
    IF EXISTS (
       SELECT 1
       FROM public.bank_transaction_allocations a
       WHERE a.bank_transaction_id = NEW.id
         AND a.status = 'active'
         AND a.reversed_at IS NULL
         AND a.target_type = 'unassigned'
         AND a.allocation_type = 'unassigned'
    ) THEN
      NEW.booking_id := NULL;
      NEW.match_status := 'review';
      NEW.match_confidence := 0;
      NEW.matched_by := NULL;
      NEW.matched_at := NULL;
    ELSIF TG_OP = 'UPDATE'
       AND OLD.match_status IN ('manual', 'auto')
       AND NEW.match_status = 'review'
       AND NEW.matched_by IS NULL THEN
      -- A provider-evidence refresh must not overwrite an approval that won
      -- the row lock after the refresh began. Explicit memo-review commands
      -- carry their own actor and are intentionally not covered here.
      NEW.booking_id := OLD.booking_id;
      NEW.match_status := OLD.match_status;
      NEW.match_confidence := OLD.match_confidence;
      NEW.matched_by := OLD.matched_by;
      NEW.matched_at := OLD.matched_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_pending_clobe_outflow_review()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_pending_clobe_outflow_review
  ON public.bank_transactions;
CREATE TRIGGER trg_enforce_pending_clobe_outflow_review
BEFORE INSERT OR UPDATE OF
  booking_id,
  match_status,
  match_confidence,
  matched_by,
  matched_at,
  settlement_scope,
  status,
  transaction_type,
  is_refund
ON public.bank_transactions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_pending_clobe_outflow_review();

CREATE OR REPLACE FUNCTION public.enforce_clobe_outflow_review_from_allocation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'active'
     AND NEW.reversed_at IS NULL
     AND NEW.target_type = 'unassigned'
     AND NEW.allocation_type = 'unassigned' THEN
    UPDATE public.bank_transactions bt
    SET booking_id = NULL,
        match_status = 'review',
        match_confidence = 0,
        matched_by = NULL,
        matched_at = NULL,
        updated_at = pg_catalog.now()
    WHERE bt.id = NEW.bank_transaction_id
      AND COALESCE(bt.status, 'active') <> 'excluded'
      AND (bt.source IN ('clobe_mcp', 'clobe_api') OR bt.external_provider = 'clobe')
      AND bt.settlement_scope = 'travel'
      AND (bt.transaction_type = '출금' OR COALESCE(bt.is_refund, FALSE));
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_clobe_outflow_review_from_allocation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_clobe_outflow_review_from_allocation
  ON public.bank_transaction_allocations;
CREATE TRIGGER trg_enforce_clobe_outflow_review_from_allocation
AFTER INSERT OR UPDATE OF
  bank_transaction_id,
  status,
  reversed_at,
  target_type,
  allocation_type
ON public.bank_transaction_allocations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_clobe_outflow_review_from_allocation();

UPDATE public.bank_transactions bt
SET booking_id = NULL,
    match_status = 'review',
    match_confidence = 0,
    matched_by = NULL,
    matched_at = NULL,
    updated_at = pg_catalog.now()
WHERE COALESCE(bt.status, 'active') <> 'excluded'
  AND (bt.source IN ('clobe_mcp', 'clobe_api') OR bt.external_provider = 'clobe')
  AND bt.settlement_scope = 'travel'
  AND (bt.transaction_type = '출금' OR COALESCE(bt.is_refund, FALSE))
  AND EXISTS (
    SELECT 1
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = bt.id
      AND a.status = 'active'
      AND a.reversed_at IS NULL
      AND a.target_type = 'unassigned'
      AND a.allocation_type = 'unassigned'
  )
  AND (
    bt.booking_id IS NOT NULL
    OR bt.match_status IS DISTINCT FROM 'review'
    OR bt.match_confidence IS DISTINCT FROM 0
    OR bt.matched_by IS NOT NULL
    OR bt.matched_at IS NOT NULL
  );

COMMENT ON FUNCTION public.enforce_pending_clobe_outflow_review()
  IS 'Prevents Clobe withdrawals with active unassigned evidence from appearing approved before an explicit allocation command.';

COMMENT ON FUNCTION public.enforce_clobe_outflow_review_from_allocation()
  IS 'Applies the pending-review invariant when an active unassigned Clobe outflow allocation is created or restored.';

COMMIT;
