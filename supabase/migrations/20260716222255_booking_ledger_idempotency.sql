-- Claim idempotency before any booking balance mutation and persist the exact
-- request/result pair. Exact retries return the original result; conflicts fail.

BEGIN;

CREATE TABLE public.booking_ledger_idempotency (
  idempotency_key text PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  requested_paid_delta integer NOT NULL,
  requested_payout_delta integer NOT NULL,
  source text NOT NULL,
  source_ref_id text NULL,
  memo text NULL,
  created_by text NULL,
  applied_paid_delta integer NULL,
  applied_payout_delta integer NULL,
  result_paid_amount integer NULL,
  result_total_paid_out integer NULL,
  result_payment_status text NULL,
  result_booking_status text NULL,
  result_auto_status_changed boolean NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  CONSTRAINT booking_ledger_idempotency_key_nonblank CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT booking_ledger_idempotency_completion_consistent CHECK (
    (completed_at IS NULL
      AND applied_paid_delta IS NULL
      AND applied_payout_delta IS NULL
      AND result_paid_amount IS NULL
      AND result_total_paid_out IS NULL
      AND result_payment_status IS NULL
      AND result_booking_status IS NULL
      AND result_auto_status_changed IS NULL)
    OR
    (completed_at IS NOT NULL
      AND applied_paid_delta IS NOT NULL
      AND applied_payout_delta IS NOT NULL
      AND result_paid_amount IS NOT NULL
      AND result_total_paid_out IS NOT NULL
      AND result_payment_status IS NOT NULL
      AND result_booking_status IS NOT NULL
      AND result_auto_status_changed IS NOT NULL)
  )
);

CREATE INDEX booking_ledger_idempotency_booking_id_idx
  ON public.booking_ledger_idempotency(booking_id);

ALTER TABLE public.booking_ledger_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.booking_ledger_idempotency FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.booking_ledger_idempotency TO service_role;
CREATE POLICY booking_ledger_idempotency_service_role
  ON public.booking_ledger_idempotency FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.update_booking_ledger(
  p_booking_id uuid,
  p_paid_delta integer DEFAULT 0,
  p_payout_delta integer DEFAULT 0,
  p_source text DEFAULT 'slack_ingest',
  p_source_ref_id text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_memo text DEFAULT NULL,
  p_created_by text DEFAULT NULL
)
RETURNS TABLE (
  paid_amount integer,
  total_paid_out integer,
  payment_status text,
  booking_status text,
  auto_status_changed boolean
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_claim public.booking_ledger_idempotency%ROWTYPE;
  v_total_price integer;
  v_old_paid integer;
  v_old_payout integer;
  v_new_paid integer;
  v_new_payout integer;
  v_applied_paid integer;
  v_applied_payout integer;
  v_payment_status text;
  v_old_status text;
  v_new_status text;
  v_status_changed boolean := false;
BEGIN
  IF p_paid_delta = 0 AND p_payout_delta = 0 THEN
    RETURN QUERY
      SELECT COALESCE(b.paid_amount, 0), COALESCE(b.total_paid_out, 0),
        b.payment_status, b.status, false
      FROM public.bookings b WHERE b.id = p_booking_id;
    RETURN;
  END IF;
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'booking ledger idempotency key is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
  SELECT * INTO v_claim
  FROM public.booking_ledger_idempotency
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_claim.booking_id <> p_booking_id
      OR v_claim.requested_paid_delta <> p_paid_delta
      OR v_claim.requested_payout_delta <> p_payout_delta
      OR v_claim.source <> p_source
      OR v_claim.source_ref_id IS DISTINCT FROM p_source_ref_id
      OR v_claim.memo IS DISTINCT FROM p_memo
      OR v_claim.created_by IS DISTINCT FROM p_created_by THEN
      RAISE EXCEPTION 'booking ledger idempotency key conflict';
    END IF;
    IF v_claim.completed_at IS NULL THEN
      RAISE EXCEPTION 'booking ledger idempotency claim is incomplete';
    END IF;
    RETURN QUERY SELECT
      v_claim.result_paid_amount,
      v_claim.result_total_paid_out,
      v_claim.result_payment_status,
      v_claim.result_booking_status,
      v_claim.result_auto_status_changed;
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ledger_entries
    WHERE idempotency_key IN (p_idempotency_key || ':paid', p_idempotency_key || ':payout')
  ) THEN
    RAISE EXCEPTION 'legacy ledger idempotency key requires reconciliation';
  END IF;

  INSERT INTO public.booking_ledger_idempotency (
    idempotency_key, booking_id, requested_paid_delta, requested_payout_delta,
    source, source_ref_id, memo, created_by
  ) VALUES (
    p_idempotency_key, p_booking_id, p_paid_delta, p_payout_delta,
    p_source, p_source_ref_id, p_memo, p_created_by
  );

  SELECT COALESCE(b.total_price, 0), COALESCE(b.paid_amount, 0),
    COALESCE(b.total_paid_out, 0), b.status
  INTO v_total_price, v_old_paid, v_old_payout, v_old_status
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found';
  END IF;

  v_new_paid := GREATEST(0, v_old_paid + p_paid_delta);
  v_new_payout := GREATEST(0, v_old_payout + p_payout_delta);
  v_applied_paid := v_new_paid - v_old_paid;
  v_applied_payout := v_new_payout - v_old_payout;
  v_payment_status := CASE
    WHEN v_total_price > 0 AND v_new_paid >= v_total_price THEN '완납'
    WHEN v_new_paid > 0 THEN '일부입금'
    ELSE '미입금'
  END;
  v_new_status := v_old_status;
  IF v_old_status <> 'cancelled' AND v_applied_paid > 0 THEN
    IF v_total_price > 0 AND v_new_paid >= v_total_price AND v_old_status <> 'completed' THEN
      v_new_status := 'completed';
    ELSIF v_new_paid > 0 AND v_old_status = 'pending' THEN
      v_new_status := 'confirmed';
    END IF;
  END IF;
  v_status_changed := v_new_status <> v_old_status;

  UPDATE public.bookings
  SET paid_amount = v_new_paid,
      total_paid_out = v_new_payout,
      payment_status = v_payment_status,
      status = v_new_status,
      updated_at = now()
  WHERE id = p_booking_id;

  IF v_applied_paid <> 0 THEN
    PERFORM public.record_ledger_entry(
      p_booking_id, 'paid_amount',
      CASE WHEN v_applied_paid > 0 THEN 'deposit' ELSE 'refund' END,
      v_applied_paid, p_source, p_source_ref_id,
      p_idempotency_key || ':paid', p_memo, p_created_by
    );
  END IF;
  IF v_applied_payout <> 0 THEN
    PERFORM public.record_ledger_entry(
      p_booking_id, 'total_paid_out',
      CASE WHEN v_applied_payout > 0 THEN 'payout' ELSE 'payout_reverse' END,
      v_applied_payout, p_source, p_source_ref_id,
      p_idempotency_key || ':payout', p_memo, p_created_by
    );
  END IF;

  UPDATE public.booking_ledger_idempotency
  SET applied_paid_delta = v_applied_paid,
      applied_payout_delta = v_applied_payout,
      result_paid_amount = v_new_paid,
      result_total_paid_out = v_new_payout,
      result_payment_status = v_payment_status,
      result_booking_status = v_new_status,
      result_auto_status_changed = v_status_changed,
      completed_at = now()
  WHERE idempotency_key = p_idempotency_key;

  RETURN QUERY SELECT v_new_paid, v_new_payout, v_payment_status, v_new_status, v_status_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.update_booking_ledger(uuid, integer, integer, text, text, text, text, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_booking_ledger(uuid, integer, integer, text, text, text, text, text)
  TO service_role;

COMMENT ON TABLE public.booking_ledger_idempotency IS
  'Global request claims and immutable outcomes for atomic booking ledger mutations.';
COMMENT ON FUNCTION public.update_booking_ledger(uuid, integer, integer, text, text, text, text, text) IS
  'Claims a global idempotency key before mutation, rejects payload conflicts, and records applied clamped deltas.';

COMMIT;
