-- Atomic, idempotent batch classification for the finance workday.
-- Existing booking allocations and settlement snapshots are never rewritten.

CREATE TABLE IF NOT EXISTS public.finance_classification_batch_runs (
  idempotency_key text PRIMARY KEY,
  request_hash text NOT NULL,
  actor_label text NOT NULL,
  item_count integer NOT NULL CHECK (item_count BETWEEN 1 AND 200),
  result jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finance_classification_batch_key_not_blank CHECK (btrim(idempotency_key) <> '')
);

ALTER TABLE public.finance_classification_batch_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.finance_classification_batch_runs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.finance_classification_batch_runs TO service_role;

DROP POLICY IF EXISTS finance_classification_batch_runs_service_role
  ON public.finance_classification_batch_runs;
CREATE POLICY finance_classification_batch_runs_service_role
  ON public.finance_classification_batch_runs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.save_finance_classification_batch(
  p_items jsonb,
  p_idempotency_key text,
  p_actor uuid DEFAULT NULL,
  p_actor_label text DEFAULT 'admin'
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_hash text;
  v_existing public.finance_classification_batch_runs%ROWTYPE;
  v_item jsonb;
  v_transaction_id uuid;
  v_allocation_id uuid;
  v_classification text;
  v_expected text;
  v_receipt_status text;
  v_target_type text;
  v_current_classification text;
  v_provider_category text;
  v_direction text;
  v_result jsonb;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'finance classification batch items must be an array';
  END IF;
  v_count := jsonb_array_length(p_items);
  IF v_count < 1 OR v_count > 200 THEN
    RAISE EXCEPTION 'finance classification batch size must be between 1 and 200';
  END IF;
  IF NULLIF(btrim(p_idempotency_key), '') IS NULL THEN
    RAISE EXCEPTION 'finance classification idempotency key is required';
  END IF;
  IF (SELECT COUNT(*) FROM (SELECT DISTINCT item->>'allocationId' FROM jsonb_array_elements(p_items) item) deduped) <> v_count THEN
    RAISE EXCEPTION 'finance classification batch contains duplicate allocation ids';
  END IF;
  IF (SELECT COUNT(*) FROM (SELECT DISTINCT item->>'transactionId' FROM jsonb_array_elements(p_items) item) deduped) <> v_count THEN
    RAISE EXCEPTION 'finance classification batch contains duplicate transaction ids';
  END IF;

  v_hash := md5(p_items::text);
  PERFORM pg_advisory_xact_lock(hashtextextended('finance-classification-batch:' || p_idempotency_key, 0));
  SELECT * INTO v_existing
  FROM public.finance_classification_batch_runs
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_hash <> v_hash THEN
      RAISE EXCEPTION 'finance classification idempotency key was reused for different items';
    END IF;
    RETURN v_existing.result;
  END IF;

  -- Validate the complete request before mutating any row.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_transaction_id := (v_item->>'transactionId')::uuid;
      v_allocation_id := (v_item->>'allocationId')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'finance classification batch contains an invalid id';
    END;
    v_classification := v_item->>'classification';
    v_expected := COALESCE(v_item->>'expectedClassification', 'review');
    v_receipt_status := COALESCE(v_item->>'receiptStatus',
      CASE WHEN v_classification IN ('company_expense', 'company_travel', 'tax') THEN 'missing' ELSE 'not_required' END);
    IF v_classification NOT IN ('company_expense', 'company_travel', 'tax', 'capital', 'transfer', 'refund', 'owner_draw', 'other_income') THEN
      RAISE EXCEPTION 'unsupported finance classification: %', v_classification;
    END IF;
    IF v_receipt_status NOT IN ('not_required', 'missing', 'attached', 'verified') THEN
      RAISE EXCEPTION 'unsupported receipt status: %', v_receipt_status;
    END IF;

    SELECT
      transaction.provider_category,
      transaction.transaction_type,
      CASE
        WHEN allocation.target_type = 'customer_refund' THEN 'refund'
        WHEN allocation.target_type IN ('bank_fee', 'company_expense') THEN 'company_expense'
        WHEN allocation.target_type = 'company_travel' THEN 'company_travel'
        WHEN allocation.target_type = 'tax' THEN 'tax'
        WHEN allocation.target_type = 'capital' THEN 'capital'
        WHEN allocation.target_type = 'transfer' THEN 'transfer'
        WHEN allocation.target_type = 'owner_draw' THEN 'owner_draw'
        WHEN allocation.target_type = 'other_income' THEN 'other_income'
        ELSE 'review'
      END
    INTO v_provider_category, v_direction, v_current_classification
    FROM public.bank_transactions transaction
    JOIN public.bank_transaction_allocations allocation
      ON allocation.bank_transaction_id = transaction.id
    WHERE transaction.id = v_transaction_id
      AND allocation.id = v_allocation_id
      AND allocation.status = 'active'
      AND allocation.reversed_at IS NULL
      AND allocation.booking_id IS NULL
      AND allocation.target_type <> 'booking'
      AND transaction.external_provider = 'clobe'
      AND transaction.source = 'clobe_mcp'
      AND transaction.status = 'active'
      AND transaction.account_number = '100038454128'
      AND transaction.settlement_scope = 'non_travel'
      AND allocation.allocated_amount = transaction.amount
      AND 1 = (
        SELECT COUNT(*)
        FROM public.bank_transaction_allocations active_allocation
        WHERE active_allocation.bank_transaction_id = transaction.id
          AND active_allocation.status = 'active'
          AND active_allocation.reversed_at IS NULL
      )
    FOR UPDATE OF transaction, allocation;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'finance classification item is stale or unavailable: %', v_allocation_id;
    END IF;
    IF v_current_classification IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'stale finance classification for allocation %', v_allocation_id;
    END IF;
    IF v_classification IN ('company_expense', 'company_travel', 'tax', 'owner_draw', 'refund')
       AND v_direction <> '출금' THEN
      RAISE EXCEPTION 'expense classification requires a withdrawal: %', v_allocation_id;
    END IF;
    IF v_classification IN ('capital', 'other_income') AND v_direction <> '입금' THEN
      RAISE EXCEPTION 'income classification requires a deposit: %', v_allocation_id;
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_transaction_id := (v_item->>'transactionId')::uuid;
    v_allocation_id := (v_item->>'allocationId')::uuid;
    v_classification := v_item->>'classification';
    v_receipt_status := COALESCE(v_item->>'receiptStatus',
      CASE WHEN v_classification IN ('company_expense', 'company_travel', 'tax') THEN 'missing' ELSE 'not_required' END);

    SELECT provider_category, transaction_type
    INTO v_provider_category, v_direction
    FROM public.bank_transactions
    WHERE id = v_transaction_id;
    v_target_type := public.finance_classification_target_type(v_classification, v_direction);

    INSERT INTO public.bank_transaction_classifications (
      bank_transaction_id,
      clobe_original_classification,
      os_classification,
      resolved_classification,
      resolution_source,
      rule_id,
      is_profit_and_loss,
      receipt_status,
      confirmed_at,
      confirmed_by,
      notes,
      updated_at
    ) VALUES (
      v_transaction_id,
      v_provider_category,
      v_classification,
      v_classification,
      'manual',
      NULL,
      v_classification NOT IN ('capital', 'transfer', 'refund', 'owner_draw'),
      v_receipt_status,
      now(),
      COALESCE(NULLIF(p_actor_label, ''), 'admin'),
      '정산센터 일괄 분류',
      now()
    )
    ON CONFLICT (bank_transaction_id) DO UPDATE SET
      os_classification = EXCLUDED.os_classification,
      resolved_classification = EXCLUDED.resolved_classification,
      resolution_source = 'manual',
      rule_id = NULL,
      is_profit_and_loss = EXCLUDED.is_profit_and_loss,
      receipt_status = EXCLUDED.receipt_status,
      confirmed_at = EXCLUDED.confirmed_at,
      confirmed_by = EXCLUDED.confirmed_by,
      notes = EXCLUDED.notes,
      updated_at = now();

    UPDATE public.bank_transaction_allocations
    SET target_type = v_target_type,
        allocation_type = CASE WHEN v_target_type = 'unassigned' THEN 'unassigned' ELSE 'non_booking' END,
        target_label = CASE
          WHEN target_type = 'unassigned' OR metadata->>'origin' = 'finance_classification_auto' THEN v_classification
          ELSE COALESCE(target_label, v_classification)
        END,
        reason = '정산센터 일괄 분류',
        metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
          'classification', v_classification,
          'classificationSource', 'company_expense_batch',
          'receiptStatus', v_receipt_status,
          'batchIdempotencyKey', p_idempotency_key
        ),
        confirmed_by = COALESCE(NULLIF(p_actor_label, ''), 'admin'),
        confirmed_at = now()
    WHERE id = v_allocation_id;

    UPDATE public.bank_transactions
    SET booking_id = NULL,
        match_status = 'manual',
        match_confidence = 1,
        matched_by = COALESCE(NULLIF(p_actor_label, ''), 'admin'),
        matched_at = now(),
        updated_at = now()
    WHERE id = v_transaction_id
      AND NOT EXISTS (
        SELECT 1 FROM public.bank_transaction_allocations allocation
        WHERE allocation.bank_transaction_id = v_transaction_id
          AND allocation.status = 'active'
          AND allocation.reversed_at IS NULL
          AND allocation.target_type = 'booking'
      );

    INSERT INTO public.audit_logs (
      user_id, action, target_type, target_id, description, after_value
    ) VALUES (
      p_actor,
      'FINANCE_TRANSACTION_BATCH_CLASSIFIED',
      'bank_transaction',
      v_transaction_id::text,
      v_classification || ' 일괄 확정',
      jsonb_build_object(
        'allocation_id', v_allocation_id,
        'classification', v_classification,
        'receipt_status', v_receipt_status,
        'actor', COALESCE(NULLIF(p_actor_label, ''), 'admin'),
        'idempotency_key', p_idempotency_key
      )
    );
  END LOOP;

  v_result := jsonb_build_object('success', true, 'updated', v_count, 'idempotencyKey', p_idempotency_key);
  INSERT INTO public.finance_classification_batch_runs (
    idempotency_key, request_hash, actor_label, item_count, result
  ) VALUES (
    p_idempotency_key,
    v_hash,
    COALESCE(NULLIF(p_actor_label, ''), 'admin'),
    v_count,
    v_result
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_finance_classification_batch(jsonb, text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_finance_classification_batch(jsonb, text, uuid, text)
  TO service_role;

COMMENT ON FUNCTION public.save_finance_classification_batch(jsonb, text, uuid, text) IS
  'Atomically classifies 1-200 conserved non-travel Clobe allocation lines with stale-write and idempotency protection.';
