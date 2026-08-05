-- Clobe 4128 transactions are atomic statement rows: one row, one booking,
-- and never more than the source amount.

BEGIN;

CREATE OR REPLACE FUNCTION public.assert_clobe_4128_allocation_integrity(
  p_bank_transaction_id uuid
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_transaction public.bank_transactions%ROWTYPE;
  v_booking_count integer;
  v_allocated_total bigint;
BEGIN
  SELECT * INTO v_transaction
  FROM public.bank_transactions
  WHERE id = p_bank_transaction_id;

  IF NOT FOUND
     OR v_transaction.external_provider <> 'clobe'
     OR v_transaction.source <> 'clobe_mcp'
     OR v_transaction.account_number <> '100038454128'
     OR v_transaction.status <> 'active' THEN
    RETURN;
  END IF;

  SELECT
    COUNT(DISTINCT booking_id)::integer,
    COALESCE(SUM(allocated_amount), 0)::bigint
  INTO v_booking_count, v_allocated_total
  FROM public.bank_transaction_allocations
  WHERE bank_transaction_id = p_bank_transaction_id
    AND status = 'active'
    AND reversed_at IS NULL;

  IF v_booking_count > 1 THEN
    RAISE EXCEPTION 'Clobe 4128 transaction may be allocated to only one booking';
  END IF;
  IF v_allocated_total > v_transaction.amount THEN
    RAISE EXCEPTION 'active allocation exceeds Clobe 4128 transaction amount';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_clobe_4128_allocation_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM public.assert_clobe_4128_allocation_integrity(NEW.bank_transaction_id);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.bank_transaction_id IS DISTINCT FROM NEW.bank_transaction_id THEN
    PERFORM public.assert_clobe_4128_allocation_integrity(OLD.bank_transaction_id);
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_clobe_4128_allocation_integrity ON public.bank_transaction_allocations;
CREATE TRIGGER trg_clobe_4128_allocation_integrity
  AFTER INSERT OR UPDATE OF bank_transaction_id, booking_id, allocated_amount, status, reversed_at
  ON public.bank_transaction_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_clobe_4128_allocation_integrity();

REVOKE ALL ON FUNCTION public.assert_clobe_4128_allocation_integrity(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assert_clobe_4128_allocation_integrity(uuid) TO service_role;

COMMIT;
