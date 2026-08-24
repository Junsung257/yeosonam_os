-- Clobe memo settlement cash-close command.
--
-- This is intentionally separate from product-price settlement. Clobe
-- settlement bookings have no sales price/cost yet; their immediate truth is
-- provider deposits minus provider payouts. The command is short, atomic and
-- idempotent, while the provider sync remains resumable and manual.

BEGIN;

CREATE TABLE IF NOT EXISTS public.clobe_settlement_command_idempotency (
  idempotency_key TEXT PRIMARY KEY,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  command_type TEXT NOT NULL CHECK (command_type IN ('finalize', 'unfinalize')),
  request_json JSONB NOT NULL,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.clobe_settlement_command_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clobe_settlement_command_idempotency FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clobe_settlement_command_idempotency TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_clobe_booking_settlement(
  p_booking_id UUID,
  p_confirm BOOLEAN DEFAULT TRUE,
  p_reason TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL,
  p_actor TEXT DEFAULT 'admin'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking RECORD;
  v_command RECORD;
  v_paid BIGINT;
  v_payout BIGINT;
  v_net BIGINT;
  v_result JSONB;
  v_command_type TEXT := CASE WHEN p_confirm THEN 'finalize' ELSE 'unfinalize' END;
  v_already_in_state BOOLEAN := FALSE;
BEGIN
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Clobe settlement command requires idempotency_key' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));

  SELECT * INTO v_command
  FROM public.clobe_settlement_command_idempotency
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_command.booking_id <> p_booking_id OR v_command.command_type <> v_command_type THEN
      RAISE EXCEPTION 'Clobe settlement idempotency key conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(v_command.result_json, jsonb_build_object('ok', true, 'idempotent_replay', true));
  END IF;

  SELECT id, status, is_deleted, paid_amount, total_paid_out,
         settlement_confirmed_at, settlement_confirmed_by, settlement_mode
    INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_booking.is_deleted, false) THEN
    RAISE EXCEPTION 'booking not found or deleted' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.booking_settlement_keys k
    WHERE k.booking_id = p_booking_id
      AND k.status = 'active'
      AND (
        k.source IN ('clobe_memo_created_booking', 'bank_memo_created_booking')
        OR COALESCE(k.metadata ->> 'clobe_generated', 'false') IN ('true', 't', '1')
      )
  ) THEN
    RAISE EXCEPTION 'Clobe settlement key is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN account = 'paid_amount' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN account = 'total_paid_out' THEN amount ELSE 0 END), 0)
    INTO v_paid, v_payout
  FROM public.ledger_entries
  WHERE booking_id = p_booking_id;

  IF v_paid <> COALESCE(v_booking.paid_amount, 0)
     OR v_payout <> COALESCE(v_booking.total_paid_out, 0) THEN
    RAISE EXCEPTION 'ledger drift blocks Clobe settlement: booking paid=% ledger paid=% booking payout=% ledger payout=%',
      COALESCE(v_booking.paid_amount, 0), v_paid,
      COALESCE(v_booking.total_paid_out, 0), v_payout USING ERRCODE = 'P0001';
  END IF;

  v_net := v_paid - v_payout;
  v_already_in_state := CASE
    WHEN p_confirm THEN v_booking.settlement_confirmed_at IS NOT NULL
    ELSE v_booking.settlement_confirmed_at IS NULL
  END;

  IF p_confirm AND NOT v_already_in_state THEN
    IF v_booking.status = 'cancelled' THEN
      RAISE EXCEPTION 'cancelled booking cannot be finalized by Clobe cash settlement' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.bookings
    SET settlement_confirmed_at = now(),
        settlement_confirmed_by = COALESCE(NULLIF(btrim(p_actor), ''), 'admin'),
        settlement_mode = 'cash',
        updated_at = now()
    WHERE id = p_booking_id;
  ELSIF NOT p_confirm AND NOT v_already_in_state THEN
    IF NULLIF(btrim(p_reason), '') IS NULL THEN
      RAISE EXCEPTION 'unfinalize reason is required' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.bookings
    SET settlement_confirmed_at = NULL,
        settlement_confirmed_by = NULL,
        settlement_mode = NULL,
        updated_at = now()
    WHERE id = p_booking_id;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'command', v_command_type,
    'paid_amount', v_paid,
    'total_paid_out', v_payout,
    'net_profit', v_net,
    'settlement_mode', CASE WHEN p_confirm THEN 'cash' ELSE NULL END,
    'already_in_state', v_already_in_state,
    'actor', COALESCE(NULLIF(btrim(p_actor), ''), 'admin')
  );

  INSERT INTO public.clobe_settlement_command_idempotency (
    idempotency_key, booking_id, command_type, request_json, result_json, completed_at
  ) VALUES (
    p_idempotency_key,
    p_booking_id,
    v_command_type,
    jsonb_build_object('confirm', p_confirm, 'reason', p_reason, 'actor', p_actor),
    v_result,
    now()
  );

  INSERT INTO public.audit_logs (
    action, target_type, target_id, before_value, after_value, description, user_id
  ) VALUES (
    CASE WHEN p_confirm THEN 'clobe_settlement_finalized' ELSE 'clobe_settlement_unfinalized' END,
    'bookings',
    p_booking_id::TEXT,
    jsonb_build_object(
      'settlement_confirmed_at', v_booking.settlement_confirmed_at,
      'settlement_confirmed_by', v_booking.settlement_confirmed_by,
      'settlement_mode', v_booking.settlement_mode,
      'status', v_booking.status
    ),
    v_result,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Clobe 입금-출금 기준 정산 확정'),
    p_actor
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_clobe_booking_settlement(UUID, BOOLEAN, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_clobe_booking_settlement(UUID, BOOLEAN, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.finalize_clobe_booking_settlement(UUID, BOOLEAN, TEXT, TEXT, TEXT)
  IS 'Clobe memo booking cash close: paid_amount - total_paid_out, no product price required, idempotent and ledger-drift blocking.';

CREATE OR REPLACE FUNCTION public.apply_clobe_memo_booking_correction(
  p_booking_id UUID,
  p_transaction_id UUID,
  p_previous_key TEXT,
  p_next_key TEXT,
  p_raw_key TEXT,
  p_departure_date DATE,
  p_customer_id UUID,
  p_customer_name TEXT,
  p_land_operator_id UUID,
  p_land_operator_name TEXT,
  p_package_title TEXT,
  p_actor TEXT DEFAULT 'clobe_sync'
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_booking RECORD;
  v_transaction RECORD;
  v_current_key RECORD;
  v_target_key RECORD;
  v_now TIMESTAMPTZ := now();
BEGIN
  IF NULLIF(btrim(p_previous_key), '') IS NULL
     OR NULLIF(btrim(p_next_key), '') IS NULL
     OR p_previous_key = p_next_key THEN
    RAISE EXCEPTION 'valid distinct Clobe memo keys are required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('clobe-memo:' || p_booking_id::TEXT, 0));

  SELECT id, source, external_provider, status
    INTO v_transaction
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_transaction.status = 'excluded'
     OR NOT (
       v_transaction.source IN ('clobe_mcp', 'clobe_api')
       OR v_transaction.external_provider = 'clobe'
     ) THEN
    RAISE EXCEPTION 'active Clobe transaction is required' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, is_deleted, settlement_confirmed_at, package_title
    INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;
  IF NOT FOUND OR COALESCE(v_booking.is_deleted, FALSE) THEN
    RAISE EXCEPTION 'booking not found or deleted' USING ERRCODE = 'P0002';
  END IF;
  IF v_booking.settlement_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'finalized Clobe settlement memo cannot be changed automatically' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, tenant_id, source, metadata, raw_key
    INTO v_current_key
  FROM public.booking_settlement_keys
  WHERE booking_id = p_booking_id
    AND normalized_key = p_previous_key
    AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND OR NOT (
    v_current_key.source IN ('clobe_memo_created_booking', 'bank_memo_created_booking')
    OR COALESCE(v_current_key.metadata ->> 'clobe_generated', 'false') IN ('true', 't', '1')
    OR COALESCE(v_current_key.metadata ->> 'placeholder', 'false') IN ('true', 't', '1')
  ) THEN
    RAISE EXCEPTION 'active Clobe-generated settlement key is required' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bank_transactions t
    WHERE t.id <> p_transaction_id
      AND t.status <> 'excluded'
      AND (
        t.source IN ('clobe_mcp', 'clobe_api')
        OR t.external_provider = 'clobe'
      )
      AND (
        t.memo IN (p_previous_key, v_current_key.raw_key)
        OR t.source_metadata -> 'clobe_mcp' ->> 'settlement_key' = p_previous_key
        OR t.source_metadata -> 'clobe_api' ->> 'settlement_key' = p_previous_key
      )
  ) THEN
    RAISE EXCEPTION 'another active Clobe transaction still uses the previous memo key' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, booking_id, metadata
    INTO v_target_key
  FROM public.booking_settlement_keys
  WHERE normalized_key = p_next_key
    AND status = 'active'
    AND tenant_id IS NOT DISTINCT FROM v_current_key.tenant_id
  FOR UPDATE;
  IF FOUND AND v_target_key.booking_id <> p_booking_id THEN
    RAISE EXCEPTION 'corrected memo key already belongs to another booking' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.bookings
  SET departure_date = p_departure_date,
      lead_customer_id = p_customer_id,
      land_operator = p_land_operator_name,
      land_operator_id = p_land_operator_id,
      package_title = COALESCE(NULLIF(btrim(p_package_title), ''), package_title),
      updated_at = v_now
  WHERE id = p_booking_id;

  IF v_target_key.id IS NOT NULL THEN
    UPDATE public.booking_settlement_keys
    SET raw_key = p_raw_key,
        departure_date = p_departure_date,
        customer_name_snapshot = p_customer_name,
        land_operator_id = p_land_operator_id,
        land_operator_name_snapshot = p_land_operator_name,
        source = 'clobe_memo_created_booking',
        metadata = COALESCE(v_target_key.metadata, '{}'::JSONB)
          || jsonb_build_object('clobe_generated', TRUE, 'last_corrected_from', p_previous_key),
        updated_at = v_now
    WHERE id = v_target_key.id;

    UPDATE public.booking_settlement_keys
    SET status = 'retired',
        metadata = COALESCE(v_current_key.metadata, '{}'::JSONB)
          || jsonb_build_object('clobe_generated', TRUE, 'corrected_to', p_next_key),
        updated_at = v_now
    WHERE id = v_current_key.id;
  ELSE
    UPDATE public.booking_settlement_keys
    SET normalized_key = p_next_key,
        raw_key = p_raw_key,
        departure_date = p_departure_date,
        customer_name_snapshot = p_customer_name,
        land_operator_id = p_land_operator_id,
        land_operator_name_snapshot = p_land_operator_name,
        source = 'clobe_memo_created_booking',
        metadata = COALESCE(v_current_key.metadata, '{}'::JSONB)
          || jsonb_build_object('clobe_generated', TRUE, 'corrected_from', p_previous_key),
        updated_at = v_now
    WHERE id = v_current_key.id;
  END IF;

  INSERT INTO public.audit_logs (
    action, target_type, target_id, before_value, after_value, description, user_id
  ) VALUES (
    'clobe_memo_booking_corrected',
    'bookings',
    p_booking_id::TEXT,
    jsonb_build_object('settlement_key', p_previous_key),
    jsonb_build_object('settlement_key', p_next_key, 'transaction_id', p_transaction_id),
    'Clobe memo source-of-truth correction before final settlement',
    COALESCE(NULLIF(btrim(p_actor), ''), 'clobe_sync')
  );

  RETURN jsonb_build_object(
    'ok', TRUE,
    'booking_id', p_booking_id,
    'transaction_id', p_transaction_id,
    'previous_key', p_previous_key,
    'next_key', p_next_key
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_clobe_memo_booking_correction(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, UUID, TEXT, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_clobe_memo_booking_correction(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, UUID, TEXT, UUID, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.apply_clobe_memo_booking_correction(
  UUID, UUID, TEXT, TEXT, TEXT, DATE, UUID, TEXT, UUID, TEXT, TEXT, TEXT
) IS 'Atomically renames a pre-finalization Clobe memo booking only when no other active provider transaction still uses the previous key.';

COMMIT;
