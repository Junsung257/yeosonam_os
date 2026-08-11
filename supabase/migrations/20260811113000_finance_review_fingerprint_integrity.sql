BEGIN;

-- Preserve the exact pre-change queue and affected cancelled bookings in the
-- existing immutable audit store. Deploys can change code, but not this proof.
INSERT INTO public.finance_migration_snapshots (snapshot_key, snapshot_type, snapshot)
SELECT
  'finance_integrity_20260811_prechange_v1',
  'booking_review_integrity_prechange',
  jsonb_build_object(
    'captured_at', now(),
    'current_reviews', COALESCE((
      SELECT jsonb_agg(to_jsonb(review) ORDER BY review.booking_id)
      FROM public.booking_settlement_reviews review
      WHERE review.is_current
    ), '[]'::jsonb),
    'cancelled_bookings', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', booking.id,
        'booking_no', booking.booking_no,
        'status', booking.status,
        'finance_excluded', booking.finance_excluded,
        'finance_exclusion_reason', booking.finance_exclusion_reason
      ) ORDER BY booking.id)
      FROM public.bookings booking
      WHERE booking.status = 'cancelled'
    ), '[]'::jsonb)
  )
ON CONFLICT (snapshot_key) DO NOTHING;

-- Review fingerprints contain only operator-visible business evidence. Clobe
-- refreshes updated_at during an otherwise identical sync, so timestamps that
-- merely describe persistence must never invalidate an owner decision.
CREATE OR REPLACE FUNCTION public.finance_booking_review_fingerprint(p_booking_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT md5(concat_ws('|',
    'v4',
    b.id::text,
    COALESCE(b.booking_no, ''),
    COALESCE(b.lead_customer_id::text, ''),
    COALESCE(b.package_title, ''),
    COALESCE(b.departure_date::text, ''),
    COALESCE(b.status, ''),
    COALESCE(b.is_deleted, false)::text,
    COALESCE(b.finance_excluded, false)::text,
    COALESCE(b.finance_exclusion_reason, ''),
    COALESCE(b.total_price::text, ''),
    COALESCE(b.total_cost::text, ''),
    COALESCE((
      SELECT string_agg(concat_ws(':',
        a.bank_transaction_id::text,
        a.target_type,
        COALESCE(a.booking_id::text, ''),
        a.allocated_amount::text,
        COALESCE(a.ledger_delta::text, ''),
        COALESCE(a.reconciliation_key, ''),
        COALESCE(a.target_label, ''),
        COALESCE(a.reason, ''),
        COALESCE(t.transaction_type, ''),
        COALESCE(t.amount::text, ''),
        COALESCE(t.counterparty_name, ''),
        COALESCE(t.memo, ''),
        COALESCE(t.received_at::text, ''),
        COALESCE(t.status, '')
      ), '|' ORDER BY t.received_at, t.id, a.target_type, a.allocated_amount, a.id)
      FROM public.bank_transaction_allocations a
      JOIN public.bank_transactions t ON t.id = a.bank_transaction_id
      WHERE a.booking_id = b.id
        AND a.status = 'active'
        AND a.reversed_at IS NULL
        AND t.status = 'active'
    ), '')
  ))
  FROM public.bookings b
  WHERE b.id = p_booking_id;
$$;

CREATE OR REPLACE FUNCTION public.finance_bank_breakdown_fingerprint(p_bank_transaction_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT md5(concat_ws('|',
    'v4',
    t.id::text,
    t.amount::text,
    COALESCE(t.transaction_type, ''),
    COALESCE(t.counterparty_name, ''),
    COALESCE(t.memo, ''),
    COALESCE(t.received_at::text, ''),
    COALESCE(t.status, ''),
    COALESCE((
      SELECT string_agg(concat_ws(':',
        a.id::text,
        a.target_type,
        COALESCE(a.booking_id::text, ''),
        a.allocated_amount::text,
        COALESCE(a.ledger_delta::text, ''),
        COALESCE(a.reconciliation_key, ''),
        COALESCE(a.target_label, ''),
        COALESCE(a.reason, ''),
        COALESCE(a.metadata::text, '{}')
      ), '|' ORDER BY a.created_at, a.id)
      FROM public.bank_transaction_allocations a
      WHERE a.bank_transaction_id = t.id
        AND a.status = 'active'
        AND a.reversed_at IS NULL
    ), '')
  ))
  FROM public.bank_transactions t
  WHERE t.id = p_bank_transaction_id;
$$;

CREATE OR REPLACE FUNCTION public.finance_booking_review_live_snapshots(
  p_booking_ids uuid[] DEFAULT NULL
) RETURNS TABLE (
  booking_id uuid,
  departure_month date,
  review_fingerprint text,
  deposits bigint,
  withdrawals bigint,
  customer_refunds bigint,
  bank_fees bigint,
  cash_margin bigint,
  transaction_ids jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.id,
    date_trunc('month', b.departure_date)::date,
    public.finance_booking_review_fingerprint(b.id),
    COALESCE(cash.deposits, 0)::bigint,
    COALESCE(cash.withdrawals, 0)::bigint,
    COALESCE(cash.customer_refunds, 0)::bigint,
    COALESCE(cash.bank_fees, 0)::bigint,
    (COALESCE(cash.deposits, 0) - COALESCE(cash.withdrawals, 0) - COALESCE(cash.customer_refunds, 0))::bigint,
    COALESCE(cash.transaction_ids, '[]'::jsonb)
  FROM public.bookings b
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(SUM(a.allocated_amount) FILTER (
        WHERE a.target_type = 'booking' AND t.transaction_type = '입금'
      ), 0)::bigint AS deposits,
      COALESCE(SUM(a.allocated_amount) FILTER (
        WHERE a.target_type = 'booking' AND t.transaction_type = '출금'
      ), 0)::bigint AS withdrawals,
      COALESCE(SUM(a.allocated_amount) FILTER (
        WHERE a.target_type = 'customer_refund'
      ), 0)::bigint AS customer_refunds,
      COALESCE(SUM(a.allocated_amount) FILTER (
        WHERE a.target_type = 'bank_fee'
      ), 0)::bigint AS bank_fees,
      COALESCE(jsonb_agg(DISTINCT t.id) FILTER (WHERE t.id IS NOT NULL), '[]'::jsonb) AS transaction_ids
    FROM public.bank_transaction_allocations a
    JOIN public.bank_transactions t
      ON t.id = a.bank_transaction_id
     AND t.status = 'active'
    WHERE a.booking_id = b.id
      AND a.status = 'active'
      AND a.reversed_at IS NULL
  ) cash ON true
  WHERE p_booking_ids IS NULL OR b.id = ANY(p_booking_ids);
$$;

REVOKE ALL ON FUNCTION public.finance_booking_review_live_snapshots(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_booking_review_live_snapshots(uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.finance_invalidate_booking_review(
  p_booking_id uuid,
  p_reason text DEFAULT 'source_changed'
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_current public.booking_settlement_reviews%ROWTYPE;
  v_fingerprint text;
  v_departure_month date;
  v_deposits bigint := 0;
  v_withdrawals bigint := 0;
  v_refunds bigint := 0;
  v_fees bigint := 0;
  v_cash_margin bigint := 0;
  v_transaction_ids jsonb := '[]'::jsonb;
BEGIN
  SELECT
    live.review_fingerprint,
    live.departure_month,
    live.deposits,
    live.withdrawals,
    live.customer_refunds,
    live.bank_fees,
    live.cash_margin,
    live.transaction_ids
  INTO
    v_fingerprint,
    v_departure_month,
    v_deposits,
    v_withdrawals,
    v_refunds,
    v_fees,
    v_cash_margin,
    v_transaction_ids
  FROM public.finance_booking_review_live_snapshots(ARRAY[p_booking_id]) live;

  IF NOT FOUND OR v_fingerprint IS NULL THEN RETURN; END IF;

  SELECT * INTO v_current
  FROM public.booking_settlement_reviews
  WHERE booking_id = p_booking_id AND is_current
  FOR UPDATE;

  -- A no-op provider refresh must preserve an existing decision. Pending rows
  -- are still healed so an older stale snapshot cannot block the next click.
  IF FOUND AND v_current.review_fingerprint = v_fingerprint THEN
    IF v_current.status = 'pending' THEN
      UPDATE public.booking_settlement_reviews
      SET departure_month = v_departure_month,
          deposits = v_deposits,
          withdrawals = v_withdrawals,
          customer_refunds = v_refunds,
          bank_fees = v_fees,
          cash_margin = v_cash_margin,
          transaction_ids = v_transaction_ids,
          updated_at = now(),
          snapshot = snapshot || jsonb_build_object('fingerprint_version', 4, 'snapshot_refreshed_at', now())
      WHERE id = v_current.id;
    END IF;
    RETURN;
  END IF;

  IF FOUND AND v_current.status = 'pending' THEN
    UPDATE public.booking_settlement_reviews
    SET departure_month = v_departure_month,
        review_fingerprint = v_fingerprint,
        deposits = v_deposits,
        withdrawals = v_withdrawals,
        customer_refunds = v_refunds,
        bank_fees = v_fees,
        cash_margin = v_cash_margin,
        transaction_ids = v_transaction_ids,
        updated_at = now(),
        snapshot = snapshot || jsonb_build_object(
          'fingerprint_version', 4,
          'last_invalidation_reason', p_reason,
          'last_invalidated_at', now()
        ),
        decision_reason = 'Clobe 거래·메모 또는 배분 변경으로 재검토 필요'
    WHERE id = v_current.id;
  ELSE
    IF FOUND THEN
      UPDATE public.booking_settlement_reviews
      SET is_current = false,
          status = 'superseded',
          updated_at = now(),
          snapshot = snapshot || jsonb_build_object('superseded_reason', p_reason, 'superseded_at', now())
      WHERE id = v_current.id;
    END IF;

    INSERT INTO public.booking_settlement_reviews (
      booking_id, departure_month, status, review_fingerprint,
      deposits, withdrawals, customer_refunds, bank_fees, cash_margin,
      transaction_ids, snapshot, decision_reason
    ) VALUES (
      p_booking_id, v_departure_month, 'pending', v_fingerprint,
      v_deposits, v_withdrawals, v_refunds, v_fees, v_cash_margin,
      v_transaction_ids,
      jsonb_build_object('origin', 'automatic_invalidation', 'reason', p_reason, 'fingerprint_version', 4),
      'Clobe 거래·메모 또는 배분 변경으로 재검토 필요'
    );
  END IF;

  INSERT INTO public.settlement_period_exceptions (
    settlement_period_id, departure_month, booking_id, exception_type,
    status, reason, source_fingerprint, current_fingerprint, payload
  )
  SELECT
    p.id, p.departure_month, p_booking_id, 'post_close_change',
    'open', '월 마감 후 Clobe 거래·메모 또는 배분이 변경됨',
    item.transaction_fingerprint, v_fingerprint,
    jsonb_build_object('origin', 'finance_v3_invalidation', 'change_reason', p_reason)
  FROM public.settlement_periods p
  JOIN public.settlement_period_items item
    ON item.settlement_period_id = p.id AND item.booking_id = p_booking_id
  WHERE p.is_current AND p.status IN ('closed', 'conditional')
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidate_booking_review_from_transaction()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_booking_id uuid;
BEGIN
  IF OLD.memo IS NOT DISTINCT FROM NEW.memo
     AND OLD.amount IS NOT DISTINCT FROM NEW.amount
     AND OLD.transaction_type IS NOT DISTINCT FROM NEW.transaction_type
     AND OLD.counterparty_name IS NOT DISTINCT FROM NEW.counterparty_name
     AND OLD.received_at IS NOT DISTINCT FROM NEW.received_at
     AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  FOR v_booking_id IN
    SELECT DISTINCT booking_id
    FROM public.bank_transaction_allocations
    WHERE bank_transaction_id = NEW.id
      AND booking_id IS NOT NULL
      AND status = 'active'
      AND reversed_at IS NULL
  LOOP
    PERFORM public.finance_invalidate_booking_review(v_booking_id, 'clobe_transaction_changed');
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_booking_review_from_transaction ON public.bank_transactions;
CREATE TRIGGER trg_invalidate_booking_review_from_transaction
  AFTER UPDATE OF memo, amount, transaction_type, counterparty_name, received_at, status
  ON public.bank_transactions
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_booking_review_from_transaction();

DROP TRIGGER IF EXISTS trg_invalidate_booking_review_from_allocation ON public.bank_transaction_allocations;
CREATE TRIGGER trg_invalidate_booking_review_from_allocation
  AFTER INSERT OR UPDATE OF booking_id, target_type, allocated_amount, ledger_delta,
    status, reversed_at, reconciliation_key, target_label, reason OR DELETE
  ON public.bank_transaction_allocations
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_booking_review_from_allocation();

CREATE OR REPLACE FUNCTION public.invalidate_booking_review_from_booking()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR OLD.booking_no IS DISTINCT FROM NEW.booking_no
     OR OLD.lead_customer_id IS DISTINCT FROM NEW.lead_customer_id
     OR OLD.package_title IS DISTINCT FROM NEW.package_title
     OR OLD.departure_date IS DISTINCT FROM NEW.departure_date
     OR OLD.status IS DISTINCT FROM NEW.status
     OR OLD.is_deleted IS DISTINCT FROM NEW.is_deleted
     OR OLD.finance_excluded IS DISTINCT FROM NEW.finance_excluded
     OR OLD.finance_exclusion_reason IS DISTINCT FROM NEW.finance_exclusion_reason
     OR OLD.total_price IS DISTINCT FROM NEW.total_price
     OR OLD.total_cost IS DISTINCT FROM NEW.total_cost THEN
    PERFORM public.finance_invalidate_booking_review(NEW.id, 'booking_state_changed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_invalidate_booking_review_from_booking ON public.bookings;
CREATE TRIGGER trg_invalidate_booking_review_from_booking
  AFTER INSERT OR UPDATE OF booking_no, lead_customer_id, package_title,
    departure_date, status, is_deleted, finance_excluded,
    finance_exclusion_reason, total_price, total_cost
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_booking_review_from_booking();

-- Heal every pending queue item from the current allocation ledger. Historical
-- confirmed decisions remain immutable and are invalidated only by real drift.
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
      'integrity_refreshed_at', now()
    )
FROM public.finance_booking_review_live_snapshots(NULL::uuid[]) live
WHERE review.booking_id = live.booking_id
  AND review.is_current
  AND review.status = 'pending';

-- A booking already marked cancelled is a resolved cancellation, not a hidden
-- pending review. Preserve its cash evidence while excluding it from profit.
UPDATE public.bookings
SET finance_excluded = true,
    finance_exclusion_reason = COALESCE(NULLIF(finance_exclusion_reason, ''), '기존 취소 예약 재무 제외 정리'),
    finance_excluded_at = COALESCE(finance_excluded_at, now()),
    finance_excluded_by = COALESCE(finance_excluded_by, 'finance_integrity_migration'),
    updated_at = now()
WHERE status = 'cancelled'
  AND COALESCE(finance_excluded, false) = false;

UPDATE public.booking_settlement_reviews review
SET status = 'customer_cancelled',
    decision_reason = COALESCE(NULLIF(review.decision_reason, ''), '기존 취소 예약 재무 제외 정리'),
    reviewed_by_label = COALESCE(review.reviewed_by_label, 'finance_integrity_migration'),
    reviewed_at = COALESCE(review.reviewed_at, now()),
    updated_at = now(),
    snapshot = review.snapshot || jsonb_build_object('cancelled_booking_reconciled_at', now())
FROM public.bookings booking
WHERE review.booking_id = booking.id
  AND review.is_current
  AND review.status = 'pending'
  AND booking.status = 'cancelled';

COMMENT ON FUNCTION public.finance_booking_review_fingerprint(uuid) IS
  '예약 정산 확인용 v4 지문. Clobe no-op sync의 updated_at은 제외하고 운영상 의미 있는 예약·거래·배분 필드만 포함한다.';
COMMENT ON FUNCTION public.finance_booking_review_live_snapshots(uuid[]) IS
  '예약별 현재 Clobe 배분 합계와 확인용 지문을 한 번에 반환한다.';

COMMIT;
