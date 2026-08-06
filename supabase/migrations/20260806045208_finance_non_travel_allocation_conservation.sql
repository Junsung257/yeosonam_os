-- Give every active Clobe 4128 company transaction a conserved allocation line.
-- Existing manual splits remain authoritative; only a missing remainder is added.

CREATE OR REPLACE FUNCTION public.finance_classification_target_type(
  p_classification text,
  p_transaction_type text
) RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_classification = 'review' OR p_classification IS NULL THEN 'unassigned'
    WHEN p_classification = 'refund' AND p_transaction_type = '출금' THEN 'customer_refund'
    WHEN p_classification = 'refund' THEN 'transfer'
    ELSE p_classification
  END;
$$;

CREATE OR REPLACE FUNCTION public.sync_non_travel_classification_allocations(
  p_transaction_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_inserted integer := 0;
  v_updated integer := 0;
  v_source_count integer := 0;
  v_non_exact integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('finance-non-travel-allocation', 0));

  WITH resolved AS (
    SELECT
      transaction.id AS transaction_id,
      transaction.amount::bigint AS source_amount,
      classification.resolved_classification,
      classification.resolution_source,
      classification.receipt_status,
      classification.confirmed_by,
      public.finance_classification_target_type(
        classification.resolved_classification,
        transaction.transaction_type
      ) AS target_type
    FROM public.bank_transactions transaction
    JOIN public.bank_transaction_classifications classification
      ON classification.bank_transaction_id = transaction.id
    WHERE transaction.external_provider = 'clobe'
      AND transaction.source = 'clobe_mcp'
      AND transaction.status = 'active'
      AND transaction.account_number = '100038454128'
      AND transaction.settlement_scope = 'non_travel'
      AND (p_transaction_id IS NULL OR transaction.id = p_transaction_id)
  ), active_summary AS (
    SELECT
      resolved.*,
      COUNT(allocation.id)::integer AS active_count,
      COALESCE(SUM(allocation.allocated_amount), 0)::bigint AS allocated_amount,
      (ARRAY_AGG(allocation.id ORDER BY allocation.id)
        FILTER (WHERE allocation.id IS NOT NULL))[1] AS only_allocation_id
    FROM resolved
    LEFT JOIN public.bank_transaction_allocations allocation
      ON allocation.bank_transaction_id = resolved.transaction_id
      AND allocation.status = 'active'
      AND allocation.reversed_at IS NULL
    GROUP BY
      resolved.transaction_id,
      resolved.source_amount,
      resolved.resolved_classification,
      resolved.resolution_source,
      resolved.receipt_status,
      resolved.confirmed_by,
      resolved.target_type
  )
  UPDATE public.bank_transaction_allocations allocation
  SET target_type = summary.target_type,
      allocation_type = CASE WHEN summary.target_type = 'unassigned' THEN 'unassigned' ELSE 'non_booking' END,
      target_label = summary.resolved_classification,
      reason = 'Clobe non-travel classification synchronized',
      metadata = COALESCE(allocation.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
        'origin', 'finance_classification_auto',
        'classification', summary.resolved_classification,
        'resolutionSource', summary.resolution_source,
        'receiptStatus', summary.receipt_status
      )),
      confirmed_by = COALESCE(NULLIF(summary.confirmed_by, ''), 'system:finance_classification'),
      confirmed_at = now()
  FROM active_summary summary
  WHERE allocation.id = summary.only_allocation_id
    AND summary.active_count = 1
    AND summary.allocated_amount = summary.source_amount
    AND allocation.metadata->>'origin' = 'finance_classification_auto'
    AND allocation.created_by = 'system:finance_classification'
    AND (
      allocation.target_type IS DISTINCT FROM summary.target_type
      OR allocation.target_label IS DISTINCT FROM summary.resolved_classification
    );
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  WITH resolved AS (
    SELECT
      transaction.id AS transaction_id,
      transaction.amount::bigint AS source_amount,
      classification.resolved_classification,
      classification.resolution_source,
      classification.receipt_status,
      classification.confirmed_by,
      public.finance_classification_target_type(
        classification.resolved_classification,
        transaction.transaction_type
      ) AS target_type
    FROM public.bank_transactions transaction
    JOIN public.bank_transaction_classifications classification
      ON classification.bank_transaction_id = transaction.id
    WHERE transaction.external_provider = 'clobe'
      AND transaction.source = 'clobe_mcp'
      AND transaction.status = 'active'
      AND transaction.account_number = '100038454128'
      AND transaction.settlement_scope = 'non_travel'
      AND (p_transaction_id IS NULL OR transaction.id = p_transaction_id)
  ), active_summary AS (
    SELECT
      resolved.*,
      COALESCE(SUM(allocation.allocated_amount), 0)::bigint AS allocated_amount,
      COALESCE(STRING_AGG(allocation.id::text, '|' ORDER BY allocation.id), '') AS allocation_fingerprint
    FROM resolved
    LEFT JOIN public.bank_transaction_allocations allocation
      ON allocation.bank_transaction_id = resolved.transaction_id
      AND allocation.status = 'active'
      AND allocation.reversed_at IS NULL
    GROUP BY
      resolved.transaction_id,
      resolved.source_amount,
      resolved.resolved_classification,
      resolved.resolution_source,
      resolved.receipt_status,
      resolved.confirmed_by,
      resolved.target_type
  ), inserted AS (
    INSERT INTO public.bank_transaction_allocations (
      bank_transaction_id,
      booking_id,
      ledger_account,
      allocated_amount,
      ledger_delta,
      allocation_type,
      target_type,
      target_label,
      reason,
      metadata,
      status,
      idempotency_key,
      notes,
      created_by,
      confirmed_by,
      confirmed_at
    )
    SELECT
      summary.transaction_id,
      NULL,
      NULL,
      summary.source_amount - summary.allocated_amount,
      NULL,
      CASE WHEN summary.target_type = 'unassigned' THEN 'unassigned' ELSE 'non_booking' END,
      summary.target_type,
      summary.resolved_classification,
      'Clobe non-travel classification conservation',
      jsonb_strip_nulls(jsonb_build_object(
        'origin', 'finance_classification_auto',
        'classification', summary.resolved_classification,
        'resolutionSource', summary.resolution_source,
        'receiptStatus', summary.receipt_status
      )),
      'active',
      'finance-classification:auto:' || summary.transaction_id::text || ':' || md5(concat_ws('|',
        summary.allocation_fingerprint,
        summary.allocated_amount::text,
        summary.source_amount::text,
        summary.target_type
      )),
      'Clobe non-travel classification conservation',
      'system:finance_classification',
      COALESCE(NULLIF(summary.confirmed_by, ''), 'system:finance_classification'),
      now()
    FROM active_summary summary
    WHERE summary.allocated_amount < summary.source_amount
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*)::integer INTO v_inserted FROM inserted;

  UPDATE public.bank_transactions transaction
  SET booking_id = NULL,
      match_status = CASE WHEN EXISTS (
        SELECT 1
        FROM public.bank_transaction_allocations allocation
        WHERE allocation.bank_transaction_id = transaction.id
          AND allocation.status = 'active'
          AND allocation.reversed_at IS NULL
          AND allocation.target_type = 'unassigned'
      ) THEN 'review' ELSE 'manual' END,
      match_confidence = 1,
      matched_by = COALESCE(transaction.matched_by, 'system:finance_classification'),
      matched_at = COALESCE(transaction.matched_at, now()),
      updated_at = now()
  WHERE transaction.external_provider = 'clobe'
    AND transaction.source = 'clobe_mcp'
    AND transaction.status = 'active'
    AND transaction.account_number = '100038454128'
    AND transaction.settlement_scope = 'non_travel'
    AND (p_transaction_id IS NULL OR transaction.id = p_transaction_id)
    AND EXISTS (
      SELECT 1
      FROM public.bank_transaction_allocations allocation
      WHERE allocation.bank_transaction_id = transaction.id
        AND allocation.status = 'active'
        AND allocation.reversed_at IS NULL
        AND allocation.metadata->>'origin' = 'finance_classification_auto'
        AND allocation.created_by = 'system:finance_classification'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.bank_transaction_allocations allocation
      WHERE allocation.bank_transaction_id = transaction.id
        AND allocation.status = 'active'
        AND allocation.reversed_at IS NULL
        AND allocation.target_type = 'booking'
    )
    AND (
      transaction.booking_id IS NOT NULL
      OR transaction.match_status IS DISTINCT FROM CASE WHEN EXISTS (
        SELECT 1
        FROM public.bank_transaction_allocations allocation
        WHERE allocation.bank_transaction_id = transaction.id
          AND allocation.status = 'active'
          AND allocation.reversed_at IS NULL
          AND allocation.target_type = 'unassigned'
      ) THEN 'review' ELSE 'manual' END
      OR transaction.match_confidence IS DISTINCT FROM 1
      OR transaction.matched_at IS NULL
    );

  WITH source_rows AS (
    SELECT transaction.id, transaction.amount::bigint AS source_amount
    FROM public.bank_transactions transaction
    JOIN public.bank_transaction_classifications classification
      ON classification.bank_transaction_id = transaction.id
    WHERE transaction.external_provider = 'clobe'
      AND transaction.source = 'clobe_mcp'
      AND transaction.status = 'active'
      AND transaction.account_number = '100038454128'
      AND transaction.settlement_scope = 'non_travel'
      AND (p_transaction_id IS NULL OR transaction.id = p_transaction_id)
  ), totals AS (
    SELECT
      source_rows.id,
      source_rows.source_amount,
      COALESCE(SUM(allocation.allocated_amount), 0)::bigint AS allocated_amount
    FROM source_rows
    LEFT JOIN public.bank_transaction_allocations allocation
      ON allocation.bank_transaction_id = source_rows.id
      AND allocation.status = 'active'
      AND allocation.reversed_at IS NULL
    GROUP BY source_rows.id, source_rows.source_amount
  )
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE allocated_amount <> source_amount)::integer
  INTO v_source_count, v_non_exact
  FROM totals;

  IF v_non_exact > 0 THEN
    RAISE EXCEPTION 'non-travel allocation conservation failed for % transaction(s)', v_non_exact;
  END IF;

  RETURN jsonb_build_object(
    'sourceCount', v_source_count,
    'inserted', v_inserted,
    'updated', v_updated,
    'nonExact', v_non_exact
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finance_classification_target_type(text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_non_travel_classification_allocations(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_classification_target_type(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sync_non_travel_classification_allocations(uuid) TO service_role;

SELECT public.sync_non_travel_classification_allocations(NULL);

COMMENT ON FUNCTION public.sync_non_travel_classification_allocations(uuid) IS
  'Conserves every active Clobe 4128 non-travel transaction without overwriting exact manual splits.';
