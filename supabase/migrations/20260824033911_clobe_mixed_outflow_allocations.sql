-- Clobe outflow allocation command (created with Supabase CLI).
--
-- A provider withdrawal remains one immutable bank transaction, while its
-- accounting meaning can be split across bookings as supplier payouts and
-- customer refunds. Example: 9,140,000 = payout 7,640,000 + refund 1,500,000.

BEGIN;

CREATE TABLE IF NOT EXISTS public.clobe_outflow_allocation_commands (
  idempotency_key TEXT PRIMARY KEY,
  bank_transaction_id UUID NOT NULL REFERENCES public.bank_transactions(id) ON DELETE RESTRICT,
  request_json JSONB NOT NULL,
  result_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_clobe_outflow_commands_transaction
  ON public.clobe_outflow_allocation_commands(bank_transaction_id, created_at DESC);

ALTER TABLE public.clobe_outflow_allocation_commands ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clobe_outflow_allocation_commands FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clobe_outflow_allocation_commands TO service_role;

CREATE OR REPLACE FUNCTION public.match_clobe_outflow_allocations(
  p_transaction_id UUID,
  p_allocations JSONB,
  p_idempotency_key TEXT,
  p_matched_by TEXT DEFAULT 'admin',
  p_notes TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tx RECORD;
  v_command RECORD;
  v_alloc RECORD;
  v_booking RECORD;
  v_total BIGINT := 0;
  v_payout_total BIGINT := 0;
  v_refund_total BIGINT := 0;
  v_count INT := 0;
  v_index INT := 0;
  v_first_booking_id UUID := NULL;
  v_ledger_account TEXT;
  v_ledger_delta BIGINT;
  v_result JSONB;
BEGIN
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Clobe outflow allocation requires idempotency_key' USING ERRCODE = 'P0001';
  END IF;
  IF p_allocations IS NULL
     OR jsonb_typeof(p_allocations) <> 'array'
     OR jsonb_array_length(p_allocations) = 0 THEN
    RAISE EXCEPTION 'allocations array is required' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('clobe-outflow:' || p_idempotency_key, 0));

  SELECT * INTO v_command
  FROM public.clobe_outflow_allocation_commands
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_command.bank_transaction_id <> p_transaction_id
       OR v_command.request_json->>'action' IS DISTINCT FROM 'match' THEN
      RAISE EXCEPTION 'Clobe outflow idempotency key conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(v_command.result_json, jsonb_build_object('ok', TRUE, 'idempotent_replay', TRUE));
  END IF;

  SELECT id, tenant_id, source, external_provider, transaction_type, amount,
         match_status, status, counterparty_name
    INTO v_tx
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank transaction not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_tx.source IN ('clobe_mcp', 'clobe_api') OR v_tx.external_provider = 'clobe') THEN
    RAISE EXCEPTION 'active Clobe transaction is required' USING ERRCODE = 'P0001';
  END IF;
  IF v_tx.transaction_type <> '출금' OR v_tx.status = 'excluded' THEN
    RAISE EXCEPTION 'active Clobe outflow is required' USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(v_tx.match_status, 'unmatched') NOT IN ('unmatched', 'review', 'error') THEN
    RAISE EXCEPTION 'Clobe outflow is already allocated (status=%)', v_tx.match_status USING ERRCODE = 'P0001';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM jsonb_array_elements(p_allocations)
  ) <> (
    SELECT COUNT(DISTINCT value->>'bookingId')
    FROM jsonb_array_elements(p_allocations)
  ) THEN
    RAISE EXCEPTION 'one Clobe outflow can allocate a booking only once' USING ERRCODE = 'P0001';
  END IF;

  FOR v_alloc IN
    SELECT
      (value->>'bookingId')::UUID AS booking_id,
      COALESCE((value->>'amount')::BIGINT, 0) AS amount,
      NULLIF(value->>'allocationType', '') AS allocation_type
    FROM jsonb_array_elements(p_allocations)
  LOOP
    IF v_alloc.booking_id IS NULL OR v_alloc.amount <= 0 THEN
      RAISE EXCEPTION 'each allocation requires bookingId and positive amount' USING ERRCODE = 'P0001';
    END IF;
    IF v_alloc.allocation_type NOT IN ('payout', 'refund') THEN
      RAISE EXCEPTION 'allocationType must be payout or refund' USING ERRCODE = 'P0001';
    END IF;
    v_total := v_total + v_alloc.amount;
    v_count := v_count + 1;
    IF v_alloc.allocation_type = 'refund' THEN
      v_refund_total := v_refund_total + v_alloc.amount;
    ELSE
      v_payout_total := v_payout_total + v_alloc.amount;
    END IF;
    IF v_first_booking_id IS NULL THEN
      v_first_booking_id := v_alloc.booking_id;
    END IF;
  END LOOP;

  IF v_total <> ABS(COALESCE(v_tx.amount, 0)) THEN
    RAISE EXCEPTION 'allocation total (%) must exactly equal transaction amount (%)',
      v_total, ABS(COALESCE(v_tx.amount, 0)) USING ERRCODE = 'P0001';
  END IF;

  -- Lock every target booking in UUID order so two concurrent mixed
  -- allocations cannot deadlock by presenting the same bookings in a
  -- different JSON order.
  PERFORM b.id
  FROM public.bookings b
  WHERE b.id IN (
    SELECT (value->>'bookingId')::UUID
    FROM jsonb_array_elements(p_allocations)
  )
  ORDER BY b.id
  FOR UPDATE;

  FOR v_alloc IN
    SELECT
      (value->>'bookingId')::UUID AS booking_id,
      COALESCE((value->>'amount')::BIGINT, 0) AS amount,
      NULLIF(value->>'allocationType', '') AS allocation_type
    FROM jsonb_array_elements(p_allocations)
  LOOP
    SELECT id, tenant_id, lead_customer_id, booking_no, is_deleted, settlement_confirmed_at
      INTO v_booking
    FROM public.bookings
    WHERE id = v_alloc.booking_id
    FOR UPDATE;

    IF NOT FOUND OR COALESCE(v_booking.is_deleted, FALSE) THEN
      RAISE EXCEPTION 'booking not found or deleted: %', v_alloc.booking_id USING ERRCODE = 'P0002';
    END IF;
    IF v_booking.tenant_id IS DISTINCT FROM v_tx.tenant_id THEN
      RAISE EXCEPTION 'cross-tenant Clobe allocation is forbidden' USING ERRCODE = 'P0001';
    END IF;
    IF v_booking.settlement_confirmed_at IS NOT NULL THEN
      RAISE EXCEPTION 'finalized booking cannot receive a new Clobe allocation: %', v_booking.booking_no USING ERRCODE = 'P0001';
    END IF;

    v_index := v_index + 1;
    v_ledger_account := CASE WHEN v_alloc.allocation_type = 'refund' THEN 'paid_amount' ELSE 'total_paid_out' END;
    v_ledger_delta := CASE WHEN v_alloc.allocation_type = 'refund' THEN -v_alloc.amount ELSE v_alloc.amount END;

    INSERT INTO public.bank_transaction_allocations (
      bank_transaction_id,
      booking_id,
      ledger_account,
      allocated_amount,
      ledger_delta,
      allocation_type,
      idempotency_key,
      notes,
      created_by
    ) VALUES (
      p_transaction_id,
      v_alloc.booking_id,
      v_ledger_account,
      v_alloc.amount,
      v_ledger_delta,
      v_alloc.allocation_type,
      p_idempotency_key || ':' || v_index::TEXT,
      p_notes,
      COALESCE(NULLIF(btrim(p_matched_by), ''), 'admin')
    );

    PERFORM public.update_booking_ledger(
      p_booking_id := v_alloc.booking_id,
      p_paid_delta := CASE WHEN v_ledger_account = 'paid_amount' THEN v_ledger_delta::INTEGER ELSE 0 END,
      p_payout_delta := CASE WHEN v_ledger_account = 'total_paid_out' THEN v_ledger_delta::INTEGER ELSE 0 END,
      p_source := 'clobe_outflow_allocation',
      p_source_ref_id := p_transaction_id::TEXT,
      p_idempotency_key := p_idempotency_key || ':' || v_index::TEXT,
      p_memo := COALESCE(p_notes, 'Clobe outflow allocation (' || v_alloc.allocation_type || ')'),
      p_created_by := COALESCE(NULLIF(btrim(p_matched_by), ''), 'admin')
    );

    INSERT INTO public.ops_events (
      event_type, severity, title, description, booking_id, customer_id,
      bank_transaction_id, target_type, target_id, status, metadata, created_by
    ) VALUES (
      'payment_matched',
      'info',
      CASE WHEN v_alloc.allocation_type = 'refund' THEN 'Clobe 고객 환불 배정' ELSE 'Clobe 랜드사 지급 배정' END,
      format('%s %s원', COALESCE(v_tx.counterparty_name, 'Clobe 출금'), v_alloc.amount),
      v_alloc.booking_id,
      v_booking.lead_customer_id,
      p_transaction_id,
      'bank_transactions',
      p_transaction_id::TEXT,
      'resolved',
      jsonb_build_object(
        'allocation_type', v_alloc.allocation_type,
        'ledger_account', v_ledger_account,
        'ledger_delta', v_ledger_delta,
        'booking_no', v_booking.booking_no,
        'source', 'clobe'
      ),
      COALESCE(NULLIF(btrim(p_matched_by), ''), 'admin')
    );
  END LOOP;

  UPDATE public.bank_transactions
  SET booking_id = v_first_booking_id,
      match_status = 'manual',
      match_confidence = 1,
      matched_by = COALESCE(NULLIF(btrim(p_matched_by), ''), 'admin'),
      matched_at = now(),
      updated_at = now()
  WHERE id = p_transaction_id;

  v_result := jsonb_build_object(
    'ok', TRUE,
    'transaction_id', p_transaction_id,
    'representative_booking_id', v_first_booking_id,
    'allocation_count', v_count,
    'allocated_total', v_total,
    'payout_total', v_payout_total,
    'refund_total', v_refund_total
  );

  INSERT INTO public.clobe_outflow_allocation_commands (
    idempotency_key, bank_transaction_id, request_json, result_json, completed_at
  ) VALUES (
    p_idempotency_key,
    p_transaction_id,
    jsonb_build_object('action', 'match', 'allocations', p_allocations, 'notes', p_notes, 'actor', p_matched_by),
    v_result,
    now()
  );

  INSERT INTO public.audit_logs (
    action, target_type, target_id, before_value, after_value, description, user_id
  ) VALUES (
    'clobe_outflow_allocated',
    'bank_transactions',
    p_transaction_id::TEXT,
    jsonb_build_object('match_status', v_tx.match_status, 'amount', v_tx.amount),
    v_result,
    COALESCE(p_notes, 'Clobe 출금의 랜드사 지급/고객 환불 배정'),
    NULL
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.match_clobe_outflow_allocations(UUID, JSONB, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_clobe_outflow_allocations(UUID, JSONB, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.match_clobe_outflow_allocations(UUID, JSONB, TEXT, TEXT, TEXT)
  IS 'Atomically allocates one immutable Clobe outflow across bookings as supplier payouts and/or customer refunds with exact-sum validation.';

CREATE OR REPLACE FUNCTION public.reverse_clobe_outflow_allocations(
  p_transaction_id UUID,
  p_idempotency_key TEXT,
  p_actor TEXT DEFAULT 'admin',
  p_reason TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tx RECORD;
  v_command RECORD;
  v_alloc RECORD;
  v_finalized_booking_no TEXT;
  v_count INT := 0;
  v_reversed_total BIGINT := 0;
  v_result JSONB;
BEGIN
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'Clobe outflow reversal requires idempotency_key' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('clobe-outflow-reverse:' || p_idempotency_key, 0));

  SELECT * INTO v_command
  FROM public.clobe_outflow_allocation_commands
  WHERE idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_command.bank_transaction_id <> p_transaction_id
       OR v_command.request_json->>'action' IS DISTINCT FROM 'reverse' THEN
      RAISE EXCEPTION 'Clobe outflow reversal idempotency key conflict' USING ERRCODE = 'P0001';
    END IF;
    RETURN COALESCE(v_command.result_json, jsonb_build_object('ok', TRUE, 'idempotent_replay', TRUE));
  END IF;

  SELECT id, tenant_id, source, external_provider, transaction_type, amount,
         match_status, status
    INTO v_tx
  FROM public.bank_transactions
  WHERE id = p_transaction_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank transaction not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_tx.source IN ('clobe_mcp', 'clobe_api') OR v_tx.external_provider = 'clobe')
     OR v_tx.transaction_type <> '출금'
     OR v_tx.status = 'excluded' THEN
    RAISE EXCEPTION 'active Clobe outflow is required' USING ERRCODE = 'P0001';
  END IF;

  -- Lock all linked bookings in a deterministic order before inspecting the
  -- final-settlement gate and applying compensating ledger entries.
  PERFORM b.id
  FROM public.bookings b
  WHERE b.id IN (
    SELECT a.booking_id
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = p_transaction_id
      AND a.status = 'active'
      AND a.booking_id IS NOT NULL
  )
  ORDER BY b.id
  FOR UPDATE;

  SELECT b.booking_no INTO v_finalized_booking_no
  FROM public.bank_transaction_allocations a
  JOIN public.bookings b ON b.id = a.booking_id
  WHERE a.bank_transaction_id = p_transaction_id
    AND a.status = 'active'
    AND b.settlement_confirmed_at IS NOT NULL
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'finalized booking must be unfinalized before reversing Clobe allocation: %',
      v_finalized_booking_no USING ERRCODE = 'P0001';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.bank_transaction_allocations a
    WHERE a.bank_transaction_id = p_transaction_id
      AND a.status = 'active'
  ) THEN
    RAISE EXCEPTION 'active Clobe allocations were not found; legacy review is required' USING ERRCODE = 'P0002';
  END IF;

  FOR v_alloc IN
    SELECT id, booking_id, ledger_account, allocated_amount, ledger_delta,
           allocation_type, idempotency_key
    FROM public.bank_transaction_allocations
    WHERE bank_transaction_id = p_transaction_id
      AND status = 'active'
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_alloc.booking_id IS NOT NULL
       AND v_alloc.ledger_account IS NOT NULL
       AND v_alloc.ledger_delta IS NOT NULL
       AND v_alloc.ledger_delta <> 0 THEN
      PERFORM public.update_booking_ledger(
        p_booking_id := v_alloc.booking_id,
        p_paid_delta := CASE WHEN v_alloc.ledger_account = 'paid_amount' THEN -v_alloc.ledger_delta::INTEGER ELSE 0 END,
        p_payout_delta := CASE WHEN v_alloc.ledger_account = 'total_paid_out' THEN -v_alloc.ledger_delta::INTEGER ELSE 0 END,
        p_source := 'bank_tx_manual_match',
        p_source_ref_id := p_transaction_id::TEXT,
        p_idempotency_key := p_idempotency_key || ':' || v_alloc.id::TEXT,
        p_memo := COALESCE(NULLIF(btrim(p_reason), ''), 'Clobe outflow allocation reversal'),
        p_created_by := COALESCE(NULLIF(btrim(p_actor), ''), 'admin')
      );
    END IF;

    UPDATE public.bank_transaction_allocations
    SET status = 'reversed',
        reversed_at = now(),
        reason = concat_ws(' | ', NULLIF(reason, ''), COALESCE(NULLIF(btrim(p_reason), ''), 'Clobe outflow allocation reversal'))
    WHERE id = v_alloc.id;

    v_count := v_count + 1;
    v_reversed_total := v_reversed_total + v_alloc.allocated_amount;
  END LOOP;

  UPDATE public.bank_transactions
  SET booking_id = NULL,
      match_status = 'unmatched',
      match_confidence = 0,
      matched_by = NULL,
      matched_at = NULL,
      is_fee = FALSE,
      updated_at = now()
  WHERE id = p_transaction_id;

  v_result := jsonb_build_object(
    'ok', TRUE,
    'transaction_id', p_transaction_id,
    'reversed_allocation_count', v_count,
    'reversed_total', v_reversed_total
  );

  INSERT INTO public.clobe_outflow_allocation_commands (
    idempotency_key, bank_transaction_id, request_json, result_json, completed_at
  ) VALUES (
    p_idempotency_key,
    p_transaction_id,
    jsonb_build_object('action', 'reverse', 'reason', p_reason, 'actor', p_actor),
    v_result,
    now()
  );

  INSERT INTO public.audit_logs (
    action, target_type, target_id, before_value, after_value, description, user_id
  ) VALUES (
    'clobe_outflow_allocations_reversed',
    'bank_transactions',
    p_transaction_id::TEXT,
    jsonb_build_object('match_status', v_tx.match_status, 'amount', v_tx.amount),
    v_result,
    COALESCE(NULLIF(btrim(p_reason), ''), 'Clobe 출금 배정 재검토를 위한 보상 원장 반전'),
    NULL
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_clobe_outflow_allocations(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_clobe_outflow_allocations(UUID, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.reverse_clobe_outflow_allocations(UUID, TEXT, TEXT, TEXT)
  IS 'Atomically reverses active Clobe outflow allocations with compensating ledger entries; finalized bookings must be reopened first.';

COMMIT;
